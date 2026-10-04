import { canonicalizeUrl, isSameSite } from '../url/normalize';

/**
 * Crawl frontier rules: which discovered URLs are worth fetching, in what order, and which are
 * traps. A bounded crawl must reach the pages that matter for a sharpening business first.
 */

const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|gz|rar|7z|mp4|m4v|mov|avi|webm|mp3|wav|ogg|docx?|xlsx?|pptx?|csv|css|js|mjs|json|xml|rss|atom|txt|woff2?|ttf|eot|exe|dmg|apk)$/i;

const HIGH_VALUE =
  /(servic|pric|rate|cost|menu|about|story|contact|faq|question|hour|location|direction|area|mail|ship|drop|pick-?up|book|appoint|schedul|reserv|review|testimon|gallery|commercial|restaurant|business|knife|knives|sharpen|scissor|shear|tool|mower|mobile|repair|process|how-it-works)/i;
const LOW_VALUE = /(\/(blog|news|posts?|tag|tags|category|categories|author|archive|feed|comments?)\b|\/page\/\d+)/i;
const NEVER = /\/(wp-admin|wp-login|wp-json|xmlrpc|cart|checkout|my-account|account|login|logout|signin|signup|register|search|cdn-cgi|admin)(\/|$)/i;

export type SkipReason = 'offsite' | 'extension' | 'excluded_path' | 'depth' | 'pattern_limit' | 'path_too_long';

/**
 * A path "shape" used to detect templated URL families (calendars, pagination, product ids).
 * /events/2024/05/17 → /events/:n/:n/:n ; /p/8f3a9c0d2e1b → /p/:id
 */
export function pathPattern(url: URL): string {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ':n';
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(segment)) return ':date';
      if (/^[0-9a-f-]{12,}$/i.test(segment) && /\d/.test(segment)) return ':id';
      if (/\d{3,}/.test(segment)) return ':slug-n';
      return segment.toLowerCase();
    });
  const queryKeys = [...url.searchParams.keys()].sort().join('&');
  return `/${segments.join('/')}${queryKeys ? `?${queryKeys}` : ''}`;
}

export interface FrontierCandidate {
  url: string;
  patternKey: string;
  depth: number;
  priority: number;
  discoveredFrom: string | null;
  linkText: string | null;
}

export interface FrontierContext {
  rootDomain: string;
  canonicalOrigin: URL;
  includeSubdomains: boolean;
  maxDepth: number;
}

export function scorePriority(url: URL, linkText: string, inNav: boolean, depth: number): number {
  const haystack = `${url.pathname} ${linkText}`;
  let score = 100 - depth * 10;
  if (url.pathname === '/' && !url.search) score += 50;
  if (inNav) score += 40;
  if (HIGH_VALUE.test(haystack)) score += 30;
  if (LOW_VALUE.test(url.pathname)) score -= 30;
  score -= Math.max(0, url.pathname.split('/').filter(Boolean).length - 2) * 5;
  return Math.max(0, Math.min(score, 250));
}

/**
 * Turn a discovered link into a frontier candidate, or a skip reason.
 * Same-site links are rewritten onto the canonical origin (www/apex and http/https unified).
 */
export function evaluateLink(
  rawUrl: string,
  context: FrontierContext,
  source: { depth: number; url: string | null; text?: string; inNav?: boolean },
): { candidate: FrontierCandidate } | { skip: SkipReason; url: string } {
  let url: URL;
  try {
    url = canonicalizeUrl(rawUrl);
  } catch {
    return { skip: 'offsite', url: rawUrl };
  }
  if (!isSameSite(url, context.rootDomain, context.includeSubdomains)) return { skip: 'offsite', url: url.href };
  if (url.hostname.replace(/^www\./, '') === context.canonicalOrigin.hostname.replace(/^www\./, '')) {
    url.protocol = context.canonicalOrigin.protocol;
    url.host = context.canonicalOrigin.host;
  }
  if (SKIP_EXTENSIONS.test(url.pathname)) return { skip: 'extension', url: url.href };
  if (NEVER.test(url.pathname)) return { skip: 'excluded_path', url: url.href };
  if (url.href.length > 512 || url.pathname.split('/').length > 12) return { skip: 'path_too_long', url: url.href };
  const depth = source.depth + 1;
  if (depth > context.maxDepth) return { skip: 'depth', url: url.href };
  return {
    candidate: {
      url: url.href,
      patternKey: pathPattern(url),
      depth,
      priority: scorePriority(url, source.text ?? '', source.inNav ?? false, depth),
      discoveredFrom: source.url,
      linkText: source.text?.slice(0, 120) || null,
    },
  };
}
