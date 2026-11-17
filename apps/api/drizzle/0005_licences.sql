CREATE TABLE "licences" (
	"id" text PRIMARY KEY NOT NULL,
	"licence_id" text NOT NULL,
	"key" text NOT NULL,
	"customer" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"installed_by" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "licences" ADD CONSTRAINT "licences_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;