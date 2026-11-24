CREATE TABLE "mcp_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"mode" text NOT NULL,
	"args" jsonb NOT NULL,
	"args_hash" text NOT NULL,
	"summary" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_ip" text,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "mcp_approvals" ADD CONSTRAINT "mcp_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_approvals" ADD CONSTRAINT "mcp_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_approvals" ADD CONSTRAINT "mcp_approvals_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."mcp_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_approvals_connection_idx" ON "mcp_approvals" USING btree ("connection_id","status");--> statement-breakpoint
CREATE INDEX "mcp_approvals_user_created_idx" ON "mcp_approvals" USING btree ("user_id","created_at");