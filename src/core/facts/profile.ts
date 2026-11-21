import { factScore } from './index';
import type { Fact, FactType } from './types';

/**
 * The business profile shown to operators: for each field, the best-supported value (or an
 * explicit "not found"), plus alternatives. Pure function of the stored facts, so it is always
 * consistent with the evidence. Operator decisions (verified / rejected) are applied here.
 */

export type FactStatus = 'unverified' | 'verified' | 'rejected';

export interface ProfileFact extends Fact {
  id: string;
  status: FactStatus;
}

export interface ProfileField {
  field: ProfileFieldKey;
  label: string;
  /** Single-value fields show one primary value; list fields show all values. */
  kind: 'single' | 'list';
  primary: ProfileFact | null;
  values: ProfileFact[];
}

export const PROFILE_FIELDS = [
  { field: 'business_name', label: 'Business name', types: ['business_name'], kind: 'single' },
  { field: 'owner', label: 'Owner / operator', types: ['owner_name'], kind: 'single' },
  { field: 'phone', label: 'Phone', types: ['phone'], kind: 'single' },
  { field: 'email', label: 'Email', types: ['email'], kind: 'single' },
  { field: 'address', label: 'Address', types: ['address'], kind: 'single' },
  { field: 'location', label: 'City / state', types: ['locality'], kind: 'single' },
  { field: 'service_area', label: 'Service area', types: ['service_area'], kind: 'list' },
  { field: 'hours', label: 'Hours', types: ['hours'], kind: 'list' },
  { field: 'services', label: 'Services mentioned', types: ['service'], kind: 'list' },
  { field: 'not_offered', label: 'Stated as not offered', types: ['service_not_offered'], kind: 'list' },
  { field: 'pricing', label: 'Pricing', types: ['price'], kind: 'list' },
  { field: 'turnaround', label: 'Turnaround', types: ['turnaround'], kind: 'list' },
  { field: 'booking', label: 'Booking system', types: ['booking_provider'], kind: 'list' },
  { field: 'contact_methods', label: 'Ways to get in touch', types: ['contact_method'], kind: 'list' },
  { field: 'social', label: 'Social & listings', types: ['social_profile'], kind: 'list' },
  { field: 'reviews', label: 'Reviews / testimonials on site', types: ['reviews'], kind: 'list' },
  { field: 'faq', label: 'FAQ', types: ['faq'], kind: 'list' },
  { field: 'years', label: 'Experience / founding claims', types: ['years_claim'], kind: 'list' },
  { field: 'logo', label: 'Logo', types: ['logo'], kind: 'single' },
  { field: 'structured_data', label: 'Structured data (schema.org)', types: ['structured_data'], kind: 'list' },
] as const satisfies ReadonlyArray<{ field: string; label: string; types: readonly FactType[]; kind: 'single' | 'list' }>;

export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]['field'];

const STATUS_BONUS: Record<FactStatus, number> = { verified: 1000, unverified: 0, rejected: -1000 };

export function buildProfile(facts: ProfileFact[]): ProfileField[] {
  return PROFILE_FIELDS.map((definition) => {
    const types = definition.types as readonly FactType[];
    const values = facts
      .filter((fact) => types.includes(fact.type) && fact.status !== 'rejected')
      .sort((a, b) => factScore(b) + STATUS_BONUS[b.status] - (factScore(a) + STATUS_BONUS[a.status]));
    return { field: definition.field, label: definition.label, kind: definition.kind, primary: values[0] ?? null, values };
  });
}

/** Services both claimed and disclaimed on the site — surfaced for operator review. */
export function conflictingServices(facts: ProfileFact[]): string[] {
  const offered = new Set(facts.filter((fact) => fact.type === 'service' && fact.status !== 'rejected').map((fact) => fact.key));
  return facts.filter((fact) => fact.type === 'service_not_offered' && offered.has(fact.key)).map((fact) => fact.key);
}
