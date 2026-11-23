#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Skaphos
// SPDX-License-Identifier: MIT
//
// Run googleapis/release-please from Azure Pipelines with the same behavior
// and outputs as googleapis/release-please-action.
//
// It drives the release-please *library* (not the CLI) so it can:
//   * run both phases in the action's order: releases first, then the release
//     PR (release-pr aborts while a merged release PR is still untagged);
//   * publish the action's outputs as Azure Pipelines output variables;
//   * offer `tag-only` mode: create an annotated tag instead of a GitHub
//     Release while still letting release-please flip the release PR label
//     from `autorelease: pending` to `autorelease: tagged`.
//
// Configuration is by environment variable (see docs/reference/templates.md,
// "Runner environment variables"):
//   RP_TOKEN              GitHub token (App installation token recommended). Required.
//   RP_REPO_URL           owner/repo. Required.
//   RP_API_URL            REST base. Default https://api.github.com (GHES: https://HOST/api/v3)
//   RP_GRAPHQL_URL        GraphQL base without /graphql. Default derived from RP_API_URL.
//   RP_SERVER_URL         Web base used for tag links. Default derived from RP_API_URL.
//   RP_TARGET_BRANCH      Branch to release from. Default: repository default branch.
//   RP_CONFIG_FILE        Default release-please-config.json
//   RP_MANIFEST_FILE      Default .release-please-manifest.json
//   RP_RELEASE_TYPE       If set, single-package mode (no config/manifest files).
//   RP_PATH               Package path for single-package mode.
//   RP_RELEASE_MODE       github-release (default) | tag-only | none
//   RP_SKIP_PULL_REQUEST  true to skip the release PR phase.
//   RP_FORK               true to open release PRs from a fork.
//   RP_SKIP_LABELING      true to skip labeling (breaks release detection; see docs).
//   RP_DRY_RUN            true to compute without writing anything.
//   RP_OUTPUT_FILE        Optional path to write all outputs as JSON.
//   RP_OUTPUT_PREFIX      Optional prefix for output variable names.

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const RELEASE_MODES = ['github-release', 'tag-only', 'none'];

const truthy = (v) => /^(1|true|yes|on)$/iu.test(String(v ?? '').trim());

/** Derive GraphQL and web URLs from a REST API URL (github.com, GHE.com, GHES). */
export function deriveUrls(apiUrl = 'https://api.github.com') {
  const api = apiUrl.replace(/\/+$/u, '');
  const u = new URL(api);
  if (u.hostname === 'api.github.com') {
    return { apiUrl: api, graphqlUrl: api, serverUrl: 'https://github.com' };
  }
  if (u.hostname.startsWith('api.') && !u.pathname.startsWith('/api')) {
    // GHE.com data residency: https://api.<tenant>.ghe.com
    return { apiUrl: api, graphqlUrl: api, serverUrl: `${u.protocol}//${u.hostname.slice(4)}` };
  }
  // GHES: https://HOST/api/v3 -> GraphQL https://HOST/api (octokit appends /graphql)
  return { apiUrl: api, graphqlUrl: `${u.origin}/api`, serverUrl: u.origin };
}

/** Strip a trailing /graphql, as release-please-action does. */
export function normalizeGraphqlUrl(url) {
  return url.replace(/\/+$/u, '').replace(/\/graphql$/u, '');
}

/**
 * Azure Pipelines variable names may contain only letters, digits, `.` and `_`.
 * The action's non-root outputs look like `packages/foo--tag_name`; map them to
 * `packages_foo__tag_name`.
 */
export function toAdoName(name) {
  return name.replace(/--/gu, '__').replace(/[^A-Za-z0-9_.]/gu, '_');
}

function stringify(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Compute outputs exactly as release-please-action's src/index.ts does.
 * Returns a plain object keyed by the action's output names.
 */
export function computeOutputs({ releases, prs }) {
  const out = {};
  const setPath = (path, key, value) => {
    out[path === '.' ? key : `${path}--${key}`] = value;
  };
  if (releases) {
    const created = releases.filter((r) => r !== undefined);
    const pathsReleased = [];
    out.releases_created = created.length > 0;
    const rename = { tagName: 'tag_name', uploadUrl: 'upload_url', notes: 'body', url: 'html_url' };
    for (const release of created) {
      const path = release.path || '.';
      pathsReleased.push(path);
      setPath(path, 'release_created', true);
      for (const [key, value] of Object.entries(release)) {
        setPath(path, rename[key] ?? key, value);
      }
    }
    out.paths_released = JSON.stringify(pathsReleased);
  }
  if (prs) {
    const created = prs.filter((p) => p !== undefined);
    out.prs_created = created.length > 0;
    if (created.length) {
      out.pr = created[0];
      out.prs = JSON.stringify(created);
    }
  }
  return out;
}

/** Render outputs as Azure Pipelines logging commands. */
export function adoOutputCommands(outputs, prefix = '') {
  return Object.entries(outputs).map(([key, value]) => {
    const name = toAdoName(`${prefix}${key}`);
    // Logging commands are line-oriented; multi-line values (release notes)
    // must be escaped or ADO truncates them at the first newline.
    const escaped = stringify(value).replace(/%/gu, '%AZP25').replace(/\r/gu, '%0D').replace(/\n/gu, '%0A');
    return `##vso[task.setvariable variable=${name};isOutput=true]${escaped}`;
  });
}

/**
 * Replace GitHub.createRelease with an annotated-tag implementation. The
 * Manifest keeps its own bookkeeping (PR comment, label flip, duplicate
 * handling), so the release PR still ends up `autorelease: tagged`.
 */
export function installTagOnlyRelease(github, { token, apiUrl, serverUrl, owner, repo, Errors, fetchImpl = fetch }) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${apiUrl}/repos/${owner}/${repo}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'release-please-ado',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return { ok: res.ok, status: res.status, data };
  };
  github.createRelease = async (release) => {
    const tagName = release.tag.toString();
    const tag = await call('POST', '/git/tags', {
      tag: tagName,
      message: release.notes || tagName,
      object: release.sha,
      type: 'commit',
    });
    if (!tag.ok) throw new Error(`create tag object ${tagName} failed: ${tag.status} ${JSON.stringify(tag.data)}`);
    const ref = await call('POST', '/git/refs', { ref: `refs/tags/${tagName}`, sha: tag.data.sha });
    if (!ref.ok) {
      if (ref.status === 422 && /already exists/iu.test(JSON.stringify(ref.data))) {
        throw new Errors.DuplicateReleaseError({ status: 422, message: `tag ${tagName} already exists`, response: { data: ref.data } }, tagName);
      }
      throw new Error(`create ref refs/tags/${tagName} failed: ${ref.status} ${JSON.stringify(ref.data)}`);
    }
    return {
      id: 0,
      name: release.name,
      tagName,
      sha: release.sha,
      notes: release.notes,
      url: `${serverUrl}/${owner}/${repo}/tree/${encodeURIComponent(tagName)}`,
      draft: false,
      uploadUrl: '',
    };
  };
  return github;
}

export function readConfig(env = process.env) {
  const [owner, repo] = String(env.RP_REPO_URL ?? '')
    .replace(/^https?:\/\/[^/]+\//u, '')
    .replace(/\.git$/u, '')
    .split('/');
  if (!env.RP_TOKEN) throw new Error('RP_TOKEN is required');
  if (!owner || !repo) throw new Error('RP_REPO_URL must be owner/repo');
  const derived = deriveUrls(env.RP_API_URL || 'https://api.github.com');
  const releaseMode = env.RP_RELEASE_MODE || 'github-release';
  if (!RELEASE_MODES.includes(releaseMode)) {
    throw new Error(`RP_RELEASE_MODE must be one of ${RELEASE_MODES.join(', ')}`);
  }
  return {
    token: env.RP_TOKEN,
    owner,
    repo,
    apiUrl: derived.apiUrl,
    graphqlUrl: normalizeGraphqlUrl(env.RP_GRAPHQL_URL || derived.graphqlUrl),
    serverUrl: (env.RP_SERVER_URL || derived.serverUrl).replace(/\/+$/u, ''),
    targetBranch: env.RP_TARGET_BRANCH || undefined,
    configFile: env.RP_CONFIG_FILE || 'release-please-config.json',
    manifestFile: env.RP_MANIFEST_FILE || '.release-please-manifest.json',
    releaseType: env.RP_RELEASE_TYPE || undefined,
    path: env.RP_PATH || undefined,
    releaseMode,
    skipPullRequest: truthy(env.RP_SKIP_PULL_REQUEST),
    fork: truthy(env.RP_FORK),
    skipLabeling: truthy(env.RP_SKIP_LABELING),
    dryRun: truthy(env.RP_DRY_RUN),
    outputFile: env.RP_OUTPUT_FILE || '',
    outputPrefix: env.RP_OUTPUT_PREFIX || '',
  };
}

export async function run(cfg, { rp = require('release-please'), log = console.log } = {}) {
  const { GitHub, Manifest, Errors } = rp;
  const github = await GitHub.create({
    owner: cfg.owner,
    repo: cfg.repo,
    token: cfg.token,
    apiUrl: cfg.apiUrl,
    graphqlUrl: cfg.graphqlUrl,
    defaultBranch: cfg.targetBranch,
  });
  if (cfg.releaseMode === 'tag-only') {
    installTagOnlyRelease(github, { ...cfg, Errors });
  }
  const targetBranch = cfg.targetBranch || github.repository.defaultBranch;
  const overrides = cfg.fork || cfg.skipLabeling ? { fork: cfg.fork, skipLabeling: cfg.skipLabeling } : {};
  // The action builds a fresh Manifest for each phase; so do we, so the PR
  // phase sees the tags and labels the release phase just wrote.
  const load = () =>
    cfg.releaseType
      ? Manifest.fromConfig(github, targetBranch, { releaseType: cfg.releaseType }, overrides, cfg.path)
      : Manifest.fromManifest(github, targetBranch, cfg.configFile, cfg.manifestFile, overrides);

  if (cfg.dryRun) {
    const plan = {};
    if (cfg.releaseMode !== 'none') {
      plan.releases = (await (await load()).buildReleases()).map((r) => ({
        path: r.path,
        tag: r.tag.toString(),
        sha: r.sha,
        pullRequest: r.pullRequest?.number,
      }));
    }
    if (!cfg.skipPullRequest) {
      plan.pullRequests = (await (await load()).buildPullRequests()).map((p) => ({
        title: p.title.toString(),
        headRefName: p.headRefName,
        labels: p.labels,
        updates: p.updates.map((u) => u.path),
      }));
    }
    log(JSON.stringify(plan, null, 2));
    return { dryRun: true, plan };
  }

  let releases;
  let prs;
  if (cfg.releaseMode !== 'none') releases = await (await load()).createReleases();
  if (!cfg.skipPullRequest) prs = await (await load()).createPullRequests();
  const outputs = computeOutputs({ releases, prs });
  for (const line of adoOutputCommands(outputs, cfg.outputPrefix)) log(line);
  if (cfg.outputFile) writeFileSync(cfg.outputFile, `${JSON.stringify(outputs, null, 2)}\n`);
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(readConfig()).catch((err) => {
    console.log(`##vso[task.logissue type=error]${String(err.message).split('\n')[0]}`);
    console.error(err);
    process.exit(1);
  });
}
