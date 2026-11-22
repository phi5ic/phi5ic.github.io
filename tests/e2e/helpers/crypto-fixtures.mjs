import crypto from 'node:crypto';

export const DEFAULT_TEST_SECRET = 'test-session-secret-32-chars-long-e2e-suite';

/**
 * Derives a 32-byte (256-bit) encryption key from secret using SHA-256
 * @param {string} secret
 * @returns {Buffer}
 */
export function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a session payload into AES-256-GCM token format:
 * `${iv.base64url}.${authTag.base64url}.${ciphertext.base64url}`
 * @param {object} payload
 * @param {string} secret
 * @returns {string}
 */
export function encryptSession(payload, secret = DEFAULT_TEST_SECRET) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12); // NIST SP 800-38D recommended 12-byte IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonStr = JSON.stringify(payload);
  let ciphertext = cipher.update(jsonStr, 'utf8');
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);

  const authTag = cipher.getAuthTag(); // 16-byte GCM authentication tag

  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts and authenticates AES-256-GCM session token
 * @param {string} token
 * @param {string} secret
 * @returns {object|null}
 */
export function decryptSession(token, secret = DEFAULT_TEST_SECRET) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [ivB64, tagB64, ctB64] = parts;
  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const authTag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ctB64, 'base64url');

    if (iv.length !== 12 || authTag.length !== 16) {
      return null;
    }

    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const session = JSON.parse(decrypted.toString('utf8'));

    // Check expiration
    if (session.expiresAt && Date.now() > session.expiresAt) {
      return null;
    }

    return session;
  } catch (err) {
    // Unsupported state or unable to authenticate data (tamper detected)
    return null;
  }
}

/**
 * Creates a valid owner session token cookie value
 */
export function createTestSessionCookie(
  user = { login: 'phi5ic', id: 190199501, name: 'Aravind Anilraj', avatar_url: 'https://avatars.githubusercontent.com/u/190199501' },
  secret = DEFAULT_TEST_SECRET,
  ttlMs = 7 * 24 * 60 * 60 * 1000
) {
  const now = Date.now();
  const payload = {
    user,
    accessToken: 'token_owner_valid',
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  return encryptSession(payload, secret);
}

/**
 * Creates an expired session token
 */
export function createExpiredSessionCookie(
  user = { login: 'phi5ic', id: 190199501 },
  secret = DEFAULT_TEST_SECRET
) {
  const now = Date.now();
  const payload = {
    user,
    accessToken: 'token_owner_valid',
    createdAt: now - 8 * 24 * 60 * 60 * 1000,
    expiresAt: now - 1000, // 1 second ago
  };
  return encryptSession(payload, secret);
}

/**
 * Tamper helper: bit-flip ciphertext
 */
export function createTamperedCiphertext(validToken) {
  const [iv, tag, ct] = validToken.split('.');
  const buf = Buffer.from(ct, 'base64url');
  buf[0] ^= 1; // Flip lowest bit of first byte
  return `${iv}.${tag}.${buf.toString('base64url')}`;
}

/**
 * Tamper helper: bit-flip IV
 */
export function createTamperedIV(validToken) {
  const [iv, tag, ct] = validToken.split('.');
  const buf = Buffer.from(iv, 'base64url');
  buf[0] ^= 1;
  return `${buf.toString('base64url')}.${tag}.${ct}`;
}

/**
 * Tamper helper: bit-flip Auth Tag
 */
export function createTamperedAuthTag(validToken) {
  const [iv, tag, ct] = validToken.split('.');
  const buf = Buffer.from(tag, 'base64url');
  buf[0] ^= 1;
  return `${iv}.${buf.toString('base64url')}.${ct}`;
}

/**
 * Tamper helper: truncated payload
 */
export function createTruncatedToken(validToken) {
  return validToken.slice(0, validToken.length - 8);
}

/**
 * Tamper helper: malformed token (invalid structure)
 */
export function createMalformedToken() {
  return 'not-a-valid-token-format';
}
