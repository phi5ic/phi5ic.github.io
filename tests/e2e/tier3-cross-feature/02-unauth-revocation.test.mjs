import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';

test('Tier 3: Pairwise Flow 2 - Unauthorized Access & Proactive Revocation', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('Flow Step 1: Reset mock GitHub server state', async () => {
    const res = await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });
    assert.equal(res.status, 200);
  });

  await t.test('Flow Step 2: Attacker initiates OAuth login', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login');
    assert.equal(res.status, 302, 'Login initiation endpoint must redirect (HTTP 302)');
    const state = client.getCookie('oauth_state');
    assert.ok(state, 'oauth_state cookie must be set by /api/auth/login');
  });

  await t.test('Flow Step 3: Callback with unauthorized user code triggers 403 and proactive revocation', async () => {
    const state = client.getCookie('oauth_state');
    assert.ok(state, 'oauth_state cookie must be present from login initiation');
    const res = await client.get(`/api/auth/callback?code=code_unauthorized&state=${state}`);
    assert.equal(res.status, 403, 'Unauthorized OAuth callback must return 403 Forbidden');
  });

  await t.test('Flow Step 4: Verify token is recorded in mock server revocation log', async () => {
    const logsRes = await fetch(`${mockUrl}/__mock/revocations`);
    const logs = await logsRes.json();
    assert.ok(logs.some((l) => l.token === 'token_unauth_valid'));
  });

  await t.test('Flow Step 5: Verify revoked token is now rejected by mock GitHub user endpoint', async () => {
    const userRes = await fetch(`${mockUrl}/user`, {
      headers: { Authorization: 'Bearer token_unauth_valid' },
    });
    assert.equal(userRes.status, 401, 'Revoked token must be rejected with 401');
  });

  await t.test('Flow Step 6: Verify no blog_session cookie was issued to the unauthorized client', () => {
    assert.equal(client.getCookie('blog_session'), undefined);
  });
});
