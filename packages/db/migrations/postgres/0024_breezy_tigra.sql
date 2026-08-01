CREATE TABLE "exam_proctor_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"proctor_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_proctor_assignments_status_check" CHECK ("exam_proctor_assignments"."status" IN ('active', 'revoked')),
	CONSTRAINT "exam_proctor_assignments_revocation_shape_check" CHECK (
        (
          "exam_proctor_assignments"."status" = 'active'
          AND "exam_proctor_assignments"."revoked_at" IS NULL
          AND "exam_proctor_assignments"."revoked_by" IS NULL
        )
        OR
        (
          "exam_proctor_assignments"."status" = 'revoked'
          AND "exam_proctor_assignments"."revoked_at" IS NOT NULL
          AND "exam_proctor_assignments"."revoked_by" IS NOT NULL
        )
      )
);
--> statement-breakpoint
CREATE TABLE "exam_proctor_assignment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"command_type" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_proctor_assignment_events_command_type_check" CHECK ("exam_proctor_assignment_events"."command_type" IN ('assign', 'revoke')),
	CONSTRAINT "exam_proctor_assignment_events_outcome_check" CHECK ("exam_proctor_assignment_events"."outcome" IN ('applied', 'no_change'))
);
--> statement-breakpoint
-- Unique indexes MUST be created before the FKs that reference them
-- (PostgreSQL requires a unique index on the referenced columns).
CREATE UNIQUE INDEX "exam_proctor_assignments_org_id_unique" ON "exam_proctor_assignments" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_proctor_assignments_active_unique" ON "exam_proctor_assignments" USING btree ("organization_id","exam_id","proctor_user_id") WHERE "exam_proctor_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "exam_proctor_assignments_org_exam_status_idx" ON "exam_proctor_assignments" USING btree ("organization_id","exam_id","status");--> statement-breakpoint
CREATE INDEX "exam_proctor_assignments_org_proctor_status_idx" ON "exam_proctor_assignments" USING btree ("organization_id","proctor_user_id","status");--> statement-breakpoint
CREATE INDEX "exam_proctor_assignments_revoke_target_idx" ON "exam_proctor_assignments" USING btree ("organization_id","exam_id","proctor_user_id","status","revoked_at" DESC,"id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "exam_proctor_assignment_events_org_operation_unique" ON "exam_proctor_assignment_events" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE INDEX "exam_proctor_assignment_events_assignment_idx" ON "exam_proctor_assignment_events" USING btree ("organization_id","assignment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_org_id_unique" ON "exams" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "exam_proctor_assignment_events" ADD CONSTRAINT "exam_proctor_assignment_events_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignment_events" ADD CONSTRAINT "exam_proctor_assignment_events_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignment_events" ADD CONSTRAINT "exam_proctor_assignment_events_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "exam_proctor_assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_proctor_user_fk" FOREIGN KEY ("proctor_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_revoked_by_fk" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_exam_fk" FOREIGN KEY ("organization_id","exam_id") REFERENCES "exams"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
