import 'server-only';

import { AnthropicProvider } from '../../core/ai/anthropic';
import { MockProvider } from '../../core/ai/mock';
import type { AiProvider } from '../../core/ai/types';
import { serverEnv } from '../env';

let cached: AiProvider | undefined;

/** Anthropic when credentials are configured, otherwise the clearly-labelled mock provider. */
export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const env = serverEnv();
  cached = env.ai.provider === 'anthropic' ? new AnthropicProvider({ apiKey: env.anthropicApiKey }) : new MockProvider();
  return cached;
}
