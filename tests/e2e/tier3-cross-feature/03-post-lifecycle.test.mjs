import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'astro/zod';
import { computeGitBlobSha } from '../helpers/mock-github.mjs';

const postValidationSchema = z.object({
  title: z.string().min(1),
  date: z.coerce.date(),
  section: z.enum(['systems', 'music', 'rants']),
  excerpt: z.string().min(1),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  use_math: z.boolean().default(false),
  draft: z.boolean().default(false),
});

test('Tier 3: Pairwise Flow 3 - Post Lifecycle (Create, Validate, Commit, Remote Concurrency)', async (t) => {
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const slug = 'pairwise-post-lifecycle';
  const filePath = `src/content/blog/${slug}.md`;

  const postData = {
    title: 'Pairwise Lifecycle Post',
    date: '2026-11-21',
    section: 'systems',
    excerpt: 'Testing pairwise flow from authoring to concurrency update.',
    categories: ['systems', 'lifecycle'],
    tags: ['test', 'e2e'],
    use_math: true,
    draft: false,
  };

  const bodyContent = `
---
title: "${postData.title}"
date: ${postData.date}
section: ${postData.section}
excerpt: "${postData.excerpt}"
categories:
  - systems
  - lifecycle
tags:
  - test
  - e2e
use_math: true
draft: false
---

# Pairwise Post

Formula: $\\alpha \\oplus \\beta = \\gamma$
`;

  let currentSha = null;

  await t.test('Flow Step 1: Client-side schema validation passes', () => {
    const res = postValidationSchema.safeParse(postData);
    assert.ok(res.success);
  });

  await t.test('Flow Step 2: Publish new post to mock GitHub repository', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: `Add post: ${postData.title}`,
        content: Buffer.from(bodyContent, 'utf8').toString('base64'),
        branch: 'main',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.commit?.sha);
    currentSha = data.content.sha;
    assert.equal(currentSha, computeGitBlobSha(bodyContent));
  });

  await t.test('Flow Step 3: Fetch published post and verify content and SHA matching', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.sha, currentSha);
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    assert.ok(content.includes('Formula: $\\alpha \\oplus \\beta = \\gamma$'));
  });

  await t.test('Flow Step 4: Update post with matching blob SHA', async () => {
    const updatedBody = bodyContent + '\n\nUpdated paragraph.';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: `Update post: ${postData.title}`,
        content: Buffer.from(updatedBody, 'utf8').toString('base64'),
        sha: currentSha,
        branch: 'main',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    currentSha = data.content.sha;
    assert.equal(currentSha, computeGitBlobSha(updatedBody));
  });

  await t.test('Flow Step 5: Verify commit log records both creation and update with owner attribution', async () => {
    const res = await fetch(`${mockUrl}/__mock/commits`);
    const commits = await res.json();
    const related = commits.filter((c) => c.path === filePath);
    assert.equal(related.length, 2);
    assert.equal(related[0].message, `Add post: ${postData.title}`);
    assert.equal(related[1].message, `Update post: ${postData.title}`);
    assert.equal(related[0].author.name, 'phi5ic');
  });
});
