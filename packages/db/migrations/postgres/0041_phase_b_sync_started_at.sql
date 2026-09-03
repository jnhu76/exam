-- 0041 — Phase B synchronized-start authority (#291): exams.sync_started_at.
--
-- Null = the operator has not triggered the synchronized sitting (timed_sync
-- only; non-sync exams stay permanently null). Written exactly once by the
-- canonical sync-start command (B2 slice); never reset — cancel/archive keep
-- it as history. No backfill: legacy and non-sync rows are null by default.
-- No CHECK: per-mode legality (duration/closeAt/strict/retake under
-- timed_sync) is owned by the canonical exam-policy validator in
-- @exam/exam-engine, the same split as migration 0040.
ALTER TABLE "exams" ADD COLUMN "sync_started_at" timestamp with time zone;
