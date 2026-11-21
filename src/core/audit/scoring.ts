import type { AuditContext } from './context';
import {
  CATEGORIES,
  CATEGORY_INFO,
  RULESET_VERSION,
  type AuditResult,
  type CategoryScore,
  type Finding,
  type RuleDefinition,
  type RuleResult,
  type Severity,
} from './types';

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const round1 = (value: number) => Math.round(value * 10) / 10;

/** A partial result is one severity level less urgent than an outright failure. */
function effectiveSeverity(rule: RuleDefinition, result: RuleResult): Severity {
  if (result.outcome !== 'partial') return rule.severity;
  return rule.severity === 'high' ? 'medium' : 'low';
}

export function toFinding(rule: RuleDefinition, result: RuleResult): Finding {
  const assessed = result.outcome === 'pass' || result.outcome === 'partial' || result.outcome === 'fail';
  const credit = assessed ? Math.max(0, Math.min(1, result.credit)) : 0;
  const severity = effectiveSeverity(rule, result);
  const lost = assessed ? rule.points * (1 - credit) : 0;
  return {
    ruleId: rule.id,
    category: rule.category,
    source: 'deterministic',
    outcome: result.outcome,
    severity,
    title: result.outcome === 'pass' ? rule.passTitle : result.outcome === 'partial' ? (rule.partialTitle ?? rule.failTitle) : rule.failTitle,
    detail: result.detail,
    evidence: result.evidence.slice(0, 5),
    whyItMatters: rule.whyItMatters,
    recommendedFix: rule.recommendedFix,
    requiresOwnerConfirmation: Boolean(rule.requiresOwnerConfirmation),
    pointsPossible: assessed ? rule.points : 0,
    pointsAwarded: assessed ? round1(rule.points * credit) : 0,
    // Problems first, ordered by urgency × points at stake; unscored opportunities after.
    priority: result.outcome === 'pass' || !assessed ? 0 : SEVERITY_RANK[severity] * 100 + lost * 10 + (rule.points === 0 ? -50 : 0),
  };
}

/**
 * Category score = points earned / points possible over the rules that could be assessed.
 * Rules that are not applicable or could not be assessed are excluded from the denominator
 * (and reported), so missing data never silently counts as a failure or a pass.
 * Overall = category scores weighted by CATEGORY_INFO weights, over categories with a score.
 */
export function scoreFindings(findings: Finding[]): { overall: number | null; categories: CategoryScore[] } {
  const categories: CategoryScore[] = CATEGORIES.map((category) => {
    const inCategory = findings.filter((finding) => finding.category === category);
    const assessed = inCategory.filter((finding) => finding.outcome !== 'not_applicable' && finding.outcome !== 'unknown');
    const possible = assessed.reduce((total, finding) => total + finding.pointsPossible, 0);
    const earned = assessed.reduce((total, finding) => total + finding.pointsAwarded, 0);
    return {
      category,
      score: possible > 0 ? Math.round((earned / possible) * 100) : null,
      earned: round1(earned),
      possible,
      rulesAssessed: assessed.length,
      rulesSkipped: inCategory.length - assessed.length,
    };
  });

  let weighted = 0;
  let weights = 0;
  for (const category of categories) {
    const weight = CATEGORY_INFO[category.category].weight;
    if (category.score === null || weight === 0) continue;
    weighted += category.score * weight;
    weights += weight;
  }
  return { overall: weights > 0 ? Math.round(weighted / weights) : null, categories };
}

export function runAudit(rules: RuleDefinition[], context: AuditContext): AuditResult {
  const caveats: string[] = [];
  if (context.pages.length === 0) caveats.push('No pages could be read, so nothing could be assessed.');
  if (context.crawl.likelyJsRendered) {
    caveats.push('The site appears to build pages with JavaScript; some content may not have been visible to the crawler or to search engines.');
  }
  if (context.crawl.stopReason === 'page_limit' || context.crawl.stopReason === 'time_limit') {
    caveats.push('The crawl stopped at its limit; findings reflect the most important pages, not necessarily every page.');
  }

  const findings = rules.map((rule) => {
    if (context.pages.length === 0) {
      return toFinding(rule, { outcome: 'unknown', credit: 0, detail: 'No crawled pages were available.', evidence: [] });
    }
    try {
      return toFinding(rule, rule.evaluate(context));
    } catch (error) {
      return toFinding(rule, {
        outcome: 'unknown',
        credit: 0,
        detail: `This check could not be completed (${error instanceof Error ? error.message : 'error'}).`,
        evidence: [],
      });
    }
  });
  findings.sort((a, b) => b.priority - a.priority || a.ruleId.localeCompare(b.ruleId));
  return { rulesetVersion: RULESET_VERSION, ...scoreFindings(findings), findings, caveats };
}
