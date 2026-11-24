import type { ProfileFact } from '../facts/profile';
import { SERVICES } from '../facts/taxonomy';
import type { FactType } from '../facts/types';

/**
 * The fact catalog is the ONLY source of business information a concept may use. It is a frozen
 * snapshot stored with each concept, so a concept always renders exactly as it was generated even
 * if facts are reviewed later.
 *
 * Included: facts not rejected by an operator. Low-confidence facts are included only once an
 * operator verifies them.
 */

export const CATALOG_TYPES: FactType[] = [
  'business_name',
  'owner_name',
  'phone',
  'email',
  'address',
  'locality',
  'service_area',
  'hours',
  'service',
  'service_not_offered',
  'price',
  'turnaround',
  'reviews',
  'years_claim',
  'booking_provider',
  'contact_method',
  'social_profile',
];

export interface CatalogFact {
  /** Short reference used by the copywriter, e.g. "f7". */
  ref: string;
  factId: string;
  type: FactType;
  display: string;
  value: Record<string, unknown>;
  verified: boolean;
  sourceUrl: string | null;
  /** Verbatim snippets from the site (used only to support claims, never rendered). */
  snippets: string[];
}

export interface FactCatalog {
  facts: CatalogFact[];
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

export function buildCatalog(facts: ProfileFact[]): FactCatalog {
  const eligible = facts
    .filter((fact) => CATALOG_TYPES.includes(fact.type) && fact.status !== 'rejected')
    .filter((fact) => fact.confidence !== 'low' || fact.status === 'verified')
    .sort(
      (a, b) =>
        CATALOG_TYPES.indexOf(a.type) - CATALOG_TYPES.indexOf(b.type) ||
        Number(b.status === 'verified') - Number(a.status === 'verified') ||
        CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
        b.occurrences - a.occurrences ||
        a.key.localeCompare(b.key),
    );
  // A service the site also says it does NOT offer is ambiguous: leave it out until reviewed.
  const disclaimed = new Set(eligible.filter((fact) => fact.type === 'service_not_offered').map((fact) => fact.key));
  const usable = eligible.filter((fact) => !(fact.type === 'service' && disclaimed.has(fact.key) && fact.status !== 'verified'));

  return {
    facts: usable.slice(0, 80).map((fact, index) => ({
      ref: `f${index + 1}`,
      factId: fact.id,
      type: fact.type,
      display: fact.display,
      value: fact.value,
      verified: fact.status === 'verified',
      sourceUrl: fact.evidence[0]?.pageUrl ?? null,
      snippets: fact.evidence.map((entry) => entry.snippet).slice(0, 3),
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// Convenience accessors used by generators and renderers
// ------------------------------------------------------------------------------------------------

export const factsOf = (catalog: FactCatalog, type: FactType) => catalog.facts.filter((fact) => fact.type === type);
export const firstOf = (catalog: FactCatalog, type: FactType) => catalog.facts.find((fact) => fact.type === type) ?? null;
export const byRef = (catalog: FactCatalog, ref: string) => catalog.facts.find((fact) => fact.ref === ref) ?? null;

export function businessName(catalog: FactCatalog): string | null {
  return firstOf(catalog, 'business_name')?.display ?? null;
}

export function city(catalog: FactCatalog): { city: string; state: string | null } | null {
  const locality = firstOf(catalog, 'locality');
  if (locality && typeof locality.value.city === 'string') {
    return { city: locality.value.city, state: typeof locality.value.state === 'string' ? locality.value.state : null };
  }
  const address = firstOf(catalog, 'address');
  if (address && typeof address.value.city === 'string') {
    return { city: address.value.city, state: typeof address.value.state === 'string' ? address.value.state : null };
  }
  return null;
}

export interface CatalogService {
  ref: string;
  key: string;
  label: string;
  category: string;
}

export function services(catalog: FactCatalog): CatalogService[] {
  return factsOf(catalog, 'service').map((fact) => {
    const key = String(fact.value.service ?? '');
    const known = SERVICES.find((service) => service.key === key);
    return { ref: fact.ref, key, label: known?.label ?? fact.display, category: known?.category ?? String(fact.value.category ?? 'other') };
  });
}

export const hasService = (catalog: FactCatalog, key: string) => services(catalog).some((service) => service.key === key);

export function contactChannels(catalog: FactCatalog): Set<string> {
  return new Set(factsOf(catalog, 'contact_method').map((fact) => String(fact.value.channel ?? '')));
}
