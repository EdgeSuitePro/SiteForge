import { describe, expect, it } from 'vitest';

import { checkConcept } from './claims';
import { draftConcept } from './draft';
import { conceptContentSchema, STRATEGIES } from './schema';
import { testCatalog } from './test-catalog';

describe('deterministic concept drafts', () => {
  for (const strategy of STRATEGIES) {
    it(`${strategy}: valid, grounded, and passes the claim checker untouched`, () => {
      const draft = conceptContentSchema.parse(draftConcept(strategy, testCatalog(), ['Service area is hard to find']));
      const { report } = checkConcept(draft, testCatalog(), { strategy });
      expect(report.violations).toEqual([]);
      expect(report.structural).toEqual([]);
    });

    it(`${strategy}: with no facts at all, uses placeholders instead of inventing`, () => {
      const draft = conceptContentSchema.parse(draftConcept(strategy, { facts: [] }));
      const { report, content } = checkConcept(draft, { facts: [] }, { strategy });
      expect(report.violations).toEqual([]);
      expect(report.placeholders).toBeGreaterThan(0);
      expect(content.hero.primaryCta).toMatch(/book|contact/); // no phone → no call button
    });
  }

  it('produces three structurally different concepts', () => {
    const shapes = STRATEGIES.map((strategy) => draftConcept(strategy, testCatalog()).sections.map((section) => section.kind).join(','));
    expect(new Set(shapes).size).toBe(3);
  });
});
