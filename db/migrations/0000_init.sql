CREATE SCHEMA "siteforge";
--> statement-breakpoint
CREATE TABLE "siteforge"."activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prospect_id" uuid,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "siteforge"."activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"website_url" text NOT NULL,
	"normalized_domain" text NOT NULL,
	"business_name_hint" text,
	"city_hint" text,
	"notes" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_status_check" CHECK ("siteforge"."prospects"."status" in ('new', 'analyzing', 'analyzed', 'failed', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_role_check" CHECK ("siteforge"."workspace_members"."role" in ('owner', 'operator', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "siteforge"."workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "siteforge"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "siteforge"."workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siteforge"."activity_log" ADD CONSTRAINT "activity_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."activity_log" ADD CONSTRAINT "activity_log_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "siteforge"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."prospects" ADD CONSTRAINT "prospects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteforge"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "siteforge"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_prospect_created_idx" ON "siteforge"."activity_log" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_workspace_domain_key" ON "siteforge"."prospects" USING btree ("workspace_id","normalized_domain");--> statement-breakpoint
CREATE INDEX "prospects_workspace_created_idx" ON "siteforge"."prospects" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_key" ON "siteforge"."workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "siteforge"."workspace_members" USING btree ("user_id");