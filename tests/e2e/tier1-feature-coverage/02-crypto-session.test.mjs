import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveKey as fixtureDeriveKey,
  encryptSession as fixtureEncryptSession,
  decryptSession as fixtureDecryptSession,
  createTestSessionCookie,
  createExpiredSessionCookie,
  createTamperedCiphertext,
  createTamperedIV,
  createTamperedAuthTag,
  DEFAULT_TEST_SECRET,
} from '../helpers/crypto-fixtures.mjs';
import { TestHttpClient } from '../helpers/http-client.mjs';

// Dynamically import application authentication utility
const appAuth = await import('../../../src/utils/auth.ts').catch(() => null);

test('Feature 5: AES-256-GCM Session Crypto Utility', async (t) => {
  if (!appAuth) {
    t.todo('Application module src/utils/auth.ts is pending Milestone 2 implementation');
    return;
  }

  const { encryptSession, decryptSession, deriveKey } = appAuth;

  await t.test('5.1 Symmetrical encryption and decryption roundtrip preserves session data', () => {
    const payload = {
      user: {
        login: 'phi5ic',
        id: 190199501,
        name: 'Aravind Anilraj',
        avatar_url: 'https://avatars.githubusercontent.com/u/190199501',
      },
      accessToken: 'gho_mock_token_12345',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };

    const token = encryptSession(payload, DEFAULT_TEST_SECRET);
    assert.equal(typeof token, 'string');
    assert.equal(token.split('.').length, 3, 'Token must follow iv.tag.ciphertext format');

    const decrypted = decryptSession(token, DEFAULT_TEST_SECRET);
    assert.ok(decrypted, 'Decrypted session must not be null');
    assert.equal(decrypted.user.login, 'phi5ic');
    assert.equal(decrypted.user.id, 190199501);
    assert.equal(decrypted.accessToken, 'gho_mock_token_12345');
    assert.equal(decrypted.expiresAt, payload.expiresAt);
  });

  await t.test('5.2 Each encryption call generates a distinct, non-reused 12-byte IV', () => {
    const payload = { user: { login: 'phi5ic' }, createdAt: 1000, expiresAt: 9999999999999 };
    const token1 = encryptSession(payload, DEFAULT_TEST_SECRET);
    const token2 = encryptSession(payload, DEFAULT_TEST_SECRET);

    const [iv1] = token1.split('.');
    const [iv2] = token2.split('.');
    assert.notEqual(iv1, iv2, 'Two successive encryptions must have unique random IVs');
    assert.equal(Buffer.from(iv1, 'base64url').length, 12, 'IV must be 12 bytes');
  });

  await t.test('5.3 Interoperability: Application tokens decrypt cleanly with reference test oracle', () => {
    const payload = { user: { login: 'phi5ic' }, createdAt: Date.now(), expiresAt: Date.now() + 60000 };
    const appToken = encryptSession(payload, DEFAULT_TEST_SECRET);
    const oracleDecrypted = fixtureDecryptSession(appToken, DEFAULT_TEST_SECRET);
    assert.ok(oracleDecrypted, 'Fixture oracle must be capable of decrypting application token');
    assert.equal(oracleDecrypted.user.login, 'phi5ic');

    const fixtureToken = fixtureEncryptSession(payload, DEFAULT_TEST_SECRET);
    const appDecrypted = decryptSession(fixtureToken, DEFAULT_TEST_SECRET);
    assert.ok(appDecrypted, 'Application must be capable of decrypting reference fixture token');
    assert.equal(appDecrypted.user.login, 'phi5ic');
  });

  await t.test('5.4 Encrypted token contains 16-byte GCM authentication tag', () => {
    const payload = { user: { login: 'phi5ic' }, expiresAt: Date.now() + 100000 };
    const token = encryptSession(payload, DEFAULT_TEST_SECRET);
    const [, tagB64] = token.split('.');
    const tagBuf = Buffer.from(tagB64, 'base64url');
    assert.equal(tagBuf.length, 16, 'GCM Auth tag must be exactly 16 bytes');
  });

  await t.test('5.5 Decryption with incorrect secret key fails authentication tag validation', () => {
    const payload = { user: { login: 'phi5ic' }, expiresAt: Date.now() + 100000 };
    const token = encryptSession(payload, 'correct-secret-key-1');
    const decrypted = decryptSession(token, 'wrong-secret-key-2');
    assert.equal(decrypted, null, 'Decryption with wrong key must return null');
  });

  await t.test('5.6 Key derivation deterministically generates 32-byte key from arbitrary secret', () => {
    const key1 = deriveKey('short-secret');
    const key2 = deriveKey('short-secret');
    const key3 = deriveKey('different-secret-key-that-is-much-longer-than-32-bytes-total');

    assert.equal(key1.length, 32, 'Derived key must be exactly 32 bytes for AES-256');
    assert.equal(key3.length, 32, 'Derived key must be 32 bytes even for long inputs');
    assert.deepEqual(key1, key2, 'Identical secrets must produce identical keys');
    assert.notDeepEqual(key1, key3, 'Different secrets must produce distinct keys');
  });
});

test('Feature 9: Tamper-Proof Session Cookie Management', async (t) => {
  if (!appAuth) {
    t.todo('Application module src/utils/auth.ts is pending Milestone 2 implementation');
    return;
  }

  const { encryptSession, decryptSession } = appAuth;

  await t.test('9.1 Tampered ciphertext bit-flip triggers decryption failure', () => {
    const valid = encryptSession({ user: { login: 'phi5ic' }, expiresAt: Date.now() + 60000 }, DEFAULT_TEST_SECRET);
    const tampered = createTamperedCiphertext(valid);
    const result = decryptSession(tampered, DEFAULT_TEST_SECRET);
    assert.equal(result, null, 'Tampered ciphertext must fail authentication and return null');
  });

  await t.test('9.2 Tampered IV bit-flip triggers decryption failure', () => {
    const valid = encryptSession({ user: { login: 'phi5ic' }, expiresAt: Date.now() + 60000 }, DEFAULT_TEST_SECRET);
    const tampered = createTamperedIV(valid);
    const result = decryptSession(tampered, DEFAULT_TEST_SECRET);
    assert.equal(result, null, 'Tampered IV must fail authentication and return null');
  });

  await t.test('9.3 Tampered Auth Tag bit-flip triggers decryption failure', () => {
    const valid = encryptSession({ user: { login: 'phi5ic' }, expiresAt: Date.now() + 60000 }, DEFAULT_TEST_SECRET);
    const tampered = createTamperedAuthTag(valid);
    const result = decryptSession(tampered, DEFAULT_TEST_SECRET);
    assert.equal(result, null, 'Tampered auth tag must fail authentication and return null');
  });

  await t.test('9.4 Expired session timestamp is rejected by session verifier', () => {
    const expiredPayload = { user: { login: 'phi5ic' }, createdAt: Date.now() - 10000, expiresAt: Date.now() - 1000 };
    const expiredToken = encryptSession(expiredPayload, DEFAULT_TEST_SECRET);
    const result = decryptSession(expiredToken, DEFAULT_TEST_SECRET);
    assert.equal(result, null, 'Expired session must return null upon decryption');
  });

  await t.test('9.5 Valid session contains 7-day TTL expiration calculation', () => {
    const before = Date.now();
    const token = createTestSessionCookie();
    const session = decryptSession(token, DEFAULT_TEST_SECRET);
    assert.ok(session, 'Valid token must decrypt');
    const expectedExpiryMin = before + 7 * 24 * 60 * 60 * 1000 - 1000;
    const expectedExpiryMax = Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000;
    assert.ok(session.expiresAt >= expectedExpiryMin && session.expiresAt <= expectedExpiryMax);
  });
});

test('Feature 12: Session Status API', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const client = new TestHttpClient(baseUrl);

  await t.test('12.1 Unauthenticated request to /api/auth/me returns 401 Unauthorized', async () => {
    client.clearCookies();
    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 401, 'Unauthenticated request must return 401');
    const body = await res.json();
    assert.equal(body.authenticated, false);
  });

  await t.test('12.2 Request with valid owner session cookie returns authenticated status', async () => {
    client.clearCookies();
    const sessionCookie = createTestSessionCookie();
    client.setCookie('blog_session', sessionCookie);

    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 200, 'Authenticated owner request must return 200');
    const data = await res.json();
    assert.equal(data.authenticated, true);
    assert.equal(data.user.login, 'phi5ic');
  });

  await t.test('12.3 Request with expired session returns 401 and invalidates session', async () => {
    client.clearCookies();
    const expiredCookie = createExpiredSessionCookie();
    client.setCookie('blog_session', expiredCookie);

    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 401, 'Expired session must return 401');
  });

  await t.test('12.4 Request with tampered session cookie returns 401', async () => {
    client.clearCookies();
    const valid = createTestSessionCookie();
    client.setCookie('blog_session', createTamperedCiphertext(valid));

    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 401, 'Tampered session must return 401');
  });

  await t.test('12.5 Session status contains owner avatar_url and user ID metadata', async () => {
    client.clearCookies();
    const sessionCookie = createTestSessionCookie();
    client.setCookie('blog_session', sessionCookie);

    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 200, 'Authenticated owner request must return 200');
    const data = await res.json();
    assert.equal(data.user.id, 190199501);
    assert.ok(data.user.avatar_url?.includes('githubusercontent'));
  });
});
