CREATE UNIQUE INDEX "courses_org_id_unique" ON "courses" USING btree ("organization_id","id");--> statement-breakpoint
CREATE TABLE "teacher_course_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"teacher_user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_course_assignments_status_check" CHECK ("teacher_course_assignments"."status" IN ('active', 'revoked')),
	CONSTRAINT "teacher_course_assignments_revocation_shape_check" CHECK (
        (
          "teacher_course_assignments"."status" = 'active'
          AND "teacher_course_assignments"."revoked_at" IS NULL
          AND "teacher_course_assignments"."revoked_by" IS NULL
        )
        OR
        (
          "teacher_course_assignments"."status" = 'revoked'
          AND "teacher_course_assignments"."revoked_at" IS NOT NULL
          AND "teacher_course_assignments"."revoked_by" IS NOT NULL
        )
      )
);
--> statement-breakpoint
-- Unique indexes MUST be created before the FKs that reference them
-- (PostgreSQL requires a unique index on the referenced columns).
CREATE UNIQUE INDEX "teacher_course_assignments_org_id_unique" ON "teacher_course_assignments" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_course_assignments_active_unique" ON "teacher_course_assignments" USING btree ("organization_id","teacher_user_id","course_id") WHERE "teacher_course_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "teacher_course_assignments_org_teacher_status_idx" ON "teacher_course_assignments" USING btree ("organization_id","teacher_user_id","status");--> statement-breakpoint
CREATE INDEX "teacher_course_assignments_org_course_status_idx" ON "teacher_course_assignments" USING btree ("organization_id","course_id","status");--> statement-breakpoint
ALTER TABLE "teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_teacher_user_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_revoked_by_fk" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_course_fk" FOREIGN KEY ("organization_id","course_id") REFERENCES "courses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint