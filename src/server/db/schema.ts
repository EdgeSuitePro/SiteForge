/**
 * SiteForge database schema (Drizzle, PostgreSQL).
 *
 * Portability rules — this schema must run unchanged on embedded PGlite (local dev/tests)
 * and on a dedicated Supabase Postgres project:
 *  - Everything lives in the `siteforge` schema, which Supabase's REST API does not expose.
 *  - Row-level security is enabled on every table with NO policies: only the server's direct
 *    Postgres connection (a privileged role) can read or write. Defence in depth.
 *  - Status-like columns are `text` + CHECK constraints rather than Postgres enums, so new
 *    states can be added in an ordinary transactional migration.
 *  - User IDs are plain `uuid` values (Supabase `auth.users.id`) without a foreign key into
 *    the `auth` schema, which does not exist in PGlite.
 *  - `updated_at` is maintained by the application (`$onUpdate`), not by triggers.
 *
 * Migrations are generated from this file with `pnpm db:generate` and committed to db/migrations.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { CrawlLimits } from '../../core/crawl/limits';

export const siteforge = pgSchema('siteforge');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------------------------
// Workspaces: the ESP sales/operator organization that owns prospects.
// ---------------------------------------------------------------------------------------------

export const workspaces = siteforge
  .table('workspaces', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  })
  .enableRLS();

export const WORKSPACE_ROLES = ['owner', 'operator', 'viewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = siteforge
  .table(
    'workspace_members',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      /** Supabase auth user id (or a deterministic local id in dev auth mode). */
      userId: uuid('user_id').notNull(),
      email: text('email').notNull(),
      role: text('role').$type<WorkspaceRole>().notNull().default('operator'),
      createdAt: createdAt(),
    },
    (table) => [
      uniqueIndex('workspace_members_workspace_user_key').on(table.workspaceId, table.userId),
      index('workspace_members_user_idx').on(table.userId),
      check('workspace_members_role_check', sql`${table.role} in ('owner', 'operator', 'viewer')`),
    ],
  )
  .enableRLS();

// ---------------------------------------------------------------------------------------------
// Prospects: a sharpening business website under evaluation.
// ---------------------------------------------------------------------------------------------

export const PROSPECT_STATUSES = ['new', 'analyzing', 'analyzed', 'failed', 'archived'] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const prospects = siteforge
  .table(
    'prospects',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      /** URL exactly as entered by the operator (after basic normalization). */
      websiteUrl: text('website_url').notNull(),
      /** Lower-cased host without a leading `www.`; one prospect per domain per workspace. */
      normalizedDomain: text('normalized_domain').notNull(),
      businessNameHint: text('business_name_hint'),
      cityHint: text('city_hint'),
      notes: text('notes'),
      status: text('status').$type<ProspectStatus>().notNull().default('new'),
      createdBy: uuid('created_by'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (table) => [
      uniqueIndex('prospects_workspace_domain_key').on(table.workspaceId, table.normalizedDomain),
      index('prospects_workspace_created_idx').on(table.workspaceId, table.createdAt),
      check(
        'prospects_status_check',
        sql`${table.status} in ('new', 'analyzing', 'analyzed', 'failed', 'archived')`,
      ),
    ],
  )
  .enableRLS();

// ---------------------------------------------------------------------------------------------
// Activity log: operator actions and pipeline state changes, per workspace / prospect.
// ---------------------------------------------------------------------------------------------

export const activityLog = siteforge
  .table(
    'activity_log',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'cascade' }),
      actorUserId: uuid('actor_user_id'),
      /** Stable dotted event name, e.g. `prospect.created`, `crawl.completed`. */
      kind: text('kind').notNull(),
      detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
      createdAt: createdAt(),
    },
    (table) => [index('activity_log_prospect_created_idx').on(table.prospectId, table.createdAt)],
  )
  .enableRLS();

// ---------------------------------------------------------------------------------------------
// Crawling (Phase 1)
// ---------------------------------------------------------------------------------------------

/** bytea that always surfaces as a Node Buffer (PGlite returns Uint8Array, postgres-js Buffer). */
const bytea = customType<{ data: Buffer; driverData: Uint8Array | Buffer }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value),
  toDriver: (value) => value,
});

export const CRAWL_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'canceled'] as const;
export type CrawlRunStatus = (typeof CRAWL_RUN_STATUSES)[number];

export const CRAWL_STOP_REASONS = [
  'exhausted',
  'page_limit',
  'time_limit',
  'canceled',
  'robots_disallowed',
  'start_failed',
  'error',
] as const;
export type CrawlStopReason = (typeof CRAWL_STOP_REASONS)[number];

export interface RobotsSnapshot {
  status: 'parsed' | 'not_found' | 'unavailable';
  origin: string;
  detail: string;
  delayMs: number;
  sitemaps: string[];
  /** robots.txt text, capped for storage. */
  raw: string | null;
}

export interface CrawlRunNotes {
  /** Links discarded before queueing, by reason (offsite, extension, …). */
  discarded?: Record<string, number>;
  redirectedFrom?: string;
  likelyJsRendered?: boolean;
  sitemapUrlsFound?: number;
}

export const crawlRuns = siteforge
  .table(
    'crawl_runs',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id')
        .notNull()
        .references(() => prospects.id, { onDelete: 'cascade' }),
      status: text('status').$type<CrawlRunStatus>().notNull().default('queued'),
      stopReason: text('stop_reason').$type<CrawlStopReason>(),
      startUrl: text('start_url').notNull(),
      /** Origin locked onto after following the homepage redirects, e.g. https://www.example.com */
      canonicalOrigin: text('canonical_origin'),
      rootDomain: text('root_domain').notNull(),
      limits: jsonb('limits').$type<CrawlLimits>().notNull(),
      crawlerVersion: text('crawler_version').notNull(),
      robots: jsonb('robots').$type<RobotsSnapshot>(),
      notes: jsonb('notes').$type<CrawlRunNotes>().notNull().default({}),
      cancelRequested: boolean('cancel_requested').notNull().default(false),
      error: text('error'),
      requestedBy: uuid('requested_by'),
      lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
      heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
      startedAt: timestamp('started_at', { withTimezone: true }),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (table) => [
      index('crawl_runs_prospect_created_idx').on(table.prospectId, table.createdAt),
      check(
        'crawl_runs_status_check',
        sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'canceled')`,
      ),
      check(
        'crawl_runs_stop_reason_check',
        sql`${table.stopReason} is null or ${table.stopReason} in ('exhausted', 'page_limit', 'time_limit', 'canceled', 'robots_disallowed', 'start_failed', 'error')`,
      ),
    ],
  )
  .enableRLS();

export const CRAWL_PAGE_STATES = ['queued', 'fetching', 'fetched', 'skipped', 'failed'] as const;
export type CrawlPageState = (typeof CRAWL_PAGE_STATES)[number];

export interface CrawlPageSummary {
  title: string | null;
  h1: string | null;
  lang: string | null;
  canonical: string | null;
  metaRobots: { noindex: boolean; nofollow: boolean };
  wordCount: number;
  likelyJsRendered: boolean;
  linkCount: number;
}

/** One row per URL per crawl run. Doubles as the crawl queue (state = queued). */
export const crawlPages = siteforge
  .table(
    'crawl_pages',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      crawlRunId: uuid('crawl_run_id')
        .notNull()
        .references(() => crawlRuns.id, { onDelete: 'cascade' }),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      url: text('url').notNull(),
      patternKey: text('pattern_key').notNull(),
      depth: integer('depth').notNull(),
      priority: integer('priority').notNull().default(0),
      source: text('source').$type<'start' | 'link' | 'sitemap'>().notNull(),
      discoveredFrom: text('discovered_from'),
      linkText: text('link_text'),
      state: text('state').$type<CrawlPageState>().notNull().default('queued'),
      skipReason: text('skip_reason'),
      attempts: integer('attempts').notNull().default(0),
      httpStatus: integer('http_status'),
      finalUrl: text('final_url'),
      contentType: text('content_type'),
      bytes: integer('bytes'),
      truncated: boolean('truncated').notNull().default(false),
      contentHash: text('content_hash'),
      fetchMs: integer('fetch_ms'),
      redirects: jsonb('redirects').$type<string[]>(),
      summary: jsonb('summary').$type<CrawlPageSummary>(),
      parserVersion: text('parser_version'),
      error: text('error'),
      createdAt: createdAt(),
      fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    },
    (table) => [
      uniqueIndex('crawl_pages_run_url_key').on(table.crawlRunId, table.url),
      index('crawl_pages_run_queue_idx').on(table.crawlRunId, table.state, table.priority, table.createdAt),
      index('crawl_pages_run_pattern_idx').on(table.crawlRunId, table.patternKey),
      check(
        'crawl_pages_state_check',
        sql`${table.state} in ('queued', 'fetching', 'fetched', 'skipped', 'failed')`,
      ),
      check('crawl_pages_source_check', sql`${table.source} in ('start', 'link', 'sitemap')`),
    ],
  )
  .enableRLS();

/** Gzipped raw HTML, kept so extractors can be re-run without re-crawling. Subject to retention. */
export const crawlPageBodies = siteforge
  .table('crawl_page_bodies', {
    pageId: uuid('page_id')
      .primaryKey()
      .references(() => crawlPages.id, { onDelete: 'cascade' }),
    encoding: text('encoding').$type<'gzip'>().notNull().default('gzip'),
    body: bytea('body').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  })
  .enableRLS();

// ---------------------------------------------------------------------------------------------
// Background jobs: a Postgres-backed queue (FOR UPDATE SKIP LOCKED + leases).
// ---------------------------------------------------------------------------------------------

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = siteforge
  .table(
    'jobs',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
      kind: text('kind').notNull(),
      payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
      /** At most one active (queued/running) job per dedupe key, e.g. `crawl:<runId>`. */
      dedupeKey: text('dedupe_key'),
      status: text('status').$type<JobStatus>().notNull().default('queued'),
      priority: integer('priority').notNull().default(0),
      runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
      attempts: integer('attempts').notNull().default(0),
      maxAttempts: integer('max_attempts').notNull().default(5),
      lockedBy: text('locked_by'),
      lockedUntil: timestamp('locked_until', { withTimezone: true }),
      lastError: text('last_error'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
    },
    (table) => [
      index('jobs_claim_idx').on(table.status, table.runAfter, table.priority),
      uniqueIndex('jobs_active_dedupe_key')
        .on(table.dedupeKey)
        .where(sql`${table.status} in ('queued', 'running')`),
      check(
        'jobs_status_check',
        sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'canceled')`,
      ),
    ],
  )
  .enableRLS();
