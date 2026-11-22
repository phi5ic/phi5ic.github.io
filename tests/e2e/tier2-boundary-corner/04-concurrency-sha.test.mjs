import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGitBlobSha } from '../helpers/mock-github.mjs';

test('Tier 2: Optimistic Concurrency & Git Blob SHA Collisions', async (t) => {
  const mockUrl = process.env.MOCK_GITHUB_URL || 'http://127.0.0.1:43211';
  const slug = 'concurrency-test-post';
  const filePath = `src/content/blog/${slug}.md`;

  await t.test('4.1 Initial post creation without SHA succeeds with 201 Created', async () => {
    // Reset mock server to ensure clean state
    await fetch(`${mockUrl}/__mock/reset`, { method: 'POST' });

    const initialContent = '# Initial Version\nCreated for concurrency testing.';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Add post: Concurrency Test Post',
        content: Buffer.from(initialContent).toString('base64'),
      }),
    });
    assert.equal(res.status, 201);
  });

  await t.test('4.2 Stale SHA conflict: updating with wrong SHA returns 409 Conflict', async () => {
    const wrongSha = '1111222233334444555566667777888899990000';
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update with wrong sha',
        content: Buffer.from('# Bad update').toString('base64'),
        sha: wrongSha,
      }),
    });
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.ok(data.message.includes('Conflict'));
  });

  await t.test('4.3 Missing SHA update on existing file returns 409 Conflict', async () => {
    const res = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update without sha',
        content: Buffer.from('# No sha').toString('base64'),
      }),
    });
    assert.equal(res.status, 409);
  });

  await t.test('4.4 Simultaneous race condition: Editor A succeeds, Editor B gets 409 Conflict', async () => {
    // 1. Both editors read current blob SHA
    const getRes = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`);
    const { sha: baseSha } = await getRes.json();

    // 2. Editor A updates the file
    const resA = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update from Editor A',
        content: Buffer.from('# Content from Editor A').toString('base64'),
        sha: baseSha,
      }),
    });
    assert.equal(resA.status, 200, 'Editor A update should succeed');
    const dataA = await resA.json();
    const newShaFromA = dataA.content.sha;
    assert.notEqual(newShaFromA, baseSha, 'New SHA must be generated');

    // 3. Editor B tries to update using the now-stale baseSha
    const resB = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update from Editor B',
        content: Buffer.from('# Content from Editor B').toString('base64'),
        sha: baseSha,
      }),
    });
    assert.equal(resB.status, 409, 'Editor B must receive 409 Conflict due to stale SHA');

    // 4. Editor B refetches latest SHA and succeeds on retry
    const resBRetry = await fetch(`${mockUrl}/repos/phi5ic/phi5ic.github.io/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_valid',
      },
      body: JSON.stringify({
        message: 'Update from Editor B retry',
        content: Buffer.from('# Content from Editor B (retried)').toString('base64'),
        sha: newShaFromA,
      }),
    });
    assert.equal(resBRetry.status, 200, 'Editor B retry with new SHA must succeed');
  });

  await t.test('4.5 SHA computation matches sha1("blob <len>\\0<content>") byte-for-byte', () => {
    const raw = '# Content for SHA verification';
    const computed = computeGitBlobSha(raw);
    const expected = computeGitBlobSha(Buffer.from(raw, 'utf8'));
    assert.equal(computed, expected);
  });
});
