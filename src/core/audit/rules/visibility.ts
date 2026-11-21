import { jsonLdNodes, jsonLdTypes } from '../../extract/document';
import type { RuleDefinition } from '../types';
import { fail, graded, notApplicable, partial, pass, pathOf, percent, SHARPENING_TERM, unknown } from './helpers';

const BUSINESS_SCHEMA = /LocalBusiness|Store|ProfessionalService|HomeAndConstructionBusiness|AutomotiveBusiness/;

export const visibilityRules: RuleDefinition[] = [
  {
    id: 'visibility.https',
    category: 'visibility',
    points: 6,
    severity: 'high',
    passTitle: 'The site uses a secure HTTPS connection',
    failTitle: 'The site is not served over HTTPS',
    whyItMatters: 'Browsers label non-HTTPS sites "Not secure", which scares off customers, and search engines favour secure sites.',
    recommendedFix: 'Enable HTTPS (most hosts provide free certificates) and redirect all http:// traffic to https://.',
    evaluate: (ctx) => {
      if (!ctx.crawl.canonicalOrigin) return unknown('The final site address was not recorded.');
      return ctx.crawl.canonicalOrigin.startsWith('https://')
        ? pass(`The site resolves to ${ctx.crawl.canonicalOrigin}.`)
        : fail(`The site resolves to ${ctx.crawl.canonicalOrigin} (not HTTPS).`);
    },
  },
  {
    id: 'visibility.homepage_indexable',
    category: 'visibility',
    points: 5,
    severity: 'high',
    passTitle: 'The homepage can be indexed by search engines',
    failTitle: 'The homepage tells search engines not to index it',
    whyItMatters: 'A "noindex" homepage cannot appear in Google results at all.',
    recommendedFix: 'Remove the noindex robots meta tag from the homepage.',
    evaluate: (ctx) => {
      const robots = ctx.home!.doc.robotsMeta ?? '';
      return /noindex|none/i.test(robots)
        ? fail(`The homepage has <meta name="robots" content="${robots}">.`, [ctx.pageEvidence(ctx.home!, robots, 'meta robots')])
        : pass('No noindex directive on the homepage.');
    },
  },
  {
    id: 'visibility.title_tags',
    category: 'visibility',
    points: 5,
    severity: 'medium',
    passTitle: 'Every crawled page has a title tag',
    failTitle: 'Some pages are missing a title tag',
    whyItMatters: 'The title is the headline shown in search results; pages without one are poorly understood and rarely clicked.',
    recommendedFix: 'Give every page a unique, descriptive title, e.g. "Knife Sharpening in Springfield | Business Name".',
    evaluate: (ctx) => {
      const missing = ctx.pages.filter((page) => !page.doc.title);
      const fraction = 1 - missing.length / ctx.pages.length;
      return graded(
        fraction,
        missing.length ? `${missing.length} of ${ctx.pages.length} pages have no title: ${missing.slice(0, 5).map((page) => pathOf(page.url)).join(', ')}.` : `All ${ctx.pages.length} pages have a title.`,
        missing.slice(0, 3).map((page) => ctx.pageEvidence(page, '(no <title>)', 'title')),
      );
    },
  },
  {
    id: 'visibility.homepage_title_service',
    category: 'visibility',
    points: 5,
    severity: 'high',
    passTitle: 'The homepage title says what the business does',
    failTitle: 'The homepage title does not mention sharpening',
    whyItMatters: 'People search for "knife sharpening near me". A title without the service is less likely to match those searches.',
    recommendedFix: 'Put the core service in the homepage title, e.g. "Professional Knife Sharpening | Business Name".',
    evaluate: (ctx) => {
      const title = ctx.home!.doc.title;
      if (!title) return fail('The homepage has no title.');
      const evidence = [ctx.pageEvidence(ctx.home!, title, 'title')];
      return SHARPENING_TERM.test(title) ? pass(`Homepage title: “${title}”.`, evidence) : fail(`Homepage title: “${title}” — no sharpening term.`, evidence);
    },
  },
  {
    id: 'visibility.meta_descriptions',
    category: 'visibility',
    points: 4,
    severity: 'medium',
    passTitle: 'Pages have meta descriptions',
    failTitle: 'Meta descriptions are missing',
    whyItMatters: 'The meta description is the summary under the title in search results; without one, search engines pick random text.',
    recommendedFix: 'Write a 140–160 character description for each important page that names the service and area.',
    evaluate: (ctx) => {
      const homeMissing = !ctx.home!.doc.metaDescription;
      const withDescription = ctx.pages.filter((page) => page.doc.metaDescription).length;
      const fraction = withDescription / ctx.pages.length;
      const detail = `${withDescription} of ${ctx.pages.length} pages have a meta description${homeMissing ? ', and the homepage does not' : ''}.`;
      if (homeMissing) return fraction > 0 ? partial(fraction / 2, detail) : fail(detail);
      return graded(fraction, detail, [ctx.pageEvidence(ctx.home!, ctx.home!.doc.metaDescription!, 'meta description')]);
    },
  },
  {
    id: 'visibility.duplicate_titles',
    category: 'visibility',
    points: 3,
    severity: 'low',
    passTitle: 'Page titles are unique',
    failTitle: 'Several pages share the same title',
    whyItMatters: 'Duplicate titles make pages compete with each other and hide what each page is about.',
    recommendedFix: 'Give each page its own title describing that page (services, pricing, about, contact…).',
    evaluate: (ctx) => {
      const titled = ctx.pages.filter((page) => page.doc.title);
      if (titled.length < 2) return notApplicable('Fewer than two titled pages.');
      const counts = new Map<string, number>();
      for (const page of titled) counts.set(page.doc.title!, (counts.get(page.doc.title!) ?? 0) + 1);
      const duplicated = titled.filter((page) => (counts.get(page.doc.title!) ?? 0) > 1);
      const fraction = 1 - duplicated.length / titled.length;
      const example = [...counts.entries()].find(([, n]) => n > 1);
      return graded(
        fraction,
        duplicated.length ? `${duplicated.length} pages share a title, e.g. “${example?.[0]}” (${example?.[1]} pages).` : 'Every page title is unique.',
      );
    },
  },
  {
    id: 'visibility.h1',
    category: 'visibility',
    points: 4,
    severity: 'medium',
    passTitle: 'Pages have one clear main heading (H1)',
    failTitle: 'Main headings (H1) are missing or duplicated',
    whyItMatters: 'The H1 tells readers and search engines what the page is about. None — or several — weakens that signal.',
    recommendedFix: 'Give each page exactly one H1 that states its topic.',
    evaluate: (ctx) => {
      const count = (page: (typeof ctx.pages)[number]) => page.doc.headings.filter((heading) => heading.level === 1).length;
      const good = ctx.pages.filter((page) => count(page) === 1);
      const none = ctx.pages.filter((page) => count(page) === 0);
      const many = ctx.pages.filter((page) => count(page) > 1);
      const detail = `${good.length} of ${ctx.pages.length} pages have exactly one H1; ${none.length} have none; ${many.length} have several.${count(ctx.home!) === 0 ? ' The homepage has no H1.' : ''}`;
      const fraction = good.length / ctx.pages.length;
      return count(ctx.home!) === 0 ? (fraction > 0 ? partial(fraction / 2, detail) : fail(detail)) : graded(fraction, detail);
    },
  },
  {
    id: 'visibility.local_business_schema',
    category: 'visibility',
    points: 6,
    severity: 'high',
    passTitle: 'LocalBusiness structured data is present',
    failTitle: 'Local business structured data is missing',
    whyItMatters: 'Structured data tells Google, maps and AI assistants the business name, address, phone and hours in a machine-readable way.',
    recommendedFix: 'Add schema.org LocalBusiness JSON-LD with name, address, phone, hours, area served and URL.',
    evaluate: (ctx) => {
      for (const page of ctx.pages) {
        for (const node of jsonLdNodes(page.doc)) {
          const types = jsonLdTypes(node);
          if (types.some((type) => BUSINESS_SCHEMA.test(type))) {
            return pass(`Found ${types.join('/')} structured data on ${pathOf(page.url)}.`, [ctx.pageEvidence(page, `@type: ${types.join('/')}`, 'json-ld')]);
          }
        }
      }
      const any = ctx.factsOf('structured_data').map((fact) => fact.display);
      return fail(any.length ? `Only general structured data found (${any.join(', ')}), not a local business.` : 'No schema.org structured data found on crawled pages.');
    },
  },
  {
    id: 'visibility.service_schema',
    category: 'visibility',
    points: 2,
    severity: 'low',
    passTitle: 'Services are described in structured data',
    failTitle: 'Services are not described in structured data',
    whyItMatters: 'Service markup helps search and AI tools match the business to specific requests (e.g. "Japanese knife sharpening").',
    recommendedFix: 'Describe each service with schema.org Service / OfferCatalog inside the LocalBusiness markup.',
    evaluate: (ctx) => {
      for (const page of ctx.pages) {
        for (const node of jsonLdNodes(page.doc)) {
          if (jsonLdTypes(node).some((type) => /^(Service|Offer|OfferCatalog)$/.test(type)) || node.hasOfferCatalog || node.makesOffer) {
            return pass(`Service/offer structured data found on ${pathOf(page.url)}.`);
          }
        }
      }
      return fail('No Service, Offer or OfferCatalog structured data found.');
    },
  },
  {
    id: 'visibility.image_alt',
    category: 'visibility',
    points: 3,
    severity: 'low',
    passTitle: 'Images have descriptive alt text',
    failTitle: 'Many images are missing alt text',
    whyItMatters: 'Alt text makes images accessible to screen readers and helps image search understand the work shown.',
    recommendedFix: 'Add short alt text describing each meaningful image (e.g. "Chef’s knife after whetstone sharpening").',
    evaluate: (ctx) => {
      const images = ctx.pages.flatMap((page) => page.doc.images.map((image) => ({ page, image })));
      if (images.length === 0) return notApplicable('No images found on crawled pages.');
      const missing = images.filter(({ image }) => image.alt === null);
      const fraction = 1 - missing.length / images.length;
      return graded(fraction, `${images.length - missing.length} of ${images.length} images (${percent(fraction)}) have alt text.`);
    },
  },
  {
    id: 'visibility.sitemap',
    category: 'visibility',
    points: 2,
    severity: 'low',
    passTitle: 'An XML sitemap is available',
    failTitle: 'No XML sitemap was found',
    whyItMatters: 'A sitemap helps search engines find every page, including ones that are not linked prominently.',
    recommendedFix: 'Publish /sitemap.xml (most site builders can generate it) and reference it in robots.txt.',
    evaluate: (ctx) =>
      ctx.crawl.sitemapUrlsFound > 0 || ctx.crawl.robotsSitemaps > 0
        ? pass(`Sitemap found${ctx.crawl.sitemapUrlsFound ? ` listing ${ctx.crawl.sitemapUrlsFound} pages` : ' in robots.txt'}.`)
        : fail('No sitemap was listed in robots.txt or found at /sitemap.xml.'),
  },
  {
    id: 'visibility.canonical',
    category: 'visibility',
    points: 2,
    severity: 'low',
    passTitle: 'Pages declare canonical URLs',
    failTitle: 'Canonical URLs are not declared',
    whyItMatters: 'Canonical tags prevent duplicate versions of a page (www/non-www, tracking links) from splitting search signals.',
    recommendedFix: 'Add <link rel="canonical"> to each page pointing at its preferred address.',
    evaluate: (ctx) => {
      const withCanonical = ctx.pages.filter((page) => page.doc.canonical).length;
      return graded(withCanonical / ctx.pages.length, `${withCanonical} of ${ctx.pages.length} pages declare a canonical URL.`);
    },
  },
];
