ALTER TABLE "sessions" ADD COLUMN "support_workspace_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "support_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "support_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_support_workspace_id_workspaces_id_fk" FOREIGN KEY ("support_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;