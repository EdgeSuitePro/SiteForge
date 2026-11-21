/**
 * Brand extraction (ported from the siteforge.py prototype's analyze_brand): weighted colour and
 * font usage across the site's CSS. Pure and deterministic; stylesheet fetching lives elsewhere.
 */
export const BRAND_VERSION = 'brand@1';

export interface CssSource {
  css: string;
  /** Inline <style>/style="" carry more intent than a framework stylesheet. */
  weight: number;
}

export interface BrandColor {
  hex: string;
  weight: number;
  role: 'brand' | 'neutral';
  /** True when it came from a named brand/primary/accent custom property or theme-color. */
  named: boolean;
}

export interface BrandProfile {
  version: string;
  colors: BrandColor[];
  /** Up to 6 brand (saturated) colours, strongest first. */
  brandColors: string[];
  /** Up to 6 neutrals (near-black/white/grey), strongest first. */
  neutrals: string[];
  fonts: string[];
  themeColor: string | null;
}

const HEX = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RGB = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)/g;
const NAMED_VAR = /--[\w-]*(primary|brand|accent|secondary|main|theme|highlight)[\w-]*\s*:\s*([^;}{]+)[;}]/gi;
const FONT_FAMILY = /font-family\s*:\s*([^;}{]+)/gi;

const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', 'revert',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'arial', 'helvetica', 'helvetica neue', 'times new roman',
  'times', 'roboto', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'apple color emoji',
  'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'courier new', 'courier', 'menlo', 'monaco',
  'consolas', 'georgia', 'verdana', 'tahoma', 'liberation sans', 'noto sans', 'oxygen', 'ubuntu', 'cantarell',
  'fira sans', 'droid sans', 'sf pro text', 'sf pro display', 'emoji', 'math', 'fangsong',
]);
const ICON_FONT = /awesome|icon|glyph|dashicons|material symbols|material icons|eicons|fontello|ionicons|feather|bootstrap-icons|^fa[-\s]|wix-?icons|fallback/i;

export function parseColor(raw: string): string | null {
  const value = raw.trim();
  HEX.lastIndex = 0;
  const hex = HEX.exec(value);
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return `#${h.toLowerCase()}`;
  }
  RGB.lastIndex = 0;
  const rgb = RGB.exec(value);
  if (rgb) {
    if (rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) return null; // fully transparent
    return toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }
  return null;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** HSL saturation and lightness (0..1) — same split the prototype used via colorsys. */
export function saturationLightness(hex: string): { s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

export function isNeutral(hex: string): boolean {
  const { s, l } = saturationLightness(hex);
  return s < 0.12 || l < 0.06 || l > 0.96;
}

export function analyzeBrand(input: { sources: CssSource[]; themeColors: string[]; googleFonts: string[] }): BrandProfile {
  const colorWeights = new Map<string, { weight: number; named: boolean }>();
  const addColor = (hex: string | null, weight: number, named = false) => {
    if (!hex) return;
    const current = colorWeights.get(hex) ?? { weight: 0, named: false };
    colorWeights.set(hex, { weight: current.weight + weight, named: current.named || named });
  };
  const fontWeights = new Map<string, number>();

  for (const { css, weight } of input.sources) {
    if (!css) continue;
    for (const match of css.matchAll(NAMED_VAR)) addColor(parseColor(match[2] ?? ''), 15 * weight, true);
    for (const match of css.matchAll(HEX)) addColor(parseColor(match[0]), weight);
    for (const match of css.matchAll(RGB)) addColor(parseColor(match[0]), weight);
    for (const match of css.matchAll(FONT_FAMILY)) {
      const first = (match[1] ?? '').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '').replace(/\s*!important$/, '').trim() ?? '';
      const lower = first.toLowerCase();
      if (!first || first.length > 60 || GENERIC_FONTS.has(lower) || lower.startsWith('var(') || ICON_FONT.test(lower)) continue;
      fontWeights.set(first, (fontWeights.get(first) ?? 0) + weight);
    }
  }

  const themeColor = input.themeColors.map(parseColor).find((value): value is string => Boolean(value)) ?? null;
  if (themeColor) addColor(themeColor, 50, true);

  const colors: BrandColor[] = [...colorWeights.entries()]
    .map(([hex, { weight, named }]) => ({ hex, weight, named, role: isNeutral(hex) ? ('neutral' as const) : ('brand' as const) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 60);

  for (const font of input.googleFonts) fontWeights.set(font, (fontWeights.get(font) ?? 0) + 20);
  const fonts = [...fontWeights.entries()].sort((a, b) => b[1] - a[1]).map(([font]) => font).slice(0, 6);

  return {
    version: BRAND_VERSION,
    colors,
    brandColors: colors.filter((color) => color.role === 'brand').slice(0, 6).map((color) => color.hex),
    neutrals: colors.filter((color) => color.role === 'neutral').slice(0, 6).map((color) => color.hex),
    fonts,
    themeColor,
  };
}
