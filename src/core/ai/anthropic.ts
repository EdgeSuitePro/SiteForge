import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

import { AiOutputError, AiRefusalError, AiUnavailableError, type AiProvider, type StructuredRequest, type StructuredResponse } from './types';

/**
 * Anthropic adapter.
 *  - Structured outputs (`output_config.format` via the SDK's Zod helper): the response is
 *    constrained to the schema and parsed by the SDK; SiteForge re-validates it anyway.
 *  - The system prompt is static per prompt version and marked for caching.
 *  - Server-side refusal fallbacks are enabled where the API supports them (Sonnet / Opus tiers);
 *    Haiku has no server-side fallback, so a refusal surfaces as AiRefusalError.
 *  - No tools are offered to the model: nothing it outputs can trigger an action.
 */

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const supportsServerFallback = (model: string) => /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5)/.test(model);

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
  /** Request timeout per call, ms. */
  timeoutMs?: number;
  maxRetries?: number;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      timeout: options.timeoutMs ?? 120_000,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const fallback = supportsServerFallback(request.model);
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: request.model,
        max_tokens: request.maxTokens,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.user }],
        output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
        ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      });
    } catch (error) {
      throw mapError(error);
    }

    if (response.stop_reason === 'refusal') {
      const details = (response as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new AiRefusalError(details?.category ?? null);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiOutputError('The model response was cut off before it finished.', response.stop_reason);
    }
    const parsed = request.schema.safeParse(response.parsed_output);
    if (!parsed.success) {
      throw new AiOutputError(`The model response did not match the expected structure: ${parsed.error.issues[0]?.message ?? 'invalid'}`, response.stop_reason);
    }

    const usage = response.usage;
    return {
      data: parsed.data,
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
      servedModel: response.model,
      stopReason: response.stop_reason,
      latencyMs: Date.now() - started,
    };
  }
}

/** Typed SDK errors → retryable / non-retryable SiteForge errors. Most specific first. */
function mapError(error: unknown): Error {
  if (error instanceof AiOutputError || error instanceof AiRefusalError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiUnavailableError('The AI provider rejected the credentials.', false);
  }
  if (error instanceof Anthropic.NotFoundError) return new AiUnavailableError('The configured AI model was not found.', false);
  if (error instanceof Anthropic.BadRequestError) return new AiUnavailableError(`The AI request was invalid: ${error.message}`, false);
  if (error instanceof Anthropic.RateLimitError) return new AiUnavailableError('The AI provider is rate limiting requests.', true);
  if (error instanceof Anthropic.APIConnectionError) return new AiUnavailableError('Could not reach the AI provider.', true);
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 500;
    return new AiUnavailableError(`The AI provider returned an error (${status}).`, status >= 500 || status === 408 || status === 409);
  }
  if (error instanceof Error && /parse|JSON/i.test(error.message)) {
    return new AiOutputError(`The model response could not be parsed: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
