import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { TestHttpClient } from '../helpers/http-client.mjs';
import { createTestSessionCookie, decryptSession } from '../helpers/crypto-fixtures.mjs';
import { computeGitBlobSha } from '../helpers/mock-github.mjs';

test('Tier 4: Scenario 1 - Full Owner Authoring & Publishing Workflow', async (t) => {
  const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:43210';
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const client = new TestHttpClient(baseUrl);

  const postSlug = 'scenario-1-storage-breakthrough';
  const postFilePath = `src/content/blog/${postSlug}.md`;
  let currentSha = null;

  await t.test('Step 1: Owner logs in via GitHub OAuth', async () => {
    // Reset mock server to ensure clean state
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });

    client.clearCookies();
    // Simulate OAuth callback grant
    const sessionCookie = createTestSessionCookie({
      login: 'phi5ic',
      id: 190199501,
      name: 'Aravind Anilraj',
      avatar_url: 'https://avatars.githubusercontent.com/u/190199501',
    });
    client.setCookie('blog_session', sessionCookie);
    const session = decryptSession(sessionCookie);
    assert.equal(session.user.login, 'phi5ic');
  });

  await t.test('Step 2: Owner navigates to Admin Dashboard and verifies identity', async () => {
    const res = await client.get('/api/auth/me');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.authenticated, true);
    assert.equal(data.user.login, 'phi5ic');
  });

  await t.test('Step 3: Owner composes post with KaTeX equations and emojis', () => {
    const postBody = `
# 🚀 High-Throughput Slice Repairs in Nifsi

We introduce the slice repair theorem:
$$\\sum_{i=1}^k \\alpha_i \\cdot \\beta_i = \\Omega(N)$$

With inline metric $O(N \\log N)$ and zero packet drop.
`;
    // Verify KaTeX math rendering
    const inlineMath = katex.renderToString('O(N \\log N)', { throwOnError: false });
    assert.ok(inlineMath.includes('katex'));

    const displayMath = katex.renderToString('\\sum_{i=1}^k \\alpha_i \\cdot \\beta_i = \\Omega(N)', {
      displayMode: true,
      throwOnError: false,
    });
    assert.ok(displayMath.includes('katex-display'));

    // Metrics check
    const wordCount = postBody.trim().split(/\s+/).length;
    const readingTime = Math.max(1, Math.round(wordCount / 200));
    assert.ok(wordCount > 10);
    assert.equal(readingTime, 1);
  });

  await t.test('Step 4: Owner publishes post committing atomic markdown file via GitHub API', async () => {
    const fullMarkdown = `---
title: "High-Throughput Slice Repairs in Nifsi"
date: 2026-11-21
section: systems
excerpt: "Investigating erasure-coded storage with sub-millisecond repairs."
categories:
  - systems
  - storage
tags:
  - erasure-coding
  - nifsi
use_math: true
draft: false
---

# 🚀 High-Throughput Slice Repairs in Nifsi

$$\\sum_{i=1}^k \\alpha_i = \\Omega(N)$$
`;

    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${postFilePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Add post: High-Throughput Slice Repairs in Nifsi',
        content: Buffer.from(fullMarkdown, 'utf8').toString('base64'),
        branch: 'main',
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    currentSha = data.content.sha;
    assert.equal(currentSha, computeGitBlobSha(fullMarkdown));
  });

  await t.test('Step 5: Owner updates post with optimistic concurrency verification', async () => {
    const updatedMarkdown = `---
title: "High-Throughput Slice Repairs in Nifsi"
date: 2026-11-21
section: systems
excerpt: "Investigating erasure-coded storage with sub-millisecond repairs."
categories:
  - systems
  - storage
tags:
  - erasure-coding
  - nifsi
use_math: true
draft: false
---

# 🚀 High-Throughput Slice Repairs in Nifsi (v2)

Benchmark results confirm 3.8x throughput improvement.
`;

    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${postFilePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update post: High-Throughput Slice Repairs in Nifsi',
        content: Buffer.from(updatedMarkdown, 'utf8').toString('base64'),
        sha: currentSha,
        branch: 'main',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.notEqual(data.content.sha, currentSha);
    currentSha = data.content.sha;
  });

  await t.test('Step 6: Owner completes session and logs out', async () => {
    client.clearCookies();
    const res = await client.get('/admin');
    assert.equal(res.status, 302);
  });
});
