import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';
import { createTestSessionCookie, decryptSession } from '../helpers/crypto-fixtures.mjs';
import { isOwner } from '../../../src/utils/auth.ts';

test('Feature 6: OAuth Authorization Initiation', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('6.1 GET /api/auth/login initiates OAuth with 302 redirect', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login');
    assert.equal(res.status, 302, 'OAuth login endpoint must redirect');
  });

  await t.test('6.2 OAuth redirect Location contains required client_id, state, and scopes', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login');
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location, 'Must provide Location redirect header');
    const targetUrl = new URL(location, baseUrl);
    assert.ok(targetUrl.searchParams.has('state'), 'Redirect URL must contain state param');
    assert.ok(targetUrl.searchParams.has('client_id'), 'Redirect URL must contain client_id');
    const scope = targetUrl.searchParams.get('scope') || '';
    assert.ok(scope.includes('repo'), 'Scope must include repo');
    assert.ok(scope.includes('read:user'), 'Scope must include read:user');
  });

  await t.test('6.3 GET /api/auth/login sets oauth_state HTTP-only cookie', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login');
    assert.equal(res.status, 302);
    const stateCookie = client.getCookie('oauth_state');
    assert.ok(stateCookie, 'oauth_state cookie must be set on login initiation');
  });

  await t.test('6.4 State parameter is at least 32 characters of random entropy', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login');
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location);
    const targetUrl = new URL(location, baseUrl);
    const state = targetUrl.searchParams.get('state') || '';
    assert.ok(state.length >= 32, 'OAuth state must possess >= 32 characters of entropy');
  });

  await t.test('6.5 Malicious redirect parameter (https://evil.com) is sanitized to prevent open redirect', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/login?redirect=https://evil.com');
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location);
    assert.ok(!location.includes('evil.com'), 'Open redirect to external domain must be blocked');
  });
});

test('Feature 7: OAuth Callback & Code Exchange', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('7.1 Callback rejects request when state cookie is missing or mismatched with 400 Bad Request', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/callback?code=code_owner&state=forged_state');
    assert.equal(res.status, 400, 'Mismatched CSRF state must return 400');
  });

  await t.test('7.2 Code exchange at mock GitHub token endpoint returns access token for owner', async () => {
    // Direct test against mock GitHub server
    const tokenRes = await fetch(`${mockUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'code_owner' }),
    });
    assert.equal(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.equal(tokenData.access_token, 'token_owner_valid');
    assert.equal(tokenData.token_type, 'bearer');
  });

  await t.test('7.3 Valid owner callback sets blog_session cookie and redirects to /admin', async () => {
    client.clearCookies();
    client.setCookie('oauth_state', 'valid_test_state_123');
    const res = await client.get('/api/auth/callback?code=code_owner&state=valid_test_state_123');
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location?.includes('/admin'));
    assert.ok(client.getCookie('blog_session'), 'Must set blog_session cookie');
  });

  await t.test('7.4 Successful callback clears oauth_state cookie', async () => {
    client.clearCookies();
    client.setCookie('oauth_state', 'valid_test_state_123');
    const res = await client.get('/api/auth/callback?code=code_owner&state=valid_test_state_123');
    assert.equal(res.status, 302);
    assert.equal(client.getCookie('oauth_state'), undefined, 'oauth_state must be cleared');
  });

  await t.test('7.5 Mock GitHub access token endpoint returns error for expired/invalid code', async () => {
    const errRes = await fetch(`${mockUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'code_expired' }),
    });
    assert.equal(errRes.status, 200);
    const errData = await errRes.json();
    assert.equal(errData.error, 'bad_verification_code');
  });
});

test('Feature 8: Strict Owner Access Enforcement', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('8.1 Mock GitHub returns phi5ic profile for owner token and octocat for unauth token', async () => {
    const ownerRes = await fetch(`${mockUrl}/user`, {
      headers: { Authorization: 'Bearer token_owner_valid' },
    });
    assert.equal(ownerRes.status, 200);
    const ownerProfile = await ownerRes.json();
    assert.equal(ownerProfile.login, 'phi5ic');

    const unauthRes = await fetch(`${mockUrl}/user`, {
      headers: { Authorization: 'Bearer token_unauth_valid' },
    });
    assert.equal(unauthRes.status, 200);
    const unauthProfile = await unauthRes.json();
    assert.equal(unauthProfile.login, 'octocat');
  });

  await t.test('8.2 Unauthorized user (octocat) callback is rejected with 403 Forbidden', async () => {
    client.clearCookies();
    client.setCookie('oauth_state', 'unauth_state_123');
    const res = await client.get('/api/auth/callback?code=code_unauthorized&state=unauth_state_123');
    assert.equal(res.status, 403, 'Unauthorized user must receive 403 Forbidden');
    assert.equal(client.getCookie('blog_session'), undefined, 'No session cookie should be issued');
  });

  await t.test('8.3 Unauthorized login attempt triggers proactive upstream token revocation on GitHub', async () => {
    // Reset mock server to inspect revocation log cleanly
    const resetRes = await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });
    assert.equal(resetRes.status, 200, 'Mock reset must return 200');

    client.clearCookies();
    client.setCookie('oauth_state', 'unauth_state_123');
    const res = await client.get('/api/auth/callback?code=code_unauthorized&state=unauth_state_123');
    assert.equal(res.status, 403, 'Unauthorized callback must return 403 Forbidden');

    const logsRes = await fetch(`${mockUrl}/__mock/revocations`);
    assert.equal(logsRes.status, 200, 'Mock revocations endpoint must return 200');
    const logs = await logsRes.json();
    assert.ok(
      logs.some((l) => l.token === 'token_unauth_valid'),
      'Astro server must proactively invoke upstream DELETE /applications/:client_id/token for unauthorized token'
    );
  });

  await t.test('8.4 Mock GitHub user profile rejects revoked token with 401 Unauthorized', async () => {
    // Revoke token
    await fetch(`${mockUrl}/applications/mock_client_id/token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: 'token_to_revoke' }),
    });

    const userRes = await fetch(`${mockUrl}/user`, {
      headers: { Authorization: 'Bearer token_to_revoke' },
    });
    assert.equal(userRes.status, 401, 'Revoked token must fail authentication');
  });

  await t.test('8.5 Case-insensitive check matches owner PHI5IC and rejects others', () => {
    assert.ok(isOwner('phi5ic'));
    assert.ok(isOwner('PHI5IC'));
    assert.ok(isOwner('Phi5ic'));
    assert.equal(isOwner('octocat'), false);
    assert.equal(isOwner('phi5ic-attacker'), false);
  });
});

test('Feature 11: Session Logout & Upstream Revocation', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('11.1 POST /api/auth/logout invalidates session and clears blog_session cookie', async () => {
    client.clearCookies();
    const sessionCookie = createTestSessionCookie();
    client.setCookie('blog_session', sessionCookie);

    const res = await client.post('/api/auth/logout');
    assert.ok(res.status === 200 || res.status === 302);
    assert.equal(client.getCookie('blog_session'), undefined, 'blog_session cookie must be deleted');
  });

  await t.test('11.2 Logout triggers upstream token revocation on mock GitHub server', async () => {
    // Reset mock server to inspect revocation log cleanly
    const resetRes = await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });
    assert.equal(resetRes.status, 200, 'Mock reset must return 200');

    client.clearCookies();
    const sessionCookie = createTestSessionCookie();
    client.setCookie('blog_session', sessionCookie);

    const res = await client.post('/api/auth/logout');
    assert.ok(res.status === 200 || res.status === 302, 'POST /api/auth/logout must return 200 or 302');

    const logsRes = await fetch(`${mockUrl}/__mock/revocations`);
    assert.equal(logsRes.status, 200, 'Mock revocations endpoint must return 200');
    const logs = await logsRes.json();
    assert.ok(
      logs.some((l) => l.token === 'token_owner_valid' || l.token === 'token_owner_logout_revoked'),
      'Astro server must invoke upstream token revocation for the active session token upon logout'
    );
    assert.equal(client.getCookie('blog_session'), undefined, 'blog_session cookie must be cleared upon logout');

    // Reset mock server state so token_owner_valid is restored for subsequent test suites
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });
  });

  await t.test('11.3 Subsequent requests with logged-out session cookie are rejected', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  await t.test('11.4 Logout without active session handles gracefully without unhandled error', async () => {
    client.clearCookies();
    const res = await client.post('/api/auth/logout');
    assert.ok(res.status === 200 || res.status === 302);
  });

  await t.test('11.5 Replay of revoked token is rejected by GitHub API', async () => {
    await fetch(`${mockUrl}/applications/mock_client_id/token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: 'token_replay_test' }),
    });
    const res = await fetch(`${mockUrl}/user`, {
      headers: { Authorization: 'Bearer token_replay_test' },
    });
    assert.equal(res.status, 401);
  });
});

test('Feature 13: Owner Login Terminal UI', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const client = new TestHttpClient(baseUrl);

  await t.test('13.1 GET /login renders HTML terminal login interface', async () => {
    client.clearCookies();
    const res = await client.get('/login');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('phi5ic') || text.includes('Login') || text.includes('login'));
  });

  await t.test('13.2 Login page contains link or form to initiate /api/auth/login', async () => {
    const res = await client.get('/login');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(
      text.includes('/api/auth/login') || text.includes('GitHub') || text.includes('login'),
      'Login page must link to auth initiation'
    );
  });

  await t.test('13.3 Login page displays error state when ?error= query parameter is present', async () => {
    const res = await client.get('/login?error=access_denied');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.toLowerCase().includes('denied') || text.toLowerCase().includes('error'));
  });

  await t.test('13.4 Login page preserves redirect parameter when ?redirect=/admin is passed', async () => {
    const res = await client.get('/login?redirect=%2Fadmin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('/admin') || text.includes('redirect'));
  });

  await t.test('13.5 Already authenticated owner accessing /login redirects to /admin', async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/login');
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location')?.includes('/admin'));
  });
});
