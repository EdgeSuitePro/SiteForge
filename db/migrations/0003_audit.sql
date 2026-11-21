CREATE TABLE "siteforge"."audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"outcome" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"why_it_matters" text NOT NULL,
	"recommended_fix" text NOT NULL,
	"requires_owner_confirmation" boolean DEFAULT false NOT NULL,
	"points_possible" real NOT NULL,
	"points_awarded" real NOT NULL,
	"priority" real NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_findings_outcome_check" CHECK ("siteforge"."audit_findings"."outcome" in ('pass', 'partial', 'fail', 'not_applicable', 'unknown')),
	CONSTRAINT "audit_findings_severity_check" CHECK ("siteforge"."audit_findings"."severity" in ('high', 'medium', 'low')),
	CONSTRAINT "audit_findings_source_check" CHECK ("siteforge"."audit_findings"."source" in ('deterministic', 'semantic'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."audit_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"ruleset_version" text NOT NULL,
	"overall_score" integer,
	"categories" jsonb,
	"caveats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts_reviewed_through" timestamp with time zone,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_runs_status_check" CHECK ("siteforge"."audit_runs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "audit_runs_score_check" CHECK ("siteforge"."audit_runs"."overall_score" is null or ("siteforge"."audit_runs"."overall_score" between 0 and 100))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_findings" ADD CONSTRAINT "audit_findings_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "siteforge"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_findings" ADD CONSTRAINT "audit_findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_findings" ADD CONSTRAINT "audit_findings_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD CONSTRAINT "audit_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD CONSTRAINT "audit_runs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD CONSTRAINT "audit_runs_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "siteforge"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."audit_runs" ADD CONSTRAINT "audit_runs_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "siteforge"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_findings_run_rule_key" ON "siteforge"."audit_findings" USING btree ("audit_run_id","rule_id");--> statement-breakpoint
CREATE INDEX "audit_findings_run_order_idx" ON "siteforge"."audit_findings" USING btree ("audit_run_id","sort_order");--> statement-breakpoint
CREATE INDEX "audit_runs_prospect_created_idx" ON "siteforge"."audit_runs" USING btree ("prospect_id","created_at");