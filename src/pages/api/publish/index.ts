export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { putRepoFile } from '../../../utils/github';

const publishSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  frontmatter: z.object({
    title: z.string().min(1),
    date: z.coerce.date(),
    section: z.enum(['systems', 'music', 'rants']),
    excerpt: z.string().min(1),
    header: z.object({ teaser: z.string().optional() }).optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    use_math: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
  body: z.string().default(''),
  sha: z.string().optional(),
  commitMessage: z.string().optional(),
});

function formatMarkdown(frontmatter: any, body: string): string {
  const dateStr = new Date(frontmatter.date).toISOString().split('T')[0];
  let yaml = `---\n`;
  yaml += `title: ${JSON.stringify(frontmatter.title)}\n`;
  yaml += `date: ${dateStr}\n`;
  yaml += `section: ${frontmatter.section}\n`;
  yaml += `excerpt: ${JSON.stringify(frontmatter.excerpt)}\n`;
  if (frontmatter.header?.teaser) {
    yaml += `header:\n  teaser: ${JSON.stringify(frontmatter.header.teaser)}\n`;
  }
  if (frontmatter.categories && frontmatter.categories.length > 0) {
    yaml += `categories:\n${frontmatter.categories.map((c: string) => `  - ${c}`).join('\n')}\n`;
  }
  if (frontmatter.tags && frontmatter.tags.length > 0) {
    yaml += `tags:\n${frontmatter.tags.map((t: string) => `  - ${t}`).join('\n')}\n`;
  }
  yaml += `use_math: ${frontmatter.use_math ? 'true' : 'false'}\n`;
  yaml += `draft: ${frontmatter.draft ? 'true' : 'false'}\n`;
  yaml += `---\n\n${body.trim()}\n`;
  return yaml;
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Middleware handles unauthenticated 401 & non-owner 403, but verify as defense-in-depth
  if (!locals.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Authentication required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let bodyData;
  try {
    bodyData = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'BadRequest', message: 'Invalid JSON payload.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parsed = publishSchema.safeParse(bodyData);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: 'ValidationError',
        message: 'Invalid post schema attributes.',
        details: parsed.error.issues,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { slug, frontmatter, body, sha, commitMessage } = parsed.data;
  const filePath = `src/content/blog/${slug}.md`;
  const fileContent = formatMarkdown(frontmatter, body);

  const defaultMessage = sha ? `Update post: ${frontmatter.title}` : `Add post: ${frontmatter.title}`;
  const message = commitMessage || defaultMessage;

  if (!locals.accessToken) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Valid access token required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const token = locals.accessToken;

  try {
    const result = await putRepoFile({
      path: filePath,
      content: fileContent,
      message,
      sha,
      token,
    });

    if (result.status === 200 || result.status === 201) {
      return new Response(
        JSON.stringify({
          success: true,
          slug,
          commit: result.data.commit,
          content: result.data.content,
        }),
        { status: result.status, headers: { 'Content-Type': 'application/json' } }
      );
    } else if (result.status === 409) {
      return new Response(
        JSON.stringify({
          error: 'Conflict',
          message: 'Remote file SHA mismatch. Post was modified concurrently.',
          details: result.data,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({
          error: 'GitHubAPIError',
          message: result.data.message || 'Failed to commit file to GitHub.',
          details: result.data,
        }),
        { status: result.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'InternalServerError', message: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
