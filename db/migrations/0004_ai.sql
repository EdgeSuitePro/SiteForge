CREATE TABLE "siteforge"."model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"tier" text NOT NULL,
	"model_requested" text NOT NULL,
	"model_served" text,
	"prompt_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"effort" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"stop_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real,
	"prices_version" text NOT NULL,
	"latency_ms" integer,
	"error" text,
	"related" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_runs_status_check" CHECK ("siteforge"."model_runs"."status" in ('succeeded', 'failed', 'refused', 'invalid_output', 'skipped_budget'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."model_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_findings" ADD COLUMN "model_run_id" uuid;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD COLUMN "semantic_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD COLUMN "semantic_error" text;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD COLUMN "semantic_model_run_id" uuid;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD COLUMN "semantic_prompt_version" text;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD COLUMN "semantic_notes" jsonb;--> statement-breakpoint
ALTER TABLE "siteforge"."business_facts" ADD COLUMN "model_run_id" uuid;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD COLUMN "ai_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD COLUMN "ai_error" text;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD COLUMN "ai_model_run_id" uuid;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD COLUMN "ai_stats" jsonb;--> statement-breakpoint
ALTER TABLE "siteforge"."model_runs" ADD CONSTRAINT "model_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."model_runs" ADD CONSTRAINT "model_runs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_runs_prospect_created_idx" ON "siteforge"."model_runs" USING btree ("prospect_id","created_at");--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD CONSTRAINT "audit_runs_semantic_status_check" CHECK ("siteforge"."audit_runs"."semantic_status" in ('pending', 'completed', 'failed', 'skipped', 'mock'));--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD CONSTRAINT "extraction_runs_ai_status_check" CHECK ("siteforge"."extraction_runs"."ai_status" in ('pending', 'completed', 'failed', 'skipped', 'mock'));