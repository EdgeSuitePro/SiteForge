CREATE TABLE "siteforge"."business_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"fact_type" text NOT NULL,
	"fact_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"display" text NOT NULL,
	"method" text NOT NULL,
	"confidence" text NOT NULL,
	"occurrences" integer NOT NULL,
	"page_count" integer NOT NULL,
	"on_homepage" boolean NOT NULL,
	"in_header" boolean NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_facts_status_check" CHECK ("siteforge"."business_facts"."status" in ('unverified', 'verified', 'rejected')),
	CONSTRAINT "business_facts_method_check" CHECK ("siteforge"."business_facts"."method" in ('structured_data', 'markup', 'text_pattern', 'ai_extracted', 'operator')),
	CONSTRAINT "business_facts_confidence_check" CHECK ("siteforge"."business_facts"."confidence" in ('high', 'medium', 'low'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."business_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"extractor_version" text NOT NULL,
	"facts_version" text NOT NULL,
	"taxonomy_version" text NOT NULL,
	"brand_version" text NOT NULL,
	"brand" jsonb,
	"stats" jsonb,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_runs_status_check" CHECK ("siteforge"."extraction_runs"."status" in ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."page_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"depth" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "siteforge"."page_extractions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siteforge"."business_facts" ADD CONSTRAINT "business_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."business_facts" ADD CONSTRAINT "business_facts_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."business_facts" ADD CONSTRAINT "business_facts_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "siteforge"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD CONSTRAINT "extraction_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD CONSTRAINT "extraction_runs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."extraction_runs" ADD CONSTRAINT "extraction_runs_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "siteforge"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."page_extractions" ADD CONSTRAINT "page_extractions_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "siteforge"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."page_extractions" ADD CONSTRAINT "page_extractions_page_id_crawl_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "siteforge"."crawl_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."page_extractions" ADD CONSTRAINT "page_extractions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_facts_run_type_key" ON "siteforge"."business_facts" USING btree ("extraction_run_id","fact_type","fact_key");--> statement-breakpoint
CREATE INDEX "business_facts_prospect_idx" ON "siteforge"."business_facts" USING btree ("prospect_id","extraction_run_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_prospect_created_idx" ON "siteforge"."extraction_runs" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_extractions_run_page_key" ON "siteforge"."page_extractions" USING btree ("extraction_run_id","page_id");