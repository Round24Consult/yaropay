CREATE TABLE "billing_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"invoice_id" text,
	"reference" text NOT NULL,
	"purpose" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"started_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_payment_methods" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"authorization_enc" text NOT NULL,
	"email" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"last4" text DEFAULT '' NOT NULL,
	"exp_month" text DEFAULT '' NOT NULL,
	"exp_year" text DEFAULT '' NOT NULL,
	"bank" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "past_due_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payment_methods" ADD CONSTRAINT "billing_payment_methods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payment_methods" ADD CONSTRAINT "billing_payment_methods_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charges_reference_key" ON "billing_charges" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "billing_charges_invoice_idx" ON "billing_charges" USING btree ("invoice_id");