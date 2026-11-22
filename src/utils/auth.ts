import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {}

export interface SessionUser {
  login: string;
  id: number;
  name?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface SessionData {
  user: SessionUser;
  accessToken: string;
  createdAt: number;
  expiresAt: number;
  [key: string]: unknown;
}

export const SESSION_COOKIE_NAME = 'blog_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 604,800,000 ms (7 days)
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 604,800 seconds
export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60; // 600 seconds (10 minutes)
export const AUTH_REDIRECT_COOKIE_NAME = 'auth_redirect';
export const AUTH_REDIRECT_MAX_AGE_SECONDS = 10 * 60; // 600 seconds (10 minutes)
const DEFAULT_TEST_SECRET = 'test-session-secret-32-chars-long-e2e-suite';

/**
 * Derives a deterministic 32-byte (256-bit) encryption key from secret using SHA-256.
 */
export function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Resolves the active session secret from parameter or environment.
 */
export function resolveSecret(secret?: string): string {
  const resolved = secret || process.env.SESSION_SECRET;
  if (!resolved) {
    if (process.env.NODE_ENV === 'test') {
      return DEFAULT_TEST_SECRET;
    }
    throw new Error('SESSION_SECRET environment variable is missing.');
  }
  return resolved;
}

/**
 * Determines whether HTTPS-only cookie flags should be enforced.
 */
export function isProduction(): boolean {
  return (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.PROD === 'boolean')
    ? import.meta.env.PROD
    : process.env.NODE_ENV === 'production';
}

/**
 * Encrypts a session payload into AES-256-GCM token format:
 * `${iv.base64url}.${authTag.base64url}.${ciphertext.base64url}`
 */
export function encryptSession(
  payload: SessionData | Record<string, unknown>,
  secret?: string
): string {
  const secretKey = resolveSecret(secret);
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(12); // NIST SP 800-38D recommended 12-byte IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let ciphertext = cipher.update(jsonStr, 'utf8');
  ciphertext = Buffer.concat([ciphertext, cipher.final()]);

  const authTag = cipher.getAuthTag(); // 16-byte GCM authentication tag

  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts, validates, and unpacks an AES-256-GCM session token.
 * Returns null if token is malformed, tampered, expired, or failed authentication.
 */
export function decryptSession<T = SessionData>(
  token: string,
  secret?: string
): T | null {
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

    const secretKey = resolveSecret(secret);
    const key = deriveKey(secretKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const session = JSON.parse(decrypted.toString('utf8')) as T;

    // Check expiration timestamp
    const record = session as Record<string, unknown>;
    if (typeof record.expiresAt === 'number' && Date.now() > record.expiresAt) {
      return null;
    }

    return session;
  } catch (err) {
    // Tamper detected or authentication failure
    return null;
  }
}

/**
 * Constructs a standard SessionData object with 7-day TTL.
 */
export function createSessionData(
  user: SessionUser,
  accessToken: string,
  ttlMs: number = SESSION_TTL_MS
): SessionData {
  const now = Date.now();
  return {
    user,
    accessToken,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}

/**
 * Encrypts and stores the session token into Astro cookies.
 */
export function setSessionCookie(
  cookies: AstroCookies,
  sessionData: SessionData,
  secret?: string
): string {
  const token = encryptSession(sessionData, secret);
  cookies.set(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: isProduction(),
  });
  return token;
}

/**
 * Clears the session cookie from client storage.
 */
export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE_NAME, {
    path: '/',
  });
}

/**
 * Retrieves and decrypts the session from Astro cookies (asynchronous per interface contract).
 */
export async function getSessionFromCookie(
  cookies: AstroCookies,
  secret?: string
): Promise<SessionData | null> {
  const cookie = cookies.get(SESSION_COOKIE_NAME);
  if (!cookie || !cookie.value) return null;
  return decryptSession<SessionData>(cookie.value, secret);
}

/**
 * Synchronous variant for callers in synchronous contexts.
 */
export function getSessionFromCookieSync(
  cookies: AstroCookies,
  secret?: string
): SessionData | null {
  const cookie = cookies.get(SESSION_COOKIE_NAME);
  if (!cookie || !cookie.value) return null;
  return decryptSession<SessionData>(cookie.value, secret);
}

/**
 * Generates 32 bytes (64 hex chars) of cryptographically secure random entropy for OAuth state.
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Stores OAuth state cookie with 10-minute TTL.
 */
export function setOAuthStateCookie(cookies: AstroCookies, state: string): void {
  cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    secure: isProduction(),
  });
}

/**
 * Reads OAuth state cookie.
 */
export function getOAuthStateCookie(cookies: AstroCookies): string | null {
  return cookies.get(OAUTH_STATE_COOKIE_NAME)?.value ?? null;
}

/**
 * Clears OAuth state cookie.
 */
export function clearOAuthStateCookie(cookies: AstroCookies): void {
  cookies.delete(OAUTH_STATE_COOKIE_NAME, {
    path: '/',
  });
}

/**
 * Stores target redirect destination in temporary cookie.
 */
export function setAuthRedirectCookie(cookies: AstroCookies, redirect: string): void {
  cookies.set(AUTH_REDIRECT_COOKIE_NAME, redirect, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: AUTH_REDIRECT_MAX_AGE_SECONDS,
    secure: isProduction(),
  });
}

/**
 * Reads target redirect destination cookie.
 */
export function getAuthRedirectCookie(cookies: AstroCookies): string | null {
  return cookies.get(AUTH_REDIRECT_COOKIE_NAME)?.value ?? null;
}

/**
 * Clears target redirect destination cookie.
 */
export function clearAuthRedirectCookie(cookies: AstroCookies): void {
  cookies.delete(AUTH_REDIRECT_COOKIE_NAME, {
    path: '/',
  });
}

/**
 * Verifies if the GitHub login matches the site owner ('phi5ic') case-insensitively.
 */
export function isOwner(login: string): boolean {
  if (!login || typeof login !== 'string') return false;
  const expectedOwner = (process.env.ALLOWED_USER || process.env.GITHUB_ALLOWED_USER || 'phi5ic').trim().toLowerCase();
  return login.trim().toLowerCase() === expectedOwner;
}

/**
 * Sanitizes redirect target paths to prevent open-redirect vulnerabilities.
 */
export function sanitizeRedirect(target: string | null | undefined, fallback: string = '/admin'): string {
  if (!target || typeof target !== 'string') return fallback;
  const trimmed = target.trim();
  if (!trimmed || /[\x00-\x1F\x7F]/.test(trimmed)) return fallback;

  let decoded = trimmed;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return fallback;
    }
  }

  if (/[\x00-\x1F\x7F]/.test(decoded)) return fallback;

  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes(':')
  ) {
    return fallback;
  }

  if (
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    decoded.includes(':')
  ) {
    return fallback;
  }

  // Prevent redirect loop to /login (collapse to /admin)
  const targetPath = decoded.split(/[?#]/)[0].replace(/\/+$/, '');
  if (targetPath === '/login') {
    return '/admin';
  }

  return trimmed;
}

/**
 * Exchanges GitHub OAuth temporary authorization code for access token.
 */
export async function exchangeOAuthCode(code: string): Promise<string> {
  const oauthBase = (process.env.GITHUB_OAUTH_URL || process.env.GITHUB_OAUTH_BASE_URL || 'https://github.com').replace(/\/+$/, '');
  const clientId = process.env.GITHUB_CLIENT_ID || '';
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || '';

  const res = await fetch(`${oauthBase}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'phi5ic-blog-auth/1.0',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || 'GitHub OAuth token exchange failed');
  }

  return data.access_token;
}

/**
 * Fetches authenticated user profile from GitHub API.
 */
export async function fetchGitHubUser(accessToken: string): Promise<SessionUser> {
  const apiBase = (process.env.GITHUB_API_URL || process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '');
  const res = await fetch(`${apiBase}/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'phi5ic-blog-auth/1.0',
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub user profile fetch failed with status ${res.status}`);
  }

  const data = await res.json();
  return {
    login: data.login,
    id: data.id,
    name: data.name,
    avatar_url: data.avatar_url,
  };
}

/**
 * Proactively revokes a GitHub OAuth access token upstream via GitHub REST API
 * DELETE /applications/{client_id}/token
 */
export async function revokeGitHubToken(accessToken: string): Promise<boolean> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret || !accessToken) return false;

  const apiBase = (process.env.GITHUB_API_URL || process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '');
  const url = `${apiBase}/applications/${clientId}/token`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'phi5ic-blog-auth/1.0',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });

    return res.status === 204 || res.ok;
  } catch (err) {
    console.error('Failed to revoke GitHub token upstream:', err);
    return false;
  }
}
