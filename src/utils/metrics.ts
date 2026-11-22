/**
 * Metrics calculation for blog posts.
 * Computes word count (whitespace delimited) and estimated reading time
 * at standard 200 words per minute, with a minimum reading time of 1 minute.
 */

export interface MetricsResult {
  wordCount: number;
  readTimeMinutes: number;
}

export function calculateMetrics(bodyText: string): MetricsResult {
  if (!bodyText || typeof bodyText !== 'string') {
    return {
      wordCount: 0,
      readTimeMinutes: 1,
    };
  }

  const words = bodyText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readTimeMinutes = Math.max(1, Math.round(wordCount / 200));

  return {
    wordCount,
    readTimeMinutes,
  };
}
