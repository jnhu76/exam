ALTER TABLE "exam_attempts" ADD COLUMN "submitted_answers" jsonb;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN "submission_reason" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "rubric" text;