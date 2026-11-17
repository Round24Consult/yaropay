CREATE TABLE "trusted_browsers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trusted_browsers" ADD CONSTRAINT "trusted_browsers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_browsers_token_hash_key" ON "trusted_browsers" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "trusted_browsers_user_idx" ON "trusted_browsers" USING btree ("user_id");