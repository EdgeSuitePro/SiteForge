import { describe, expect, it } from 'vitest';

import { parseDocument } from '../extract/document';
import { extractFacts } from '../facts';
import type { ProfileFact } from '../facts/profile';
import type { AuditInput, AuditPage } from './context';
import { RULES, auditWebsite } from './ruleset';
import { scoreFindings, toFinding } from './scoring';
import { CATEGORY_INFO, RULESET_VERSION, type Finding, type RuleDefinition } from './types';

function page(pageId: string, url: string, depth: number, body: string, head: string): AuditPage {
  const { inlineCss: _css, ...doc } = parseDocument(`<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`, url);
  return { pageId, url, depth, doc };
}

function input(pages: AuditPage[], overrides: Partial<AuditInput['crawl']> = {}, transform?: (facts: ProfileFact[]) => ProfileFact[]): AuditInput {
  const facts = extractFacts(pages.map((p) => ({ ...p, doc: { ...p.doc, inlineCss: '' } }))).map(
    (fact, index): ProfileFact => ({ ...fact, id: `f${index}`, status: 'unverified' }),
  );
  return {
    pages,
    crawl: {
      canonicalOrigin: new URL(pages[0]!.url).origin,
      outcomes: pages.map((p) => ({ pageId: p.pageId, url: p.url, state: 'fetched', httpStatus: 200, skipReason: null, discoveredFrom: null, linkText: null, error: null })),
      sitemapUrlsFound: 0,
      robotsSitemaps: 0,
      likelyJsRendered: false,
      stopReason: 'exhausted',
      ...overrides,
    },
    facts: transform ? transform(facts) : facts,
    prospect: { cityHint: null },
  };
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

const strongSite = [
  page(
    'h',
    'https://www.keenedge.com/',
    0,
    `<header><a href="tel:+16125550147">(612) 555-0147</a><nav><a href="/services">Services</a><a href="/about">About</a><a href="/book">Book a drop-off</a></nav></header>
     <main><h1>Professional knife sharpening in Minneapolis</h1>
     <p>Proudly serving Minneapolis, St. Paul and the western suburbs with expert sharpening for home cooks and chefs. We sharpen kitchen knives, Japanese knives, scissors and garden tools by hand on water stones, then test every edge before it goes home with you. Bring your knives to our drop-off box any day, or mail them in with our prepaid label.</p>
     <h2>How it works</h2><ol><li>Drop off your knives</li><li>We sharpen them</li><li>Pick them up</li></ol>
     <p>Most knives are ready within 2 business days. Open Tue–Sat 10am–6pm.</p>
     <h2>What our customers say</h2><blockquote>Best edge my knives have ever had, and the service was friendly and fast.</blockquote>
     <h2>FAQ</h2><h3>Do you sharpen serrated knives?</h3><p>Yes.</p></main>
     <footer><address>123 Main St, Minneapolis, MN 55401</address><a href="https://g.page/keenedge">Google</a>
     <a href="mailto:hello@keenedge.com">hello@keenedge.com</a><p>© 2024 Keen Edge Sharpening</p></footer>`,
    `<title>Knife Sharpening Minneapolis | Keen Edge Sharpening</title><meta name="description" content="Hand sharpening for kitchen knives in Minneapolis.">${VIEWPORT}
     <link rel="canonical" href="https://www.keenedge.com/">
     <script type="application/ld+json">{"@type":"LocalBusiness","name":"Keen Edge Sharpening","telephone":"+16125550147","address":{"streetAddress":"123 Main St","addressLocality":"Minneapolis","addressRegion":"MN","postalCode":"55401"},"hasOfferCatalog":{"@type":"OfferCatalog"}}</script>`,
  ),
  page(
    's',
    'https://www.keenedge.com/services',
    1,
    `<header><a href="tel:+16125550147">(612) 555-0147</a></header><main><h1>Services & pricing</h1>
     <ul><li>Kitchen knives $1.50 per inch</li><li>Scissors $10</li><li>Garden tools $12</li></ul>
     <a href="/book">Book now</a><form><input type="email" name="email"><textarea name="message"></textarea></form></main>`,
    `<title>Services & Pricing | Keen Edge Sharpening</title><meta name="description" content="Prices for knife sharpening.">${VIEWPORT}<link rel="canonical" href="https://www.keenedge.com/services">`,
  ),
  page(
    'a',
    'https://www.keenedge.com/about',
    1,
    `<header><a href="tel:+16125550147">(612) 555-0147</a></header><main><h1>About us</h1><p>My name is Jason Miller and I have sharpened knives since 2011.</p></main>`,
    `<title>About | Keen Edge Sharpening</title><meta name="description" content="Meet your sharpener.">${VIEWPORT}<link rel="canonical" href="https://www.keenedge.com/about">`,
  ),
];

const weakSite = [
  page('w', 'http://bladeworks.example/', 0, '<div><h2>Welcome!</h2><p>We do great work. Contact us for sharpening.</p></div>', '<title>Home</title>'),
  page('w2', 'http://bladeworks.example/gallery', 1, '<div><h1>Gallery</h1><img src="/a.jpg"><img src="/b.jpg"></div>', '<title>Home</title>'),
];

const byId = (findings: Finding[]) => new Map(findings.map((finding) => [finding.ruleId, finding]));

describe('scoring model', () => {
  const rule = (id: string, category: RuleDefinition['category'], points: number): RuleDefinition => ({
    id, category, points, severity: 'medium', passTitle: id, failTitle: id, whyItMatters: '', recommendedFix: '', evaluate: () => ({ outcome: 'pass', credit: 1, detail: '', evidence: [] }),
  });

  it('scores only assessed rules, with partial credit, and excludes unscored categories', () => {
    const findings = [
      toFinding(rule('a', 'visibility', 6), { outcome: 'pass', credit: 1, detail: '', evidence: [] }),
      toFinding(rule('b', 'visibility', 4), { outcome: 'partial', credit: 0.5, detail: '', evidence: [] }),
      toFinding(rule('c', 'visibility', 10), { outcome: 'unknown', credit: 0, detail: '', evidence: [] }),
      toFinding(rule('d', 'visibility', 10), { outcome: 'not_applicable', credit: 0, detail: '', evidence: [] }),
      toFinding(rule('e', 'conversion', 5), { outcome: 'fail', credit: 0, detail: '', evidence: [] }),
      toFinding(rule('f', 'revenue_opportunities', 0), { outcome: 'fail', credit: 0, detail: '', evidence: [] }),
    ];
    const { overall, categories } = scoreFindings(findings);
    const visibility = categories.find((category) => category.category === 'visibility')!;
    expect(visibility).toMatchObject({ score: 80, earned: 8, possible: 10, rulesAssessed: 2, rulesSkipped: 2 });
    expect(categories.find((category) => category.category === 'conversion')!.score).toBe(0);
    expect(categories.find((category) => category.category === 'trust')!.score).toBeNull();
    expect(categories.find((category) => category.category === 'revenue_opportunities')!.score).toBeNull();
    // (80*20 + 0*20) / 40
    expect(overall).toBe(40);
  });

  it('downgrades severity for partial results and ranks problems by urgency', () => {
    const high: RuleDefinition = { ...rule('h', 'conversion', 6), severity: 'high' };
    expect(toFinding(high, { outcome: 'partial', credit: 0.5, detail: '', evidence: [] }).severity).toBe('medium');
    const failHigh = toFinding(high, { outcome: 'fail', credit: 0, detail: '', evidence: [] });
    const failLow = toFinding({ ...rule('l', 'trust', 2), severity: 'low' }, { outcome: 'fail', credit: 0, detail: '', evidence: [] });
    expect(failHigh.priority).toBeGreaterThan(failLow.priority);
  });

  it('every rule is documented and category weights sum to 100', () => {
    for (const definition of RULES) {
      expect(definition.whyItMatters.length, definition.id).toBeGreaterThan(20);
      expect(definition.recommendedFix.length, definition.id).toBeGreaterThan(15);
      expect(definition.id.startsWith(definition.category === 'customer_experience' ? 'experience' : definition.category === 'local_relevance' ? 'local' : definition.category === 'revenue_opportunities' ? 'revenue' : definition.category)).toBe(true);
    }
    expect(new Set(RULES.map((definition) => definition.id)).size).toBe(RULES.length);
    expect(Object.values(CATEGORY_INFO).reduce((total, info) => total + info.weight, 0)).toBe(100);
  });
});

describe('auditWebsite', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(auditWebsite(input(strongSite)))).toBe(JSON.stringify(auditWebsite(input(strongSite))));
  });

  it('scores a well-built sharpening site highly, with evidence for what works', () => {
    const result = auditWebsite(input(strongSite, { sitemapUrlsFound: 3 }));
    expect(result.rulesetVersion).toBe(RULESET_VERSION);
    expect(result.overall).toBeGreaterThanOrEqual(85);
    const findings = byId(result.findings);
    for (const id of [
      'visibility.https', 'visibility.homepage_title_service', 'visibility.local_business_schema', 'clarity.homepage_h1_service',
      'clarity.services_listed', 'conversion.phone_prominent', 'conversion.homepage_cta', 'conversion.pricing_visible',
      'experience.turnaround', 'experience.process_explained', 'local.location_in_title_or_h1', 'local.service_area', 'trust.reviews_on_site',
      'trust.consistent_name', 'revenue.mail_in',
    ]) {
      expect(findings.get(id)?.outcome, id).toBe('pass');
    }
    expect(findings.get('conversion.phone_found')?.evidence[0]?.locator).toMatch(/tel|json-ld/);
    // Partial results get an accurate headline instead of the outright-failure wording.
    expect(findings.get('conversion.online_booking')).toMatchObject({ outcome: 'partial', title: 'Online booking is not clearly set up' });
  });

  it('identifies the concrete problems on a weak site', () => {
    const result = auditWebsite(input(weakSite));
    const findings = byId(result.findings);
    expect(result.overall).toBeLessThan(30);
    for (const id of [
      'visibility.https', 'visibility.homepage_title_service', 'visibility.local_business_schema', 'visibility.duplicate_titles',
      'clarity.homepage_h1_service', 'conversion.phone_found', 'conversion.mobile_viewport', 'conversion.pricing_visible',
      'local.location_stated', 'local.service_area', 'trust.reviews_on_site', 'experience.turnaround',
    ]) {
      expect(findings.get(id)?.outcome, id).toBe('fail');
    }
    // Rules that depend on missing data are excluded, not counted as failures.
    expect(findings.get('conversion.tap_to_call')?.outcome).toBe('not_applicable');
    expect(findings.get('local.location_in_title_or_h1')?.outcome).toBe('not_applicable');
    // Problems are listed before passes, highest priority first.
    expect(result.findings[0]!.outcome).toBe('fail');
    expect(result.findings[0]!.severity).toBe('high');
  });

  it('reports revenue opportunities as unscored and requiring owner confirmation', () => {
    const result = auditWebsite(input(weakSite));
    const commercial = byId(result.findings).get('revenue.commercial')!;
    expect(commercial).toMatchObject({ outcome: 'fail', requiresOwnerConfirmation: true, pointsPossible: 0, pointsAwarded: 0 });
    expect(commercial.title).toMatch(/^Potential opportunity — requires owner confirmation/);
    expect(result.categories.find((category) => category.category === 'revenue_opportunities')!.score).toBeNull();
  });

  it('respects operator decisions: a rejected phone number no longer counts', () => {
    const rejected = auditWebsite(input(strongSite, {}, (facts) => facts.map((fact) => (fact.type === 'phone' ? { ...fact, status: 'rejected' } : fact))));
    expect(byId(rejected.findings).get('conversion.phone_found')?.outcome).toBe('fail');
  });

  it('flags broken internal links with where they were linked from', () => {
    const base = input(strongSite);
    base.crawl.outcomes.push({ pageId: 'x', url: 'https://www.keenedge.com/old-prices', state: 'failed', httpStatus: 404, skipReason: null, discoveredFrom: 'https://www.keenedge.com/services', linkText: 'Old price list', error: null });
    const finding = byId(auditWebsite(base).findings).get('experience.broken_links')!;
    expect(finding.outcome).toBe('partial');
    expect(finding.detail).toContain('/old-prices (linked from /services)');
    expect(finding.evidence[0]?.snippet).toContain('Old price list');
  });

  it('marks everything unknown when no pages could be read', () => {
    const result = auditWebsite({ ...input(strongSite), pages: [] });
    expect(result.overall).toBeNull();
    expect(result.findings.every((finding) => finding.outcome === 'unknown')).toBe(true);
    expect(result.caveats[0]).toMatch(/No pages/);
  });
});
