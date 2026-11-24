import type { BrandProfile } from '../brand/brand';
import type { FactCatalog } from '../concepts/catalog';
import type { ConceptContent, StrategyId } from '../concepts/schema';
import type { PlaceholderMode } from './escape';
import type { RenderInput } from './shared';
import { renderCraftsman } from './templates/craftsman';
import { renderFastestPath } from './templates/fastest-path';
import { renderLocalGrowth } from './templates/local-growth';
import { designTokens, type DesignTokens } from './tokens';

/**
 * Deterministic renderers: same concept document + catalog + tokens + version → same HTML.
 * Output is a complete, self-contained page: one inline <style>, no scripts, no external requests.
 */
export const RENDERER_VERSION = 'render@1';

const RENDERERS: Record<StrategyId, (input: RenderInput) => { html: string; css: string }> = {
  local_growth: renderLocalGrowth,
  craftsman: renderCraftsman,
  fastest_path: renderFastestPath,
};

export interface RenderOptions {
  strategy: StrategyId;
  content: ConceptContent;
  catalog: FactCatalog;
  tokens: DesignTokens;
  domain: string;
  placeholders?: PlaceholderMode;
}

export function renderConcept(options: RenderOptions): { html: string; css: string } {
  return RENDERERS[options.strategy]({ ...options, placeholders: options.placeholders ?? 'show' });
}

export { designTokens };
export type { BrandProfile, DesignTokens };
