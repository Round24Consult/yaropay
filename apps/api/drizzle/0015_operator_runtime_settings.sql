ALTER TABLE "settings" ADD COLUMN "gateway_timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "webhook_timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "session_days" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "password_hash_cost" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "log_level" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "worker_interval_ms" integer;