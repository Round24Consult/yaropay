CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"product_ids" text[],
	"disabled_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"onboarding_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plan" text DEFAULT 'community' NOT NULL,
	"default_currency" text DEFAULT 'NGN' NOT NULL,
	"alerts_webhook_url_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Installs from before workspaces had one company: it becomes workspace `wsp_primary`, with the
-- company-level settings moved over. Fresh installs have no data here and get their first workspace at setup.
INSERT INTO "workspaces" ("id", "name", "slug", "default_currency", "alerts_webhook_url_enc")
SELECT 'wsp_primary', "company_name", 'primary', "default_currency", "alerts_webhook_url_enc" FROM "settings" WHERE "id" = 1;--> statement-breakpoint
INSERT INTO "workspaces" ("id", "name", "slug")
SELECT 'wsp_primary', 'My company', 'primary'
WHERE NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'wsp_primary')
  AND (EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "products") OR EXISTS (SELECT 1 FROM "connections"));--> statement-breakpoint
ALTER TABLE "product_gateways" DROP CONSTRAINT "product_gateways_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_gateways" DROP CONSTRAINT "product_gateways_connection_id_connections_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_product_id_products_id_fk";--> statement-breakpoint
DROP INDEX "audit_log_at_idx";--> statement-breakpoint
DROP INDEX "notifications_user_created_idx";--> statement-breakpoint
DROP INDEX "products_prefix_key";--> statement-breakpoint
DROP INDEX "products_slug_key";--> statement-breakpoint
DROP INDEX "transactions_reference_key";--> statement-breakpoint
DROP INDEX "webhook_events_reference_idx";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_gateways" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "workspace_id" text DEFAULT 'wsp_primary' NOT NULL;--> statement-breakpoint
UPDATE "sessions" SET "workspace_id" = 'wsp_primary' WHERE EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'wsp_primary');--> statement-breakpoint
-- Composite keys first: the cross-company foreign keys below point at them.
CREATE UNIQUE INDEX "connections_workspace_id_key" ON "connections" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_workspace_id_key" ON "products" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_workspace_id_key" ON "transactions" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree (lower("slug"));--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_gateways" ADD CONSTRAINT "product_gateways_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_gateways" ADD CONSTRAINT "product_gateways_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_gateways" ADD CONSTRAINT "product_gateways_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."products"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_prefix_key" ON "products" USING btree ("workspace_id","reference_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_key" ON "products" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions" USING btree ("workspace_id","reference");--> statement-breakpoint
CREATE INDEX "webhook_events_reference_idx" ON "webhook_events" USING btree ("workspace_id","reference");--> statement-breakpoint
-- Every existing team member keeps their role and product scope in the primary company.
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "product_ids", "disabled_at", "last_active_at", "onboarding_dismissed_at", "created_at")
SELECT 'wsp_primary', "id", "role", "product_ids", "disabled_at", "last_active_at", "onboarding_dismissed_at", "created_at" FROM "users"
WHERE EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = 'wsp_primary');
