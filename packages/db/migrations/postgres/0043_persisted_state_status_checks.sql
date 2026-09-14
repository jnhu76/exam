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
-- ── OPERATOR RECOVERY RUNBOOK (when 0043 preflight raises) ──────────────
--
-- If this migration raises with "0043 preflight: exam_attempts.status has N
-- row(s) outside the accepted vocabulary", the operator must disposition
-- those rows before re-running. Legacy `grading` rows are crash residues:
-- the old gradeAttempt wrote status='grading' then crashed before writing
-- status='graded' with terminal facts (score, passed, gradingResult,
-- gradedAt). Two populations exist:
--
--   SAFE CANDIDATE (rare): the second write succeeded before the crash —
--   all of score, passed, gradingResult, gradedAt are non-NULL.
--   Disposition: UPDATE exam_attempts SET status = 'graded' WHERE id = '...';
--   then run `pnpm --filter @exam/api backfill:submitted-answers` to
--   populate submitted_answers from draft answers.
--
--   CRASH RESIDUE (common): score, passed, gradingResult, or gradedAt is
--   NULL — grading never completed. Do NOT set status='graded' (this
--   creates a zombie terminal with no scoring facts and a stale enrollment
--   projection). Instead:
--     Option A (recommended): SET status = 'voided' — marks the row as
--       known-bad without fabricating terminal semantics.
--     Option B: re-grade through the grading engine by setting status back
--       to 'submitted' and triggering the grading pipeline (requires the
--       grading workset to be present or reconstructed).
--
-- IDENTIFY the two populations:
--   SELECT id, status, score, passed, grading_result IS NOT NULL AS has_result,
--          graded_at IS NOT NULL AS has_graded_at, grading_status
--   FROM exam_attempts WHERE status = 'grading';
--
-- SAFE CANDIDATE predicate:
--   score IS NOT NULL AND passed IS NOT NULL
--   AND grading_result IS NOT NULL AND graded_at IS NOT NULL
--
-- CRASH RESIDUE predicate:
--   score IS NULL OR passed IS NULL
--   OR grading_result IS NULL OR graded_at IS NULL
--
-- After disposition, re-run this migration. The preflight will pass and
-- the CHECK constraints will be installed.
--
-- KNOWN GAP: dispositioning to 'graded' does NOT fix the enrollment
-- projection (finalScore, finalPassed, finalAttemptId remain NULL). The
-- grading engine's idempotency guard prevents re-entry on an already-
-- graded attempt. This is a follow-up concern, not a migration blocker.
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
    RAISE EXCEPTION '0043 preflight: exam_attempts.status has % row(s) outside the accepted vocabulary (not_started/queued/in_progress/disrupted/submitted/graded/voided) — includes any legacy status=''grading'' row from pre-#J2 deployments (#542 removed that fossil). Disposition the rows explicitly first (no silent rewrite), then re-run this migration. Safe candidates: rows with completed score/gradedAt fields. Quarantine: rows with absent score fields (incomplete grading — re-grade or void).', bad_attempts;
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
