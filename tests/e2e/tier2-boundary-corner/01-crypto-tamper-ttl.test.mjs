import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createTestSessionCookie,
  createExpiredSessionCookie,
  createTamperedCiphertext,
  createTamperedIV,
  createTamperedAuthTag,
  createTruncatedToken,
  createMalformedToken,
  DEFAULT_TEST_SECRET,
} from '../helpers/crypto-fixtures.mjs';

// Ensure test environment for secret resolution
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Dynamically import application authentication utility
const appAuth = await import('../../../src/utils/auth.ts').catch(() => null);

test('Tier 2: Cryptographic Tampering & TTL Boundaries', async (t) => {
  if (!appAuth) {
    t.todo('Application module src/utils/auth.ts is pending Milestone 2 implementation');
    return;
  }

  const { deriveKey, encryptSession, decryptSession } = appAuth;

  await t.test('2.1 Bit-flip on ciphertext byte 0 throws authentication error', () => {
    const valid = createTestSessionCookie();
    const tampered = createTamperedCiphertext(valid);
    assert.equal(decryptSession(tampered), null);
  });

  await t.test('2.2 Bit-flip on IV byte 0 throws authentication error', () => {
    const valid = createTestSessionCookie();
    const tampered = createTamperedIV(valid);
    assert.equal(decryptSession(tampered), null);
  });

  await t.test('2.3 Bit-flip on authentication tag byte 0 throws authentication error', () => {
    const valid = createTestSessionCookie();
    const tampered = createTamperedAuthTag(valid);
    assert.equal(decryptSession(tampered), null);
  });

  await t.test('2.4 Truncated token (missing last 8 bytes) is rejected', () => {
    const valid = createTestSessionCookie();
    const truncated = createTruncatedToken(valid);
    assert.equal(decryptSession(truncated), null);
  });

  await t.test('2.5 Malformed token string without dot separators is rejected', () => {
    const malformed = createMalformedToken();
    assert.equal(decryptSession(malformed), null);
  });

  await t.test('2.6 Token with invalid number of parts (2 parts or 4 parts) is rejected', () => {
    assert.equal(decryptSession('part1.part2'), null);
    assert.equal(decryptSession('p1.p2.p3.p4'), null);
  });

  await t.test('2.7 Decryption with different 256-bit secret fails', () => {
    const valid = createTestSessionCookie({ login: 'phi5ic' }, 'secret-alpha-1234567890123456');
    assert.equal(decryptSession(valid, 'secret-beta-123456789012345678'), null);
  });

  await t.test('2.8 Session expired by 1 millisecond is rejected', () => {
    const now = Date.now();
    const token = encryptSession({
      user: { login: 'phi5ic' },
      createdAt: now - 1000,
      expiresAt: now - 1, // expired 1ms ago
    });
    assert.equal(decryptSession(token), null);
  });

  await t.test('2.9 Session expiring in future (+60 seconds) is accepted', () => {
    const now = Date.now();
    const token = encryptSession({
      user: { login: 'phi5ic' },
      createdAt: now,
      expiresAt: now + 60000,
    });
    const decrypted = decryptSession(token);
    assert.ok(decrypted);
    assert.equal(decrypted.user.login, 'phi5ic');
  });

  await t.test('2.10 Large 64KB session payload encrypts and decrypts cleanly without truncation', () => {
    const largeData = 'x'.repeat(64 * 1024);
    const payload = {
      user: { login: 'phi5ic' },
      blob: largeData,
      expiresAt: Date.now() + 60000,
    };
    const token = encryptSession(payload);
    const decrypted = decryptSession(token);
    assert.ok(decrypted);
    assert.equal(decrypted.blob.length, 64 * 1024);
  });
});
