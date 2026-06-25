CREATE TABLE "client_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"attempt_id" text,
	"exam_id" text,
	"question_id" text,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"name" text NOT NULL,
	"route" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_session_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_events_org_received_at_idx" ON "client_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "client_events_org_kind_received_at_idx" ON "client_events" USING btree ("organization_id","kind","received_at");--> statement-breakpoint
CREATE INDEX "client_events_org_attempt_received_at_idx" ON "client_events" USING btree ("organization_id","attempt_id","received_at");--> statement-breakpoint
CREATE INDEX "client_events_org_exam_received_at_idx" ON "client_events" USING btree ("organization_id","exam_id","received_at");--> statement-breakpoint
CREATE INDEX "client_events_org_name_received_at_idx" ON "client_events" USING btree ("organization_id","name","received_at");
