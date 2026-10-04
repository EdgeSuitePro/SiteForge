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
import { check, index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
