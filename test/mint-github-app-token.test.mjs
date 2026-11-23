// SPDX-FileCopyrightText: 2026 Skaphos
// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import {
  createAppJwt,
  mintInstallationToken,
  normalizePem,
  parseRepositories,
} from '../scripts/mint-github-app-token.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('createAppJwt produces a verifiable RS256 JWT with a <=10 minute lifetime', () => {
  const now = 1_800_000_000;
  const jwt = createAppJwt({ appId: 'Iv23liExample', privateKey, now });
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT' });
  const payload = decode(p);
  assert.equal(payload.iss, 'Iv23liExample');
  assert.equal(payload.iat, now - 60);
  assert.ok(payload.exp - payload.iat <= 600, 'GitHub caps JWT lifetime at 10 minutes');
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'signature verifies with the public key');
});

test('normalizePem repairs keys flattened by secret stores', () => {
  const flattenedEscaped = privateKey.trim().replace(/\n/gu, '\\n');
  const flattenedSpaces = privateKey.trim().replace(/\n/gu, ' ');
  for (const variant of [flattenedEscaped, flattenedSpaces]) {
    const jwt = createAppJwt({ appId: '1', privateKey: variant });
    assert.equal(jwt.split('.').length, 3);
  }
  assert.ok(normalizePem(flattenedSpaces).startsWith('-----BEGIN RSA PRIVATE KEY-----\n'));
});

test('parseRepositories accepts owner/name, commas, and whitespace', () => {
  assert.deepEqual(parseRepositories('org/a, b  c\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(parseRepositories(''), []);
});

test('mintInstallationToken resolves the installation from the repo and scopes the token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/repos/acme/widgets/installation')) {
      return new Response(JSON.stringify({ id: 42 }), { status: 200 });
    }
    if (url.endsWith('/app/installations/42/access_tokens')) {
      return new Response(JSON.stringify({ token: 'ghs_x', expires_at: '2026-01-01T00:00:00Z' }), {
        status: 201,
      });
    }
    return new Response('not found', { status: 404 });
  };
  const result = await mintInstallationToken({
    appId: '1',
    privateKey,
    owner: 'acme',
    repositories: ['widgets'],
    apiUrl: 'https://ghe.example.com/api/v3/',
    permissions: { contents: 'write' },
    fetchImpl,
  });
  assert.equal(result.token, 'ghs_x');
  assert.equal(result.installationId, 42);
  assert.equal(calls[0].url, 'https://ghe.example.com/api/v3/repos/acme/widgets/installation');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    repositories: ['widgets'],
    permissions: { contents: 'write' },
  });
});

test('mintInstallationToken surfaces API errors', async () => {
  const fetchImpl = async () => new Response('Bad credentials', { status: 401, statusText: 'Unauthorized' });
  await assert.rejects(
    mintInstallationToken({ appId: '1', privateKey, owner: 'acme', fetchImpl }),
    /401 Unauthorized Bad credentials/u,
  );
});
