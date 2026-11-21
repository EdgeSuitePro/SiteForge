import type { AuditContext, StoredPageDocumentLike } from './context';
import type { Evidence } from '../facts/types';

/**
 * ESP Website Opportunity Score — an internal, transparent heuristic for sharpening-business
 * websites. It is NOT an industry-standard SEO score. Every point comes from a named, versioned rule.
 * Bump RULESET_VERSION when any rule, weight or threshold changes.
 */
export const RULESET_VERSION = 'esp-audit@1';
export const SCORE_NAME = 'ESP Website Opportunity Score';

export const CATEGORIES = [
  'visibility',
  'clarity',
  'trust',
  'conversion',
  'customer_experience',
  'local_relevance',
  'revenue_opportunities',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_INFO: Record<Category, { label: string; question: string; weight: number }> = {
  visibility: { label: 'Visibility', question: 'Can search engines and AI systems understand who this business is, what it offers and where?', weight: 20 },
  clarity: { label: 'Clarity', question: 'Can a normal customer immediately understand the service?', weight: 15 },
  trust: { label: 'Trust', question: 'Does the business look legitimate, experienced and safe to hand knives to?', weight: 15 },
  conversion: { label: 'Conversion', question: 'Can a visitor easily contact, book, drop off or ship — and become a customer?', weight: 20 },
  customer_experience: { label: 'Customer experience', question: 'Does the site explain what happens before, during and after sharpening?', weight: 15 },
  local_relevance: { label: 'Local relevance', question: 'Does the site clearly connect the business to its service area?', weight: 15 },
  // Reported as potential opportunities only; never part of the score.
  revenue_opportunities: { label: 'Revenue opportunities', question: 'Are services, segments or seasonal work being under-promoted?', weight: 0 },
};

export type Outcome = 'pass' | 'partial' | 'fail' | 'not_applicable' | 'unknown';
export type Severity = 'high' | 'medium' | 'low';

export interface RuleResult {
  outcome: Outcome;
  /** 0..1 credit for pass/partial/fail. Ignored for not_applicable/unknown. */
  credit: number;
  /** What was observed, in plain language. */
  detail: string;
  evidence: Evidence[];
}

export interface RuleDefinition {
  id: string;
  category: Category;
  /** Points possible. 0 = reported but not scored (revenue opportunities). */
  points: number;
  severity: Severity;
  /** Title when the rule passes (shown under "What's working"). */
  passTitle: string;
  /** Title when it fails — phrased as the problem. */
  failTitle: string;
  /** Title when it partially passes, if the fail title would overstate the problem. */
  partialTitle?: string;
  whyItMatters: string;
  recommendedFix: string;
  /** Opportunity the business may not offer — never assume; must be confirmed with the owner. */
  requiresOwnerConfirmation?: boolean;
  evaluate: (context: AuditContext) => RuleResult;
}

export interface Finding {
  ruleId: string;
  category: Category;
  source: 'deterministic';
  outcome: Outcome;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Evidence[];
  whyItMatters: string;
  recommendedFix: string;
  requiresOwnerConfirmation: boolean;
  pointsPossible: number;
  pointsAwarded: number;
  /** Higher = address first. */
  priority: number;
}

export interface CategoryScore {
  category: Category;
  /** 0..100, or null when nothing in the category could be assessed. */
  score: number | null;
  earned: number;
  possible: number;
  rulesAssessed: number;
  rulesSkipped: number;
}

export interface AuditResult {
  rulesetVersion: string;
  overall: number | null;
  categories: CategoryScore[];
  findings: Finding[];
  caveats: string[];
}

export type { StoredPageDocumentLike };
