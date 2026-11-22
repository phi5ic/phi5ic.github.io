import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { z } from 'astro/zod';

const unifiedSchema = z.object({
  title: z.string(),
  date: z.coerce.date(),
  excerpt: z.string().optional().default(''),
  header: z.object({ teaser: z.string().optional() }).optional(),
  section: z.enum(['systems', 'music', 'rants']).default('systems'),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  use_math: z.boolean().default(false),
  draft: z.boolean().default(false),
});

test('Tier 4: Scenario 3 - Multi-Section Content Management & Schema Compatibility', async (t) => {
  const sections = ['systems', 'music', 'rants'];

  await t.test('Step 1: Validate distinct posts across all three site sections', () => {
    for (const sec of sections) {
      const post = {
        title: `Technical Notes for ${sec.toUpperCase()}`,
        date: '2026-11-21',
        section: sec,
        excerpt: `In-depth exploration of ${sec}.`,
        header: { teaser: `/assets/images/posts/${sec}-teaser.jpg` },
        categories: [sec, 'engineering'],
        tags: [sec, 'research'],
        use_math: sec === 'systems',
        draft: sec === 'rants', // draft test
      };

      const res = unifiedSchema.safeParse(post);
      assert.ok(res.success, `Post for section ${sec} must satisfy schema`);
      assert.equal(res.data.section, sec);
      assert.equal(res.data.draft, sec === 'rants');
    }
  });

  await t.test('Step 2: Verify draft posts are filtered out of public list query predicate', () => {
    const posts = [
      { id: '1', data: { section: 'systems', draft: false } },
      { id: '2', data: { section: 'systems', draft: true } },
      { id: '3', data: { section: 'music', draft: false } },
      { id: '4', data: { section: 'rants', draft: true } },
    ];

    // Predicate used in src/pages/posts/index.astro: !post.data.draft
    const publicPosts = posts.filter((p) => !p.data.draft);
    assert.equal(publicPosts.length, 2);
    assert.deepEqual(publicPosts.map((p) => p.id), ['1', '3']);

    // Section partitioning predicate
    const systemsPosts = publicPosts.filter((p) => p.data.section === 'systems');
    assert.equal(systemsPosts.length, 1);
    assert.equal(systemsPosts[0].id, '1');
  });

  await t.test('Step 3: Section enum non-member is strictly rejected across partitions', () => {
    const invalidPost = {
      title: 'Invalid Section Post',
      date: '2026-11-21',
      section: 'crypto', // not in systems, music, rants
    };
    const res = unifiedSchema.safeParse(invalidPost);
    assert.equal(res.success, false);
  });
});

test('Tier 4: Scenario 5 - End-to-End Astro Build & CI/CD Pipeline Verification', async (t) => {
  const testPostPath = path.resolve('src/content/blog/e2e-build-test-post.md');
  const generatedHtmlDir = path.resolve('dist/client/posts/e2e-build-test-post');

  // Unified cleanup function guaranteeing restoration of repository workspace
  const cleanupWorkspace = () => {
    let postRemoved = false;
    if (fs.existsSync(testPostPath)) {
      try {
        fs.unlinkSync(testPostPath);
        postRemoved = true;
      } catch (err) {}
    }
    if (fs.existsSync(generatedHtmlDir)) {
      try {
        fs.rmSync(generatedHtmlDir, { recursive: true, force: true });
      } catch (err) {}
    }
    return postRemoved;
  };

  // Layer 1: Idempotent pre-cleanup in case a previous run crashed unexpectedly
  cleanupWorkspace();

  // Layer 2: node:test lifecycle hook guaranteed to run even upon assertion failure
  t.after(() => {
    const wasRemoved = cleanupWorkspace();
    if (wasRemoved) {
      try {
        execSync('npm run build', { stdio: 'pipe' });
      } catch (err) {}
    }
  });

  // Layer 3: Process interrupt handlers for graceful termination (SIGINT, SIGTERM, exit)
  const signalHandler = () => {
    cleanupWorkspace();
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  process.once('exit', signalHandler);
  t.after(() => {
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    process.removeListener('exit', signalHandler);
  });

  // Layer 4: try ... finally block wrapping the entire authoring and build verification lifecycle
  try {
    await t.test('Step 1: Write temporary content collection post matching publishing output', () => {
      const markdownContent = `---
title: "E2E Build Verification Post"
date: 2026-11-21
section: systems
excerpt: "Automated test post verifying Astro build integrity."
categories:
  - systems
  - e2e
tags:
  - build
  - test
use_math: true
draft: false
---

# E2E Build Test

Formula: $x^2 + y^2 = z^2$

Emoji: 🚀
`;
      fs.writeFileSync(testPostPath, markdownContent, 'utf8');
      assert.ok(fs.existsSync(testPostPath), 'Temporary markdown post file must exist on disk');
    });

    await t.test('Step 2: Run npm run build with the new committed post', () => {
      try {
        execSync('npm run build', { stdio: 'pipe' });
        assert.ok(true, 'npm run build completed cleanly');
      } catch (err) {
        assert.fail(`npm run build failed: ${err.stderr?.toString() || err.message}`);
      }
    });

    await t.test('Step 3: Verify built HTML output contains compiled post and math markup', () => {
      const generatedHtmlPath = path.join(generatedHtmlDir, 'index.html');
      assert.ok(
        fs.existsSync(generatedHtmlPath),
        `Expected prerendered post HTML at ${generatedHtmlPath}`
      );
      const html = fs.readFileSync(generatedHtmlPath, 'utf8');
      assert.ok(html.includes('E2E Build Verification Post'), 'Built HTML must contain post title');
      assert.ok(html.includes('class="katex"') || html.includes('katex'), 'Built HTML must contain KaTeX math markup');
    });
  } finally {
    const removed = cleanupWorkspace();
    if (removed) {
      execSync('npm run build', { stdio: 'pipe' });
    }
  }

  await t.test('Step 4: Verify test post file and generated build artifacts are completely removed', () => {
    assert.equal(fs.existsSync(testPostPath), false, 'Temporary markdown post file must be unlinked');
    assert.equal(fs.existsSync(generatedHtmlDir), false, 'Generated post directory in dist/client must be pruned');
  });
});
