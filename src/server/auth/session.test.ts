import { describe, expect, it } from 'vitest';

import { devUserIdForEmail } from './dev-identity';
import { SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from './session';

const SECRET = 'a'.repeat(40);
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'op@example.com' };

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createSessionToken(user, SECRET);
    expect(verifySessionToken(token, SECRET)).toMatchObject({ sub: user.id, email: user.email });
  });

  it('rejects a token signed with another secret', () => {
    expect(verifySessionToken(createSessionToken(user, SECRET), 'b'.repeat(40))).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [, signature] = createSessionToken(user, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'x', email: 'evil@example.com', iat: 0, exp: 9e12 })).toString(
      'base64url',
    );
    expect(verifySessionToken(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const issued = Date.now() - (SESSION_TTL_SECONDS + 1) * 1000;
    expect(verifySessionToken(createSessionToken(user, SECRET, issued), SECRET)).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const bad of [undefined, '', 'abc', 'a.b.c', 'x'.repeat(5000)]) {
      expect(verifySessionToken(bad, SECRET)).toBeNull();
    }
  });
});

describe('devUserIdForEmail', () => {
  it('is stable, case-insensitive and UUID-shaped', () => {
    const id = devUserIdForEmail('Operator@SiteForge.local');
    expect(id).toBe(devUserIdForEmail('operator@siteforge.local'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
