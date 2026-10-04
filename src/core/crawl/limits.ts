import { z } from 'zod';

/** Bump when crawl behaviour changes in a way that affects stored results. */
export const CRAWLER_VERSION = 'crawler@1';

export const crawlLimitsSchema = z.object({
  maxPages: z.number().int().min(1).max(60).default(25),
  maxDepth: z.number().int().min(0).max(6).default(4),
  maxHtmlBytes: z.number().int().min(10_000).max(5_000_000).default(2_000_000),
  requestTimeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
  maxDurationMs: z.number().int().min(10_000).max(30 * 60_000).default(6 * 60_000),
  maxQueued: z.number().int().min(10).max(2_000).default(500),
  maxPerPattern: z.number().int().min(1).max(50).default(3),
  maxRedirects: z.number().int().min(0).max(10).default(5),
  maxSitemapUrls: z.number().int().min(0).max(1_000).default(200),
  includeSubdomains: z.boolean().default(false),
});

export type CrawlLimits = z.infer<typeof crawlLimitsSchema>;

export const resolveCrawlLimits = (input: Partial<CrawlLimits> = {}): CrawlLimits => crawlLimitsSchema.parse(input);
