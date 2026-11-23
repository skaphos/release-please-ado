// SPDX-FileCopyrightText: 2026 Skaphos
// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import {
  adoOutputCommands,
  computeOutputs,
  deriveUrls,
  installTagOnlyRelease,
  normalizeGraphqlUrl,
  readConfig,
  run,
  toAdoName,
} from '../scripts/release-please-run.mjs';

const require = createRequire(import.meta.url);
const { Errors } = require('release-please');

test('deriveUrls handles github.com, GHE.com and GHES', () => {
  assert.deepEqual(deriveUrls(), {
    apiUrl: 'https://api.github.com',
    graphqlUrl: 'https://api.github.com',
    serverUrl: 'https://github.com',
  });
  assert.deepEqual(deriveUrls('https://api.acme.ghe.com'), {
    apiUrl: 'https://api.acme.ghe.com',
    graphqlUrl: 'https://api.acme.ghe.com',
    serverUrl: 'https://acme.ghe.com',
  });
  assert.deepEqual(deriveUrls('https://github.acme.internal/api/v3/'), {
    apiUrl: 'https://github.acme.internal/api/v3',
    graphqlUrl: 'https://github.acme.internal/api',
    serverUrl: 'https://github.acme.internal',
  });
  assert.equal(normalizeGraphqlUrl('https://h/api/graphql/'), 'https://h/api');
});

test('toAdoName maps action output names to legal ADO variable names', () => {
  assert.equal(toAdoName('tag_name'), 'tag_name');
  assert.equal(toAdoName('packages/foo--tag_name'), 'packages_foo__tag_name');
  assert.equal(toAdoName('@scope/pkg--version'), '_scope_pkg__version');
});

test('computeOutputs mirrors release-please-action', () => {
  const releases = [
    undefined,
    {
      id: 1, name: 'v1.2.3', tagName: 'v1.2.3', sha: 'abc', notes: 'notes', url: 'https://x/r/1',
      draft: false, uploadUrl: 'https://u', path: '.', version: '1.2.3', major: 1, minor: 2, patch: 3, prNumber: 9,
    },
    { tagName: 'foo-v0.1.0', path: 'packages/foo', version: '0.1.0', url: 'https://x/r/2', notes: 'n2' },
  ];
  const prs = [{ number: 10, title: 'chore(main): release 1.3.0' }];
  const out = computeOutputs({ releases, prs });
  assert.equal(out.releases_created, true);
  assert.equal(out.release_created, true);
  assert.equal(out.tag_name, 'v1.2.3');
  assert.equal(out.body, 'notes');
  assert.equal(out.html_url, 'https://x/r/1');
  assert.equal(out.upload_url, 'https://u');
  assert.equal(out.major, 1);
  assert.equal(out['packages/foo--release_created'], true);
  assert.equal(out['packages/foo--tag_name'], 'foo-v0.1.0');
  assert.equal(out.paths_released, '[".","packages/foo"]');
  assert.equal(out.prs_created, true);
  assert.deepEqual(out.pr, prs[0]);
  assert.equal(out.prs, JSON.stringify(prs));
});

test('computeOutputs with nothing to do', () => {
  assert.deepEqual(computeOutputs({ releases: [], prs: [undefined] }), {
    releases_created: false,
    paths_released: '[]',
    prs_created: false,
  });
  assert.deepEqual(computeOutputs({}), {});
});

test('adoOutputCommands escapes multi-line values and applies prefix', () => {
  const lines = adoOutputCommands({ body: 'a\nb 100%', 'pkg/x--version': '1.0.0', pr: { n: 1 } }, 'rp_');
  assert.deepEqual(lines, [
    '##vso[task.setvariable variable=rp_body;isOutput=true]a%0Ab 100%AZP25',
    '##vso[task.setvariable variable=rp_pkg_x__version;isOutput=true]1.0.0',
    '##vso[task.setvariable variable=rp_pr;isOutput=true]{"n":1}',
  ]);
});

test('readConfig validates and defaults', () => {
  assert.throws(() => readConfig({}), /RP_TOKEN/u);
  assert.throws(() => readConfig({ RP_TOKEN: 't', RP_REPO_URL: 'nope' }), /owner\/repo/u);
  assert.throws(() => readConfig({ RP_TOKEN: 't', RP_REPO_URL: 'a/b', RP_RELEASE_MODE: 'x' }), /RP_RELEASE_MODE/u);
  const cfg = readConfig({
    RP_TOKEN: 't',
    RP_REPO_URL: 'https://github.acme.internal/acme/widgets.git',
    RP_API_URL: 'https://github.acme.internal/api/v3',
    RP_DRY_RUN: 'true',
  });
  assert.equal(cfg.owner, 'acme');
  assert.equal(cfg.repo, 'widgets');
  assert.equal(cfg.graphqlUrl, 'https://github.acme.internal/api');
  assert.equal(cfg.releaseMode, 'github-release');
  assert.equal(cfg.dryRun, true);
});

const fakeRelease = {
  tag: { toString: () => 'v1.0.0' },
  sha: 'deadbeef',
  notes: '## 1.0.0\n\n* feat',
  name: 'v1.0.0',
};

test('tag-only release creates an annotated tag and returns a release-shaped object', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/git/tags')) return new Response(JSON.stringify({ sha: 'tagobj' }), { status: 201 });
    return new Response(JSON.stringify({ ref: 'refs/tags/v1.0.0' }), { status: 201 });
  };
  const github = {};
  installTagOnlyRelease(github, {
    token: 't', apiUrl: 'https://api.github.com', serverUrl: 'https://github.com', owner: 'o', repo: 'r', Errors, fetchImpl,
  });
  const created = await github.createRelease(fakeRelease);
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/git/tags');
  assert.deepEqual(calls[0].body, { tag: 'v1.0.0', message: fakeRelease.notes, object: 'deadbeef', type: 'commit' });
  assert.deepEqual(calls[1].body, { ref: 'refs/tags/v1.0.0', sha: 'tagobj' });
  assert.equal(created.tagName, 'v1.0.0');
  assert.equal(created.url, 'https://github.com/o/r/tree/v1.0.0');
});

test('tag-only release raises DuplicateReleaseError when the tag exists', async () => {
  const fetchImpl = async (url) =>
    url.endsWith('/git/tags')
      ? new Response(JSON.stringify({ sha: 'tagobj' }), { status: 201 })
      : new Response(JSON.stringify({ message: 'Reference already exists' }), { status: 422 });
  const github = {};
  installTagOnlyRelease(github, {
    token: 't', apiUrl: 'https://h/api/v3', serverUrl: 'https://h', owner: 'o', repo: 'r', Errors, fetchImpl,
  });
  await assert.rejects(github.createRelease(fakeRelease), (err) => err instanceof Errors.DuplicateReleaseError);
});

function fakeRp({ releases = [], prs = [] } = {}) {
  const order = [];
  const manifest = {
    createReleases: async () => (order.push('releases'), releases),
    createPullRequests: async () => (order.push('prs'), prs),
  };
  return {
    order,
    rp: {
      Errors,
      GitHub: { create: async (opts) => ({ opts, repository: { defaultBranch: 'main' } }) },
      Manifest: {
        fromManifest: async (gh, branch, config, manifestFile) => (order.push(`load:${branch}:${config}:${manifestFile}`), manifest),
        fromConfig: async () => manifest,
      },
    },
  };
}

test('run() executes releases before PRs and emits ADO outputs', async () => {
  const { rp, order } = fakeRp({ releases: [{ tagName: 'v2.0.0', path: '.', version: '2.0.0' }], prs: [] });
  const lines = [];
  const cfg = readConfig({ RP_TOKEN: 't', RP_REPO_URL: 'o/r' });
  const out = await run(cfg, { rp, log: (l) => lines.push(l) });
  assert.deepEqual(order, [
    'load:main:release-please-config.json:.release-please-manifest.json',
    'releases',
    'load:main:release-please-config.json:.release-please-manifest.json',
    'prs',
  ]);
  assert.equal(out.tag_name, 'v2.0.0');
  assert.ok(lines.includes('##vso[task.setvariable variable=releases_created;isOutput=true]true'));
  assert.ok(lines.includes('##vso[task.setvariable variable=prs_created;isOutput=true]false'));
});

test('run() honors release mode none and skip pull request', async () => {
  const { rp, order } = fakeRp();
  const cfg = readConfig({ RP_TOKEN: 't', RP_REPO_URL: 'o/r', RP_RELEASE_MODE: 'none', RP_SKIP_PULL_REQUEST: 'true' });
  const out = await run(cfg, { rp, log: () => {} });
  assert.deepEqual(order, []);
  assert.deepEqual(out, {});
});
