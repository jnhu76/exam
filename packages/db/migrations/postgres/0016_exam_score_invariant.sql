-- EXAM-SCORE-INV-1: enforce passing-score / total-score invariant.
--
-- Adds CHECK constraints so the database rejects any exam row where:
--   passing_score < 0
--   total_score <= 0
--   passing_score > total_score
--
-- Fail-closed: if invalid historical rows exist the migration fails and
-- the operator must resolve them explicitly. No silent data modification.

ALTER TABLE "exams" ADD CONSTRAINT "exams_passing_score_min_check" CHECK ("passing_score" >= 0);
--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_total_score_positive_check" CHECK ("total_score" > 0);
--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_passing_score_max_check" CHECK ("passing_score" <= "total_score");
