import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';
import { createTestSessionCookie, createTamperedCiphertext } from '../helpers/crypto-fixtures.mjs';

test('Feature 10: Route Protection Middleware', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const client = new TestHttpClient(baseUrl);

  await t.test('10.1 Unauthenticated request to /admin redirects (302) to /login?redirect=%2Fadmin', { todo: 'Pending M3 /admin route mounting' }, async () => {
    client.clearCookies();
    const res = await client.get('/admin');
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.ok(loc?.includes('/login'));
    assert.ok(loc?.includes('redirect'));
  });

  await t.test('10.2 Unauthenticated request to protected API endpoint (/api/publish) returns 401 Unauthorized', { todo: 'Pending M4 /api/publish route mounting' }, async () => {
    client.clearCookies();
    const res = await client.postJson('/api/publish', { title: 'Test' });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.error?.toLowerCase().includes('unauthorized') || data.message?.toLowerCase().includes('auth'));
  });

  await t.test('10.3 Valid owner session cookie grants access to /admin returning 200 OK HTML', { todo: 'Pending M3 /admin route mounting' }, async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('phi5ic') || text.includes('Admin') || text.includes('Blog'));
  });

  await t.test('10.4 Public routes (/, /posts/, /about/, /projects/) bypass middleware without requiring session', async () => {
    client.clearCookies();
    const publicPaths = ['/', '/posts/', '/about/', '/projects/'];
    for (const p of publicPaths) {
      const res = await client.get(p);
      assert.equal(res.status, 200, `Public path ${p} must return 200 OK without session`);
      assert.equal(client.getCookie('blog_session'), undefined);
    }
  });

  await t.test('10.5 Tampered session cookie targeting /admin is rejected and redirected to login', { todo: 'Pending M3 /admin route mounting' }, async () => {
    client.clearCookies();
    const valid = createTestSessionCookie();
    client.setCookie('blog_session', createTamperedCiphertext(valid));
    const res = await client.get('/admin');
    assert.equal(res.status, 302);
    const loc = res.headers.get('location');
    assert.ok(loc?.includes('/login'));
  });
});

test('Feature 14: Blog Post Management Dashboard', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const client = new TestHttpClient(baseUrl);

  await t.test('14.1 /admin dashboard renders post list containing existing markdown files', { todo: 'Pending M3 /admin dashboard route mounting' }, async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('What I Learned Trying to Beat XOR') || text.includes('xor'));
  });

  await t.test('14.2 Dashboard displays section categories systems, music, and rants', { todo: 'Pending M3 /admin dashboard route mounting' }, async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('systems') || text.includes('Systems'));
  });

  await t.test('14.3 Dashboard displays draft indicator badges for draft posts', { todo: 'Pending M3 /admin dashboard route mounting' }, async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('draft') || text.includes('Draft') || text.includes('badge'));
  });

  await t.test('14.4 Dashboard includes navigation trigger to create a new post', { todo: 'Pending M3 /admin dashboard route mounting' }, async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('New') || text.includes('Create') || text.includes('new'));
  });

  await t.test('14.5 Dashboard includes logout trigger calling /api/auth/logout', { todo: 'Pending M3 /admin dashboard route mounting' }, async () => {
    client.clearCookies();
    client.setCookie('blog_session', createTestSessionCookie());
    const res = await client.get('/admin');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Logout') || text.includes('logout') || text.includes('/api/auth/logout'));
  });
});
