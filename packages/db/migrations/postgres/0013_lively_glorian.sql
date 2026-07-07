CREATE TABLE "attempt_grading_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"grading_mode" text NOT NULL,
	"status" text NOT NULL,
	"max_score" double precision NOT NULL,
	"earned_score" double precision,
	"candidate_answer" jsonb,
	"standard_answer" jsonb,
	"correct" boolean,
	"comment" text DEFAULT '' NOT NULL,
	"graded_by" text,
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_grading_entries_mode_check" CHECK ("attempt_grading_entries"."grading_mode" IN ('auto', 'manual')),
	CONSTRAINT "attempt_grading_entries_status_check" CHECK ("attempt_grading_entries"."status" IN ('completed_auto', 'pending_manual', 'completed_manual')),
	CONSTRAINT "attempt_grading_entries_max_score_check" CHECK ("attempt_grading_entries"."max_score" >= 0),
	CONSTRAINT "attempt_grading_entries_earned_score_check" CHECK ("attempt_grading_entries"."earned_score" >= 0),
	CONSTRAINT "attempt_grading_entries_earned_score_limit_check" CHECK ("attempt_grading_entries"."earned_score" <= "attempt_grading_entries"."max_score")
);
--> statement-breakpoint
ALTER TABLE "attempt_grading_entries" ADD CONSTRAINT "attempt_grading_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_grading_entries" ADD CONSTRAINT "attempt_grading_entries_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_grading_entries_attempt_question_unique" ON "attempt_grading_entries" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE INDEX "attempt_grading_entries_queue_index" ON "attempt_grading_entries" USING btree ("organization_id","status");