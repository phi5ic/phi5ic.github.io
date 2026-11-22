import type { APIRoute } from 'astro';
import {
  getSessionFromCookie,
  clearSessionCookie,
  revokeGitHubToken,
} from '../../../utils/auth';

export const prerender = false;

async function handleLogout(context: Parameters<APIRoute>[0]): Promise<Response> {
  const session = await getSessionFromCookie(context.cookies);

  // Upstream token revocation if accessToken is present
  if (session?.accessToken) {
    await revokeGitHubToken(session.accessToken);
  }

  // Invalidate session cookie
  clearSessionCookie(context.cookies);

  // Check if client expects JSON
  const acceptHeader = context.request.headers.get('accept') || '';
  if (acceptHeader.includes('application/json')) {
    return new Response(
      JSON.stringify({ success: true, message: 'Logged out successfully.' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Redirect to login page with logout confirmation
  return context.redirect('/login?logout=success', 302);
}

export const POST: APIRoute = async (context) => {
  return handleLogout(context);
};

export const GET: APIRoute = async (context) => {
  return handleLogout(context);
};
