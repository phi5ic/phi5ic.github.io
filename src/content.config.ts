import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    excerpt: z.string(),
    header: z.object({
      teaser: z.string().optional(),
    }).optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    use_math: z.boolean().optional(),
  }),
});

export const collections = { blog };
