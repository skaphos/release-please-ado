#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Skaphos
// SPDX-License-Identifier: MIT
//
// Revoke a GitHub App installation token (DELETE /installation/token).
// Installation tokens live for an hour; revoking at job end shrinks the
// window in which a leaked token is useful.
//
//   GITHUB_TOKEN    token to revoke (required; no-op when empty)
//   GITHUB_API_URL  REST base. Default https://api.github.com

const token = process.env.GITHUB_TOKEN;
const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/u, '');

if (!token || token.startsWith('$(')) {
  console.log('No token to revoke.');
  process.exit(0);
}

const res = await fetch(`${apiUrl}/installation/token`, {
  method: 'DELETE',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'release-please-ado',
  },
});
if (res.status === 204 || res.status === 401) {
  console.log(res.status === 204 ? 'Installation token revoked.' : 'Token already invalid.');
} else {
  console.log(`##vso[task.logissue type=warning]Token revoke returned ${res.status}`);
}
