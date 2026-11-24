import type { Usage } from './types';

/**
 * USD per million tokens, used to ESTIMATE spend for budgets and reporting. Not an invoice.
 * Cache writes are billed at 1.25× input. Update PRICES_VERSION whenever values change.
 */
export const PRICES_VERSION = 'prices@2026-11';

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  mock: { input: 0, output: 0, cacheRead: 0 },
};

/** Estimated cost in USD, or null when the model has no known price. */
export function estimateCostUsd(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.input * 1.25) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
