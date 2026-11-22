import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import {
  clearOAuthStateCookie,
  getOAuthStateCookie,
  getAuthRedirectCookie,
  clearAuthRedirectCookie,
  sanitizeRedirect,
  exchangeOAuthCode,
  fetchGitHubUser,
  revokeGitHubToken,
  isOwner,
  createSessionData,
  setSessionCookie,
  clearSessionCookie,
  type SessionUser,
  type SessionData,
} from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const { url, cookies } = context;

  // 1. Check for GitHub upstream error query parameters
  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    clearOAuthStateCookie(cookies);
    clearAuthRedirectCookie(cookies);
    return context.redirect(`/login?error=${encodeURIComponent(errorParam)}`, 302);
  }

  // 2. Validate CSRF state parameter against cookie using timingSafeEqual
  const stateQuery = url.searchParams.get('state');
  const stateCookie = getOAuthStateCookie(cookies);

  if (!stateQuery || !stateCookie) {
    clearOAuthStateCookie(cookies);
    return new Response(
      JSON.stringify({
        error: 'bad_request',
        message: 'Invalid or missing OAuth state parameter.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const stateQueryBuf = Buffer.from(stateQuery, 'utf8');
  const stateCookieBuf = Buffer.from(stateCookie, 'utf8');

  if (
    stateQueryBuf.length !== stateCookieBuf.length ||
    !crypto.timingSafeEqual(stateQueryBuf, stateCookieBuf)
  ) {
    clearOAuthStateCookie(cookies);
    return new Response(
      JSON.stringify({
        error: 'bad_request',
        message: 'Invalid or missing OAuth state parameter.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // State verified: clear state cookie immediately
  clearOAuthStateCookie(cookies);

  // 3. Validate code query parameter
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response(
      JSON.stringify({
        error: 'bad_request',
        message: 'Missing OAuth authorization code.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 4. Exchange authorization code for access token
  let accessToken: string;
  try {
    accessToken = await exchangeOAuthCode(code);
  } catch (err: unknown) {
    console.error('OAuth token exchange error:', err);
    return context.redirect('/login?error=token_exchange_failed', 302);
  }

  // 5. Fetch user profile from GitHub API
  let userData: SessionUser | null = null;
  try {
    userData = await fetchGitHubUser(accessToken);
  } catch (err: unknown) {
    console.error('GitHub user fetch error:', err);
    return context.redirect('/login?error=user_fetch_failed', 302);
  }

  // 6. Strict Owner Verification (Case-Insensitive)
  if (!userData || !isOwner(userData.login)) {
    // Proactively revoke upstream token
    await revokeGitHubToken(accessToken);

    // Clean up all auth cookies
    clearAuthRedirectCookie(cookies);
    clearSessionCookie(cookies);

    // Return 403 Forbidden
    return new Response(
      JSON.stringify({
        error: 'Forbidden',
        message: 'Access restricted strictly to site owner (phi5ic).',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 7. Authorized Owner Flow: Issue encrypted session cookie
  const sessionData: SessionData = createSessionData(
    {
      login: userData.login,
      id: userData.id,
      name: userData.name,
      avatar_url: userData.avatar_url,
    },
    accessToken
  );

  setSessionCookie(cookies, sessionData);

  // Retrieve and clear post-auth redirect target
  const rawRedirect = getAuthRedirectCookie(cookies);
  clearAuthRedirectCookie(cookies);
  const finalRedirect = sanitizeRedirect(rawRedirect, '/admin');

  return context.redirect(finalRedirect, 302);
};
