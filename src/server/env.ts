import { z } from 'zod';

/**
 * Server environment, validated once at first use.
 *
 * Safety rules enforced here (not just documented):
 *  - Local development uses an embedded PGlite database unless DATABASE_URL is set.
 *  - The dev login can only run when the app is NOT on Vercel (VERCEL_ENV unset).
 *  - Production requires a real database, Supabase auth, and a session secret.
 *  - DATABASE_URL may never point at a known non-SiteForge database (e.g. Chef KnifeWorks).
 */

/** Supabase project refs / hosts SiteForge must never connect to. Extend via SITEFORGE_FORBIDDEN_DB_HOSTS. */
const BUILT_IN_FORBIDDEN_DB_HOSTS = [
  // EdgeSuite-Pro---Knife-Sharpening-Business-Platform-938 prototype project.
  'mjtyspnfvfbhpfbxwilk',
];

const DEV_SESSION_SECRET = 'siteforge-local-dev-session-secret-not-for-deployment';
const DEV_JOB_SECRET = 'siteforge-local-dev-job-secret-not-for-deployment';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'preview', 'production']).optional()),

  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string')
      .optional(),
  ),
  SITEFORGE_LOCAL_DB_DIR: z.string().default('.data/pglite'),
  SITEFORGE_FORBIDDEN_DB_HOSTS: optionalString,

  SITEFORGE_AUTH_MODE: z.enum(['dev', 'supabase']).default('dev'),
  SITEFORGE_DEV_OPERATOR_EMAIL: z.email().default('operator@siteforge.local'),
  SESSION_SECRET: optionalString,

  SUPABASE_URL: optionalString,
  SUPABASE_ANON_KEY: optionalString,

  APP_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  JOB_SECRET: optionalString,
  CRON_SECRET: optionalString,
  VERCEL_URL: optionalString,
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalString,
  PORT: optionalString,

  ANTHROPIC_API_KEY: optionalString,

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type DatabaseTarget = { kind: 'pglite'; dataDir: string } | { kind: 'postgres'; url: string };

export interface ServerEnv {
  nodeEnv: 'development' | 'test' | 'production';
  vercelEnv: 'development' | 'preview' | 'production' | undefined;
  isDeployed: boolean;
  database: DatabaseTarget;
  auth:
    | { mode: 'dev'; devOperatorEmail: string }
    | { mode: 'supabase'; supabaseUrl: string; supabaseAnonKey: string };
  sessionSecret: string;
  /** Base URL the worker uses to call itself. Never derived from request headers. */
  appBaseUrl: string;
  jobSecret: string;
  vercelBypassSecret: string | undefined;
  cronSecret: string | undefined;
  anthropicApiKey: string | undefined;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export class EnvError extends Error {
  constructor(message: string) {
    super(`SiteForge environment error: ${message}`);
    this.name = 'EnvError';
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new EnvError(issues);
  }
  const raw = parsed.data;
  const isDeployed = raw.VERCEL_ENV !== undefined;

  // --- database ---------------------------------------------------------------
  let database: DatabaseTarget;
  if (raw.DATABASE_URL) {
    const forbidden = [
      ...BUILT_IN_FORBIDDEN_DB_HOSTS,
      ...(raw.SITEFORGE_FORBIDDEN_DB_HOSTS ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ];
    let host: string;
    try {
      const url = new URL(raw.DATABASE_URL);
      host = `${url.hostname} ${decodeURIComponent(url.username)}`.toLowerCase();
    } catch {
      throw new EnvError('DATABASE_URL is not a valid URL.');
    }
    const hit = forbidden.find((entry) => host.includes(entry));
    if (hit) {
      throw new EnvError(`DATABASE_URL points at a forbidden database (${hit}). SiteForge must use its own project.`);
    }
    database = { kind: 'postgres', url: raw.DATABASE_URL };
  } else {
    if (isDeployed) {
      throw new EnvError('DATABASE_URL is required on Vercel deployments; the embedded local database is dev-only.');
    }
    database = { kind: 'pglite', dataDir: raw.SITEFORGE_LOCAL_DB_DIR };
  }

  // --- auth -------------------------------------------------------------------
  let auth: ServerEnv['auth'];
  if (raw.SITEFORGE_AUTH_MODE === 'dev') {
    if (isDeployed) {
      throw new EnvError('SITEFORGE_AUTH_MODE=dev is only allowed for local development, never on Vercel.');
    }
    auth = { mode: 'dev', devOperatorEmail: raw.SITEFORGE_DEV_OPERATOR_EMAIL };
  } else {
    if (!raw.SUPABASE_URL || !raw.SUPABASE_ANON_KEY) {
      throw new EnvError('SITEFORGE_AUTH_MODE=supabase requires SUPABASE_URL and SUPABASE_ANON_KEY.');
    }
    auth = { mode: 'supabase', supabaseUrl: raw.SUPABASE_URL, supabaseAnonKey: raw.SUPABASE_ANON_KEY };
  }

  // --- secrets ----------------------------------------------------------------
  let sessionSecret = raw.SESSION_SECRET;
  if (!sessionSecret) {
    if (isDeployed) throw new EnvError('SESSION_SECRET is required on Vercel deployments.');
    sessionSecret = DEV_SESSION_SECRET;
  } else if (sessionSecret.length < 32) {
    throw new EnvError('SESSION_SECRET must be at least 32 characters.');
  }
  if (isDeployed && (!raw.JOB_SECRET || !raw.CRON_SECRET)) {
    throw new EnvError('JOB_SECRET and CRON_SECRET are required on Vercel deployments.');
  }

  const appBaseUrl = (
    raw.APP_BASE_URL ?? (raw.VERCEL_URL ? `https://${raw.VERCEL_URL}` : `http://localhost:${raw.PORT ?? '3000'}`)
  ).replace(/\/$/, '');

  return {
    nodeEnv: raw.NODE_ENV,
    vercelEnv: raw.VERCEL_ENV,
    isDeployed,
    database,
    auth,
    sessionSecret,
    appBaseUrl,
    jobSecret: raw.JOB_SECRET ?? DEV_JOB_SECRET,
    vercelBypassSecret: raw.VERCEL_AUTOMATION_BYPASS_SECRET,
    cronSecret: raw.CRON_SECRET,
    anthropicApiKey: raw.ANTHROPIC_API_KEY,
    logLevel: raw.LOG_LEVEL,
  };
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
