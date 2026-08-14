-- P7-CLOSE review fix: success ↔ verified invariant on retention_runs.
-- A retention run may be recorded as `succeeded` ONLY when repository/chain
-- verification is `verified` AND it has a completion time. Previously `result`
-- and `verification_status` were validated as independent fields, so
-- `result='succeeded'` + `verification_status='failed'` could be stored and
-- then rendered as latestSuccessfulRetention — contradicting the table
-- docstring ("success = retention succeeded AND verification succeeded"). The
-- DB CHECK is the ultimate authority; the recording CLI and the repo's
-- latestSucceededRetention query mirror this invariant.
--
-- NULL-safe: `verification_status IS NOT DISTINCT FROM 'verified'` (NOT
-- `= 'verified'`) so a forged `succeeded` row cannot skip the requirement via a
-- NULL verification_status — `NULL = 'verified'` yields NULL, and a CHECK
-- treats NULL as PASS. `completed_at IS NOT NULL` is already NULL-safe.
-- Append-only: 0033 creates retention_runs on fresh DBs; this ALTER only adds
-- the cross-field CHECK (a distinct constraint name, so it cannot collide).

ALTER TABLE "retention_runs"
  ADD CONSTRAINT "retention_runs_success_verified_check"
  CHECK ("retention_runs"."result" <> 'succeeded' OR ("retention_runs"."verification_status" IS NOT DISTINCT FROM 'verified' AND "retention_runs"."completed_at" IS NOT NULL));
