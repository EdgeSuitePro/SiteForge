import type { AuditPage } from '../context';
import type { RuleDefinition } from '../types';
import { fail, factEvidence, graded, notApplicable, partial, pass, pathOf } from './helpers';

const CTA_TEXT = /\b(book|schedule|reserve|appointment|get started|contact|call|text|drop[- ]?off|mail[- ]?in|order|get a quote|request)\b/i;

function hasNextStep(page: AuditPage): boolean {
  return (
    page.doc.links.some((link) => link.kind === 'tel' || link.kind === 'sms' || link.kind === 'mailto' || (CTA_TEXT.test(link.text) && link.text.length <= 60)) ||
    page.doc.forms.some((form) => form.hasEmail || form.hasPhone || form.hasTextarea) ||
    page.doc.iframes.some((frame) => /book|appointment|schedul|calendly|setmore|squareup|acuity/i.test(frame.src))
  );
}

export const conversionRules: RuleDefinition[] = [
  {
    id: 'conversion.phone_found',
    category: 'conversion',
    points: 6,
    severity: 'high',
    passTitle: 'A phone number is published',
    failTitle: 'No phone number was found',
    whyItMatters: 'Many sharpening customers want to call or text before dropping off knives. No number means lost enquiries.',
    recommendedFix: 'Show your phone number on every page, ideally in the header.',
    evaluate: (ctx) => {
      const phones = ctx.factsOf('phone');
      return phones.length ? pass(`Phone: ${phones[0]!.display}.`, factEvidence(phones)) : fail('No phone number appears on the crawled pages.');
    },
  },
  {
    id: 'conversion.tap_to_call',
    category: 'conversion',
    points: 4,
    severity: 'medium',
    passTitle: 'The phone number is tap-to-call on mobile',
    failTitle: 'The phone number is not tap-to-call',
    whyItMatters: 'On a phone, a number that is just text has to be copied by hand; a tel: link calls in one tap.',
    recommendedFix: 'Link the number with href="tel:+1…" everywhere it appears.',
    evaluate: (ctx) => {
      if (!ctx.hasFact('phone')) return notApplicable('No phone number to link.');
      const linked = ctx.pages.some((page) => page.doc.links.some((link) => link.kind === 'tel'));
      return linked ? pass('The number is linked with tel:.') : fail('The phone number appears only as plain text.', factEvidence(ctx.factsOf('phone')));
    },
  },
  {
    id: 'conversion.phone_prominent',
    category: 'conversion',
    points: 4,
    severity: 'medium',
    passTitle: 'The phone number is prominent (header / homepage)',
    failTitle: 'The phone number is hard to find',
    partialTitle: 'The phone number is not in the site header',
    whyItMatters: 'If the number is buried in the footer or on the contact page, mobile visitors often give up before finding it.',
    recommendedFix: 'Put a tap-to-call number in the site header so it is visible on every page.',
    evaluate: (ctx) => {
      const phones = ctx.factsOf('phone');
      if (!phones.length) return notApplicable('No phone number found.');
      const top = phones[0]!;
      if (top.inHeader) return pass('The number appears in the site header.', factEvidence([top]));
      if (top.onHomepage) return partial(0.5, 'The number is on the homepage but not in the header.', factEvidence([top]));
      return fail(`The number appears only on inner pages (${top.evidence.map((evidence) => pathOf(evidence.pageUrl)).slice(0, 3).join(', ')}).`, factEvidence([top]));
    },
  },
  {
    id: 'conversion.homepage_cta',
    category: 'conversion',
    points: 6,
    severity: 'high',
    passTitle: 'The homepage gives a clear next step',
    failTitle: 'The homepage has no clear next step',
    partialTitle: 'The homepage’s only next step is the phone number',
    whyItMatters: 'Visitors who are ready to act need an obvious button: book, call, text, or how to drop off.',
    recommendedFix: 'Add a prominent call to action near the top of the homepage (e.g. "Book a drop-off" or "Call / text us").',
    evaluate: (ctx) => {
      const ctas = ctx.home!.doc.links.filter((link) => link.kind !== 'external' && CTA_TEXT.test(link.text) && link.text.length <= 60);
      const tel = ctx.home!.doc.links.some((link) => link.kind === 'tel');
      if (ctas.length) {
        return pass(`Homepage actions: ${[...new Set(ctas.map((link) => `“${link.text}”`))].slice(0, 4).join(', ')}.`, [
          ctx.pageEvidence(ctx.home!, ctas[0]!.text, `link (${ctas[0]!.region})`),
        ]);
      }
      if (tel) return partial(0.5, 'The only action on the homepage is the phone link.');
      return fail('No booking, contact or call-to-action link was found on the homepage.');
    },
  },
  {
    id: 'conversion.online_booking',
    category: 'conversion',
    points: 4,
    severity: 'medium',
    passTitle: 'Customers can book or schedule online',
    failTitle: 'There is no way to book online',
    partialTitle: 'Online booking is not clearly set up',
    whyItMatters: 'Many customers prefer to schedule a drop-off or pickup without a phone call, especially outside business hours.',
    recommendedFix: 'Add online booking (or an EdgeSuite Pro reservation link) for drop-offs, pickups or appointments.',
    evaluate: (ctx) => {
      const providers = ctx.factsOf('booking_provider');
      if (providers.length) return pass(`Online booking via ${providers.map((fact) => fact.display).join(', ')}.`, factEvidence(providers));
      const links = ctx.factsOf('contact_method').filter((fact) => fact.key === 'online_booking_link');
      if (links.length) return partial(0.7, 'There is a booking link, but no recognised booking system was detected.', factEvidence(links));
      return fail('No booking system or booking link was found.');
    },
  },
  {
    id: 'conversion.contact_form',
    category: 'conversion',
    points: 3,
    severity: 'low',
    passTitle: 'There is a contact form',
    failTitle: 'There is no contact form',
    whyItMatters: 'A form captures enquiries from people who will not call or email.',
    recommendedFix: 'Add a short contact or request form (name, phone/email, what needs sharpening).',
    evaluate: (ctx) => {
      const forms = ctx.factsOf('contact_method').filter((fact) => fact.key === 'contact_form');
      return forms.length ? pass('A contact form was found.', factEvidence(forms)) : fail('No contact form was found.');
    },
  },
  {
    id: 'conversion.mobile_viewport',
    category: 'conversion',
    points: 5,
    severity: 'high',
    passTitle: 'Pages are configured for mobile screens',
    failTitle: 'Pages are not configured for mobile screens',
    whyItMatters: 'Most local searches happen on phones. Without a viewport setting, pages render tiny and are hard to use.',
    recommendedFix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and use a responsive layout.',
    evaluate: (ctx) => {
      const ok = ctx.pages.filter((page) => /width\s*=\s*device-width/i.test(page.doc.viewport ?? ''));
      return graded(ok.length / ctx.pages.length, `${ok.length} of ${ctx.pages.length} pages declare a mobile viewport.`);
    },
  },
  {
    id: 'conversion.pricing_visible',
    category: 'conversion',
    points: 5,
    severity: 'high',
    passTitle: 'Pricing is published and easy to reach',
    failTitle: 'Pricing is missing or hard to find',
    partialTitle: 'Pricing exists but requires multiple clicks',
    whyItMatters: 'Customers hesitate when they cannot estimate the cost. Visible pricing removes the biggest reason not to drop off knives.',
    recommendedFix: 'Show typical prices (per knife, per inch, scissors, repairs) on the services page and link it from the homepage.',
    evaluate: (ctx) => {
      const prices = ctx.factsOf('price');
      if (!prices.length) return fail('No prices were found on the crawled pages.');
      const depthOf = new Map(ctx.pages.map((page) => [page.pageId, page.depth]));
      const shallowest = Math.min(...prices.flatMap((fact) => fact.evidence.map((evidence) => depthOf.get(evidence.pageId) ?? 9)));
      if (shallowest <= 1) return pass(`${prices.length} price mention${prices.length === 1 ? '' : 's'} found, reachable from the homepage.`, factEvidence(prices));
      return partial(0.5, `Prices exist but are ${shallowest} clicks from the homepage.`, factEvidence(prices));
    },
  },
  {
    id: 'conversion.no_dead_ends',
    category: 'conversion',
    points: 3,
    severity: 'low',
    passTitle: 'Every page offers a next step',
    failTitle: 'Some pages are dead ends',
    whyItMatters: 'A page with no call, booking or contact link leaves interested visitors with nowhere to go.',
    recommendedFix: 'Put the phone number and a booking/contact button in the header or footer so every page has a next step.',
    evaluate: (ctx) => {
      const deadEnds = ctx.pages.filter((page) => !hasNextStep(page));
      return graded(
        1 - deadEnds.length / ctx.pages.length,
        deadEnds.length ? `${deadEnds.length} of ${ctx.pages.length} pages have no call, booking or contact option: ${deadEnds.slice(0, 5).map((page) => pathOf(page.url)).join(', ')}.` : 'Every crawled page has a call, booking or contact option.',
        deadEnds.slice(0, 3).map((page) => ctx.pageEvidence(page, page.doc.title ?? pathOf(page.url), 'page')),
      );
    },
  },
];
