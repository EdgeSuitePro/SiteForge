import type { Effort, ModelTier } from './types';

/**
 * Task → tier → model routing. Defaults use current Claude models; every tier can be overridden
 * with SITEFORGE_MODEL_FAST / _STRONG / _PREMIUM so the product is never pinned to one model.
 */
export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: 'claude-haiku-5-5',
  strong: 'claude-sonnet-5-5',
  premium: 'claude-opus-5-5',
};

export interface TaskConfig {
  tier: ModelTier;
  effort: Effort;
  maxTokens: number;
  description: string;
}

export const AI_TASKS = {
  'facts.ai_extract': {
    tier: 'fast',
    effort: 'low',
    maxTokens: 8_000,
    description: 'Find services, prices, turnaround, process and service-area statements the deterministic extractors missed.',
  },
  'audit.semantic': {
    tier: 'strong',
    effort: 'medium',
    maxTokens: 16_000,
    description: 'Answer the semantic audit rubric (clarity, trust, customer focus…) with quoted evidence.',
  },
  'concepts.generate': {
    tier: 'strong',
    effort: 'medium',
    maxTokens: 12_000,
    description: 'Write one strategy concept (copy + fact references) as a concept document; rendered deterministically.',
  },
} as const satisfies Record<string, TaskConfig>;

export type AiTaskId = keyof typeof AI_TASKS;

export interface ResolvedTask extends TaskConfig {
  task: AiTaskId;
  model: string;
}

export function resolveTask(task: AiTaskId, overrides: Partial<Record<ModelTier, string | undefined>> = {}): ResolvedTask {
  const config: TaskConfig = AI_TASKS[task];
  return { ...config, task, model: overrides[config.tier] || DEFAULT_MODELS[config.tier] };
}
