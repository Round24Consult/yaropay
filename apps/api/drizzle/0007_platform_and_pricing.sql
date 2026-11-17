CREATE TABLE "billing_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"schedule" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"naira_per_unit" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"workspace_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_currency" text DEFAULT 'NGN' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "free_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "billing_prices" ADD CONSTRAINT "billing_prices_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_prices" ADD CONSTRAINT "billing_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_plans_slug_key" ON "billing_plans" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "billing_prices_plan_idx" ON "billing_prices" USING btree ("plan_id","effective_from");--> statement-breakpoint
CREATE INDEX "platform_audit_log_at_idx" ON "platform_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "platform_audit_log_workspace_idx" ON "platform_audit_log" USING btree ("workspace_id","at");--> statement-breakpoint
INSERT INTO "billing_plans" ("id", "slug", "name", "description", "public", "trial_days", "features") VALUES ('pln_standard', 'standard', 'Standard', 'Pay for each product that takes live payments in a month. Test mode is always free.', true, 14, '{multi_workspace,custom_roles,audit_export,sso,enforce_2fa,more_gateways,refunds,reconciliation,scheduled_reports,priority_support}') ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "billing_prices" ("id", "plan_id", "effective_from", "schedule") VALUES ('prc_standard_v1', 'pln_standard', '1970-01-01T00:00:00Z', '{"perLiveProduct":{"NGN":1500000,"USD":1000},"volumeFee":{"enabled":false,"rateBps":0,"threshold":{"NGN":0,"USD":0},"cap":null}}') ON CONFLICT DO NOTHING;
