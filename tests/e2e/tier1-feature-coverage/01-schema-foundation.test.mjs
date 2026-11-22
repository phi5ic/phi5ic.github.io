import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { z } from 'astro/zod';
import { parseFrontmatter } from '@astrojs/markdown-remark';

// Reference unified schema as defined in PROJECT.md Feature 1
const unifiedBlogSchema = z.object({
  title: z.string(),
  date: z.coerce.date(),
  excerpt: z.string().optional().default(''),
  header: z.object({
    teaser: z.string().optional(),
  }).optional(),
  section: z.enum(['systems', 'music', 'rants']).default('systems'),
  categories: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  use_math: z.boolean().optional().default(false),
  draft: z.boolean().optional().default(false),
});

test('Feature 1: Content Schema Unification', async (t) => {
  await t.test('1.1 Canonical sample post validates against unified schema', () => {
    const postPath = 'src/content/blog/what-I-learned-trying-to-beat-xor.md';
    assert.ok(fs.existsSync(postPath), `Canonical post must exist at ${postPath}`);
    const raw = fs.readFileSync(postPath, 'utf8');
    const { frontmatter } = parseFrontmatter(raw);

    const parsed = unifiedBlogSchema.safeParse(frontmatter);
    assert.ok(parsed.success, `Schema validation failed: ${JSON.stringify(parsed.error?.issues)}`);
    assert.equal(parsed.data.title, 'What I Learned Trying to Beat XOR');
    assert.equal(parsed.data.section, 'systems');
    assert.equal(parsed.data.use_math, true);
    assert.equal(parsed.data.draft, false);
    assert.ok(Array.isArray(parsed.data.categories));
    assert.ok(parsed.data.categories.includes('storage'));
  });

  await t.test('1.2 Minimal post frontmatter validates and injects required defaults', () => {
    const minimal = {
      title: 'Minimal Test Post',
      date: '2026-11-21',
    };
    const parsed = unifiedBlogSchema.safeParse(minimal);
    assert.ok(parsed.success, 'Minimal post must validate');
    assert.equal(parsed.data.section, 'systems');
    assert.equal(parsed.data.draft, false);
    assert.equal(parsed.data.use_math, false);
    assert.deepEqual(parsed.data.categories, []);
    assert.deepEqual(parsed.data.tags, []);
  });

  await t.test('1.3 All valid section enum branches (systems, music, rants) validate cleanly', () => {
    for (const sec of ['systems', 'music', 'rants']) {
      const res = unifiedBlogSchema.safeParse({
        title: `Post for ${sec}`,
        date: '2026-11-21',
        section: sec,
      });
      assert.ok(res.success, `Section ${sec} should be valid`);
      assert.equal(res.data.section, sec);
    }
  });

  await t.test('1.4 Non-member section enum is rejected with invalid_value issue', () => {
    const invalidSections = ['gaming', 'random', 'tech', ''];
    for (const sec of invalidSections) {
      const res = unifiedBlogSchema.safeParse({
        title: 'Invalid Section Post',
        date: '2026-11-21',
        section: sec,
      });
      assert.equal(res.success, false, `Section "${sec}" must be rejected`);
      const secIssue = res.error.issues.find((i) => i.path.includes('section'));
      assert.ok(secIssue, `Expected validation error on section for "${sec}"`);
    }
  });

  await t.test('1.5 Draft flag defaults to false and supports boolean toggling', () => {
    const draftPost = unifiedBlogSchema.safeParse({
      title: 'Draft Post',
      date: '2026-11-21',
      draft: true,
    });
    assert.ok(draftPost.success);
    assert.equal(draftPost.data.draft, true);

    const publishedPost = unifiedBlogSchema.safeParse({
      title: 'Live Post',
      date: '2026-11-21',
      draft: false,
    });
    assert.ok(publishedPost.success);
    assert.equal(publishedPost.data.draft, false);
  });

  await t.test('1.6 Nested header.teaser supports optional string and rejects non-string types', () => {
    const withTeaser = unifiedBlogSchema.safeParse({
      title: 'Teaser Post',
      date: '2026-11-21',
      header: { teaser: '/assets/images/posts/sample.jpg' },
    });
    assert.ok(withTeaser.success);
    assert.equal(withTeaser.data.header?.teaser, '/assets/images/posts/sample.jpg');

    const invalidTeaser = unifiedBlogSchema.safeParse({
      title: 'Bad Teaser',
      date: '2026-11-21',
      header: { teaser: 404 },
    });
    assert.equal(invalidTeaser.success, false);
  });
});

test('Feature 2: Secrets Hygiene & Environment Template', async (t) => {
  const gitignorePath = '.gitignore';
  assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');

  await t.test('2.1 .gitignore explicitly ignores .env file', () => {
    const hasEnv = gitignore.split('\n').some((line) => line.trim() === '.env');
    assert.ok(hasEnv, '.gitignore must include exact line ".env"');
  });

  await t.test('2.2 .gitignore ignores all .env.* wildcard variants', () => {
    const hasEnvWildcard = gitignore.split('\n').some((line) => line.trim() === '.env.*');
    assert.ok(hasEnvWildcard, '.gitignore must include ".env.*" wildcard pattern');
  });

  await t.test('2.3 .gitignore explicitly un-ignores .env.example with negation pattern', () => {
    const hasExemption = gitignore.split('\n').some((line) => line.trim() === '!.env.example');
    assert.ok(hasExemption, '.gitignore must include "!.env.example" exemption pattern');
  });

  await t.test('2.4 .env.example exists and contains all required configuration keys', () => {
    const examplePath = '.env.example';
    assert.ok(fs.existsSync(examplePath), '.env.example must exist in repository root');
    const exampleContent = fs.readFileSync(examplePath, 'utf8');

    const requiredKeys = [
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'SESSION_SECRET',
      'ALLOWED_USER',
      'PORT',
      'HOST',
      'GITHUB_REPO_OWNER',
      'GITHUB_REPO_NAME',
      'GITHUB_REPO_BRANCH',
    ];

    for (const key of requiredKeys) {
      assert.ok(
        exampleContent.includes(`${key}=`),
        `.env.example must define template key "${key}="`
      );
    }
  });

  await t.test('2.5 Repository root does not contain committed live .env secrets', () => {
    let tracked = '';
    try {
      tracked = execSync('git ls-files .env', { encoding: 'utf8' }).trim();
    } catch {}
    assert.equal(
      tracked,
      '',
      'Live .env must not be tracked or committed in git'
    );
  });
});

test('Feature 3: Node SSR Adapter Integration', async (t) => {
  await t.test('3.1 package.json includes @astrojs/node dependency', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.ok(
      pkg.dependencies?.['@astrojs/node'] || pkg.devDependencies?.['@astrojs/node'],
      '@astrojs/node must be present in package dependencies'
    );
  });

  await t.test('3.2 astro.config.mjs configures standalone node adapter and output mode', () => {
    const config = fs.readFileSync('astro.config.mjs', 'utf8');
    assert.ok(config.includes('@astrojs/node'), 'astro.config.mjs must import @astrojs/node');
    assert.ok(
      config.includes("adapter: node({ mode: 'standalone' })") ||
      config.includes('mode: "standalone"') ||
      config.includes("mode: 'standalone'"),
      'astro.config.mjs must configure adapter with standalone mode'
    );
  });

  await t.test('3.3 Standalone build entrypoint dist/server/entry.mjs exists', () => {
    assert.ok(
      fs.existsSync('dist/server/entry.mjs'),
      'Build must output server entrypoint at dist/server/entry.mjs'
    );
  });

  await t.test('3.4 Prerendered client static directory dist/client/ exists with public pages', () => {
    assert.ok(fs.existsSync('dist/client'), 'Client prerender directory dist/client must exist');
    assert.ok(fs.existsSync('dist/client/index.html'), 'dist/client/index.html must exist');
    assert.ok(fs.existsSync('dist/client/posts/index.html'), 'dist/client/posts/index.html must exist');
    assert.ok(fs.existsSync('dist/client/about/index.html'), 'dist/client/about/index.html must exist');
  });

  await t.test('3.5 Running server responds to HTTP requests on loopback port', async () => {
    const baseUrl = process.env.E2E_BASE_URL;
    assert.ok(baseUrl, 'E2E_BASE_URL environment variable must be set by runner');
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200, 'Server must return 200 OK for root route');
    const text = await res.text();
    assert.ok(text.includes('phi5ic') || text.includes('html'), 'Server response must contain page content');
  });
});

test('Feature 4: Deploy Script Guard', async (t) => {
  const deployScriptPath = 'scripts/deploy.js';
  assert.ok(fs.existsSync(deployScriptPath), 'scripts/deploy.js must exist');
  const deployScript = fs.readFileSync(deployScriptPath, 'utf8');

  await t.test('4.1 Deploy script targets dist/client instead of entire dist root', () => {
    assert.ok(
      deployScript.includes('dist/client') || deployScript.includes('clientDistDir'),
      'Deploy script must target dist/client for gh-pages deployment'
    );
  });

  await t.test('4.2 Deploy script asserts absence of server runtime artifacts in worktree', () => {
    assert.ok(
      deployScript.includes('entry.mjs') && deployScript.includes('server'),
      'Deploy script must guard against committing server code (entry.mjs, server) to gh-pages'
    );
  });

  await t.test('4.3 Deploy script asserts absence of .env secret files in worktree', () => {
    assert.ok(
      deployScript.includes('.env'),
      'Deploy script must check and forbid .env secret files from deploy worktree'
    );
  });

  await t.test('4.4 Deploy script guarantees .nojekyll creation at worktree root', () => {
    assert.ok(
      deployScript.includes('.nojekyll'),
      'Deploy script must ensure .nojekyll is preserved or created at worktree root'
    );
  });

  await t.test('4.5 Deploy script implements cleanup in finally block', () => {
    assert.ok(
      deployScript.includes('finally'),
      'Deploy script must implement cleanup of worktree in finally block'
    );
  });
});
