CREATE TABLE "siteforge"."concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"strategy" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"content" jsonb,
	"raw_content" jsonb,
	"claim_report" jsonb,
	"fact_catalog" jsonb,
	"design_tokens" jsonb,
	"schema_version" text NOT NULL,
	"renderer_version" text NOT NULL,
	"claim_check_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text,
	"model_run_id" uuid,
	"render_hash" text,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_status_check" CHECK ("siteforge"."concepts"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "concepts_strategy_check" CHECK ("siteforge"."concepts"."strategy" in ('local_growth', 'craftsman', 'fastest_path'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."concepts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siteforge"."concepts" ADD CONSTRAINT "concepts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."concepts" ADD CONSTRAINT "concepts_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."concepts" ADD CONSTRAINT "concepts_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "siteforge"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."concepts" ADD CONSTRAINT "concepts_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "siteforge"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_prospect_generation_strategy_idx" ON "siteforge"."concepts" USING btree ("prospect_id","generation","strategy");--> statement-breakpoint
CREATE INDEX "concepts_prospect_created_idx" ON "siteforge"."concepts" USING btree ("prospect_id","created_at");