import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { describe, expect, it } from 'vitest';

import { draftConcept } from './draft';
import { conceptModelOutputSchema, normalizeConcept } from './schema';
import { testCatalog } from './test-catalog';

describe('concept schema', () => {
  it('converts to an API output format (lenient variant)', () => {
    const format = betaZodOutputFormat(conceptModelOutputSchema);
    expect(format.type).toBe('json_schema');
    expect(JSON.stringify(format.schema)).toContain('cta_band');
  });

  it('clamps over-long model copy instead of failing the concept', () => {
    const draft = draftConcept('local_growth', testCatalog());
    const long = { ...draft, hero: { ...draft.hero, headline: 'word '.repeat(60) }, rationale: 'x '.repeat(400) };
    const normalized = normalizeConcept(conceptModelOutputSchema.parse(long));
    expect(normalized.hero.headline.length).toBeLessThanOrEqual(90);
    expect(normalized.hero.headline.endsWith('…')).toBe(true);
    expect(normalized.rationale.length).toBeLessThanOrEqual(500);
  });

  it('does not leave half a placeholder token when clamping', () => {
    const draft = draftConcept('local_growth', testCatalog());
    const normalized = normalizeConcept({ ...draft, hero: { ...draft.hero, headline: `${'a'.repeat(70)} {{missing: something long enough to cut}}` } });
    expect(normalized.hero.headline).not.toContain('{{');
  });
});
