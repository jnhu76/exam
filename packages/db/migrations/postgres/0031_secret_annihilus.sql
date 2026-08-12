CREATE TABLE "backup_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"backup_type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"artifact_label" text,
	"artifact_size_bytes" bigint,
	"verification_method" text,
	"verification_status" text,
	"verified_at" timestamp with time zone,
	"failure_reason" text,
	"executor_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_runs_status_check" CHECK ("backup_runs"."status" IN ('running', 'succeeded', 'failed', 'abandoned')),
	CONSTRAINT "backup_runs_type_check" CHECK ("backup_runs"."backup_type" IN ('logical', 'physical_base', 'cold_filesystem')),
	CONSTRAINT "backup_runs_verification_status_check" CHECK ("backup_runs"."verification_status" IN ('verified', 'failed', 'pending')),
	CONSTRAINT "backup_runs_success_verified_check" CHECK (("backup_runs"."status" <> 'succeeded' OR ("backup_runs"."verification_status" IS NOT NULL AND "backup_runs"."verification_status" = 'verified')))
);
--> statement-breakpoint
CREATE TABLE "backup_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_run_events_type_check" CHECK ("backup_run_events"."event_type" IN ('started', 'succeeded', 'failed', 'abandoned', 'duplicate_rejected'))
);
--> statement-breakpoint
CREATE TABLE "restore_drill_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"backup_type" text NOT NULL,
	"result" text NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" bigint,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restore_drill_runs_result_check" CHECK ("restore_drill_runs"."result" IN ('succeeded', 'failed')),
	CONSTRAINT "restore_drill_runs_source_check" CHECK ("restore_drill_runs"."source" IN ('automated', 'operator_declared'))
);
--> statement-breakpoint
ALTER TABLE "backup_run_events" ADD CONSTRAINT "backup_run_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run_events" ADD CONSTRAINT "backup_run_events_run_id_backup_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "backup_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drill_runs" ADD CONSTRAINT "restore_drill_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_run_events_org_run_idx" ON "backup_run_events" USING btree ("organization_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_org_operation_succeeded_unique" ON "backup_runs" USING btree ("organization_id","operation_id") WHERE status = 'succeeded';--> statement-breakpoint
CREATE INDEX "backup_runs_org_started_idx" ON "backup_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "restore_drill_runs_org_operation_unique" ON "restore_drill_runs" USING btree ("organization_id","operation_id");