CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_attempts_check" CHECK ("email_outbox"."attempts" >= 0),
	CONSTRAINT "email_outbox_max_attempts_check" CHECK ("email_outbox"."max_attempts" >= 1)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_org_status_retry_idx" ON "email_outbox" USING btree ("organization_id","status","next_retry_at");--> statement-breakpoint
CREATE INDEX "email_outbox_org_created_at_idx" ON "email_outbox" USING btree ("organization_id","created_at");
