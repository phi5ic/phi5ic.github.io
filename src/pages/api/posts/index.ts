export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  try {
    const posts = await getCollection('blog');
    const sorted = posts
      .map((post) => ({
        id: post.id,
        slug: post.id.replace(/\.mdx?$/, ''),
        data: post.data,
      }))
      .sort((a, b) => new Date(b.data.date).valueOf() - new Date(a.data.date).valueOf());

    return new Response(JSON.stringify(sorted), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'InternalServerError', message: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
