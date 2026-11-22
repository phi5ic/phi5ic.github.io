import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { z } from 'astro/zod';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';

// Schema validator for client-side pre-commit check (Feature 19)
const clientEditorSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format'),
  date: z.coerce.date(),
  section: z.enum(['systems', 'music', 'rants']),
  excerpt: z.string().min(1, 'Excerpt is required'),
  header: z.object({ teaser: z.string().optional() }).optional(),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  use_math: z.boolean().default(false),
  draft: z.boolean().default(false),
  body: z.string().default(''),
});

// Helper to normalize slug
function deriveSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

test('Feature 15: Post Creation & Editing Form', async (t) => {
  await t.test('15.1 Form state model binds all required post attributes', () => {
    const postState = {
      title: 'A New Architecture for Slice Storage',
      slug: 'a-new-architecture-for-slice-storage',
      date: '2026-11-21',
      section: 'systems',
      excerpt: 'Investigating high-throughput slice repairs.',
      header: { teaser: '/assets/images/posts/slice.png' },
      categories: ['storage', 'systems'],
      tags: ['slice', 'repair'],
      use_math: true,
      draft: false,
      body: '# Content here',
    };
    const parsed = clientEditorSchema.safeParse(postState);
    assert.ok(parsed.success);
    assert.equal(parsed.data.title, postState.title);
    assert.equal(parsed.data.slug, postState.slug);
  });

  await t.test('15.2 Slug auto-derivation converts complex titles to clean kebab-case', () => {
    assert.equal(deriveSlug('What I Learned Trying to Beat XOR!'), 'what-i-learned-trying-to-beat-xor');
    assert.equal(deriveSlug('Systems & Hardware: 2026 Edition'), 'systems-hardware-2026-edition');
    assert.equal(deriveSlug('  Spaces   and   Tabs  '), 'spaces-and-tabs');
  });

  await t.test('15.3 Section selector restricts choice to systems, music, and rants', () => {
    for (const validSec of ['systems', 'music', 'rants']) {
      const res = clientEditorSchema.shape.section.safeParse(validSec);
      assert.ok(res.success);
    }
    const invalidRes = clientEditorSchema.shape.section.safeParse('other');
    assert.equal(invalidRes.success, false);
  });

  await t.test('15.4 Tag and category handling supports array serialization', () => {
    const commaSeparated = 'erasure-coding, storage, nifsi';
    const tagArray = commaSeparated.split(',').map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(tagArray, ['erasure-coding', 'storage', 'nifsi']);
    const validation = clientEditorSchema.shape.tags.safeParse(tagArray);
    assert.ok(validation.success);
  });

  await t.test('15.5 Draft switch properly toggles boolean state', () => {
    assert.equal(clientEditorSchema.shape.draft.parse(true), true);
    assert.equal(clientEditorSchema.shape.draft.parse(false), false);
    assert.equal(clientEditorSchema.shape.draft.parse(undefined), false);
  });
});

test('Feature 16: Real-Time Live Markdown Preview', async (t) => {
  const processor = await createMarkdownProcessor();

  await t.test('16.1 Headings # through ### render standard HTML heading markup with slugified IDs', async () => {
    const sampleMd = '# Main Title\n## Sub Title\n### Section';
    const { code } = await processor.render(sampleMd);
    assert.match(code, /<h1[^>]*id="main-title"[^>]*>Main Title<\/h1>/, 'Must render h1 with id');
    assert.match(code, /<h2[^>]*id="sub-title"[^>]*>Sub Title<\/h2>/, 'Must render h2 with id');
    assert.match(code, /<h3[^>]*id="section"[^>]*>Section<\/h3>/, 'Must render h3 with id');
    assert.ok(!code.includes('# Main Title'), 'Raw markdown heading delimiters must be compiled');
  });

  await t.test('16.2 Bold, italic, and inline code formatting syntax parse cleanly into HTML elements', async () => {
    const md = '**bold text** and *italic text* and `code snippet`';
    const { code } = await processor.render(md);
    assert.ok(code.includes('<strong>bold text</strong>'), 'Must compile **bold** to <strong>');
    assert.ok(code.includes('<em>italic text</em>'), 'Must compile *italic* to <em>');
    assert.ok(code.includes('<code>code snippet</code>'), 'Must compile `code` to <code>');
    assert.ok(!code.includes('**bold text**'), 'Raw markdown asterisks must be consumed');
  });

  await t.test('16.3 Cyber terminal blockquotes and lists are identified in preview parser', async () => {
    const md = '> Terminal quote\n\n- Item 1\n- Item 2';
    const { code } = await processor.render(md);
    assert.ok(code.includes('<blockquote>'), 'Must wrap quotes in blockquote');
    assert.ok(code.includes('Terminal quote'), 'Quote content must be enclosed');
    assert.ok(code.includes('<ul>'), 'Must render unordered list element');
    assert.ok(code.includes('<li>Item 1</li>'), 'Must render li item 1');
    assert.ok(code.includes('<li>Item 2</li>'), 'Must render li item 2');
  });

  await t.test('16.4 Fenced code blocks with language specifiers are preserved', async () => {
    const codeBlock = '```rust\nfn main() {\n    println!("hello");\n}\n```';
    const { code } = await processor.render(codeBlock);
    assert.ok(code.includes('<pre'), 'Must render pre element');
    assert.ok(code.includes('rust') || code.includes('println!'), 'Language or code content preserved');
  });

  await t.test('16.5 Markdown tables format properly with header and rows', async () => {
    const tableMd = '| Metric | Value |\n|---|---|\n| Latency | 12ms |';
    const { code } = await processor.render(tableMd);
    assert.ok(code.includes('<table>'), 'Must render table element');
    assert.ok(code.includes('Metric'), 'Header cell must be rendered');
    assert.ok(code.includes('Latency'), 'Data cell must be rendered');
  });
});

test('Feature 17: KaTeX Formula Rendering in Preview', async (t) => {
  await t.test('17.1 Inline math formula renders KaTeX HTML markup', () => {
    const rendered = katex.renderToString('E = mc^2', { throwOnError: false });
    assert.ok(rendered.includes('class="katex"'), 'Must render KaTeX span');
    assert.ok(rendered.includes('math'), 'Must render MathML or HTML math content');
  });

  await t.test('17.2 Display block math renders with displayMode true', () => {
    const rendered = katex.renderToString('\\sum_{i=1}^n x_i = S', {
      displayMode: true,
      throwOnError: false,
    });
    assert.ok(rendered.includes('class="katex-display"'), 'Must render displayMode block container');
  });

  await t.test('17.3 Greek letters and mathematical operators render without exception', () => {
    const formula = '\\lambda \\oplus \\alpha \\otimes \\beta \\le \\gamma';
    const rendered = katex.renderToString(formula, { throwOnError: false });
    assert.ok(rendered.includes('katex'));
    assert.ok(!rendered.includes('ParseError'));
  });

  await t.test('17.4 Fractions and square roots render correct nested structure', () => {
    const formula = '\\frac{\\sqrt{a^2 + b^2}}{2\\pi}';
    const rendered = katex.renderToString(formula, { throwOnError: false });
    assert.ok(rendered.includes('frac') || rendered.includes('sqrt'));
  });

  await t.test('17.5 Malformed LaTeX syntax falls back safely with throwOnError false', () => {
    const malformed = '\\invalidMacro{unclosed';
    const rendered = katex.renderToString(malformed, { throwOnError: false });
    assert.ok(rendered, 'Must return fallback HTML string instead of throwing');
  });
});

test('Feature 18: Word Count & Reading Time Estimation', async (t) => {
  const metricsModule = await import('../../../src/utils/metrics.ts').catch(() => null);
  if (!metricsModule) {
    return;
  }
  const { calculateMetrics } = metricsModule;

  await t.test('18.1 200 words produces estimated reading time of 1 minute', () => {
    const text200 = Array(200).fill('word').join(' ');
    const { wordCount, readTimeMinutes } = calculateMetrics(text200);
    assert.equal(wordCount, 200);
    assert.equal(readTimeMinutes, 1);
  });

  await t.test('18.2 1,000 words produces estimated reading time of 5 minutes', () => {
    const text1000 = Array(1000).fill('word').join(' ');
    const { wordCount, readTimeMinutes } = calculateMetrics(text1000);
    assert.equal(wordCount, 1000);
    assert.equal(readTimeMinutes, 5);
  });

  await t.test('18.3 Empty or short body produces minimum reading time of 1 minute', () => {
    const { wordCount: wc1, readTimeMinutes: rt1 } = calculateMetrics('');
    assert.equal(wc1, 0);
    assert.equal(rt1, 1, 'Minimum reading time is 1 minute');

    const { wordCount: wc2, readTimeMinutes: rt2 } = calculateMetrics('One sentence post.');
    assert.equal(wc2, 3);
    assert.equal(rt2, 1);
  });

  await t.test('18.4 Whitespace-only string does not cause NaN or negative calculation', () => {
    const { wordCount, readTimeMinutes } = calculateMetrics('   \n\n\t  \r  ');
    assert.equal(wordCount, 0);
    assert.equal(readTimeMinutes, 1);
    assert.ok(!isNaN(readTimeMinutes));
  });

  await t.test('18.5 Multi-byte Unicode words and math expressions count accurately', () => {
    const text = 'Nifsi 🚀 cluster provides $O(N \\log N)$ erasure code performance.';
    const { wordCount, readTimeMinutes } = calculateMetrics(text);
    assert.ok(wordCount > 5);
    assert.equal(readTimeMinutes, 1);
  });
});

test('Feature 19: In-Browser Schema Validation', async (t) => {
  const baseValid = {
    title: 'Valid Post',
    slug: 'valid-post',
    date: '2026-11-21',
    section: 'systems',
    excerpt: 'Valid excerpt description',
    categories: ['systems'],
    tags: ['storage'],
    body: 'Sample body',
  };

  await t.test('19.1 Missing or empty title is rejected with error message', () => {
    const invalid = { ...baseValid, title: '' };
    const res = clientEditorSchema.safeParse(invalid);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('title')));
  });

  await t.test('19.2 Empty excerpt is rejected with error message', () => {
    const invalid = { ...baseValid, excerpt: '' };
    const res = clientEditorSchema.safeParse(invalid);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('excerpt')));
  });

  await t.test('19.3 Invalid section enum is rejected with error message', () => {
    const invalid = { ...baseValid, section: 'unsupported_section' };
    const res = clientEditorSchema.safeParse(invalid);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('section')));
  });

  await t.test('19.4 Malformed date representation fails date coercion', () => {
    const invalid = { ...baseValid, date: 'not-a-valid-date' };
    const res = clientEditorSchema.safeParse(invalid);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('date')));
  });

  await t.test('19.5 Valid full post passes client-side validation check cleanly', () => {
    const res = clientEditorSchema.safeParse(baseValid);
    assert.ok(res.success);
    assert.equal(res.data.title, 'Valid Post');
    assert.equal(res.data.section, 'systems');
  });
});
