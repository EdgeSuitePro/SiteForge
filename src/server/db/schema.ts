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
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { CategoryScore, Category, Outcome, Severity } from '../../core/audit/types';
import type { BrandProfile } from '../../core/brand/brand';
import type { CrawlLimits } from '../../core/crawl/limits';
import type { PageDocument } from '../../core/extract/document';
import type { Confidence, Evidence, FactMethod, FactType } from '../../core/facts/types';

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

// ---------------------------------------------------------------------------------------------
// Business facts (Phase 2)
// ---------------------------------------------------------------------------------------------

/** pending → completed | failed | skipped (budget / not applicable) | mock (no AI provider configured). */
export const AI_STAGE_STATUSES = ['pending', 'completed', 'failed', 'skipped', 'mock'] as const;
export type AiStageStatus = (typeof AI_STAGE_STATUSES)[number];

export const EXTRACTION_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export interface ExtractionStats {
  pages: number;
  facts: number;
  byType: Record<string, number>;
  stylesheetsFetched: number;
}

/** One deterministic extraction pass over a crawl. Re-runnable without re-crawling. */
export const extractionRuns = siteforge
  .table(
    'extraction_runs',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id')
        .notNull()
        .references(() => prospects.id, { onDelete: 'cascade' }),
      crawlRunId: uuid('crawl_run_id')
        .notNull()
        .references(() => crawlRuns.id, { onDelete: 'cascade' }),
      status: text('status').$type<ExtractionStatus>().notNull().default('queued'),
      extractorVersion: text('extractor_version').notNull(),
      factsVersion: text('facts_version').notNull(),
      taxonomyVersion: text('taxonomy_version').notNull(),
      brandVersion: text('brand_version').notNull(),
      brand: jsonb('brand').$type<BrandProfile>(),
      stats: jsonb('stats').$type<ExtractionStats>(),
      error: text('error'),
      /** AI-assisted extraction stage (fast tier). */
      aiStatus: text('ai_status').$type<AiStageStatus>().notNull().default('pending'),
      aiError: text('ai_error'),
      aiModelRunId: uuid('ai_model_run_id'),
      aiStats: jsonb('ai_stats').$type<{ added: number; rejected: number; duplicates: number }>(),
      requestedBy: uuid('requested_by'),
      startedAt: timestamp('started_at', { withTimezone: true }),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (table) => [
      index('extraction_runs_prospect_created_idx').on(table.prospectId, table.createdAt),
      check('extraction_runs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
      check('extraction_runs_ai_status_check', sql`${table.aiStatus} in ('pending', 'completed', 'failed', 'skipped', 'mock')`),
    ],
  )
  .enableRLS();

/** Parsed page structure (minus raw CSS) — input for audit rules in Phase 3. */
export type StoredPageDocument = Omit<PageDocument, 'inlineCss'>;

export const pageExtractions = siteforge
  .table(
    'page_extractions',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      extractionRunId: uuid('extraction_run_id')
        .notNull()
        .references(() => extractionRuns.id, { onDelete: 'cascade' }),
      pageId: uuid('page_id')
        .notNull()
        .references(() => crawlPages.id, { onDelete: 'cascade' }),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      url: text('url').notNull(),
      depth: integer('depth').notNull(),
      document: jsonb('document').$type<StoredPageDocument>().notNull(),
      createdAt: createdAt(),
    },
    (table) => [uniqueIndex('page_extractions_run_page_key').on(table.extractionRunId, table.pageId)],
  )
  .enableRLS();

export const FACT_STATUSES = ['unverified', 'verified', 'rejected'] as const;
export type FactReviewStatus = (typeof FACT_STATUSES)[number];

export const businessFacts = siteforge
  .table(
    'business_facts',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id')
        .notNull()
        .references(() => prospects.id, { onDelete: 'cascade' }),
      extractionRunId: uuid('extraction_run_id')
        .notNull()
        .references(() => extractionRuns.id, { onDelete: 'cascade' }),
      factType: text('fact_type').$type<FactType>().notNull(),
      factKey: text('fact_key').notNull(),
      value: jsonb('value').$type<Record<string, unknown>>().notNull(),
      display: text('display').notNull(),
      method: text('method').$type<FactMethod>().notNull(),
      confidence: text('confidence').$type<Confidence>().notNull(),
      occurrences: integer('occurrences').notNull(),
      pageCount: integer('page_count').notNull(),
      onHomepage: boolean('on_homepage').notNull(),
      inHeader: boolean('in_header').notNull(),
      evidence: jsonb('evidence').$type<Evidence[]>().notNull(),
      status: text('status').$type<FactReviewStatus>().notNull().default('unverified'),
      reviewedBy: uuid('reviewed_by'),
      reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
      reviewNote: text('review_note'),
      /** Set for AI-extracted facts: the model call that produced them. */
      modelRunId: uuid('model_run_id'),
      createdAt: createdAt(),
    },
    (table) => [
      uniqueIndex('business_facts_run_type_key').on(table.extractionRunId, table.factType, table.factKey),
      index('business_facts_prospect_idx').on(table.prospectId, table.extractionRunId),
      check('business_facts_status_check', sql`${table.status} in ('unverified', 'verified', 'rejected')`),
      check('business_facts_method_check', sql`${table.method} in ('structured_data', 'markup', 'text_pattern', 'ai_extracted', 'operator')`),
      check('business_facts_confidence_check', sql`${table.confidence} in ('high', 'medium', 'low')`),
    ],
  )
  .enableRLS();

// ---------------------------------------------------------------------------------------------
// Deterministic audit (Phase 3)
// ---------------------------------------------------------------------------------------------

export const AUDIT_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** One audit = one ruleset version applied to one extraction run (and its operator decisions). */
export const auditRuns = siteforge
  .table(
    'audit_runs',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id')
        .notNull()
        .references(() => prospects.id, { onDelete: 'cascade' }),
      extractionRunId: uuid('extraction_run_id')
        .notNull()
        .references(() => extractionRuns.id, { onDelete: 'cascade' }),
      crawlRunId: uuid('crawl_run_id')
        .notNull()
        .references(() => crawlRuns.id, { onDelete: 'cascade' }),
      status: text('status').$type<AuditStatus>().notNull().default('queued'),
      rulesetVersion: text('ruleset_version').notNull(),
      overallScore: integer('overall_score'),
      categories: jsonb('categories').$type<CategoryScore[]>(),
      caveats: jsonb('caveats').$type<string[]>().notNull().default([]),
      /** Latest fact review time included in this audit (to detect later operator changes). */
      factsReviewedThrough: timestamp('facts_reviewed_through', { withTimezone: true }),
      error: text('error'),
      /** AI-assisted semantic review stage (strong tier). */
      semanticStatus: text('semantic_status').$type<AiStageStatus>().notNull().default('pending'),
      semanticError: text('semantic_error'),
      semanticModelRunId: uuid('semantic_model_run_id'),
      semanticPromptVersion: text('semantic_prompt_version'),
      semanticNotes: jsonb('semantic_notes').$type<{ citationsRejected: number; instructionsFoundInContent: boolean; provider: string; model: string }>(),
      requestedBy: uuid('requested_by'),
      startedAt: timestamp('started_at', { withTimezone: true }),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (table) => [
      index('audit_runs_prospect_created_idx').on(table.prospectId, table.createdAt),
      check('audit_runs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
      check('audit_runs_score_check', sql`${table.overallScore} is null or (${table.overallScore} between 0 and 100)`),
      check('audit_runs_semantic_status_check', sql`${table.semanticStatus} in ('pending', 'completed', 'failed', 'skipped', 'mock')`),
    ],
  )
  .enableRLS();

export const auditFindings = siteforge
  .table(
    'audit_findings',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      auditRunId: uuid('audit_run_id')
        .notNull()
        .references(() => auditRuns.id, { onDelete: 'cascade' }),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id')
        .notNull()
        .references(() => prospects.id, { onDelete: 'cascade' }),
      ruleId: text('rule_id').notNull(),
      category: text('category').$type<Category>().notNull(),
      /** deterministic now; 'semantic' (AI-assisted, with model provenance) arrives in Phase 4. */
      source: text('source').$type<'deterministic' | 'semantic'>().notNull(),
      outcome: text('outcome').$type<Outcome>().notNull(),
      severity: text('severity').$type<Severity>().notNull(),
      title: text('title').notNull(),
      detail: text('detail').notNull(),
      evidence: jsonb('evidence').$type<Evidence[]>().notNull(),
      whyItMatters: text('why_it_matters').notNull(),
      recommendedFix: text('recommended_fix').notNull(),
      requiresOwnerConfirmation: boolean('requires_owner_confirmation').notNull().default(false),
      pointsPossible: real('points_possible').notNull(),
      pointsAwarded: real('points_awarded').notNull(),
      priority: real('priority').notNull(),
      sortOrder: integer('sort_order').notNull(),
      modelRunId: uuid('model_run_id'),
      createdAt: createdAt(),
    },
    (table) => [
      uniqueIndex('audit_findings_run_rule_key').on(table.auditRunId, table.ruleId),
      index('audit_findings_run_order_idx').on(table.auditRunId, table.sortOrder),
      check('audit_findings_outcome_check', sql`${table.outcome} in ('pass', 'partial', 'fail', 'not_applicable', 'unknown')`),
      check('audit_findings_severity_check', sql`${table.severity} in ('high', 'medium', 'low')`),
      check('audit_findings_source_check', sql`${table.source} in ('deterministic', 'semantic')`),
    ],
  )
  .enableRLS();

// ---------------------------------------------------------------------------------------------
// AI model calls (Phase 4): provenance, tokens and estimated cost for every call.
// ---------------------------------------------------------------------------------------------

export const MODEL_RUN_STATUSES = ['succeeded', 'failed', 'refused', 'invalid_output', 'skipped_budget'] as const;
export type ModelRunStatus = (typeof MODEL_RUN_STATUSES)[number];

export const modelRuns = siteforge
  .table(
    'model_runs',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspaces.id, { onDelete: 'cascade' }),
      prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'cascade' }),
      task: text('task').notNull(),
      provider: text('provider').notNull(),
      tier: text('tier').notNull(),
      modelRequested: text('model_requested').notNull(),
      modelServed: text('model_served'),
      promptId: text('prompt_id').notNull(),
      promptVersion: text('prompt_version').notNull(),
      effort: text('effort').notNull(),
      /** SHA-256 of system + user input, to spot identical repeated calls. */
      inputHash: text('input_hash').notNull(),
      status: text('status').$type<ModelRunStatus>().notNull(),
      stopReason: text('stop_reason'),
      inputTokens: integer('input_tokens').notNull().default(0),
      outputTokens: integer('output_tokens').notNull().default(0),
      cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
      cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
      /** Estimate from the versioned price table (pricesVersion), not an invoice. */
      costUsd: real('cost_usd'),
      pricesVersion: text('prices_version').notNull(),
      latencyMs: integer('latency_ms'),
      error: text('error'),
      related: jsonb('related').$type<Record<string, string>>().notNull().default({}),
      createdAt: createdAt(),
    },
    (table) => [
      index('model_runs_prospect_created_idx').on(table.prospectId, table.createdAt),
      check('model_runs_status_check', sql`${table.status} in ('succeeded', 'failed', 'refused', 'invalid_output', 'skipped_budget')`),
    ],
  )
  .enableRLS();
