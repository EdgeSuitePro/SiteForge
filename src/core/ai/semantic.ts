import { toFinding } from '../audit/scoring';
import type { Category, Finding, RuleDefinition, RuleResult } from '../audit/types';
import { verifyCitations } from './citations';
import { RUBRIC, SEMANTIC_PROMPT_VERSION, type SemanticAuditOutput } from './prompts/semantic-audit';
import type { PackedPage } from './untrusted';

/** Semantic findings may contribute at most this share of a category's points. */
export const SEMANTIC_MAX_SHARE = 0.4;

const CREDIT = { yes: 1, partly: 0.5, no: 0 } as const;

export interface SemanticMappingOptions {
  /** Mock output is displayed but never scored. */
  scored: boolean;
}

export interface SemanticMappingResult {
  findings: Finding[];
  citationsRejected: number;
  instructionsFoundInContent: boolean;
}

/** Convert the model's rubric answers into findings. Ratings → points is done here, in code. */
export function semanticFindings(output: SemanticAuditOutput, pages: PackedPage[], options: SemanticMappingOptions): SemanticMappingResult {
  let citationsRejected = 0;
  const findings: Finding[] = [];

  for (const question of RUBRIC) {
    const answer = output.answers.find((candidate) => candidate.id === question.id);
    const rule: RuleDefinition = {
      id: `semantic.${question.id}`,
      category: question.category,
      points: options.scored ? question.points : 0,
      severity: question.severity,
      passTitle: question.passTitle,
      failTitle: question.failTitle,
      whyItMatters: question.whyItMatters,
      recommendedFix: answer?.suggestedFix.trim().slice(0, 400) || 'Review this area with the owner.',
      evaluate: () => ({ outcome: 'unknown', credit: 0, detail: '', evidence: [] }),
    };

    let result: RuleResult;
    if (!answer) {
      result = { outcome: 'unknown', credit: 0, detail: 'The AI review did not answer this question.', evidence: [] };
    } else if (answer.rating === 'cannot_assess') {
      result = { outcome: 'unknown', credit: 0, detail: answer.explanation.trim().slice(0, 500) || 'Could not be assessed from the page text.', evidence: [] };
    } else {
      const { verified, rejected } = verifyCitations(answer.citations.slice(0, 5), pages);
      citationsRejected += rejected;
      const needsQuote = answer.rating === 'yes' || answer.rating === 'partly';
      if (needsQuote && verified.length === 0) {
        result = {
          outcome: 'unknown',
          credit: 0,
          detail: 'The AI review’s answer was discarded because none of its quotes could be found on the site.',
          evidence: [],
        };
      } else {
        result = {
          outcome: answer.rating === 'yes' ? 'pass' : answer.rating === 'partly' ? 'partial' : 'fail',
          credit: CREDIT[answer.rating],
          detail: answer.explanation.trim().slice(0, 500),
          evidence: verified.slice(0, 3),
        };
      }
    }
    findings.push({ ...toFinding(rule, result), source: 'semantic' });
  }

  for (const [index, opportunity] of output.opportunities.slice(0, 4).entries()) {
    const { verified, rejected } = verifyCitations(opportunity.citations.slice(0, 3), pages);
    citationsRejected += rejected;
    if (verified.length === 0) continue; // must be grounded in something the site actually says
    const rule: RuleDefinition = {
      id: `semantic.opportunity_${index + 1}`,
      category: 'revenue_opportunities',
      points: 0,
      severity: 'low',
      requiresOwnerConfirmation: true,
      passTitle: '',
      failTitle: `Potential opportunity — requires owner confirmation: ${opportunity.title.trim().slice(0, 120)}`,
      whyItMatters: opportunity.rationale.trim().slice(0, 500),
      recommendedFix: 'Confirm with the owner before promoting this more prominently.',
      evaluate: () => ({ outcome: 'fail', credit: 0, detail: '', evidence: [] }),
    };
    findings.push({
      ...toFinding(rule, { outcome: 'fail', credit: 0, detail: 'Mentioned on the site but under-promoted, according to the AI review.', evidence: verified }),
      source: 'semantic',
    });
  }

  return { findings, citationsRejected, instructionsFoundInContent: output.instructionsFoundInContent };
}

/**
 * Cap semantic points so they are at most SEMANTIC_MAX_SHARE of each category's assessed points.
 * Deterministic rules always carry the majority of every score.
 */
export function applySemanticCap(findings: Finding[]): Finding[] {
  const assessed = (finding: Finding) => finding.outcome !== 'not_applicable' && finding.outcome !== 'unknown';
  const factors = new Map<Category, number>();
  for (const category of new Set(findings.map((finding) => finding.category))) {
    const inCategory = findings.filter((finding) => finding.category === category && assessed(finding));
    const deterministic = inCategory.filter((finding) => finding.source === 'deterministic').reduce((total, finding) => total + finding.pointsPossible, 0);
    const semantic = inCategory.filter((finding) => finding.source === 'semantic').reduce((total, finding) => total + finding.pointsPossible, 0);
    const allowed = (SEMANTIC_MAX_SHARE / (1 - SEMANTIC_MAX_SHARE)) * deterministic;
    factors.set(category, semantic > allowed && semantic > 0 ? allowed / semantic : 1);
  }
  return findings.map((finding) => {
    const factor = finding.source === 'semantic' ? factors.get(finding.category) ?? 1 : 1;
    if (factor === 1) return finding;
    const round1 = (value: number) => Math.round(value * 10) / 10;
    return { ...finding, pointsPossible: round1(finding.pointsPossible * factor), pointsAwarded: round1(finding.pointsAwarded * factor) };
  });
}

export { SEMANTIC_PROMPT_VERSION };
