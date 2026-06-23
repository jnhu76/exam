CREATE TABLE "import_job_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"total" integer NOT NULL,
	"created_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"errors" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors_detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_job_logs" ADD CONSTRAINT "import_job_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_job_logs_org_created_at_idx" ON "import_job_logs" USING btree ("organization_id","created_at");