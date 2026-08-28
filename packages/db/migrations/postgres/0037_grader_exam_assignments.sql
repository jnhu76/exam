CREATE TABLE "grader_exam_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"grader_user_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grader_exam_assignments_status_check" CHECK ("grader_exam_assignments"."status" IN ('active', 'revoked')),
	CONSTRAINT "grader_exam_assignments_revocation_shape_check" CHECK (
        (
          "grader_exam_assignments"."status" = 'active'
          AND "grader_exam_assignments"."revoked_at" IS NULL
          AND "grader_exam_assignments"."revoked_by" IS NULL
        )
        OR
        (
          "grader_exam_assignments"."status" = 'revoked'
          AND "grader_exam_assignments"."revoked_at" IS NOT NULL
          AND "grader_exam_assignments"."revoked_by" IS NOT NULL
        )
      )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "grader_exam_assignments_org_id_unique" ON "grader_exam_assignments" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "grader_exam_assignments_active_unique" ON "grader_exam_assignments" USING btree ("organization_id","grader_user_id","exam_id") WHERE "grader_exam_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "grader_exam_assignments_org_grader_status_idx" ON "grader_exam_assignments" USING btree ("organization_id","grader_user_id","status");--> statement-breakpoint
CREATE INDEX "grader_exam_assignments_org_exam_status_idx" ON "grader_exam_assignments" USING btree ("organization_id","exam_id","status");--> statement-breakpoint
ALTER TABLE "grader_exam_assignments" ADD CONSTRAINT "grader_exam_assignments_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_exam_assignments" ADD CONSTRAINT "grader_exam_assignments_grader_user_fk" FOREIGN KEY ("grader_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_exam_assignments" ADD CONSTRAINT "grader_exam_assignments_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_exam_assignments" ADD CONSTRAINT "grader_exam_assignments_revoked_by_fk" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_exam_assignments" ADD CONSTRAINT "grader_exam_assignments_exam_fk" FOREIGN KEY ("organization_id","exam_id") REFERENCES "exams"("organization_id","id") ON DELETE no action ON UPDATE no action;
