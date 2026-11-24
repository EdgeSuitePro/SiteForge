import { FACT_EXTRACT_PROMPT_ID } from './prompts/fact-extract';
import { RUBRIC, SEMANTIC_PROMPT_ID, type SemanticAuditOutput } from './prompts/semantic-audit';
import { UNTRUSTED_TAG, type PackedPage } from './untrusted';
import type { AiProvider, StructuredRequest, StructuredResponse } from './types';

/**
 * Mock provider used when no AI credentials are configured. It never calls a model.
 * It is deliberately conservative and honest: it answers only what simple text checks can ground
 * in a real quote, says "cannot_assess" for everything else, and invents no facts.
 * Its results are labelled as mock in the UI and never contribute to scores.
 */

const MOCK_NOTE = 'Mock analysis (no AI provider configured): this question was not reviewed by AI.';

function pagesFromUser(user: string): PackedPage[] {
  const start = user.indexOf(`<${UNTRUSTED_TAG}>`);
  const end = user.lastIndexOf(`</${UNTRUSTED_TAG}>`);
  if (start < 0 || end < 0) return [];
  try {
    return (JSON.parse(user.slice(start + UNTRUSTED_TAG.length + 2, end)) as { pages: PackedPage[] }).pages ?? [];
  } catch {
    return [];
  }
}

function sentenceMatching(page: PackedPage | undefined, pattern: RegExp): string | null {
  if (!page) return null;
  const candidates = [...page.headings.map((heading) => heading.replace(/^h\d: /, '')), ...page.text.split(/\n|(?<=[.!?])\s+/)];
  const found = candidates.find((candidate) => candidate.length >= 8 && candidate.length <= 300 && pattern.test(candidate));
  return found ?? null;
}

function mockSemantic(pages: PackedPage[]): SemanticAuditOutput {
  const home = pages[0];
  const answers: SemanticAuditOutput['answers'] = RUBRIC.map((question) => ({
    id: question.id,
    rating: 'cannot_assess',
    explanation: MOCK_NOTE,
    citations: [],
    suggestedFix: '',
  }));
  const set = (id: string, rating: 'yes' | 'partly' | 'no', quote: string | null, explanation: string) => {
    const answer = answers.find((candidate) => candidate.id === id);
    if (!answer) return;
    Object.assign(answer, { rating, explanation: `Mock check: ${explanation}`, citations: quote ? [{ page: 'p1', quote }] : [] });
  };

  const purpose = sentenceMatching(home, /\b(sharpen\w*|knife|knives|blades?)\b/i);
  if (purpose) set('purpose_obvious', 'yes', purpose, 'the homepage names the sharpening service.');
  else set('purpose_obvious', 'no', null, 'no homepage heading or sentence names the service.');

  const action = sentenceMatching(home, /\b(call|text|book|schedule|drop[- ]?off|contact us|mail[- ]?in)\b/i);
  if (action) set('next_step_clear', 'partly', action, 'the homepage mentions a way to get started; a person should judge how clear it is.');

  const local = sentenceMatching(home, /\b(serving|service area|located in|based in)\b/i);
  if (local) set('local_signals', 'partly', local, 'the homepage mentions where the business serves.');

  const injected = pages.some((page) => /ignore (all |any )?(previous|prior) instructions|system:/i.test(page.text));
  return { answers, opportunities: [], instructionsFoundInContent: injected };
}

export class MockProvider implements AiProvider {
  readonly name = 'mock' as const;

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const pages = pagesFromUser(request.user);
    let output: unknown;
    if (request.promptId === SEMANTIC_PROMPT_ID) output = mockSemantic(pages);
    else if (request.promptId === FACT_EXTRACT_PROMPT_ID) output = { facts: [] };
    else throw new Error(`Mock provider has no behaviour for ${request.promptId}`);
    return {
      data: request.schema.parse(output),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      servedModel: 'mock',
      stopReason: 'end_turn',
      latencyMs: 0,
    };
  }
}
