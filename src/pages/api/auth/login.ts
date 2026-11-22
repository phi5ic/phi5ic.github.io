import type { APIRoute } from 'astro';
import {
  generateOAuthState,
  setOAuthStateCookie,
  setAuthRedirectCookie,
  sanitizeRedirect,
} from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  // 1. Sanitize redirect query parameter against open redirect attacks
  const rawRedirect =
    context.url.searchParams.get('redirect') ||
    context.url.searchParams.get('next');
  const safeRedirect = sanitizeRedirect(rawRedirect, '/admin');

  // Store target destination in short-lived HTTP-only cookie
  setAuthRedirectCookie(context.cookies, safeRedirect);

  // 2. Generate 32-byte cryptographically secure random state
  const state = generateOAuthState();
  setOAuthStateCookie(context.cookies, state);

  // 3. Resolve OAuth Base and Client ID
  const oauthBase = (
    process.env.GITHUB_OAUTH_URL ||
    process.env.GITHUB_OAUTH_BASE_URL ||
    'https://github.com'
  ).replace(/\/+$/, '');
  const clientId =
    process.env.GITHUB_CLIENT_ID ||
    ((import.meta as any).env ? (import.meta as any).env.GITHUB_CLIENT_ID : '') ||
    '';

  // 4. Construct GitHub OAuth authorization URL
  const callbackUrl = new URL('/api/auth/callback', context.url).toString();
  const authorizeUrl = new URL(`${oauthBase}/login/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('scope', 'repo read:user');
  authorizeUrl.searchParams.set('state', state);

  // 5. Redirect 302 to GitHub
  return context.redirect(authorizeUrl.toString(), 302);
};
