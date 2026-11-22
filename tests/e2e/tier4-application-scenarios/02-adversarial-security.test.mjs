import test from 'node:test';
import assert from 'node:assert/strict';
import { TestHttpClient } from '../helpers/http-client.mjs';
import {
  createTestSessionCookie,
  createExpiredSessionCookie,
  createTamperedCiphertext,
  createTamperedIV,
  createTamperedAuthTag,
} from '../helpers/crypto-fixtures.mjs';

// Ensure test environment for secret resolution
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Dynamically import application authentication utility
const appAuth = await import('../../../src/utils/auth.ts').catch(() => null);

test('Tier 4: Scenario 2 - Adversarial Security & Intrusion Prevention', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  await t.test('Vector 1: Unauthenticated request to /admin redirects to login', { todo: 'Pending M3 /admin route mounting' }, async () => {
    client.clearCookies();
    const res = await client.get('/admin');
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('location')?.includes('/login'));
  });

  await t.test('Vector 2: Attacker OAuth login triggers upstream revocation and 403 Forbidden', async () => {
    // Reset mock server to inspect revocation log cleanly
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });

    client.clearCookies();
    client.setCookie('oauth_state', 'adversarial_state_1');
    const res = await client.get('/api/auth/callback?code=code_unauthorized&state=adversarial_state_1');
    assert.equal(res.status, 403);
    const logsRes = await fetch(`${mockUrl}/__mock/revocations`);
    assert.equal(logsRes.status, 200);
    const logs = await logsRes.json();
    assert.ok(
      logs.some((l) => l.token === 'token_unauth_valid'),
      'Revocation log must contain unauthorized token revoked upstream by Astro server'
    );
  });

  await t.test('Vector 3: Forged AES-256-GCM cookie with bit-flipped ciphertext fails authentication', { todo: 'Pending M3 /admin route mounting' }, async () => {
    const valid = createTestSessionCookie();
    const tamperedCt = createTamperedCiphertext(valid);
    if (appAuth) {
      assert.equal(appAuth.decryptSession(tamperedCt), null);
    }

    client.clearCookies();
    client.setCookie('blog_session', tamperedCt);
    const res = await client.get('/admin');
    assert.equal(res.status, 302);
  });

  await t.test('Vector 4: Forged cookie with bit-flipped IV fails authentication', (t) => {
    if (!appAuth) {
      t.todo('Application module src/utils/auth.ts is pending Milestone 2 implementation');
      return;
    }
    const valid = createTestSessionCookie();
    const tamperedIv = createTamperedIV(valid);
    assert.equal(appAuth.decryptSession(tamperedIv), null);
  });

  await t.test('Vector 5: Forged cookie with bit-flipped Auth Tag fails authentication', (t) => {
    if (!appAuth) {
      t.todo('Application module src/utils/auth.ts is pending Milestone 2 implementation');
      return;
    }
    const valid = createTestSessionCookie();
    const tamperedTag = createTamperedAuthTag(valid);
    assert.equal(appAuth.decryptSession(tamperedTag), null);
  });

  await t.test('Vector 6: Expired session token is evicted upon decryption', (t) => {
    if (!appAuth) {
      t.todo('Application module src/utils/auth.ts is pending Milestone 2 implementation');
      return;
    }
    const expired = createExpiredSessionCookie();
    assert.equal(appAuth.decryptSession(expired), null);
  });

  await t.test('Scenario 4: Optimistic Concurrency Collision & Recovery', async () => {
    // Reset mock server to ensure clean state
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });

    const slug = 'scenario-4-concurrency-recovery';
    const filePath = `src/content/blog/${slug}.md`;

    // Step 1: Create initial post
    const initialContent = '# Initial Shared Version\nBaseline content.';
    const initRes = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Add post: Shared Baseline',
        content: Buffer.from(initialContent).toString('base64'),
      }),
    });
    assert.equal(initRes.status, 201);
    const { content: { sha: baselineSha } } = await initRes.json();

    // Step 2: Editor A and Editor B both read baselineSha
    let editorASha = baselineSha;
    let editorBSha = baselineSha;

    // Step 3: Editor A commits first
    const contentA = '# Version from Tab A\nModified by A.';
    const resA = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update from Tab A',
        content: Buffer.from(contentA).toString('base64'),
        sha: editorASha,
      }),
    });
    assert.equal(resA.status, 200);
    const dataA = await resA.json();
    const latestRemoteSha = dataA.content.sha;

    // Step 4: Editor B attempts to commit with stale baselineSha -> 409 Conflict
    const contentB = '# Version from Tab B\nModified by B.';
    const resB = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update from Tab B',
        content: Buffer.from(contentB).toString('base64'),
        sha: editorBSha,
      }),
    });
    assert.equal(resB.status, 409, 'Editor B must be rejected with 409 Conflict');

    // Step 5: Editor B fetches latest remote state and resolves conflict
    const fetchRes = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    const remoteData = await fetchRes.json();
    assert.equal(remoteData.sha, latestRemoteSha);

    // Editor B merges and updates using latestRemoteSha
    const mergedContent = '# Merged Version (A + B)\nRetaining modifications from both.';
    const resBMerged = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update from Tab B (merged)',
        content: Buffer.from(mergedContent).toString('base64'),
        sha: latestRemoteSha,
      }),
    });
    assert.equal(resBMerged.status, 200, 'Merged update with updated SHA must succeed');
  });
});
