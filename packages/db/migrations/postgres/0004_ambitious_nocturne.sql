CREATE TABLE "manual_grading_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"score" double precision NOT NULL,
	"max_score" double precision NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"graded_by" text NOT NULL,
	"graded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN "grading_status" text;--> statement-breakpoint
ALTER TABLE "manual_grading_entries" ADD CONSTRAINT "manual_grading_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_grading_entries" ADD CONSTRAINT "manual_grading_entries_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_grading_entries_attempt_question_unique" ON "manual_grading_entries" USING btree ("attempt_id","question_id");--> statement-breakpoint
-- P2D-J2 backfill: all pre-existing attempts were graded by the auto-grading
-- engine, so their grading_status is 'auto_graded'. Kept nullable rather than
-- SET NOT NULL to avoid a two-step migration; the application boundary defaults
-- to 'auto_graded' for any residual NULL.
UPDATE "exam_attempts" SET "grading_status" = 'auto_graded' WHERE "grading_status" IS NULL;