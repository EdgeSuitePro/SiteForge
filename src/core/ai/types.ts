import type { z } from 'zod';

/**
 * Provider-neutral AI interface. SiteForge code asks for a TASK, not a model; the router maps
 * tasks to tiers and tiers to models (overridable by env), so no product logic is coupled to a
 * single provider or model. Every call returns usage for cost logging.
 */

export type ModelTier = 'fast' | 'strong' | 'premium';
export type Effort = 'low' | 'medium' | 'high';

export interface StructuredRequest<T> {
  task: string;
  promptId: string;
  promptVersion: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Stable, trusted instructions (cached). Never contains crawled content. */
  system: string;
  /** Per-call content; crawled data appears here only inside the untrusted-data envelope. */
  user: string;
  schema: z.ZodType<T>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StructuredResponse<T> {
  data: T;
  usage: Usage;
  /** The model that actually served the request (may differ after a fallback). */
  servedModel: string;
  stopReason: string | null;
  latencyMs: number;
}

export interface AiProvider {
  readonly name: 'anthropic' | 'mock';
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

/** The model declined (safety). Not retried automatically. */
export class AiRefusalError extends Error {
  constructor(readonly category: string | null, message = 'The model declined this request.') {
    super(message);
    this.name = 'AiRefusalError';
  }
}

/** The response could not be used (truncated, or not valid against the schema). */
export class AiOutputError extends Error {
  constructor(message: string, readonly stopReason: string | null = null) {
    super(message);
    this.name = 'AiOutputError';
  }
}

/** Provider unavailable, rate limited, or misconfigured. `retryable` guides the job queue. */
export class AiUnavailableError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
