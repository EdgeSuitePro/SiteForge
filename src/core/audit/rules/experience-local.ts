import { jsonLdNodes, jsonLdTypes } from '../../extract/document';
import type { RuleDefinition } from '../types';
import { cityMentioned, fail, factEvidence, notApplicable, partial, pass, pathOf } from './helpers';

const SERVICE_MODELS = ['drop_off', 'mail_in', 'mobile', 'farmers_market', 'while_you_wait', 'pickup_delivery'];

export const experienceRules: RuleDefinition[] = [
  {
    id: 'experience.turnaround',
    category: 'customer_experience',
    points: 5,
    severity: 'medium',
    passTitle: 'Turnaround time is stated',
    failTitle: 'Turnaround time is not stated',
    whyItMatters: 'Customers are giving up the knives they cook with. "When do I get them back?" is one of their first questions.',
    recommendedFix: 'State typical turnaround (e.g. "ready in 2–3 business days") and any rush option you genuinely offer.',
    evaluate: (ctx) => {
      const claims = ctx.factsOf('turnaround');
      return claims.length ? pass(`Turnaround stated: ${claims.map((fact) => `“${fact.display}”`).join(', ')}.`, factEvidence(claims)) : fail('No turnaround time was found.');
    },
  },
  {
    id: 'experience.process_explained',
    category: 'customer_experience',
    points: 5,
    severity: 'high',
    passTitle: 'How to get knives to the sharpener is explained',
    failTitle: 'It is unclear how customers get their knives to you',
    partialTitle: 'The sharpening process is only partly explained',
    whyItMatters: 'Drop-off, mail-in, mobile or market — customers need to know the logistics before they commit.',
    recommendedFix: 'Add a simple "How it works" section: how to drop off/ship, what happens, and how pickup/return works.',
    evaluate: (ctx) => {
      const models = ctx.factsOf('service').filter((fact) => SERVICE_MODELS.includes(fact.key));
      const process = ctx.pages.some((page) => page.doc.headings.some((heading) => /how it works|how to|process|what to expect|step/i.test(heading.text)));
      if (models.length && process) return pass(`Service options (${models.map((fact) => fact.display).join(', ')}) and a process section were found.`, factEvidence(models));
      if (models.length) return partial(0.6, `Service options are mentioned (${models.map((fact) => fact.display).join(', ')}) but there is no step-by-step explanation.`, factEvidence(models));
      if (process) return partial(0.4, 'A process section exists, but no drop-off, mail-in or mobile option is described.');
      return fail('No drop-off, mail-in, mobile or step-by-step process information was found.');
    },
  },
  {
    id: 'experience.hours',
    category: 'customer_experience',
    points: 4,
    severity: 'medium',
    passTitle: 'Hours or availability are stated',
    failTitle: 'Hours or availability are not stated',
    whyItMatters: 'Customers need to know when they can drop off, pick up or call.',
    recommendedFix: 'Publish opening hours, drop-off windows, or "by appointment" details.',
    evaluate: (ctx) => {
      const hours = ctx.factsOf('hours');
      return hours.length ? pass(`Hours: ${hours.slice(0, 2).map((fact) => `“${fact.display}”`).join(', ')}.`, factEvidence(hours)) : fail('No hours or availability information was found.');
    },
  },
  {
    id: 'experience.faq',
    category: 'customer_experience',
    points: 4,
    severity: 'medium',
    passTitle: 'Common questions are answered (FAQ)',
    failTitle: 'Common customer questions are not answered',
    whyItMatters: 'Questions about cost, turnaround, serrated knives, or damage keep people from booking. An FAQ answers them in advance.',
    recommendedFix: 'Add an FAQ covering cost, turnaround, what you can/can’t sharpen, how to package knives, and payment.',
    evaluate: (ctx) => {
      const faq = ctx.factsOf('faq');
      return faq.length ? pass(`FAQ content found (${faq.map((fact) => fact.display).join('; ')}).`, factEvidence(faq)) : fail('No FAQ section or question-and-answer content was found.');
    },
  },
  {
    id: 'experience.broken_links',
    category: 'customer_experience',
    points: 4,
    severity: 'high',
    passTitle: 'No broken internal links were found',
    failTitle: 'Some internal links are broken',
    whyItMatters: 'Broken links look neglected and stop customers mid-journey; search engines also treat them as a quality signal.',
    recommendedFix: 'Fix or remove links that lead to missing pages (or redirect them to the right page).',
    evaluate: (ctx) => {
      const broken = ctx.crawl.outcomes.filter((outcome) => outcome.state === 'failed' && (outcome.httpStatus === 404 || outcome.httpStatus === 410));
      const checked = ctx.crawl.outcomes.filter((outcome) => outcome.state === 'fetched' || outcome.state === 'failed').length;
      if (!broken.length) return pass(`${checked} internal URLs checked; none returned "not found".`);
      return {
        outcome: broken.length >= 3 ? 'fail' : 'partial',
        credit: broken.length >= 3 ? 0 : 0.5,
        detail: `${broken.length} internal link${broken.length === 1 ? '' : 's'} lead to missing pages: ${broken
          .slice(0, 5)
          .map((outcome) => `${pathOf(outcome.url)}${outcome.discoveredFrom ? ` (linked from ${pathOf(outcome.discoveredFrom)})` : ''}`)
          .join(', ')}.`,
        evidence: broken.slice(0, 3).map((outcome) => ({
          pageUrl: outcome.discoveredFrom ?? outcome.url,
          pageId: outcome.pageId,
          snippet: `${outcome.linkText ? `“${outcome.linkText}” → ` : ''}${outcome.url} (HTTP ${outcome.httpStatus})`,
          locator: 'internal link',
          region: 'body' as const,
        })),
      };
    },
  },
  {
    id: 'experience.crawl_errors',
    category: 'customer_experience',
    points: 2,
    severity: 'low',
    passTitle: 'Pages load without server errors',
    failTitle: 'Some pages failed to load',
    whyItMatters: 'Server errors and timeouts mean visitors see an error page instead of your content.',
    recommendedFix: 'Ask your host or site builder to check the failing pages.',
    evaluate: (ctx) => {
      const errors = ctx.crawl.outcomes.filter((outcome) => outcome.state === 'failed' && outcome.httpStatus !== 404 && outcome.httpStatus !== 410);
      if (!errors.length) return pass('No server errors or timeouts during the crawl.');
      return partial(0.4, `${errors.length} page${errors.length === 1 ? '' : 's'} failed: ${errors.slice(0, 4).map((outcome) => `${pathOf(outcome.url)} (${outcome.httpStatus ?? outcome.error ?? 'error'})`).join(', ')}.`);
    },
  },
];

export const localRules: RuleDefinition[] = [
  {
    id: 'local.location_stated',
    category: 'local_relevance',
    points: 6,
    severity: 'high',
    passTitle: 'The business location is stated',
    failTitle: 'The business location is not stated',
    partialTitle: 'Only a city is given — no address or drop-off location',
    whyItMatters: 'Local customers and "near me" searches need a city or address to connect the business to their area.',
    recommendedFix: 'Show your city (and address or drop-off location if you have one) on every page, e.g. in the footer.',
    evaluate: (ctx) => {
      const address = ctx.factsOf('address');
      const locality = ctx.factsOf('locality');
      if (address.length) return pass(`Address: ${address[0]!.display}.`, factEvidence(address));
      if (locality.length) return partial(0.7, `A city is mentioned (${locality[0]!.display}) but no address or drop-off location.`, factEvidence(locality));
      return fail('No address or city/state was found.');
    },
  },
  {
    id: 'local.service_area',
    category: 'local_relevance',
    points: 5,
    severity: 'high',
    passTitle: 'The service area is described',
    failTitle: 'The service area is difficult to identify',
    partialTitle: 'The service area is not stated on the homepage',
    whyItMatters: 'Customers in nearby towns need to know you serve them; search engines use the same signals for local results.',
    recommendedFix: 'Add a clear "Serving [city], [nearby towns] and [region]" statement on the homepage and services page.',
    evaluate: (ctx) => {
      const areas = ctx.factsOf('service_area');
      if (!areas.length) return fail('No service-area statement was found.');
      const homepage = areas.some((fact) => fact.onHomepage);
      return homepage
        ? pass(`Service area stated on the homepage: “${areas[0]!.display}”.`, factEvidence(areas))
        : partial(0.6, `The service area is only described on inner pages (${areas[0]!.evidence.map((evidence) => pathOf(evidence.pageUrl)).slice(0, 2).join(', ')}).`, factEvidence(areas));
    },
  },
  {
    id: 'local.location_in_title_or_h1',
    category: 'local_relevance',
    points: 5,
    severity: 'medium',
    passTitle: 'The homepage title or headline names the location',
    failTitle: 'The homepage title and headline do not name the location',
    whyItMatters: '"Knife sharpening in Springfield" matches local searches far better than a title without a place.',
    recommendedFix: 'Include your main city in the homepage title and/or main headline.',
    evaluate: (ctx) => {
      if (!ctx.cities.length) return notApplicable('No city is known for this business yet, so this cannot be checked.');
      const text = `${ctx.home!.doc.title ?? ''} ${ctx.home!.doc.headings.find((heading) => heading.level === 1)?.text ?? ''}`;
      const city = cityMentioned(text, ctx.cities);
      return city ? pass(`“${city}” appears in the homepage title or H1.`, [ctx.pageEvidence(ctx.home!, text.trim(), 'title / h1')]) : fail(`Neither the homepage title nor the H1 mentions ${ctx.cities.join(' or ')}.`, [ctx.pageEvidence(ctx.home!, text.trim(), 'title / h1')]);
    },
  },
  {
    id: 'local.location_on_homepage',
    category: 'local_relevance',
    points: 3,
    severity: 'low',
    passTitle: 'The homepage text mentions the location',
    failTitle: 'The homepage text does not mention the location',
    whyItMatters: 'Location words in the homepage copy reinforce local relevance for visitors and search engines.',
    recommendedFix: 'Mention the city and nearby areas naturally in the homepage copy.',
    evaluate: (ctx) => {
      if (!ctx.cities.length) return notApplicable('No city is known for this business yet.');
      const block = ctx.home!.doc.blocks.find((candidate) => cityMentioned(candidate.text, ctx.cities));
      return block
        ? pass(`The homepage mentions ${cityMentioned(block.text, ctx.cities)}.`, [{ pageUrl: ctx.home!.url, pageId: ctx.home!.pageId, snippet: block.text.slice(0, 300), locator: `text ${block.tag} (${block.region})`, region: block.region }])
        : fail(`The homepage text does not mention ${ctx.cities.join(' or ')}.`);
    },
  },
  {
    id: 'local.schema_address',
    category: 'local_relevance',
    points: 3,
    severity: 'low',
    passTitle: 'Structured data includes the location',
    failTitle: 'Structured data does not include a location',
    whyItMatters: 'An address or area in structured data helps maps and AI assistants place the business correctly.',
    recommendedFix: 'Include address (or areaServed) in the LocalBusiness structured data.',
    evaluate: (ctx) => {
      for (const page of ctx.pages) {
        for (const node of jsonLdNodes(page.doc)) {
          if (!jsonLdTypes(node).length) continue;
          if (node.address || node.areaServed) return pass(`Location found in ${jsonLdTypes(node).join('/')} structured data.`);
        }
      }
      return fail('No address or areaServed in structured data.');
    },
  },
  {
    id: 'local.google_profile',
    category: 'local_relevance',
    points: 3,
    severity: 'low',
    passTitle: 'The site links to a Google Business Profile or map',
    failTitle: 'The site does not link to a Google Business Profile or map',
    whyItMatters: 'Linking the Google profile connects the site to your reviews and map listing.',
    recommendedFix: 'Link your Google Business Profile (and embed a map if customers visit a location).',
    evaluate: (ctx) => {
      const google = ctx.factsOf('social_profile').filter((fact) => fact.value.platform === 'google_business');
      if (google.length) return pass('A Google profile or map link was found.', factEvidence(google));
      const map = ctx.pages.some((page) => page.doc.iframes.some((frame) => /google\.[a-z.]+\/maps/i.test(frame.src)));
      return map ? pass('An embedded Google map was found.') : fail('No Google Business Profile link or map was found.');
    },
  },
];

/** Unscored: potential opportunities the business may or may not want. Never assumed. */
function opportunity(id: string, serviceKeys: string[], title: string, why: string, fix: string): RuleDefinition {
  return {
    id,
    category: 'revenue_opportunities',
    points: 0,
    severity: 'low',
    requiresOwnerConfirmation: true,
    passTitle: `${title} — already promoted`,
    failTitle: `Potential opportunity — requires owner confirmation: ${title.toLowerCase()}`,
    whyItMatters: why,
    recommendedFix: fix,
    evaluate: (ctx) => {
      const found = ctx.factsOf('service').filter((fact) => serviceKeys.includes(fact.key));
      const declined = ctx.factsOf('service_not_offered').filter((fact) => serviceKeys.includes(fact.key));
      if (declined.length) return notApplicable(`The site says this is not offered (${declined.map((fact) => fact.display).join(', ')}).`);
      return found.length
        ? pass(`Already mentioned: ${found.map((fact) => fact.display).join(', ')}.`, factEvidence(found))
        : fail('Not mentioned on the site. This is a possibility to discuss, not something the business is known to offer.');
    },
  };
}

export const revenueRules: RuleDefinition[] = [
  {
    id: 'revenue.services_on_homepage',
    category: 'revenue_opportunities',
    points: 0,
    severity: 'low',
    passTitle: 'Services the business offers are visible from the homepage',
    failTitle: 'Some services the site mentions are not promoted on the homepage',
    whyItMatters: 'Services that appear only on inner pages are easy to miss; customers may not know you can sharpen them.',
    recommendedFix: 'Surface every service you offer on the homepage (a short list or icons linking to details).',
    evaluate: (ctx) => {
      const services = ctx.factsOf('service').filter((fact) => fact.value.category !== 'service_model');
      if (!services.length) return notApplicable('No services identified.');
      const buried = services.filter((fact) => !fact.onHomepage);
      return buried.length
        ? fail(`Mentioned only on inner pages: ${buried.map((fact) => fact.display).join(', ')}.`, factEvidence(buried))
        : pass('Every identified service is mentioned on the homepage.');
    },
  },
  opportunity(
    'revenue.commercial',
    ['commercial', 'knife_exchange'],
    'Restaurant & commercial accounts',
    'Restaurants, butchers and caterers need regular sharpening and can be steady recurring revenue.',
    'If the owner serves (or wants) commercial clients, add a page for restaurant accounts or a knife exchange program.',
  ),
  opportunity('revenue.mail_in', ['mail_in'], 'Mail-in service', 'Mail-in widens the market beyond driving distance.', 'If the owner accepts shipped knives, explain how to package and send them.'),
  opportunity(
    'revenue.seasonal_tools',
    ['garden_tools', 'mower_blades', 'axes_machetes', 'chainsaw', 'ice_skates'],
    'Seasonal tools (garden, mower, axe, skate)',
    'Seasonal tool sharpening can fill slower months.',
    'If the owner sharpens garden tools, mower blades, axes or skates, promote them seasonally.',
  ),
  opportunity(
    'revenue.specialty',
    ['salon_shears', 'pet_grooming', 'japanese_knives'],
    'Specialty sharpening (salon shears, grooming blades, Japanese knives)',
    'Specialty work usually commands higher prices and reaches professional customers.',
    'If the owner does specialty work, give it its own section with what makes the approach different.',
  ),
  opportunity('revenue.gift_cards', ['gift_cards'], 'Gift cards', 'Gift cards bring in new customers through existing ones, especially around holidays.', 'If the owner sells gift cards, link to them from the homepage and footer.'),
];
