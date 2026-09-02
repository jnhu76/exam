-- 0040 — Phase A timing modes (#291): nullable duration/closeAt + profile
-- timing_mode.
--
-- exams.duration_minutes: null = no personal time limit (deadline / untimed
-- modes). Existing timed_window rows keep their value — no rewrite.
-- exams.close_at: null = open-ended (untimed only). Existing rows unchanged.
-- Per-mode legality (which combination is valid) is owned by the canonical
-- exam-policy validator in @exam/exam-engine; the DB only stores the columns.
--
-- exam_policy_profiles.timing_mode: the timing mode a profile defaults to.
-- NOT NULL with a 'timed_window' default so existing profiles stay valid
-- untouched. CHECK restricts profiles to the Phase A authoring modes — a
-- profile must never promise timed_sync while its admission runtime is
-- unimplemented. duration_minutes drops NOT NULL so deadline/untimed
-- profiles can carry the semantic null (the >0 CHECK still rejects explicit
-- zero/negative values; NULL is unaffected by CHECK in PostgreSQL).
ALTER TABLE "exams" ALTER COLUMN "duration_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ALTER COLUMN "close_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_policy_profiles" ADD COLUMN "timing_mode" text NOT NULL DEFAULT 'timed_window';--> statement-breakpoint
ALTER TABLE "exam_policy_profiles" ALTER COLUMN "duration_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_policy_profiles" ADD CONSTRAINT "exam_policy_profiles_timing_mode_check" CHECK ("exam_policy_profiles"."timing_mode" in ('timed_window', 'deadline', 'untimed'));
