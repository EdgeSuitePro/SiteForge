import { describe, expect, it } from 'vitest';

import { checkConcept, PH_OPEN, siteShingles, type ClaimKind } from './claims';
import type { ConceptContent } from './schema';
import { testCatalog } from './test-catalog';

const catalog = testCatalog();
const ref = (type: string, n = 0) => catalog.facts.filter((fact) => fact.type === type)[n]!.ref;

function concept(overrides: Partial<ConceptContent> = {}): ConceptContent {
  return {
    hero: {
      eyebrow: 'Knife sharpening',
      headline: 'Sharp knives in Springfield',
      subheadline: 'Bring your kitchen knives to us and get them back ready to cook with.',
      primaryCta: 'call',
      secondaryCta: 'drop_off',
    },
    sections: [
      { kind: 'services', heading: 'What we sharpen', intro: 'Everyday blades for home cooks.', items: [{ ref: ref('service', 0), blurb: 'Your everyday cooking knives.' }] },
      { kind: 'service_area', heading: 'Where we work', body: 'We serve Springfield and Chatham.', refs: [ref('service_area')] },
      { kind: 'trust', heading: 'Why people trust us', body: 'We take care with every edge.', refs: [] },
      { kind: 'process', heading: 'How it works', intro: 'Simple.', steps: [{ title: 'Drop off', body: 'Leave your knives with us.' }, { title: 'Pick up', body: 'Collect them sharp.' }] },
      { kind: 'contact', heading: 'Get in touch', body: 'Call or text us.' },
    ],
    seo: { title: 'Edge Works Sharpening', metaDescription: 'Knife sharpening in Springfield.' },
    rationale: 'Local first.',
    ...overrides,
  };
}

const withBody = (body: string) => concept({ sections: [{ kind: 'trust', heading: 'Why us', body, refs: [] }, ...concept().sections.filter((section) => section.kind !== 'trust')] });
const kindsFor = (body: string): ClaimKind[] => checkConcept(withBody(body), catalog, { strategy: 'local_growth' }).report.violations.map((violation) => violation.kind);

describe('unsupported-claim checker', () => {
  it('passes copy that only uses verified facts', () => {
    const { report, content } = checkConcept(concept(), catalog, { strategy: 'local_growth' });
    expect(report.violations).toEqual([]);
    expect(report.structural).toEqual([]);
    expect(report.placeholders).toBe(0);
    expect(JSON.stringify(content)).not.toContain(PH_OPEN);
  });

  it.each([
    ['Kitchen knives from $5.', 'price'],
    ['Kitchen knives are $8 each.', null],
    ['Family owned since 1987.', 'year'],
    ['Over 20 years of experience.', 'experience'],
    ['Same-day turnaround on every knife.', 'turnaround'],
    ['Ready in 24 hours.', 'turnaround'],
    ['Every edge is guaranteed.', 'guarantee'],
    ['Our certified sharpener does the work.', 'credential'],
    ['Award-winning results.', 'credential'],
    ['The best sharpening service around.', 'superlative'],
    ['Rated 4.9 stars by customers.', 'rating'],
    ['Trusted by 500 customers.', 'rating'],
    ['“They saved my favourite knife” — Sarah K.', 'testimonial'],
    ['Now serving Peoria too.', 'place'],
    ['We serve Springfield and Chatham.', null],
    ['Serving Springfield, Chatham and Peoria.', 'place'],
    ['We also sharpen lawn mower blades.', 'service'],
    ['Bread knives welcome.', 'service_not_offered'],
    ['Call (217) 555-9999 today.', 'contact_detail'],
    ['Call (217) 555-0142 today.', null],
    ['Three locations to choose from: 3 shops.', 'number'],
  ] as const)('%s', (body, expected) => {
    const kinds = kindsFor(body);
    if (expected === null) expect(kinds).toEqual([]);
    else expect(kinds).toContain(expected);
  });

  it('replaces only the offending sentence with a visible placeholder', () => {
    const { content, report } = checkConcept(withBody('We take care with every edge. Voted best in Illinois.'), catalog, { strategy: 'local_growth' });
    const trust = content.sections.find((section) => section.kind === 'trust')!;
    expect(trust.kind === 'trust' && trust.body).toMatch(/^We take care with every edge\. /);
    expect(report.placeholders).toBe(1);
    expect(report.violations.map((violation) => violation.path)).toEqual(expect.arrayContaining(['sections[0].body']));
  });

  it('flags copy taken word-for-word from the current site', () => {
    const shingles = siteShingles(['We hand sharpen every knife on Japanese water stones in our small workshop downtown.']);
    const { report } = checkConcept(withBody('We hand sharpen every knife on Japanese water stones in our small workshop downtown.'), catalog, {
      strategy: 'local_growth',
      siteShingles: shingles,
    });
    expect(report.violations.map((violation) => violation.kind)).toContain('copied_text');
  });

  it('repairs structure: invalid refs, unavailable CTAs, forbidden sections', () => {
    const { content, report } = checkConcept(
      concept({
        hero: { ...concept().hero, primaryCta: 'mail_in', secondaryCta: 'call' },
        sections: [
          { kind: 'services', heading: 'Services', intro: '', items: [{ ref: ref('price'), blurb: '' }, { ref: 'f999', blurb: '' }, { ref: ref('service', 1), blurb: '' }] },
          { kind: 'about', heading: 'About', body: 'A small shop.', refs: [] },
          { kind: 'process', heading: 'How', intro: '', steps: [{ title: 'One', body: 'Drop off.' }, { title: 'Two', body: 'Pick up.' }] },
          { kind: 'cta_band', heading: 'Ready?', body: 'Get started.', cta: 'email' },
        ],
      }),
      catalog,
      { strategy: 'fastest_path' },
    );
    expect(content.hero.primaryCta).toBe('contact'); // mail-in is not offered
    expect(content.sections.map((section) => section.kind)).toEqual(['services', 'process', 'cta_band']); // about is excluded for fastest path
    const services = content.sections[0]!;
    expect(services.kind === 'services' && services.items.map((item) => item.ref)).toEqual([ref('service', 1)]);
    expect(report.structural.length).toBeGreaterThanOrEqual(4);
  });

  it('falls back to safe metadata instead of placeholders', () => {
    const { content } = checkConcept(concept({ seo: { title: 'The #1 sharpener in Illinois', metaDescription: 'Since 1990.' } }), catalog, { strategy: 'local_growth' });
    expect(content.seo).toEqual({ title: 'Edge Works Sharpening', metaDescription: '' });
  });

  it('strips placeholder markers smuggled into model output', () => {
    const { content } = checkConcept(withBody('Fine copy xy here.'), catalog, { strategy: 'local_growth' });
    expect(JSON.stringify(content)).not.toMatch(/\\ue00[01]/i);
  });
});

describe('missing-information placeholders', () => {
  it('turns {{missing: …}} into an operator placeholder without flagging it', () => {
    const { content, report } = checkConcept(withBody('We take care with every edge. {{missing: real customer reviews}}'), catalog, { strategy: 'local_growth' });
    const trust = content.sections.find((section) => section.kind === 'trust')!;
    expect(trust.kind === 'trust' && trust.body).toBe('We take care with every edge. Missing: real customer reviewsmissing');
    expect(report.violations).toEqual([]);
    expect(report.placeholders).toBe(1);
  });

  it('still checks the rest of a sentence that contains a placeholder', () => {
    expect(kindsFor('Prices start at $3 {{missing: full price list}}.')).toContain('price');
  });
});
