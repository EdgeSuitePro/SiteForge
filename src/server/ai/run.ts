import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, gt, sum } from 'drizzle-orm';
import type { z } from 'zod';

import { estimateCostUsd, PRICES_VERSION } from '../../core/ai/pricing';
import { resolveTask, type AiTaskId } from '../../core/ai/router';
import { AiOutputError, AiRefusalError, AiUnavailableError, type AiProvider } from '../../core/ai/types';
import type { Database } from '../db/client';
import { modelRuns, type ModelRunStatus } from '../db/schema';
import { serverEnv } from '../env';
import { log } from '../log';

export class AiBudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`AI budget for this prospect is used up ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)} in the last 24 hours).`);
    this.name = 'AiBudgetExceededError';
  }
}

export interface AiTaskInput<T> {
  task: AiTaskId;
  prompt: { id: string; version: string; system: string; user: string; schema: z.ZodType<T> };
  workspaceId: string;
  prospectId: string;
  related: Record<string, string>;
}

/** Estimated AI spend for a prospect over the last 24 hours. */
export async function recentSpendUsd(db: Database, prospectId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(modelRuns.costUsd) })
    .from(modelRuns)
    .where(and(eq(modelRuns.prospectId, prospectId), gt(modelRuns.createdAt, new Date(Date.now() - 24 * 3_600_000))));
  return Number(row?.total ?? 0);
}

/**
 * Run one AI task through the configured provider and record it in model_runs, whatever the
 * outcome. Enforces the per-prospect budget before spending anything.
 */
export async function runAiTask<T>(
  db: Database,
  provider: AiProvider,
  input: AiTaskInput<T>,
): Promise<{ data: T; modelRunId: string; provider: string; model: string }> {
  const env = serverEnv();
  const resolved = resolveTask(input.task, env.ai.models);
  const model = provider.name === 'mock' ? 'mock' : resolved.model;
  const inputHash = createHash('sha256').update(input.prompt.system).update('\n---\n').update(input.prompt.user).digest('hex');
  const base = {
    workspaceId: input.workspaceId,
    prospectId: input.prospectId,
    task: input.task,
    provider: provider.name,
    tier: resolved.tier,
    modelRequested: model,
    promptId: input.prompt.id,
    promptVersion: input.prompt.version,
    effort: resolved.effort,
    inputHash,
    pricesVersion: PRICES_VERSION,
    related: input.related,
  };

  if (provider.name !== 'mock') {
    const spent = await recentSpendUsd(db, input.prospectId);
    if (spent >= env.ai.budgetUsdPerProspect) {
      await db.insert(modelRuns).values({ ...base, status: 'skipped_budget', error: 'budget exceeded' });
      throw new AiBudgetExceededError(spent, env.ai.budgetUsdPerProspect);
    }
  }

  try {
    const response = await provider.generateStructured({
      task: input.task,
      promptId: input.prompt.id,
      promptVersion: input.prompt.version,
      model,
      effort: resolved.effort,
      maxTokens: resolved.maxTokens,
      system: input.prompt.system,
      user: input.prompt.user,
      schema: input.prompt.schema,
    });
    const [row] = await db
      .insert(modelRuns)
      .values({
        ...base,
        status: 'succeeded',
        modelServed: response.servedModel,
        stopReason: response.stopReason,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheWriteTokens: response.usage.cacheWriteTokens,
        costUsd: estimateCostUsd(response.servedModel, response.usage),
        latencyMs: response.latencyMs,
      })
      .returning({ id: modelRuns.id });
    const { usage } = response;
    log.info('ai.task.succeeded', {
      task: input.task,
      model: response.servedModel,
      usageIn: usage.inputTokens,
      usageOut: usage.outputTokens,
      usageCacheRead: usage.cacheReadTokens,
      usageCacheWrite: usage.cacheWriteTokens,
      latencyMs: response.latencyMs,
    });
    return { data: response.data, modelRunId: row!.id, provider: provider.name, model: response.servedModel };
  } catch (error) {
    const status: ModelRunStatus =
      error instanceof AiRefusalError ? 'refused' : error instanceof AiOutputError ? 'invalid_output' : 'failed';
    await db.insert(modelRuns).values({
      ...base,
      status,
      stopReason: error instanceof AiOutputError ? error.stopReason : null,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    });
    log.warn('ai.task.failed', { task: input.task, status, error });
    throw error;
  }
}

/** Should the job queue retry this AI failure? */
export const isRetryableAiError = (error: unknown) => error instanceof AiUnavailableError && error.retryable;
