import { isIP } from 'node:net';

import { isBlockedIp } from './ip';

export const MAX_URL_LENGTH = 2048;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.localdomain'];
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type UrlRejection =
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'hostname'
  | 'blocked_ip'
  | 'too_long';

export type UrlCheck = { ok: true } | { ok: false; reason: UrlRejection; message: string };

const reject = (reason: UrlRejection, message: string): UrlCheck => ({ ok: false, reason, message });

/** Hostname without IPv6 brackets. */
export const bareHostname = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

/**
 * Static checks on a URL before any network activity. DNS-resolved addresses are checked again
 * at connect time by the fetcher, so this is the first of two independent gates.
 */
export function checkUrlShape(url: URL): UrlCheck {
  if (url.href.length > MAX_URL_LENGTH) return reject('too_long', 'URL is too long.');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return reject('scheme', 'Only http and https websites can be analyzed.');
  }
  if (url.username || url.password) return reject('credentials', 'URLs with embedded credentials are not allowed.');
  if (!ALLOWED_PORTS.has(url.port)) return reject('port', 'Only standard web ports (80/443) are allowed.');

  const host = bareHostname(url);
  if (isIP(host)) {
    return isBlockedIp(host)
      ? reject('blocked_ip', 'Private, local, or reserved network addresses cannot be analyzed.')
      : { ok: true };
  }
  if (host.length > 253 || !host.includes('.')) return reject('hostname', 'Enter a public website domain.');
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return reject('hostname', 'Local network names cannot be analyzed.');
  }
  const labels = host.replace(/\.$/, '').split('.');
  if (!labels.every((label) => HOST_LABEL.test(label))) return reject('hostname', 'The domain name is not valid.');
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return reject('hostname', 'The domain name is not valid.');
  return { ok: true };
}
