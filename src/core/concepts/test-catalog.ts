import type { CatalogFact, FactCatalog } from './catalog';

/** A small verified catalog resembling the Edge Works fixture site (tests and examples only). */
export function testCatalog(overrides: Partial<CatalogFact>[] = []): FactCatalog {
  const base: Omit<CatalogFact, 'ref'>[] = [
    { factId: 'n', type: 'business_name', display: 'Edge Works Sharpening', value: { name: 'Edge Works Sharpening' }, verified: false, sourceUrl: '/', snippets: ['Edge Works Sharpening'] },
    { factId: 'p', type: 'phone', display: '(217) 555-0142', value: { e164: '+12175550142' }, verified: false, sourceUrl: '/', snippets: ['(217) 555-0142'] },
    { factId: 'e', type: 'email', display: 'hello@edgeworks.test', value: { email: 'hello@edgeworks.test' }, verified: false, sourceUrl: '/contact', snippets: ['hello@edgeworks.test'] },
    { factId: 'l', type: 'locality', display: 'Springfield, IL', value: { city: 'Springfield', state: 'IL' }, verified: false, sourceUrl: '/', snippets: ['Professional knife sharpening in Springfield.'] },
    { factId: 'a', type: 'service_area', display: 'Springfield and Chatham', value: { text: 'Springfield and Chatham' }, verified: false, sourceUrl: '/', snippets: ['Serving Springfield and Chatham'] },
    { factId: 's1', type: 'service', display: 'Kitchen knife sharpening', value: { service: 'kitchen_knives', category: 'knives', label: 'Kitchen knife sharpening' }, verified: false, sourceUrl: '/services', snippets: ['Kitchen knives'] },
    { factId: 's2', type: 'service', display: 'Scissors & household shears', value: { service: 'scissors', category: 'tools', label: 'Scissors & household shears' }, verified: false, sourceUrl: '/services', snippets: ['Scissors'] },
    { factId: 's3', type: 'service', display: 'Garden tools', value: { service: 'garden_tools', category: 'tools', label: 'Garden tools' }, verified: false, sourceUrl: '/services', snippets: ['Garden tools'] },
    { factId: 's4', type: 'service', display: 'Drop-off', value: { service: 'drop_off', category: 'service_model', label: 'Drop-off' }, verified: false, sourceUrl: '/', snippets: ['Drop off your knives at the shop'] },
    { factId: 'x', type: 'service_not_offered', display: 'Serrated / bread knives', value: { service: 'serrated_knives', category: 'knives', label: 'Serrated / bread knives' }, verified: false, sourceUrl: '/services', snippets: ['We do not sharpen serrated knives.'] },
    { factId: 'pr', type: 'price', display: 'Kitchen knives $8 each', value: { amount: 8, maxAmount: null, unit: 'each', currency: 'USD', context: 'Kitchen knives $8 each' }, verified: false, sourceUrl: '/pricing', snippets: ['Kitchen knives $8 each'] },
    { factId: 'c', type: 'contact_method', display: 'Text message (mentioned)', value: { channel: 'text_message' }, verified: false, sourceUrl: '/contact', snippets: ['Call or text to book.'] },
  ];
  return {
    facts: [...base, ...overrides.map((override, index) => ({ ...base[0]!, factId: `o${index}`, ...override }))].map((fact, index) => ({ ...fact, ref: `f${index + 1}` }) as CatalogFact),
  };
}
