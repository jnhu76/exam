-- 0043 — Persisted-state contract hardening (#542, Phase A corrective).
--
-- Installs DB CHECK backstops for the four persisted status vocabularies:
--   exams.status / exam_enrollments.status / exam_attempts.status /
--   exam_attempts.grading_status
--
-- AUTHORITY SPLIT (unchanged by this migration): the engine state machines
-- (EXAM_VALID_TRANSITIONS, ENROLLMENT_VALID_TRANSITIONS, the attempt
-- TRANSITION_TABLE + locked commands) remain the ONLY transition authority.
-- These CHECKs bound the stored VALUE SET only — they do not encode the
-- transition graph. Allowed sets mirror the @exam/domain enums; drift between
-- the two is caught by the packages/db status-contract test.
--
-- `grading` is deliberately ABSENT from exam_attempts_status_check: older
-- production code briefly persisted `status='grading'` as a durable intermediate
-- during automatic grading (submitted → grading → graded); the #J2 lifecycle
-- convergence removed that writer (terminal grading now persists submitted → graded
-- in ONE locked transaction) and #542 removed the value from the runtime
-- vocabulary. Legacy rows from that historical window may still exist. The
-- reserved targets
-- not_started / queued / voided (attempt) and blocked (enrollment) stay
-- legal: they are documented target-design vocabulary (docs/SPEC.md §2.2),
-- not fossils.
--
-- MIGRATION SAFETY — FAIL CLOSED: the preflight counts rows whose status lies
-- outside the accepted vocabulary and REFUSES to install the CHECKs when any
-- exist (e.g. a legacy `status='grading'` row from deployments that ran the
-- original grading engine). Unknown values are NEVER rewritten, coerced, or
-- deleted here. If this migration raises, disposition the offending rows
-- explicitly first, then re-run. A NULL grading_status is legal and passes
-- untouched (legacy rows are classified at read time, never rewritten).
--
-- ── OPERATOR RUNBOOK (when 0043 preflight raises) ─────────────────────────
--
-- CONTEXT — the historical writer (proven from commit 795c6c64 through the
-- commit that removed it; window 2026-06-01 → 2026-06-14):
--
--   WRITE 1  UPDATE exam_attempts SET status='grading'        (own autocommit)
--   compute  pure in-memory scoring — no DB writes
--   WRITE 2  UPDATE exam_attempts SET status='graded',
--            grading_result=..., total_score=..., passed=...,
--            graded_at=...                                    (ONE statement)
--   WRITE 3  UPDATE exam_enrollments SET ...                  (own autocommit)
--
-- WRITE 2 was a single atomic UPDATE: status and all four terminal facts
-- always committed together or not at all. Grading entered only from
-- `submitted` (the guard), nothing else ever wrote the terminal-fact columns,
-- and a stuck `grading` row had no re-entry path in that code. Therefore:
--
--   PROVEN crash residue:  status='grading' AND total_score IS NULL AND
--                          passed IS NULL AND grading_result IS NULL AND
--                          graded_at IS NULL
--   (WRITE 1 committed; the process died before WRITE 2.)
--
--   CONTRADICTORY data:    status='grading' with ANY terminal fact non-NULL.
--   No single-writer sequential run can produce this (WRITE 2 is atomic and
--   no migration touches those columns); the only theoretical producer is
--   the historical system itself under an unprotected concurrent
--   double-grade interleaving in the pre-lock async window (two submits of
--   one attempt both passing the guard; one run's WRITE 1 landing after the
--   other's WRITE 2 and dying before its own). Whether any deployment ever
--   hit that race is UNPROVEN. Do NOT disposition such a row with the
--   recipes below — investigate its actual origin first (audit logs,
--   backups, the race above, manual edits). #542 provides no scripted
--   conversion for it, including NO scripted promotion to 'graded'.
--
-- IDENTIFY legacy rows (note: the physical score column is total_score):
--   SELECT id, status, total_score, passed,
--          grading_result IS NOT NULL AS has_result,
--          graded_at IS NOT NULL AS has_graded_at, grading_status
--   FROM exam_attempts WHERE status = 'grading';
--
-- SUPPORTED DISPOSITIONS (proven residue only) — OFFLINE LEGACY DATA REPAIR
-- EXCEPTION: manual, bounded (WHERE status='grading'), one-time legacy data
-- repair performed by an operator at migration time. NOT a runtime transition,
-- NOT callable by any code path, and NOT reusable as a business transition.
-- The engine transition authority is unchanged; none of these statements is
-- part of the lifecycle state machine.
--
--   Option A — recover as submitted (default):
--     UPDATE exam_attempts SET status='submitted'
--     WHERE id='...' AND status='grading';
--     Restores the row to the state the historical writer's own guard proves
--     it held ('grading' was entered only from 'submitted'). No terminal
--     facts are fabricated. Afterward: re-run this migration, then run
--     `pnpm --filter @exam/api backfill:submitted-answers` (the row is in
--     scope as submitted-with-submittedAt). The row remains an observable
--     non-terminal state (with the migration-default grading_status=
--     'auto_graded', GET /api/system/diagnostics reports it read-only as
--     submitted_not_terminalized); #542 does NOT auto-terminalize it —
--     business closure happens through the normal grading surfaces.
--
--   Option B — void (only when the business decides the attempt must not
--   count):
--     UPDATE exam_attempts SET status='voided'
--     WHERE id='...' AND status='grading';
--     `voided` keeps its documented business meaning (attempt invalidation;
--     SPEC §2.2 planned voidAttempt semantics). Applying it here is the same
--     offline repair exception — it is NOT a new runtime quarantine label.
--     Terminal; submitted answers are still frozen by the backfill
--     (voided-with-submittedAt carries submit semantics), preserving the
--     candidate's submission record.
--
-- ENROLLMENT NOTE: the historical writer's enrollment projection (WRITE 3)
-- was a separate autocommit, so pre-existing databases may independently hold
-- `graded` attempts with a stale enrollment — an older anomaly class that
-- predates #542. It is NOT surfaced by the read-only integrity diagnostics
-- (GET /api/system/diagnostics detects submitted_not_terminalized and
-- submitted_workset_mismatch only — not graded-with-stale-enrollment).
-- Neither disposition above creates or worsens it: 'submitted' and 'voided'
-- are legal non-fabricated states, and no #542-documented path ever writes
-- terminal grading facts offline.
--
-- After disposition, re-run this migration. The preflight will pass and
-- the CHECK constraints will be installed.
-- ── END OPERATOR RECOVERY RUNBOOK ──────────────────────────────────────
-- BEGIN 0043_PREFLIGHT
DO $$
DECLARE
  bad_exams integer;
  bad_enrollments integer;
  bad_attempts integer;
  bad_grading_status integer;
BEGIN
  SELECT count(*) INTO bad_exams FROM "exams"
    WHERE "status" NOT IN ('draft', 'published', 'open', 'closed', 'canceled', 'archived');
  IF bad_exams > 0 THEN
    RAISE EXCEPTION '0043 preflight: exams.status has % row(s) outside the accepted vocabulary (draft/published/open/closed/canceled/archived) — refusing to install exams_status_check; disposition the rows explicitly first (no silent rewrite)', bad_exams;
  END IF;

  SELECT count(*) INTO bad_enrollments FROM "exam_enrollments"
    WHERE "status" NOT IN ('assigned', 'started', 'completed', 'blocked');
  IF bad_enrollments > 0 THEN
    RAISE EXCEPTION '0043 preflight: exam_enrollments.status has % row(s) outside the accepted vocabulary (assigned/started/completed/blocked) — refusing to install exam_enrollments_status_check; disposition the rows explicitly first (no silent rewrite)', bad_enrollments;
  END IF;

  SELECT count(*) INTO bad_attempts FROM "exam_attempts"
    WHERE "status" NOT IN ('not_started', 'queued', 'in_progress', 'disrupted', 'submitted', 'graded', 'voided');
  IF bad_attempts > 0 THEN
    RAISE EXCEPTION '0043 preflight: exam_attempts.status has % row(s) outside the accepted vocabulary (not_started/queued/in_progress/disrupted/submitted/graded/voided) — includes any legacy status=''grading'' crash residue from pre-#J2 deployments (#542 removed that value from the runtime vocabulary). Unknown values are never rewritten here. Disposition the rows explicitly per the operator runbook in this file''s header (manual, migration-time-only repair; no scripted semantic conversion), then re-run this migration.', bad_attempts;
  END IF;

  SELECT count(*) INTO bad_grading_status FROM "exam_attempts"
    WHERE "grading_status" IS NOT NULL
      AND "grading_status" NOT IN ('auto_graded', 'pending_manual', 'fully_graded');
  IF bad_grading_status > 0 THEN
    RAISE EXCEPTION '0043 preflight: exam_attempts.grading_status has % row(s) outside the accepted vocabulary (auto_graded/pending_manual/fully_graded; NULL is legal) — refusing to install exam_attempts_grading_status_check; disposition the rows explicitly first (no silent rewrite)', bad_grading_status;
  END IF;
END
$$;
-- END 0043_PREFLIGHT --> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_status_check" CHECK ("exams"."status" IN ('draft', 'published', 'open', 'closed', 'canceled', 'archived'));--> statement-breakpoint
ALTER TABLE "exam_enrollments" ADD CONSTRAINT "exam_enrollments_status_check" CHECK ("exam_enrollments"."status" IN ('assigned', 'started', 'completed', 'blocked'));--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_status_check" CHECK ("exam_attempts"."status" IN ('not_started', 'queued', 'in_progress', 'disrupted', 'submitted', 'graded', 'voided'));--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_grading_status_check" CHECK ("exam_attempts"."grading_status" IN ('auto_graded', 'pending_manual', 'fully_graded'));
