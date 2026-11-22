import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';
import {
  createTestSessionCookie,
  createTamperedCiphertext,
  createExpiredSessionCookie,
} from '../helpers/crypto-fixtures.mjs';

test('Tier 3: Pairwise Flow 4 - Multi-Vector Security Defense Chain', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const client = new TestHttpClient(baseUrl);

  await t.test('Defense 1: Forged bit-flipped cookie targeting /admin is rejected', async () => {
    client.clearCookies();
    const valid = createTestSessionCookie();
    const forged = createTamperedCiphertext(valid);
    client.setCookie('blog_session', forged);

    const res = await client.get('/admin');
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location')?.includes('/login'));
  });

  await t.test('Defense 2: Expired cookie targeting /admin is evicted', async () => {
    client.clearCookies();
    const expired = createExpiredSessionCookie();
    client.setCookie('blog_session', expired);

    const res = await client.get('/admin');
    assert.equal(res.status, 302);
  });

  await t.test('Defense 3: Direct API probe without cookies is rejected with 401', async () => {
    client.clearCookies();
    const res = await client.postJson('/api/publish', { title: 'Probe' });
    assert.equal(res.status, 401);
  });

  await t.test('Defense 4: Directory traversal in slug path is rejected', async () => {
    client.clearCookies();
    const valid = createTestSessionCookie();
    client.setCookie('blog_session', valid);
    const res = await client.postJson('/api/publish', { slug: '../../etc/passwd', title: 'Traversal Probe' });
    assert.equal(res.status, 400);
  });

  await t.test('Defense 5: Re-authentication with valid owner credentials restores access', async () => {
    client.clearCookies();
    const valid = createTestSessionCookie();
    client.setCookie('blog_session', valid);

    const res = await client.get('/admin');
    assert.equal(res.status, 200);
  });
});
