import { describe, expect, it } from 'vitest';

import { parseDocument } from '../extract/document';
import { extractFacts } from './index';
import { buildProfile, conflictingServices, type ProfileFact } from './profile';
import type { Fact, SourcePage } from './types';

const page = (pageId: string, url: string, depth: number, body: string, head = ''): SourcePage => ({
  pageId,
  url,
  depth,
  doc: parseDocument(`<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`, url),
});

const home = page(
  'p-home',
  'https://www.keenedge.com/',
  0,
  `<header id="masthead"><a href="/"><img src="/img/keen-edge-logo.png" alt="Keen Edge Sharpening logo"></a>
     <nav><a href="/services">Services</a><a href="/book">Book now</a></nav>
     <a href="tel:+16125550147">(612) 555-0147</a></header>
   <main>
     <h1>Professional knife sharpening in Minneapolis</h1>
     <p>Proudly serving Minneapolis, St. Paul and the western suburbs.</p>
     <p>Hand sharpened on Japanese water stones since 2011. Most orders are ready within 2 business days.</p>
     <h2>What our customers say</h2>
     <blockquote>Best edge my chef's knife has ever had — and so fast!</blockquote>
     <p>Call or text anytime. Order #4521 placed 2024-03-14 ref 612 5550 1234567.</p>
   </main>
   <footer><address>123 Main St, Suite 4, Minneapolis, MN 55401</address>
     <p>Open Tue–Sat 10am–6pm</p>
     <a href="https://www.facebook.com/keenedgesharpening">Facebook</a>
     <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
     <a href="https://www.instagram.com/wix">Made with Wix</a>
     <a href="mailto:Hello@KeenEdge.com?subject=Hi">Email us</a>
     <p>© 2024 Keen Edge Sharpening LLC. All rights reserved.</p></footer>`,
  `<title>Keen Edge Sharpening | Knife Sharpening Minneapolis</title>
   <meta property="og:site_name" content="Keen Edge Sharpening">
   <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Keen Edge Sharpening","telephone":"+1 612-555-0147",
   "address":{"@type":"PostalAddress","streetAddress":"123 Main St, Suite 4","addressLocality":"Minneapolis","addressRegion":"MN","postalCode":"55401"},
   "sameAs":["https://instagram.com/keenedge.mn"],"openingHours":"Tu-Sa 10:00-18:00"}</script>`,
);

const services = page(
  'p-services',
  'https://www.keenedge.com/services',
  1,
  `<nav><a href="/">Garden tools</a></nav>
   <main><h1>Services</h1>
   <ul><li>Kitchen knives — $1.50 per inch</li><li>Scissors $10 each</li><li>Chip repair from $6</li></ul>
   <p>We do not sharpen serrated knives or ceramic blades.</p>
   <p>Mail-in: ship your knives to us with the prepaid label. Drop-off box available 24/7.</p>
   <p>We also work with restaurants on a rotating schedule.</p>
   <iframe src="https://app.squareup.com/appointments/book/abc123/start"></iframe>
   <form action="/contact" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea></form>
   <p>Contact: hello@keenedge.com or support@example.com</p></main>`,
);

const facts = extractFacts([home, services]);
const ofType = (type: Fact['type']) => facts.filter((fact) => fact.type === type);
const keys = (type: Fact['type']) => ofType(type).map((fact) => fact.key).sort();

describe('extractFacts — contact', () => {
  it('finds the phone from tel:, JSON-LD and text and merges them', () => {
    const phones = ofType('phone');
    expect(phones).toHaveLength(1);
    expect(phones[0]).toMatchObject({ key: '+16125550147', display: '(612) 555-0147', confidence: 'high', inHeader: true, onHomepage: true });
    expect(phones[0]!.occurrences).toBeGreaterThanOrEqual(3);
    expect(phones[0]!.evidence.map((evidence) => evidence.locator)).toEqual(expect.arrayContaining(['link tel (header)']));
  });

  it('does not mistake order numbers or dates for phone numbers', () => {
    expect(keys('phone')).toEqual(['+16125550147']);
  });

  it('normalizes email and ignores placeholder domains', () => {
    expect(keys('email')).toEqual(['hello@keenedge.com']);
  });

  it('keeps real social profiles and drops share links and builder profiles', () => {
    expect(keys('social_profile')).toEqual(['facebook:facebook.com/keenedgesharpening', 'instagram:instagram.com/keenedge.mn']);
  });

  it('detects booking provider and contact methods', () => {
    expect(keys('booking_provider')).toEqual(['square']);
    expect(keys('contact_method')).toEqual(expect.arrayContaining(['phone_call', 'email', 'contact_form', 'text_message', 'online_booking_link']));
  });
});

describe('extractFacts — location', () => {
  it('finds the address from JSON-LD and <address>', () => {
    const address = ofType('address');
    expect(address[0]).toMatchObject({ method: 'structured_data', display: '123 Main St, Suite 4, Minneapolis, MN 55401' });
    expect(keys('locality')).toContain('minneapolis mn');
  });

  it('captures the service-area statement verbatim', () => {
    expect(ofType('service_area').map((fact) => fact.display)).toContain('Proudly serving Minneapolis, St. Paul and the western suburbs.');
  });

  it('captures hours from structured data and text', () => {
    const hours = ofType('hours').map((fact) => fact.display);
    expect(hours).toEqual(expect.arrayContaining(['Tu-Sa 10:00-18:00', 'Open Tue–Sat 10am–6pm']));
  });
});

describe('extractFacts — offering', () => {
  it('maps service mentions onto the taxonomy, with evidence', () => {
    expect(keys('service')).toEqual(
      expect.arrayContaining(['kitchen_knives', 'japanese_knives', 'scissors', 'knife_repair', 'mail_in', 'drop_off', 'commercial']),
    );
    const kitchen = ofType('service').find((fact) => fact.key === 'kitchen_knives')!;
    // Best evidence is the business's own list item, not the customer quote on the homepage.
    expect(kitchen.evidence[0]).toMatchObject({ pageUrl: 'https://www.keenedge.com/services', locator: 'text li (main)' });
    expect(kitchen.confidence).toBe('high');
  });

  it('records explicitly disclaimed services as NOT offered', () => {
    expect(keys('service_not_offered')).toEqual(['serrated_knives']);
    expect(keys('service')).not.toContain('serrated_knives');
  });

  it('ignores navigation-only mentions', () => {
    expect(keys('service')).not.toContain('garden_tools');
  });

  it('extracts price mentions with units and context', () => {
    const prices = ofType('price').map((fact) => fact.value);
    expect(prices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 1.5, unit: 'inch' }),
        expect.objectContaining({ amount: 10, unit: null }),
        expect.objectContaining({ amount: 6 }),
      ]),
    );
  });

  it('extracts turnaround claims', () => {
    expect(ofType('turnaround').map((fact) => fact.display)).toContain('within 2 business days');
  });

  it('does not treat navigation text like "Next day" as a turnaround claim', () => {
    const calendar = extractFacts([page('e', 'https://x.example/events', 1, '<main><h1>Events</h1><a href="/e/2">Next day</a></main>')]);
    expect(calendar.filter((fact) => fact.type === 'turnaround')).toEqual([]);
    const real = extractFacts([page('r', 'https://x.example/', 0, '<main><p>Drop off by noon for next-day pickup.</p></main>')]);
    expect(real.filter((fact) => fact.type === 'turnaround').map((fact) => fact.display)).toEqual(['next-day']);
  });
});

describe('extractFacts — identity and trust', () => {
  it('agrees on the business name across sources', () => {
    const top = ofType('business_name')[0]!;
    expect(top.display).toBe('Keen Edge Sharpening');
    expect(top.occurrences).toBeGreaterThanOrEqual(3);
  });

  it('finds the logo, reviews, years claim and structured data types', () => {
    expect(ofType('logo')[0]?.value).toMatchObject({ src: 'https://www.keenedge.com/img/keen-edge-logo.png' });
    expect(keys('reviews')).toEqual(expect.arrayContaining(['quotes', 'testimonial_section']));
    expect(ofType('years_claim')[0]?.value).toMatchObject({ year: 2011 });
    expect(keys('structured_data')).toContain('localbusiness');
  });
});

describe('owner names', () => {
  it.each([
    ['My name is Jason Miller and I sharpen knives.', 'Jason Miller'],
    ["Hi, I'm Dana — I started sharpening in 2015.", 'Dana'],
    ['Owner: Pat Lee', 'Pat Lee'],
    ['Founded by Maria Gomez in 2009.', 'Maria Gomez'],
  ])('finds the name in %s', (text, name) => {
    const found = extractFacts([page('o', 'https://o.example/about', 1, `<main><p>${text}</p></main>`)]).filter((fact) => fact.type === 'owner_name');
    expect(found.map((fact) => fact.display)).toEqual([name]);
  });

  it.each(["We're proud to serve you.", "I'm Proud of our work.", 'Meet The team at our shop.'])('does not invent a name from %s', (text) => {
    const found = extractFacts([page('o', 'https://o.example/about', 1, `<main><p>${text}</p></main>`)]).filter((fact) => fact.type === 'owner_name');
    expect(found).toEqual([]);
  });
});

describe('buildProfile', () => {
  const asProfile = (list: Fact[]): ProfileFact[] => list.map((fact, index) => ({ ...fact, id: String(index), status: 'unverified' }));

  it('reports missing information as not found rather than guessing', () => {
    const minimal = extractFacts([page('p1', 'https://plain.example/', 0, '<main><h1>Sharpening</h1><p>We sharpen knives.</p></main>', '<title>Home</title>')]);
    const profile = buildProfile(asProfile(minimal));
    const field = (name: string) => profile.find((entry) => entry.field === name)!;
    for (const name of ['business_name', 'phone', 'email', 'address', 'hours', 'pricing', 'turnaround', 'owner', 'reviews', 'booking']) {
      expect(field(name).primary, name).toBeNull();
    }
  });

  it('lets operator decisions override automatic ranking', () => {
    const profileFacts = asProfile(facts);
    const nameFacts = profileFacts.filter((fact) => fact.type === 'business_name');
    const top = buildProfile(profileFacts).find((entry) => entry.field === 'business_name')!.primary!;
    top.status = 'rejected';
    const next = buildProfile(profileFacts).find((entry) => entry.field === 'business_name')!;
    expect(next.primary?.id).not.toBe(top.id);
    expect(next.values).toHaveLength(nameFacts.length - 1);
  });

  it('surfaces services that are both claimed and disclaimed', () => {
    const conflict = extractFacts([
      page('c', 'https://c.example/', 0, '<main><li>Serrated knives sharpened</li><p>Sorry, we cannot do serrated bread knives.</p></main>'),
    ]);
    expect(conflictingServices(asProfile(conflict))).toEqual(['serrated_knives']);
  });
});
