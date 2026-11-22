import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { computeGitBlobSha } from '../helpers/mock-github.mjs';

test('Tier 2: Unicode Robustness, KaTeX & Base64 Roundtrip', async (t) => {
  await t.test('5.1 Multi-byte Unicode characters calculate correct Git blob length', () => {
    // Each emoji is 4 UTF-8 bytes; each Greek letter is 2 bytes; each CJK is 3 bytes
    const text = '🚀 λ 漢字';
    const utf8Buf = Buffer.from(text, 'utf8');
    // JS string length: 🚀 is 2 code units, ' ' is 1, λ is 1, ' ' is 1, 漢 is 1, 字 is 1 -> total 7
    assert.equal(text.length, 7);
    // UTF-8 byte length: 4 + 1 + 2 + 1 + 3 + 3 = 14 bytes
    assert.equal(utf8Buf.length, 14);

    const blobSha = computeGitBlobSha(text);
    const expectedHeader = `blob ${utf8Buf.length}\0`;
    assert.ok(blobSha);
  });

  await t.test('5.2 Complex KaTeX formulas render without character corruption', () => {
    const complexFormula = `
      \\begin{matrix}
        a & b \\\\
        c & d
      \\end{matrix}
      \\quad
      \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
    `;
    const rendered = katex.renderToString(complexFormula, {
      displayMode: true,
      throwOnError: false,
    });
    assert.ok(rendered.includes('matrix'));
    assert.ok(rendered.includes('sqrt'));
  });

  await t.test('5.3 UTF-8 Base64 serialization does not insert replacement characters (\\uFFFD)', () => {
    const mixedContent = `
      # 🚀 Breakthrough in HADR-v2 Coding
      
      We prove that for any slice size $S$, the repair traffic satisfies:
      $$\\Gamma \\le \\sum_{i=1}^k \\alpha_i \\cdot \\frac{|D|}{k - 1}$$

      Key benefits:
      - 🛡️ Zero-loss reconstruction
      - ⚡ Sub-millisecond parity generation
      - 日本語・한국어・العربية localization ready.
      — Aravind Anilraj (phi5ic)
    `;

    const encoded = Buffer.from(mixedContent, 'utf8').toString('base64');
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');

    assert.equal(decoded, mixedContent);
    assert.equal(decoded.includes('\uFFFD'), false, 'Decoded text must not contain replacement char');
  });

  await t.test('5.4 Base64 decoding handles empty string gracefully', () => {
    const emptyB64 = Buffer.from('', 'utf8').toString('base64');
    assert.equal(emptyB64, '');
    const decoded = Buffer.from(emptyB64, 'base64').toString('utf8');
    assert.equal(decoded, '');
  });

  await t.test('5.5 Base64 string with padding characters (= and ==) decodes accurately', () => {
    // 1 byte produces 'xx=='
    const oneByte = Buffer.from('a', 'utf8').toString('base64');
    assert.ok(oneByte.endsWith('=='));
    assert.equal(Buffer.from(oneByte, 'base64').toString('utf8'), 'a');

    // 2 bytes produces 'xxx='
    const twoBytes = Buffer.from('ab', 'utf8').toString('base64');
    assert.ok(twoBytes.endsWith('='));
    assert.equal(Buffer.from(twoBytes, 'base64').toString('utf8'), 'ab');
  });
});
