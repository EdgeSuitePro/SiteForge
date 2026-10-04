import { describe, expect, it } from 'vitest';

import { EnvError, parseServerEnv } from './env';

describe('parseServerEnv', () => {
  it('defaults to local PGlite and dev auth when nothing is configured', () => {
    const env = parseServerEnv({});
    expect(env.database).toEqual({ kind: 'pglite', dataDir: '.data/pglite' });
    expect(env.auth.mode).toBe('dev');
    expect(env.isDeployed).toBe(false);
  });

  it('uses Postgres when DATABASE_URL is set', () => {
    const env = parseServerEnv({ DATABASE_URL: 'postgresql://u:p@db.siteforge-dev.supabase.co:5432/postgres' });
    expect(env.database.kind).toBe('postgres');
  });

  it('refuses a built-in forbidden database', () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: 'postgresql://postgres:x@db.mjtyspnfvfbhpfbxwilk.supabase.co:5432/postgres' }),
    ).toThrow(EnvError);
  });

  it('refuses forbidden databases listed in SITEFORGE_FORBIDDEN_DB_HOSTS, including pooler usernames', () => {
    expect(() =>
      parseServerEnv({
        SITEFORGE_FORBIDDEN_DB_HOSTS: 'ckwprojectref',
        DATABASE_URL: 'postgresql://postgres.ckwprojectref:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
      }),
    ).toThrow(/forbidden database/);
  });

  it('never allows the embedded database or dev login on Vercel', () => {
    expect(() => parseServerEnv({ VERCEL_ENV: 'preview' })).toThrow(/DATABASE_URL is required/);
    expect(() =>
      parseServerEnv({ VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://u:p@h:5432/db', SITEFORGE_AUTH_MODE: 'dev' }),
    ).toThrow(/only allowed for local development/);
  });

  it('requires secrets on Vercel', () => {
    expect(() =>
      parseServerEnv({
        VERCEL_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@h:5432/db',
        SITEFORGE_AUTH_MODE: 'supabase',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('rejects a short session secret', () => {
    expect(() => parseServerEnv({ SESSION_SECRET: 'short' })).toThrow(/32 characters/);
  });
});
