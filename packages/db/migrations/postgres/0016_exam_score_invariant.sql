-- EXAM-SCORE-INV-1: enforce passing-score / total-score invariant.
--
-- Adds CHECK constraints so the database rejects any exam row where:
--   passing_score < 0
--   total_score <= 0
--   passing_score > total_score
--
-- Repair: clamp any legacy rows that violate the invariant before adding
-- constraints. Idempotent: safe to re-run if a prior attempt failed partway.

UPDATE "exams" SET "passing_score" = "total_score" WHERE "passing_score" > "total_score";
--> statement-breakpoint
UPDATE "exams" SET "passing_score" = 0 WHERE "passing_score" < 0;
--> statement-breakpoint
UPDATE "exams" SET "total_score" = 1 WHERE "total_score" <= 0;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "exams" ADD CONSTRAINT "exams_passing_score_min_check" CHECK ("passing_score" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "exams" ADD CONSTRAINT "exams_total_score_positive_check" CHECK ("total_score" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "exams" ADD CONSTRAINT "exams_passing_score_max_check" CHECK ("passing_score" <= "total_score");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
