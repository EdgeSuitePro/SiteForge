import { clarityRules, trustRules } from './rules/clarity-trust';
import { conversionRules } from './rules/conversion';
import { experienceRules, localRules, revenueRules } from './rules/experience-local';
import { visibilityRules } from './rules/visibility';
import { buildAuditContext, type AuditInput } from './context';
import { runAudit } from './scoring';
import { RULESET_VERSION, type AuditResult, type RuleDefinition } from './types';

/** The complete ruleset for RULESET_VERSION. Order does not affect scores. */
export const RULES: RuleDefinition[] = [
  ...visibilityRules,
  ...clarityRules,
  ...trustRules,
  ...conversionRules,
  ...experienceRules,
  ...localRules,
  ...revenueRules,
];

export function auditWebsite(input: AuditInput): AuditResult {
  return runAudit(RULES, buildAuditContext(input));
}

/** Static description of every rule (for the "how this score is calculated" view). */
export function describeRules() {
  return {
    rulesetVersion: RULESET_VERSION,
    rules: RULES.map(({ id, category, points, severity, passTitle, whyItMatters }) => ({ id, category, points, severity, title: passTitle, whyItMatters })),
  };
}
