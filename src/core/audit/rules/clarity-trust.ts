import type { RuleDefinition } from '../types';
import { fail, factEvidence, findPageByPurpose, partial, pass, pathOf, SHARPENING_TERM } from './helpers';

export const clarityRules: RuleDefinition[] = [
  {
    id: 'clarity.homepage_h1_service',
    category: 'clarity',
    points: 6,
    severity: 'high',
    passTitle: 'The homepage headline says what the business does',
    failTitle: 'The homepage headline does not say what the business does',
    whyItMatters: 'Visitors decide in seconds. If the first headline is a slogan or the business name alone, many leave without realising this is a sharpening service.',
    recommendedFix: 'Make the main headline plain: e.g. "Professional knife & tool sharpening in Springfield".',
    evaluate: (ctx) => {
      const h1 = ctx.home!.doc.headings.find((heading) => heading.level === 1);
      if (!h1) {
        const first = ctx.home!.doc.headings[0];
        return first && SHARPENING_TERM.test(first.text)
          ? partial(0.5, `No H1, but the first heading mentions the service: “${first.text}”.`)
          : fail('The homepage has no main headline (H1).');
      }
      const evidence = [ctx.pageEvidence(ctx.home!, h1.text, 'h1')];
      return SHARPENING_TERM.test(h1.text) ? pass(`Homepage H1: “${h1.text}”.`, evidence) : fail(`Homepage H1: “${h1.text}” — the service is not named.`, evidence);
    },
  },
  {
    id: 'clarity.services_listed',
    category: 'clarity',
    points: 6,
    severity: 'high',
    passTitle: 'Services are clearly listed',
    failTitle: 'Services are not clearly listed',
    partialTitle: 'Services are mentioned but not clearly listed',
    whyItMatters: 'Customers need to know quickly whether you can sharpen their item — kitchen knives, scissors, garden tools, Japanese blades.',
    recommendedFix: 'Add a scannable list of what you sharpen (and what you don’t), ideally with prices.',
    evaluate: (ctx) => {
      const services = ctx.factsOf('service');
      const listed = services.filter((fact) => fact.confidence === 'high');
      const evidence = factEvidence(listed.length ? listed : services);
      if (listed.length >= 2) return pass(`${listed.length} services appear in headings or lists (${listed.slice(0, 5).map((fact) => fact.display).join(', ')}).`, evidence);
      if (services.length >= 2) return partial(0.5, `${services.length} services are mentioned, but only in running text — not as a clear list.`, evidence);
      if (services.length === 1) return partial(0.25, `Only one service is identifiable (${services[0]!.display}).`, evidence);
      return fail('No specific sharpening services could be identified on the site.');
    },
  },
  {
    id: 'clarity.services_page',
    category: 'clarity',
    points: 4,
    severity: 'medium',
    passTitle: 'There is a dedicated services page',
    failTitle: 'There is no dedicated services page',
    whyItMatters: 'A services page gives customers (and search engines) one place to see everything you sharpen.',
    recommendedFix: 'Create a "Services" page listing each item type, the process and pricing.',
    evaluate: (ctx) => {
      const page = findPageByPurpose(ctx.pages, /servic|what-we|sharpening|pric|rates/i, /servic|what we (do|sharpen)|pric/i);
      return page ? pass(`Services content at ${pathOf(page.url)}.`, [ctx.pageEvidence(page, page.doc.title ?? pathOf(page.url), 'page')]) : fail('No page dedicated to services or pricing was found.');
    },
  },
  {
    id: 'clarity.homepage_substance',
    category: 'clarity',
    points: 3,
    severity: 'low',
    passTitle: 'The homepage has enough explanatory content',
    failTitle: 'The homepage has very little text',
    whyItMatters: 'A homepage with almost no words gives customers and search engines little to understand the service.',
    recommendedFix: 'Add short sections: what you sharpen, how it works, where you serve, and how to get started.',
    evaluate: (ctx) => {
      const words = ctx.home!.doc.wordCount;
      if (words >= 200) return pass(`The homepage has about ${words} words of visible text.`);
      if (words >= 80) return partial(words / 200, `The homepage has only about ${words} words of visible text.`);
      return fail(`The homepage has about ${words} words of visible text.`);
    },
  },
];

export const trustRules: RuleDefinition[] = [
  {
    id: 'trust.reviews_on_site',
    category: 'trust',
    points: 6,
    severity: 'high',
    passTitle: 'Reviews or testimonials appear on the site',
    failTitle: 'No reviews or testimonials appear on the site',
    whyItMatters: 'People are handing over expensive knives. Seeing other customers’ experiences is one of the strongest reasons to trust a sharpener.',
    recommendedFix: 'Show a few genuine customer reviews (with permission) and link to the Google review profile.',
    evaluate: (ctx) => {
      const reviews = ctx.factsOf('reviews');
      return reviews.length ? pass(`Found: ${reviews.map((fact) => fact.display).join('; ')}.`, factEvidence(reviews)) : fail('No testimonials section, quoted reviews, review widget or rating markup was found.');
    },
  },
  {
    id: 'trust.about_page',
    category: 'trust',
    points: 4,
    severity: 'medium',
    passTitle: 'There is an about / story page',
    failTitle: 'There is no about page or business story',
    whyItMatters: 'Knowing who does the sharpening — and how — builds confidence, especially for premium or heirloom knives.',
    recommendedFix: 'Add a short about section: who you are, your training/experience, and how you care for customers’ knives.',
    evaluate: (ctx) => {
      const page = findPageByPurpose(ctx.pages, /about|story|meet|who-we-are|our-team/i, /about|our story|meet/i);
      return page ? pass(`About content at ${pathOf(page.url)}.`, [ctx.pageEvidence(page, page.doc.title ?? pathOf(page.url), 'page')]) : fail('No about, story or meet-the-sharpener page was found.');
    },
  },
  {
    id: 'trust.owner_named',
    category: 'trust',
    points: 3,
    severity: 'low',
    passTitle: 'The owner or sharpener is named',
    failTitle: 'The person doing the sharpening is not named',
    partialTitle: 'The owner’s name needs to be confirmed',
    whyItMatters: 'A real name and face make a small craft business feel accountable and personal.',
    recommendedFix: 'Introduce the owner/sharpener by name, ideally with a photo.',
    evaluate: (ctx) => {
      const owners = ctx.factsOf('owner_name');
      if (!owners.length) return fail('No owner or operator name was found.');
      return owners[0]!.confidence === 'low'
        ? partial(0.6, `A possible name was found (“${owners[0]!.display}”) but it should be confirmed.`, factEvidence(owners))
        : pass(`Named: ${owners[0]!.display}.`, factEvidence(owners));
    },
  },
  {
    id: 'trust.social_profiles',
    category: 'trust',
    points: 3,
    severity: 'low',
    passTitle: 'Social or review profiles are linked',
    failTitle: 'No social media or listing profiles are linked',
    whyItMatters: 'Active profiles show the business is real and current, and give customers more places to see your work.',
    recommendedFix: 'Link your Google Business Profile and the social accounts you actually use.',
    evaluate: (ctx) => {
      const socials = ctx.factsOf('social_profile');
      return socials.length ? pass(`Linked: ${socials.map((fact) => fact.display).join(', ')}.`, factEvidence(socials)) : fail('No links to social media, Google or Yelp profiles were found.');
    },
  },
  {
    id: 'trust.consistent_name',
    category: 'trust',
    points: 2,
    severity: 'low',
    passTitle: 'The business name is used consistently',
    failTitle: 'The business name appears in different forms',
    whyItMatters: 'Consistent naming across the site and listings helps search engines connect reviews and listings to the business.',
    recommendedFix: 'Use one exact business name everywhere: title, logo, footer, structured data and listings.',
    evaluate: (ctx) => {
      // Page titles are SEO text ("Knife Sharpening Minneapolis | Name"), not naming; compare the
      // name as the business presents it (structured data, site name, logo, copyright).
      const all = ctx.factsOf('business_name');
      if (!all.length) return fail('No business name could be identified.');
      const presented = all.filter((fact) => fact.value.source !== 'title');
      const names = presented.length ? presented : all.slice(0, 1);
      if (names.length === 1) return pass(`The name “${names[0]!.display}” is used consistently.`, factEvidence(names));
      return partial(0.5, `Different names were found: ${names.slice(0, 4).map((fact) => `“${fact.display}”`).join(', ')}.`, factEvidence(names));
    },
  },
  {
    id: 'trust.professional_email',
    category: 'trust',
    points: 2,
    severity: 'low',
    passTitle: 'A business email address is shown',
    failTitle: 'No email address is shown',
    partialTitle: 'The email address is not on the business’s own domain',
    whyItMatters: 'Some customers prefer email; a domain email (you@yourbusiness.com) also signals an established business.',
    recommendedFix: 'Show an email address, ideally on your own domain.',
    evaluate: (ctx) => {
      const emails = ctx.factsOf('email');
      if (!emails.length) return fail('No email address was found.');
      const domain = ctx.crawl.canonicalOrigin ? new URL(ctx.crawl.canonicalOrigin).hostname.replace(/^www\./, '') : '';
      const onDomain = emails.find((fact) => String(fact.value.email).endsWith(`@${domain}`));
      return onDomain
        ? pass(`Business email: ${onDomain.display}.`, factEvidence([onDomain]))
        : partial(0.7, `Email shown (${emails[0]!.display}) but not on the business domain.`, factEvidence(emails));
    },
  },
];
