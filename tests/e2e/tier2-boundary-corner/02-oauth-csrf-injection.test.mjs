import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';

test('Tier 2: OAuth CSRF, State Invariants & Injection Boundaries', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('2.1 State mismatch in callback returns 400 Bad Request', async () => {
    client.clearCookies();
    client.setCookie('oauth_state', 'expected_state_abc');
    const res = await client.get('/api/auth/callback?code=code_owner&state=forged_state_xyz');
    assert.equal(res.status, 400);
  });

  await t.test('2.2 Missing state query parameter in callback returns 400 Bad Request', async () => {
    client.clearCookies();
    client.setCookie('oauth_state', 'expected_state_abc');
    const res = await client.get('/api/auth/callback?code=code_owner');
    assert.equal(res.status, 400);
  });

  await t.test('2.3 Missing oauth_state cookie in callback returns 400 Bad Request', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/callback?code=code_owner&state=any_state');
    assert.equal(res.status, 400);
  });

  await t.test('2.4 Open redirect vector: external domain https://attacker.com is sanitized', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login?redirect=https://attacker.com');
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.ok(loc);
    assert.ok(!loc.includes('attacker.com'));
  });

  await t.test('2.5 Open redirect vector: protocol-relative //attacker.com is sanitized', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login?redirect=//attacker.com');
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.ok(loc);
    assert.ok(!loc.includes('//attacker.com'));
  });

  await t.test('2.6 Open redirect vector: javascript: URI is sanitized', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login?redirect=javascript:alert(1)');
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.ok(loc);
    assert.ok(!loc.includes('javascript:'));
  });

  await t.test('2.7 XSS / SQLi code parameters do not cause unexpected server exceptions', async () => {
    const maliciousCode = '<script>alert(1)</script>';
    const res = await fetch(`${mockUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: maliciousCode }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.access_token || data.error);
  });

  await t.test('2.8 Unauthorized user login attempt returns 403 and records upstream revocation', async () => {
    // Reset mock server to inspect revocation log cleanly
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });

    client.clearCookies();
    client.setCookie('oauth_state', 'unauth_csrf_state');
    const res = await client.get('/api/auth/callback?code=code_unauthorized&state=unauth_csrf_state');
    assert.equal(res.status, 403);
    const logs = await (await fetch(`${mockUrl}/__mock/revocations`)).json();
    assert.ok(logs.some((l) => l.token === 'token_unauth_valid'), 'Must record upstream revocation');
  });
});
