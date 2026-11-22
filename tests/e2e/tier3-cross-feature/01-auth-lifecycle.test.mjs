import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';
import { createTestSessionCookie, decryptSession } from '../helpers/crypto-fixtures.mjs';

test('Tier 3: Pairwise Flow 1 - Complete Authentication Lifecycle', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('Flow Step 1: User visits login page', async () => {
    // Reset mock server to ensure clean state
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });

    client.clearCookies();
    const res = await client.get('/login');
    assert.equal(res.status, 200);
  });

  await t.test('Flow Step 2: User initiates OAuth login', async () => {
    const res = await client.get('/api/auth/login?redirect=%2Fadmin');
    assert.equal(res.status, 302);
    assert.ok(client.getCookie('oauth_state'), 'oauth_state cookie must be set');
  });

  await t.test('Flow Step 3: GitHub redirects to callback with valid owner code', async () => {
    const state = client.getCookie('oauth_state');
    assert.ok(state, 'Must have oauth_state from step 2');
    const res = await client.get(`/api/auth/callback?code=code_owner&state=${state}`);
    assert.equal(res.status, 302);
    assert.ok(client.getCookie('blog_session'), 'Must set blog_session cookie');
  });

  await t.test('Flow Step 4: Owner accesses protected dashboard with session cookie', { todo: 'Pending M3 /admin route mounting' }, async () => {
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
  });

  await t.test('Flow Step 5: Owner checks session API status', async () => {
    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.authenticated, true);
    assert.equal(data.user.login, 'phi5ic');
  });

  await t.test('Flow Step 6: Owner logs out cleanly', async () => {
    const res = await client.post('/api/auth/logout');
    assert.ok(res.status === 200 || res.status === 302);
    assert.equal(client.getCookie('blog_session'), undefined, 'blog_session must be cleared');
    // Reset mock state to restore token for subsequent tests
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });
  });

  await t.test('Flow Step 7: Accessing dashboard after logout is redirected to /login', { todo: 'Pending M3 /admin route mounting' }, async () => {
    const res = await client.get('/admin');
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location')?.includes('/login'));
  });
});
