import { defineMiddleware } from 'astro:middleware';
import { getSessionFromCookie, clearSessionCookie, isOwner, sanitizeRedirect } from './utils/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  // Normalize pathname by stripping trailing slash for consistent matching
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // 1. Route Classification
  const isAdminRoute = normalizedPath === '/admin' || normalizedPath.startsWith('/admin/');
  const isApiRoute = normalizedPath.startsWith('/api/');
  const isLoginRoute = normalizedPath === '/login';

  // Fast path for public static routes: bypass cookie extraction during prerender
  if (!isAdminRoute && !isApiRoute && !isLoginRoute) {
    context.locals.user = null;
    context.locals.accessToken = null;
    return next();
  }

  // 2. Session Decryption & Locals Population (only for protected or auth routes)
  const session = await getSessionFromCookie(context.cookies);
  if (session && session.user) {
    context.locals.user = session.user;
    context.locals.accessToken = session.accessToken;
  } else {
    context.locals.user = null;
    context.locals.accessToken = null;
    if (context.cookies.has('blog_session')) {
      clearSessionCookie(context.cookies);
    }
  }

  // Explicitly excluded auth endpoints that handle their own authentication/status
  const isPublicAuthApi =
    normalizedPath === '/api/auth/login' ||
    normalizedPath === '/api/auth/callback' ||
    normalizedPath === '/api/auth/logout' ||
    normalizedPath === '/api/auth/me';

  // 3. Admin Protected Routes (/admin, /admin/*)
  if (isAdminRoute) {
    // Unauthenticated or invalid/tampered session -> 302 redirect to /login
    if (!context.locals.user) {
      const redirectUrl = `/login?redirect=${encodeURIComponent(pathname + context.url.search)}`;
      return context.redirect(redirectUrl, 302);
    }

    // Authenticated non-owner -> 403 Forbidden
    if (!isOwner(context.locals.user.login)) {
      clearSessionCookie(context.cookies);
      return new Response(
        JSON.stringify({ error: 'Forbidden', message: 'Access denied: not site owner.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return next();
  }

  // 4. Protected API Endpoints (/api/* except public auth)
  if (isApiRoute) {
    if (isPublicAuthApi) {
      return next();
    }

    // Unauthenticated API request -> 401 Unauthorized
    if (!context.locals.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Authenticated non-owner -> 403 Forbidden
    if (!isOwner(context.locals.user.login)) {
      clearSessionCookie(context.cookies);
      return new Response(
        JSON.stringify({ error: 'Forbidden', message: 'Access denied: not site owner.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return next();
  }

  // 5. Login Page (/login): If already logged in as owner, preserve redirect or go to /admin
  if (normalizedPath === '/login') {
    if (context.locals.user && isOwner(context.locals.user.login)) {
      const target = sanitizeRedirect(
        context.url.searchParams.get('redirect') || context.url.searchParams.get('next'),
        '/admin'
      );
      return context.redirect(target, 302);
    }
  }

  // 6. Public routes pass through without requiring session
  return next();
});
