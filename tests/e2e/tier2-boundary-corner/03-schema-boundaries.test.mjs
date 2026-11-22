import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'astro/zod';

const boundarySchema = z.object({
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  date: z.coerce.date(),
  section: z.enum(['systems', 'music', 'rants']),
  excerpt: z.string().min(1),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  use_math: z.boolean().default(false),
  draft: z.boolean().default(false),
  body: z.string().default(''),
});

test('Tier 2: Schema Boundaries, Edge Enums & Injection Prevention', async (t) => {
  await t.test('3.1 Uppercase section enum (SYSTEMS) is rejected (case sensitivity check)', () => {
    const res = boundarySchema.safeParse({
      title: 'Valid Title',
      slug: 'valid-slug',
      date: '2026-11-21',
      section: 'SYSTEMS',
      excerpt: 'Valid excerpt',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('section')));
  });

  await t.test('3.2 Leap day date (2024-02-29) coerces successfully to Date object', () => {
    const res = boundarySchema.safeParse({
      title: 'Leap Year Post',
      slug: 'leap-year-post',
      date: '2024-02-29',
      section: 'systems',
      excerpt: 'Valid excerpt',
    });
    assert.ok(res.success);
    assert.equal(res.data.date.getUTCFullYear(), 2024);
    assert.equal(res.data.date.getUTCMonth(), 1); // 1 = February (0-indexed)
    assert.equal(res.data.date.getUTCDate(), 29);
  });

  await t.test('3.3 Non-existent leap day (2025-02-29) in non-leap year coerces to March 1st', () => {
    const res = boundarySchema.safeParse({
      title: 'Invalid Leap Day',
      slug: 'invalid-leap-day',
      date: '2025-02-29',
      section: 'systems',
      excerpt: 'Valid excerpt',
    });
    assert.ok(res.success);
    // JS Date rollover converts 2025-02-29 to 2025-03-01
    assert.equal(res.data.date.getUTCMonth(), 2); // 2 = March
  });

  await t.test('3.4 Completely malformed date string fails date validation', () => {
    const res = boundarySchema.safeParse({
      title: 'Bad Date Post',
      slug: 'bad-date-post',
      date: 'not-a-real-date',
      section: 'systems',
      excerpt: 'Valid excerpt',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('date')));
  });

  await t.test('3.5 Empty title string is rejected by min(1) constraint', () => {
    const res = boundarySchema.safeParse({
      title: '',
      slug: 'empty-title',
      date: '2026-11-21',
      section: 'systems',
      excerpt: 'Valid excerpt',
    });
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes('title')));
  });

  await t.test('3.6 Path traversal slug (../../etc/passwd) is rejected by slug regex', () => {
    const maliciousSlugs = [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      '/root/secrets',
      'posts/nested-post',
      '<script>alert(1)</script>',
      'post with spaces',
      'post_with_underscores',
    ];

    for (const slug of maliciousSlugs) {
      const res = boundarySchema.safeParse({
        title: 'Traveral Attempt',
        slug,
        date: '2026-11-21',
        section: 'systems',
        excerpt: 'Valid excerpt',
      });
      assert.equal(res.success, false, `Slug "${slug}" must be rejected`);
      assert.ok(res.error.issues.some((i) => i.path.includes('slug')));
    }
  });

  await t.test('3.7 Tags containing YAML reserved words (true, false, null, yes, no) are preserved as strings', () => {
    const reservedTags = ['true', 'false', 'null', 'yes', 'no'];
    const res = boundarySchema.safeParse({
      title: 'Reserved Tags Post',
      slug: 'reserved-tags-post',
      date: '2026-11-21',
      section: 'systems',
      excerpt: 'Valid excerpt',
      tags: reservedTags,
    });
    assert.ok(res.success);
    assert.deepEqual(res.data.tags, reservedTags);
    for (const tag of res.data.tags) {
      assert.equal(typeof tag, 'string', `Tag "${tag}" must remain string`);
    }
  });

  await t.test('3.8 Massive markdown body (100,000 words) parses without memory crash', () => {
    const largeBody = 'word '.repeat(100000);
    const res = boundarySchema.safeParse({
      title: 'High Volume Post',
      slug: 'high-volume-post',
      date: '2026-11-21',
      section: 'systems',
      excerpt: 'Valid excerpt',
      body: largeBody,
    });
    assert.ok(res.success);
    assert.equal(res.data.body.length, 500000);
  });
});
