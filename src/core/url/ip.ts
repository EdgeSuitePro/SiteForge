import { isIP } from 'node:net';

/**
 * IP address classification for SSRF protection.
 *
 * SiteForge may only connect to globally routable unicast addresses. Everything else — loopback,
 * private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, documentation, benchmarking,
 * multicast, reserved, unique-local, and transition addresses that embed a non-public IPv4 — is blocked.
 */

type Cidr4 = readonly [base: number, prefix: number];

const ipv4ToInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);

const cidr4 = (spec: string): Cidr4 => {
  const [base, prefix] = spec.split('/');
  return [ipv4ToInt(base ?? '0.0.0.0'), Number(prefix)];
};

const BLOCKED_V4: readonly Cidr4[] = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, cloud metadata
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.88.99.0/24', // 6to4 relay anycast
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved + broadcast
].map(cidr4);

function inCidr4(value: number, [base, prefix]: Cidr4): boolean {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isBlockedIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return true;
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some((range) => inCidr4(value, range));
}

/** Expand an IPv6 address (optionally with a trailing dotted IPv4) into eight 16-bit groups. */
export function expandIPv6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let address = ip.toLowerCase().split('%')[0] ?? '';
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (dotted?.[1]) {
    const v4 = ipv4ToInt(dotted[1]);
    address = address.slice(0, -dotted[1].length) + `${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = '', tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (tail === undefined && missing !== 0) return null;
  const groups = [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailGroups];
  return groups.length === 8 ? groups.map((group) => parseInt(group, 16)) : null;
}

const groupsToIPv4 = (high: number, low: number) =>
  [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');

export function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    if (g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
    return isBlockedIPv4(groupsToIPv4(g6, g7));
  }
  // NAT64 64:ff9b::/96 — embedded IPv4 decides; 64:ff9b:1::/48 local-use NAT64 is blocked.
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedIPv4(groupsToIPv4(g6, g7));
    return true;
  }
  // Only global unicast 2000::/3 is acceptable at all.
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 < 0x200) return true; // 2001::/23 IETF protocol assignments (incl. Teredo 2001::/32)
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return true; // 6to4 — can embed any IPv4, including private ones
  if (g0 === 0x3fff && g1 < 0x1000) return true; // 3fff::/20 documentation
  return false;
}

/** True when SiteForge must not connect to this address (or it is not a valid IP at all). */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true;
}
