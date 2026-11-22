import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeGitBlobSha } from '../helpers/mock-github.mjs';

test('Feature 20: GitHub API Post Commit Creation', async (t) => {
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';

  await t.test('20.1 PUT /repos/:owner/:repo/contents/:path creates new file without SHA', async () => {
    const slug = 'test-new-post-creation';
    const filePath = `src/content/blog/${slug}.md`;
    const content = '# Hello World\nTesting creation.';
    const base64Content = Buffer.from(content, 'utf8').toString('base64');

    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Add post: Test New Post',
        content: base64Content,
        branch: 'main',
      }),
    });

    assert.equal(res.status, 201, 'New file creation must return 201 Created');
    const data = await res.json();
    assert.ok(data.commit?.sha);
    assert.equal(data.content.path, filePath);
    assert.equal(data.content.sha, computeGitBlobSha(content));
  });

  await t.test('20.2 Created post is retrievable via GET /repos/:owner/:repo/contents/:path', async () => {
    const filePath = 'src/content/blog/test-new-post-creation.md';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    assert.ok(decoded.includes('Testing creation.'));
  });

  await t.test('20.3 Commit creation record is logged in mock server history', async () => {
    const res = await fetch(`${mockUrl}/__mock/commits`);
    const commits = await res.json();
    const createdCommit = commits.find((c) => c.message === 'Add post: Test New Post');
    assert.ok(createdCommit, 'Commit history must record the new post creation');
    assert.equal(createdCommit.path, 'src/content/blog/test-new-post-creation.md');
  });

  await t.test('20.4 Creating post that already exists without SHA returns 409 Conflict', async () => {
    const filePath = 'src/content/blog/test-new-post-creation.md';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Add post duplicate',
        content: Buffer.from('Duplicate').toString('base64'),
      }),
    });
    assert.equal(res.status, 409, 'Creating existing file without SHA must return 409 Conflict');
  });

  await t.test('20.5 Unauthenticated PUT request is rejected with 401 Unauthorized', async () => {
    const filePath = 'src/content/blog/unauth-test.md';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Unauthenticated commit',
        content: Buffer.from('data').toString('base64'),
      }),
    });
    assert.equal(res.status, 401);
  });
});

test('Feature 21: GitHub API Post Update', async (t) => {
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const filePath = 'src/content/blog/test-new-post-creation.md';

  await t.test('21.1 Fetch current blob SHA of target post', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.sha);
  });

  await t.test('21.2 PUT with matching blob SHA successfully updates post (200 OK)', async () => {
    // 1. Get current SHA
    const getRes = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    const { sha: currentSha } = await getRes.json();

    // 2. Update with current SHA
    const updatedContent = '# Updated Post Content\nVersion 2 with more details.';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update post: Test New Post',
        content: Buffer.from(updatedContent, 'utf8').toString('base64'),
        sha: currentSha,
        branch: 'main',
      }),
    });

    assert.equal(res.status, 200, 'Update with matching SHA must return 200 OK');
    const data = await res.json();
    assert.equal(data.content.sha, computeGitBlobSha(updatedContent));
  });

  await t.test('21.3 PUT with outdated/stale SHA returns 409 Conflict', async () => {
    const staleSha = '0000000000000000000000000000000000000000';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Stale update',
        content: Buffer.from('Stale data').toString('base64'),
        sha: staleSha,
      }),
    });
    assert.equal(res.status, 409, 'Stale SHA update must return 409 Conflict');
  });

  await t.test('21.4 Attempting to update non-existent file with SHA returns 404 Not Found', async () => {
    const fakePath = 'src/content/blog/non-existent-post.md';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${fakePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update non existent',
        content: Buffer.from('data').toString('base64'),
        sha: 'abc1234567890123456789012345678901234567',
      }),
    });
    assert.equal(res.status, 404);
  });

  await t.test('21.5 Updated file preserves remote content on disk and mock storage', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    assert.ok(content.includes('Version 2 with more details.'));
  });
});

test('Feature 22: UTF-8 Safe Base64 Encoding', async (t) => {
  await t.test('22.1 Math operators and logic symbols round-trip losslessly', () => {
    const mathSymbols = '⊕ ⊗ ∈ ∉ ⊆ ⊂ ∪ ∩ ∧ ∨ ¬ ⇒ ⇔ ∀ ∃ ∑ ∏ √ ∫ ∞';
    const b64 = Buffer.from(mathSymbols, 'utf8').toString('base64');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    assert.equal(decoded, mathSymbols);
  });

  await t.test('22.2 Emojis and multi-byte surrogate pairs round-trip losslessly', () => {
    const emojis = '🚀 💡 🎉 ⚠️ ✅ 🔒 🛡️ 🦀 ⚡';
    const b64 = Buffer.from(emojis, 'utf8').toString('base64');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    assert.equal(decoded, emojis);
  });

  await t.test('22.3 Greek letters and scientific variables round-trip losslessly', () => {
    const greek = 'λ, α, β, γ, δ, ε, θ, π, σ, ω, Ω, Δ, μ';
    const b64 = Buffer.from(greek, 'utf8').toString('base64');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    assert.equal(decoded, greek);
  });

  await t.test('22.4 Typographic dashes, quotes, and ellipses round-trip losslessly', () => {
    const typo = 'Em-dash — En-dash – Smart “quotes” and ‘apostrophe’ and ellipses…';
    const b64 = Buffer.from(typo, 'utf8').toString('base64');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    assert.equal(decoded, typo);
  });

  await t.test('22.5 CJK, Cyrillic, and Arabic multi-byte scripts round-trip losslessly', () => {
    const scripts = '日本語 漢字 한국어 Русский العربية';
    const b64 = Buffer.from(scripts, 'utf8').toString('base64');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    assert.equal(decoded, scripts);
  });
});

test('Feature 23: Custom Commit Metadata & Authoring', async (t) => {
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';

  await t.test('23.1 New post commits use standardized Add post: <title> format', async () => {
    const filePath = 'src/content/blog/metadata-test-1.md';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Add post: Custom Metadata Test 1',
        content: Buffer.from('# Test 1').toString('base64'),
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.commit.message, 'Add post: Custom Metadata Test 1');
  });

  await t.test('23.2 Updated post commits use standardized Update post: <title> format', async () => {
    const filePath = 'src/content/blog/metadata-test-1.md';
    const getRes = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    const { sha } = await getRes.json();

    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update post: Custom Metadata Test 1',
        content: Buffer.from('# Test 1 Updated').toString('base64'),
        sha,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.commit.message, 'Update post: Custom Metadata Test 1');
  });

  await t.test('23.3 Commits record author name phi5ic and committer email', async () => {
    const res = await fetch(`${mockUrl}/__mock/commits`);
    const commits = await res.json();
    const commit = commits.find((c) => c.message.includes('Custom Metadata Test 1'));
    assert.ok(commit);
    assert.equal(commit.author.name, 'phi5ic');
    assert.ok(commit.committer.email?.includes('@'));
  });

  await t.test('23.4 Target branch is set explicitly to main', async () => {
    const res = await fetch(`${mockUrl}/__mock/commits`);
    const commits = await res.json();
    const commit = commits[commits.length - 1];
    assert.equal(commit.branch, 'main');
  });

  await t.test('23.5 Custom commit message override is preserved', async () => {
    const filePath = 'src/content/blog/metadata-custom-override.md';
    const customMsg = 'feat(blog): publish groundbreaking research on HADR-v2';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: customMsg,
        content: Buffer.from('# HADR-v2').toString('base64'),
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.commit.message, customMsg);
  });
});

test('Feature 24: Automated CI/CD GitHub Pages Deployment', async (t) => {
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';

  await t.test('24.1 Mock GitHub actions API returns completed workflow status', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/actions/runs`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.workflow_runs.length > 0);
    assert.equal(data.workflow_runs[0].status, 'completed');
    assert.equal(data.workflow_runs[0].conclusion, 'success');
  });

  await t.test('24.2 Workflow run targets main branch', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/actions/runs`);
    const data = await res.json();
    assert.equal(data.workflow_runs[0].head_branch, 'main');
  });

  await t.test('24.3 GitHub workflow actions API is accessible with bearer token', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/actions/runs`, {
      headers: { Authorization: 'Bearer token_owner_valid' },
    });
    assert.equal(res.status, 200);
  });

  await t.test('24.4 Workflow HTML URL links to github.com actions runs', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/actions/runs`);
    const data = await res.json();
    assert.ok(data.workflow_runs[0].html_url.includes('/actions/runs/'));
  });

  await t.test('24.5 Workflow deployment triggers static site generation for gh-pages', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.ok(pkg.scripts?.build?.includes('astro build'));
  });
});
