#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Skaphos
// SPDX-License-Identifier: MIT
//
// Mint a short-lived, repository-scoped GitHub App installation token.
//
// This is the Azure Pipelines equivalent of `actions/create-github-app-token`.
// It has zero npm dependencies (Node >= 20: global fetch + node:crypto) so it
// can run on locked-down agents that cannot reach the public npm registry.
//
// Inputs (environment variables):
//   GITHUB_APP_ID                App ID or Client ID (used as the JWT `iss`). Required.
//   GITHUB_APP_PRIVATE_KEY       PEM private key contents. Required unless
//   GITHUB_APP_PRIVATE_KEY_FILE  (a path to a PEM file) is given instead.
//   GITHUB_OWNER                 Org/user that owns the repository. Required.
//   GITHUB_REPOSITORIES          Comma/space separated repo names to scope the token to.
//                                Default: all repos the installation can access.
//   GITHUB_API_URL               REST base. Default https://api.github.com.
//                                GHES: https://<host>/api/v3
//   GITHUB_TOKEN_PERMISSIONS     Optional JSON object narrowing permissions, e.g.
//                                {"contents":"write","pull_requests":"write","issues":"write"}
//   ADO_OUTPUT_VARIABLE          Azure Pipelines secret variable to set.
//                                Default: GITHUB_TOKEN. Set to "" to print the
//                                token to stdout instead (local use only).
//
// The token is emitted with `##vso[task.setvariable ...;issecret=true;isOutput=true]`
// so Azure Pipelines masks it in logs and exposes it to later steps (and, via
// the step name, to later jobs).

import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/u, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_');
}

/**
 * Secret stores (Key Vault, ADO secret variables) frequently flatten newlines
 * to literal "\n" or spaces. Restore a parseable PEM.
 */
export function normalizePem(pem) {
  let text = String(pem).trim();
  if (text.includes('\\n')) text = text.replace(/\\n/gu, '\n');
  const match = text.match(/^(-----BEGIN [A-Z ]+-----)\s*([\s\S]*?)\s*(-----END [A-Z ]+-----)$/u);
  if (!match) return text;
  const body = match[2].replace(/\s+/gu, '');
  const lines = body.match(/.{1,64}/gu) ?? [];
  return `${match[1]}\n${lines.join('\n')}\n${match[3]}\n`;
}

/**
 * Build an RS256 JWT for GitHub App authentication. GitHub rejects JWTs whose
 * lifetime exceeds 10 minutes; iat is backdated 60s to tolerate clock skew.
 */
export function createAppJwt({ appId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  if (!appId) throw new Error('GITHUB_APP_ID is required');
  if (!privateKey) throw new Error('GitHub App private key is required');
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: String(appId) };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(normalizePem(privateKey));
  const signature = createSign('RSA-SHA256').update(signingInput).sign(key);
  return `${signingInput}.${base64url(signature)}`;
}

export function parseRepositories(value) {
  if (!value) return [];
  return String(value)
    .split(/[\s,]+/u)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.includes('/') ? r.split('/').pop() : r));
}

async function gh(apiUrl, path, { method = 'GET', token, body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${apiUrl.replace(/\/+$/u, '')}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'release-please-ado',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function mintInstallationToken({
  appId,
  privateKey,
  owner,
  repositories = [],
  apiUrl = 'https://api.github.com',
  permissions,
  fetchImpl = fetch,
}) {
  if (!owner) throw new Error('GITHUB_OWNER is required');
  const jwt = createAppJwt({ appId, privateKey });
  // Resolve the installation from a concrete repo when we have one (works for
  // user- and org-owned installs alike); otherwise from the org.
  const installation = repositories.length
    ? await gh(apiUrl, `/repos/${owner}/${repositories[0]}/installation`, { token: jwt, fetchImpl })
    : await gh(apiUrl, `/orgs/${owner}/installation`, { token: jwt, fetchImpl });
  const body = {};
  if (repositories.length) body.repositories = repositories;
  if (permissions) body.permissions = permissions;
  const result = await gh(apiUrl, `/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    token: jwt,
    body,
    fetchImpl,
  });
  return { token: result.token, expiresAt: result.expires_at, installationId: installation.id };
}

async function main() {
  const env = process.env;
  const privateKey =
    env.GITHUB_APP_PRIVATE_KEY ||
    (env.GITHUB_APP_PRIVATE_KEY_FILE ? readFileSync(env.GITHUB_APP_PRIVATE_KEY_FILE, 'utf8') : '');
  const permissions = env.GITHUB_TOKEN_PERMISSIONS ? JSON.parse(env.GITHUB_TOKEN_PERMISSIONS) : undefined;
  const { token, expiresAt, installationId } = await mintInstallationToken({
    appId: env.GITHUB_APP_ID,
    privateKey,
    owner: env.GITHUB_OWNER,
    repositories: parseRepositories(env.GITHUB_REPOSITORIES),
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    permissions,
  });
  const outVar = env.ADO_OUTPUT_VARIABLE ?? 'GITHUB_TOKEN';
  if (outVar) {
    // Register the secret first so it is masked even if something echoes it.
    console.log(`##vso[task.setsecret]${token}`);
    console.log(`##vso[task.setvariable variable=${outVar};issecret=true;isOutput=true]${token}`);
    console.log(`##vso[task.setvariable variable=${outVar};issecret=true]${token}`);
    console.log(`Minted installation token for installation ${installationId}; expires ${expiresAt}.`);
  } else {
    process.stdout.write(`${token}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.log(`##vso[task.logissue type=error]${err.message}`);
    console.error(err.message);
    process.exit(1);
  });
}
