ALTER TABLE "exams" ADD COLUMN "result_publication_mode" text DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "results_published_at" timestamp with time zone;--> statement-breakpoint
-- P2D-J5a backfill: derive result_publication_mode from the legacy
-- ControlFlags.showResultImmediately flag stored in the control_flags jsonb
-- column. true → 'immediate' (default, no-op for rows inserted after this
-- migration since the column default already sets 'immediate'); false →
-- 'manual' (the closest pre-mode analog: results hidden until acted on).
UPDATE "exams" SET "result_publication_mode" =
  CASE WHEN (control_flags->>'showResultImmediately')::boolean
       THEN 'immediate'
       ELSE 'manual'
  END;