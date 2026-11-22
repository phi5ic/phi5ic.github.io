import type { APIRoute } from 'astro';
import { getSessionFromCookie, isOwner } from '../../../utils/auth';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  // Use session from locals if populated by middleware, or decrypt from cookie
  let user = context.locals.user;
  if (!user) {
    const session = await getSessionFromCookie(context.cookies);
    if (session && session.user) {
      user = session.user;
    }
  }

  if (!user || !isOwner(user.login)) {
    return new Response(
      JSON.stringify({ authenticated: false }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: {
        login: user.login,
        id: user.id,
        name: user.name,
        avatar_url: user.avatar_url,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
