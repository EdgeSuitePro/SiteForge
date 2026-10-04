import { createHash } from 'node:crypto';

/** Deterministic, stable UUID for a local dev operator email (dev auth mode only). */
export function devUserIdForEmail(email: string): string {
  const hex = createHash('sha256').update(`siteforge-dev-user:${email.trim().toLowerCase()}`).digest('hex');
  // Shape as an RFC 4122 v4-layout UUID so it fits a Postgres uuid column.
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
