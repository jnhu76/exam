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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_grading_entries_score_check" CHECK ("manual_grading_entries"."score" >= 0),
	CONSTRAINT "manual_grading_entries_max_score_check" CHECK ("manual_grading_entries"."max_score" >= 0),
	CONSTRAINT "manual_grading_entries_score_limit_check" CHECK ("manual_grading_entries"."score" <= "manual_grading_entries"."max_score")
);
--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN "grading_status" text DEFAULT 'auto_graded';--> statement-breakpoint
ALTER TABLE "manual_grading_entries" ADD CONSTRAINT "manual_grading_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_grading_entries" ADD CONSTRAINT "manual_grading_entries_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_grading_entries_attempt_question_unique" ON "manual_grading_entries" USING btree ("attempt_id","question_id");--> statement-breakpoint
-- P2D-J2 backfill: all pre-existing attempts were graded by the auto-grading
-- engine, so their grading_status is 'auto_graded'. The column default also
-- sets this for new rows; this UPDATE covers rows that pre-date the column.
UPDATE "exam_attempts" SET "grading_status" = 'auto_graded' WHERE "grading_status" IS NULL;