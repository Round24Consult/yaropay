ALTER TABLE "settings" ADD COLUMN "billing_paystack_secret_key_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smtp_url_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "mail_from" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "v1_rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "operator_updated_at" timestamp with time zone;--> statement-breakpoint
-- Gateways are free in every edition: plans saved with "more_gateways" drop it.
UPDATE "billing_plans" SET "features" = array_remove("features", 'more_gateways');
