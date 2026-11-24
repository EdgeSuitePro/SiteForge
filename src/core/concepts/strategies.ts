import type { SectionKind, StrategyId } from './schema';

export interface StrategyDefinition {
  id: StrategyId;
  letter: 'A' | 'B' | 'C';
  name: string;
  /** One line for the operator UI. */
  summary: string;
  priorities: string[];
  /** Guidance given to the copywriter (model or mock). */
  brief: string;
  /** Sections the concept must include, in this order (others may be added between them). */
  requiredSections: SectionKind[];
  /** Sections this strategy never uses. */
  excludedSections: SectionKind[];
}

export const STRATEGY_DEFINITIONS: Record<StrategyId, StrategyDefinition> = {
  local_growth: {
    id: 'local_growth',
    letter: 'A',
    name: 'Local Growth',
    summary: 'Get found locally and turn searchers into customers.',
    priorities: ['location / service area', 'local search clarity', 'prominent services', 'reviews / trust', 'clear contact or booking path', 'conversion'],
    brief:
      'Lead with what the business does and where. Make the city or service area unmistakable in the headline and throughout, list the services plainly, put trust signals near the top, and end every section with a clear way to get in touch. Tone: clear, neighbourly, practical.',
    requiredSections: ['services', 'service_area', 'trust', 'process', 'contact'],
    excludedSections: [],
  },
  craftsman: {
    id: 'craftsman',
    letter: 'B',
    name: 'Craftsman / Premium',
    summary: 'Position the work as skilled craft worth paying for.',
    priorities: ['expertise', 'workmanship', 'owner / operator story', 'visual quality', 'premium positioning', 'process', 'trust'],
    brief:
      'Present the business as careful, skilled craft. Lead with the care taken over each edge, explain the process in detail, give the owner or business story room (only from facts), and keep calls to action calm and confident. Tone: considered, quietly confident, never boastful. No superlatives.',
    requiredSections: ['about', 'process', 'services', 'trust', 'cta_band'],
    excludedSections: [],
  },
  fastest_path: {
    id: 'fastest_path',
    letter: 'C',
    name: 'Fastest Path to Customer',
    summary: 'The shortest possible route from landing to booked.',
    priorities: ['extreme simplicity', 'services', 'pricing if available', 'what happens next', 'book / call / text / drop-off / mail-in CTA', 'mobile-first conversion'],
    brief:
      'Strip everything back. One-line headline, the action right away, services in a scannable list, prices if (and only if) they are known, then three short steps for what happens next. Short sentences. Assume the visitor is on a phone and ready to act.',
    requiredSections: ['services', 'process', 'cta_band'],
    excludedSections: ['about'],
  },
};

export const STRATEGY_ORDER: StrategyId[] = ['local_growth', 'craftsman', 'fastest_path'];
