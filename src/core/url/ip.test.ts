import { describe, expect, it } from 'vitest';

import { expandIPv6, isBlockedIp } from './ip';

describe('isBlockedIp — IPv4', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1'])(
    'allows public %s',
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('isBlockedIp — IPv6', () => {
  it.each([
    '::',
    '::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1%eth0',
    'fec0::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // same, hex form
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '::127.0.0.1', // IPv4-compatible
    '64:ff9b::a00:1', // NAT64 → 10.0.0.1
    '64:ff9b:1::1',
    '2001:db8::1', // documentation
    '2001::1', // Teredo
    '2002:7f00:1::1', // 6to4
    '100::1', // discard
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    'allows public %s',
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('isBlockedIp — garbage', () => {
  it.each(['', 'localhost', '999.1.1.1', '1.2.3', 'example.com', '::g'])('treats %s as blocked', (value) =>
    expect(isBlockedIp(value)).toBe(true),
  );
});

describe('expandIPv6', () => {
  it('expands compressed and dotted forms', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(expandIPv6('2001:db8:0:0:1:0:0:1')).toEqual([0x2001, 0xdb8, 0, 0, 1, 0, 0, 1]);
  });
});
