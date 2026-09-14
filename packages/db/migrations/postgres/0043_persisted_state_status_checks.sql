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
-- `grading` is deliberately ABSENT from exam_attempts_status_check: it was an
-- unreachable fossil (no production writer since the #J2 lifecycle converged;
-- terminal grading persists submitted → graded in ONE locked transaction and
-- the durable grading-pipeline state is grading_status, P2D-J2). It was
-- removed from the runtime vocabulary in #542. The reserved targets
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
    RAISE EXCEPTION '0043 preflight: exam_attempts.status has % row(s) outside the accepted vocabulary (not_started/queued/in_progress/disrupted/submitted/graded/voided) — includes any legacy status=''grading'' row (#542 removed that fossil); disposition the rows explicitly first (no silent rewrite)', bad_attempts;
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
