import { availableCtas, missing } from './claims';
import { businessName, city, factsOf, firstOf, services, type CatalogService, type FactCatalog } from './catalog';
import type { ConceptContent, ConceptSection, CtaIntent, StrategyId } from './schema';
import { STRATEGY_DEFINITIONS } from './strategies';

/**
 * Deterministic concept drafts built ONLY from the fact catalog. Used by the mock AI provider (no
 * credentials) and as a reference for what grounded copy looks like. Every sentence here either
 * states a catalog fact, describes the proposed page itself, or is a {{missing: …}} placeholder.
 */

/** Plain noun phrases for services. Each one matches its own taxonomy pattern, so it stays "supported". */
const NOUN: Record<string, string> = {
  kitchen_knives: 'kitchen knives',
  japanese_knives: 'Japanese knives',
  serrated_knives: 'serrated knives',
  pocket_hunting_knives: 'pocket knives',
  scissors: 'scissors',
  salon_shears: 'salon shears',
  pet_grooming: 'clipper blades',
  garden_tools: 'garden tools',
  mower_blades: 'mower blades',
  axes_machetes: 'axes',
  woodworking: 'chisels',
  chainsaw: 'chainsaw chains',
  ice_skates: 'ice skates',
  knife_repair: 'knife repair',
  rehandling: 'rehandling',
  commercial: 'restaurant accounts',
  knife_exchange: 'knife exchange',
};

const BLURB: Record<string, string> = {
  kitchen_knives: 'The knives you cook with every day.',
  japanese_knives: 'Harder, thinner blades that need a different approach.',
  serrated_knives: 'Bread knives and other serrated edges.',
  pocket_hunting_knives: 'Folding, hunting and outdoor knives.',
  scissors: 'Household and kitchen scissors.',
  salon_shears: 'Shears for stylists, barbers and groomers.',
  pet_grooming: 'Clipper blades for grooming.',
  garden_tools: 'Pruners, loppers and other cutting tools for the garden.',
  mower_blades: 'Mower blades for a cleaner cut.',
  axes_machetes: 'Axes, hatchets and machetes.',
  woodworking: 'Chisels, plane irons and carving tools.',
  chainsaw: 'Saw chains.',
  ice_skates: 'Skate blades.',
  knife_repair: 'Chipped edges, broken tips and reshaping.',
  rehandling: 'New handles for well-loved blades.',
  commercial: 'Regular sharpening for restaurant and commercial kitchens.',
  knife_exchange: 'A rotating set of sharp knives for busy kitchens.',
};

const MODELS = new Set(['drop_off', 'mail_in', 'mobile', 'farmers_market', 'while_you_wait', 'pickup_delivery']);

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Ctx {
  catalog: FactCatalog;
  name: string | null;
  place: string | null;
  blades: CatalogService[];
  nouns: string[];
  has: (key: string) => boolean;
  ctas: Set<CtaIntent>;
  areas: string[];
}

function context(catalog: FactCatalog): Ctx {
  const all = services(catalog);
  // Featured services: what gets sharpened or repaired (not how it is delivered, not retail extras).
  const blades = all.filter((service) => !MODELS.has(service.key) && service.category !== 'retail' && service.category !== 'education');
  const located = city(catalog);
  return {
    catalog,
    name: businessName(catalog),
    place: located?.city ?? null,
    blades,
    nouns: blades.map((service) => NOUN[service.key]).filter((noun): noun is string => Boolean(noun)),
    has: (key) => all.some((service) => service.key === key),
    ctas: availableCtas(catalog),
    areas: factsOf(catalog, 'service_area').map((fact) => fact.display),
  };
}

const pick = (ctx: Ctx, order: CtaIntent[]): CtaIntent => order.find((intent) => ctx.ctas.has(intent)) ?? 'contact';

function servicesSection(ctx: Ctx, heading: string, intro: string, withBlurbs: boolean): ConceptSection {
  return {
    kind: 'services',
    heading,
    intro: ctx.blades.length ? intro : missing('the services the business wants to feature'),
    items: ctx.blades.slice(0, 8).map((service) => ({ ref: service.ref, blurb: withBlurbs ? (BLURB[service.key] ?? '') : '' })),
  };
}

function processSteps(ctx: Ctx, detailed: boolean) {
  const steps: { title: string; body: string }[] = [];
  if (ctx.has('drop_off')) steps.push({ title: 'Drop off', body: 'Bring your blades in.' });
  else if (ctx.has('mail_in')) steps.push({ title: 'Send them in', body: 'Mail your blades to the shop.' });
  else steps.push({ title: 'Get in touch', body: 'Tell us what needs sharpening.' });
  if (detailed) steps.push({ title: 'Look them over', body: missing('how the owner assesses each blade before sharpening') });
  const turnaround = firstOf(ctx.catalog, 'turnaround');
  steps.push({
    title: 'Sharpening',
    body: turnaround ? `Turnaround: ${turnaround.display}.` : `${missing('typical turnaround time')}`,
  });
  if (ctx.has('drop_off')) steps.push({ title: 'Pick up', body: 'Collect your blades when they are ready.' });
  else if (ctx.has('mail_in')) steps.push({ title: 'Back to you', body: 'Your blades are sent back to you.' });
  else steps.push({ title: 'Back in use', body: 'Your blades come back ready to use.' });
  return steps.slice(0, 5);
}

function faq(ctx: Ctx): ConceptSection {
  const prices = factsOf(ctx.catalog, 'price');
  const turnaround = firstOf(ctx.catalog, 'turnaround');
  return {
    kind: 'faq',
    heading: 'Common questions',
    items: [
      { question: 'What do you sharpen?', answer: ctx.nouns.length ? `${cap(list(ctx.nouns))}.` : missing('list of services') },
      { question: 'How much does it cost?', answer: prices.length ? prices.slice(0, 3).map((price) => price.display.replace(/\.?$/, '.')).join(' ') : missing('prices') },
      { question: 'How long does it take?', answer: turnaround ? `${cap(turnaround.display)}.` : missing('typical turnaround time') },
      { question: 'Where are you?', answer: ctx.areas.length ? `We serve ${list(ctx.areas)}.` : ctx.place ? `We are in ${ctx.place}.` : missing('location or service area') },
    ],
  };
}

function trust(ctx: Ctx, heading: string): ConceptSection {
  const reviews = factsOf(ctx.catalog, 'reviews');
  const years = factsOf(ctx.catalog, 'years_claim');
  const refs = [...reviews, ...years].map((fact) => fact.ref);
  const body = reviews.length
    ? `Customer feedback is shown here, from reviews the business already has. ${missing('choose which reviews to feature')}`
    : missing('real customer reviews — none were found on the current site');
  return { kind: 'trust', heading, body, refs };
}

function contactLine(ctx: Ctx): string {
  const ways = [ctx.ctas.has('call') && 'call', ctx.ctas.has('text') && 'text', ctx.ctas.has('email') && 'email'].filter(Boolean) as string[];
  return ways.length ? `${cap(ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways.at(-1)}` : ways[0]!)} us, or book online.` : 'Book online or send us a message.';
}

export function draftConcept(strategy: StrategyId, catalog: FactCatalog, auditFocus: string[] = []): ConceptContent {
  const ctx = context(catalog);
  const name = ctx.name ?? 'The business';
  const where = ctx.place ? ` in ${ctx.place}` : '';
  const what = ctx.nouns.length ? list(ctx.nouns.slice(0, 3)) : 'knives and tools';
  const definition = STRATEGY_DEFINITIONS[strategy];
  const rationale = `${definition.name}: ${definition.summary}${auditFocus.length ? ` Addresses: ${auditFocus.slice(0, 4).join('; ')}.` : ''}`;
  const seo = {
    title: `${name}${ctx.place ? ` | Knife sharpening in ${ctx.place}` : ' | Knife sharpening'}`.slice(0, 70),
    metaDescription: `${name} sharpens ${what}${where}.`.slice(0, 170),
  };

  if (strategy === 'local_growth') {
    const area = ctx.areas.length ? ctx.areas : ctx.place ? [ctx.place] : [];
    return {
      hero: {
        eyebrow: ctx.place ? `Knife sharpening · ${ctx.place}` : 'Knife sharpening',
        headline: ctx.place ? `Knife sharpening in ${ctx.place}` : 'Local knife sharpening',
        subheadline: `${name} sharpens ${what}${area.length ? ` for customers in ${list(area)}` : ''}. ${contactLine(ctx)}`,
        primaryCta: pick(ctx, ['call', 'book', 'text', 'contact']),
        secondaryCta: pick(ctx, ['drop_off', 'book', 'text', 'email', 'contact']),
      },
      sections: [
        servicesSection(ctx, ctx.place ? `Sharpening services in ${ctx.place}` : 'Sharpening services', `What ${name} sharpens.`, true),
        {
          kind: 'service_area',
          heading: 'Where we work',
          body: area.length ? `We serve ${list(area)}.` : missing('the towns and neighbourhoods the business serves'),
          refs: [...factsOf(catalog, 'service_area'), ...factsOf(catalog, 'locality'), ...factsOf(catalog, 'address')].map((fact) => fact.ref).slice(0, 6),
        },
        trust(ctx, 'What customers say'),
        { kind: 'process', heading: 'How it works', intro: 'Three simple steps.', steps: processSteps(ctx, false) },
        faq(ctx),
        { kind: 'contact', heading: 'Get in touch', body: contactLine(ctx) },
      ],
      seo,
      rationale,
    };
  }

  if (strategy === 'craftsman') {
    const owner = firstOf(catalog, 'owner_name');
    const years = firstOf(catalog, 'years_claim');
    const story = [
      owner ? `${name} is run by ${owner.display}.` : null,
      years ? `${cap(years.display.replace(/\.$/, ''))}.` : null,
      missing('the owner’s story: how they came to sharpening and what they care about'),
    ].filter(Boolean);
    return {
      hero: {
        eyebrow: name,
        headline: 'Careful sharpening for the blades you rely on',
        subheadline: `${name} sharpens ${what}${where}.`,
        primaryCta: pick(ctx, ['book', 'call', 'contact']),
        secondaryCta: pick(ctx, ['call', 'email', 'contact']),
      },
      sections: [
        {
          kind: 'about',
          heading: owner ? `Meet ${owner.display}` : 'About the shop',
          body: story.join(' '),
          refs: [owner, years, firstOf(catalog, 'business_name')].filter((fact) => fact !== null).map((fact) => fact.ref),
        },
        {
          kind: 'process',
          heading: 'The process',
          intro: `How a blade moves through the shop. ${missing('the owner’s sharpening method and equipment, in their words')}`,
          steps: processSteps(ctx, true),
        },
        servicesSection(ctx, 'What we work on', 'Blades and tools we sharpen.', true),
        trust(ctx, 'In customers’ words'),
        { kind: 'cta_band', heading: 'Ready when you are', body: 'Reserve a time to bring your blades in.', cta: pick(ctx, ['book', 'call', 'contact']) },
      ],
      seo,
      rationale,
    };
  }

  // fastest_path
  const prices = factsOf(catalog, 'price');
  const sections: ConceptSection[] = [servicesSection(ctx, 'What we sharpen', 'Tap a button above to get started.', false)];
  if (prices.length) sections.push({ kind: 'pricing', heading: 'Prices', intro: 'From the current price list.', refs: prices.slice(0, 8).map((price) => price.ref) });
  sections.push({ kind: 'process', heading: 'What happens next', intro: '', steps: processSteps(ctx, false).slice(0, 3) });
  sections.push({ kind: 'cta_band', heading: 'Ready?', body: contactLine(ctx), cta: pick(ctx, ['call', 'text', 'book', 'contact']) });
  return {
    hero: {
      eyebrow: ctx.place ? `Knife sharpening · ${ctx.place}` : 'Knife sharpening',
      headline: 'Get your knives sharpened',
      subheadline: `${cap(what)}${where}. ${ctx.ctas.has('text') ? 'Call or text.' : contactLine(ctx)}`,
      primaryCta: pick(ctx, ['call', 'text', 'book', 'contact']),
      secondaryCta: pick(ctx, ['text', 'book', 'drop_off', 'contact']),
    },
    sections,
    seo,
    rationale,
  };
}
