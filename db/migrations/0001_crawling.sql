CREATE TABLE "siteforge"."crawl_page_bodies" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"encoding" text DEFAULT 'gzip' NOT NULL,
	"body" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_page_bodies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."crawl_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"pattern_key" text NOT NULL,
	"depth" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"discovered_from" text,
	"link_text" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"http_status" integer,
	"final_url" text,
	"content_type" text,
	"bytes" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"fetch_ms" integer,
	"redirects" jsonb,
	"summary" jsonb,
	"parser_version" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "crawl_pages_state_check" CHECK ("siteforge"."crawl_pages"."state" in ('queued', 'fetching', 'fetched', 'skipped', 'failed')),
	CONSTRAINT "crawl_pages_source_check" CHECK ("siteforge"."crawl_pages"."source" in ('start', 'link', 'sitemap'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stop_reason" text,
	"start_url" text NOT NULL,
	"canonical_origin" text,
	"root_domain" text NOT NULL,
	"limits" jsonb NOT NULL,
	"crawler_version" text NOT NULL,
	"robots" jsonb,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"error" text,
	"requested_by" uuid,
	"last_fetch_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_runs_status_check" CHECK ("siteforge"."crawl_runs"."status" in ('queued', 'running', 'completed', 'failed', 'canceled')),
	CONSTRAINT "crawl_runs_stop_reason_check" CHECK ("siteforge"."crawl_runs"."stop_reason" is null or "siteforge"."crawl_runs"."stop_reason" in ('exhausted', 'page_limit', 'time_limit', 'canceled', 'robots_disallowed', 'start_failed', 'error'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status_check" CHECK ("siteforge"."jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_page_bodies" ADD CONSTRAINT "crawl_page_bodies_page_id_crawl_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "siteforge"."crawl_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_pages" ADD CONSTRAINT "crawl_pages_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "siteforge"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_pages" ADD CONSTRAINT "crawl_pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_runs" ADD CONSTRAINT "crawl_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."crawl_runs" ADD CONSTRAINT "crawl_runs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_pages_run_url_key" ON "siteforge"."crawl_pages" USING btree ("crawl_run_id","url");--> statement-breakpoint
CREATE INDEX "crawl_pages_run_queue_idx" ON "siteforge"."crawl_pages" USING btree ("crawl_run_id","state","priority","created_at");--> statement-breakpoint
CREATE INDEX "crawl_pages_run_pattern_idx" ON "siteforge"."crawl_pages" USING btree ("crawl_run_id","pattern_key");--> statement-breakpoint
CREATE INDEX "crawl_runs_prospect_created_idx" ON "siteforge"."crawl_runs" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "siteforge"."jobs" USING btree ("status","run_after","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_key" ON "siteforge"."jobs" USING btree ("dedupe_key") WHERE "siteforge"."jobs"."status" in ('queued', 'running');