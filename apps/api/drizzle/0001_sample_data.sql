ALTER TABLE "audit_log" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_dismissed_at" timestamp with time zone;--> statement-breakpoint
-- Installs seeded before this migration: flag the demo company (fixed IDs) as sample data.
UPDATE "connections" SET "sample" = true WHERE "id" IN ('con_ps_main', 'con_fw_main', 'con_ps_test');--> statement-breakpoint
UPDATE "products" SET "sample" = true WHERE "id" IN ('prd_shopwise', 'prd_ledgerpro', 'prd_ridenow');--> statement-breakpoint
UPDATE "audit_log" SET "sample" = true WHERE "actor_id" IS NULL AND "actor_name" IN ('Tunde Bello', 'Ada Okafor', 'Wanjiru Kamau');
