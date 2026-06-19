ALTER TABLE "exams" ADD COLUMN "latest_start_offset_minutes" integer;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "min_submit_after_start_minutes" integer;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_latest_start_offset_minutes_check" CHECK ("latest_start_offset_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_min_submit_after_start_minutes_check" CHECK ("min_submit_after_start_minutes" >= 0);