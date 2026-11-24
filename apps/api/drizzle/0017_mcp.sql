CREATE TABLE "mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"client_id" text,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"live_allowed" boolean DEFAULT false NOT NULL,
	"live_allowed_at" timestamp with time zone,
	"product_ids" text[],
	"resource" text NOT NULL,
	"token_preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" text,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "mcp_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allowed_roles" text[] DEFAULT ARRAY['owner','admin','developer','finance','viewer']::text[] NOT NULL,
	"live_allowed" boolean DEFAULT false NOT NULL,
	"actions_allowed" boolean DEFAULT true NOT NULL,
	"share_customer_details" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" text
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" text,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" text,
	"user_id" text,
	"client_name" text NOT NULL,
	"tool" text NOT NULL,
	"mode" text,
	"outcome" text NOT NULL,
	"error_code" text,
	"approval_id" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_workspace_id_key" ON "mcp_connections" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_settings" ADD CONSTRAINT "mcp_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_settings" ADD CONSTRAINT "mcp_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."mcp_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_connections_user_idx" ON "mcp_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_token_hash_key" ON "mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_tokens_connection_idx" ON "mcp_tokens" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_workspace_at_idx" ON "mcp_tool_calls" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_connection_at_idx" ON "mcp_tool_calls" USING btree ("connection_id","at");--> statement-breakpoint
-- Plans that had every paid feature keep having every paid feature: AI apps (MCP) is added to them.
UPDATE "billing_plans" SET "features" = array_append("features", 'mcp')
WHERE NOT ('mcp' = ANY("features"))
  AND "features" @> ARRAY['multi_workspace','custom_roles','audit_export','sso','enforce_2fa','refunds','reconciliation','scheduled_reports','priority_support']::text[];
