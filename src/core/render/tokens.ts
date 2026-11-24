import type { BrandProfile } from '../brand/brand';
import type { StrategyId } from '../concepts/schema';

/**
 * Design tokens for a concept. Brand colours come from extraction, adjusted until text on them
 * meets WCAG AA (4.5:1). Fonts: the brand's own font names first (used only if the visitor has
 * them installed — previews load no web fonts), then a system stack chosen per strategy.
 */
export interface DesignTokens {
  primary: string;
  onPrimary: string;
  /** Text-safe version of the primary colour on the page background (links, accents). */
  primaryInk: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  headingFont: string;
  bodyFont: string;
  brandSource: 'extracted' | 'default';
}

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as Rgb;
};
const toHex = (rgb: Rgb) => `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (hex: string, target: Rgb, amount: number) => {
  const rgb = toRgb(hex);
  return toHex(rgb.map((channel, index) => channel + (target[index]! - channel) * amount) as Rgb);
};

/** Darken (or lighten) a colour in small steps until it reaches the contrast ratio against `against`. */
export function ensureContrast(color: string, against: string, ratio = 4.5): string {
  if (contrast(color, against) >= ratio) return color;
  const target: Rgb = luminance(against) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(color, target, step * 0.05);
    if (contrast(candidate, against) >= ratio) return candidate;
  }
  return luminance(against) > 0.5 ? '#000000' : '#ffffff';
}

const DEFAULTS: Record<StrategyId, { primary: string; bg: string; surface: string; ink: string; muted: string; line: string; heading: string; body: string }> = {
  local_growth: { primary: '#1d4ed8', bg: '#ffffff', surface: '#f3f6fb', ink: '#0f172a', muted: '#475569', line: '#dbe3ee', heading: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  craftsman: { primary: '#7c2d12', bg: '#faf7f2', surface: '#f1ebe1', ink: '#1c1917', muted: '#57534e', line: '#e2d8c9', heading: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif', body: '"Iowan Old Style", Georgia, serif' },
  fastest_path: { primary: '#0f766e', bg: '#ffffff', surface: '#f4f4f5', ink: '#09090b', muted: '#52525b', line: '#e4e4e7', heading: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

const safeFontName = (name: string) => (/^[\w .-]{2,40}$/.test(name) ? `"${name}"` : null);

export function designTokens(strategy: StrategyId, brand: BrandProfile | null): DesignTokens {
  const base = DEFAULTS[strategy];
  const extracted = brand?.brandColors.find((hex) => /^#[0-9a-f]{6}$/i.test(hex)) ?? null;
  const raw = extracted ?? base.primary;
  // Buttons use white text on the primary colour.
  const primary = ensureContrast(raw, '#ffffff', 4.5);
  const brandFont = brand?.fonts.map(safeFontName).find(Boolean) ?? null;
  return {
    primary,
    onPrimary: '#ffffff',
    primaryInk: ensureContrast(raw, base.bg, 4.5),
    bg: base.bg,
    surface: base.surface,
    ink: base.ink,
    muted: ensureContrast(base.muted, base.surface, 4.5),
    line: base.line,
    headingFont: brandFont ? `${brandFont}, ${base.heading}` : base.heading,
    bodyFont: base.body,
    brandSource: extracted ? 'extracted' : 'default',
  };
}
