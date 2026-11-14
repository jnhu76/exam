/**
 * Frozen W3 vocabulary of the API business operation spans (#964 W3, ADR-028
 * D3/D4).
 *
 * Every span name, attribute key, and attribute VALUE category the business
 * span layer can emit lives here. The vocabulary is deliberately closed:
 * error messages, raw payloads, answer content, URLs, and credentials have no
 * key they could travel under. Correlation attributes carry only server-side
 * bounded identifiers (UUIDs already validated by the route schemas, numeric
 * clientSeq, and fixed category unions re-exported from the domain/wire
 * contracts — never free text).
 *
 * Layer separation (single measurement, no second attribution vocabulary):
 * business spans name WHAT the operation did (`exam.attempt.*`); the DB
 * plugin's spans (#964 W2) name HOW the storage behaved (`db.*`). A business
 * span never records SQL, SQLSTATE, or connection-role facts, and a DB span
 * never records business outcome categories.
 *
 * Vocabulary freeze authority: W3 introduces the initial set; W4 freezes the
 * metric vocabulary next to the HTTP/DB ones (compat matrix §1). Renames
 * after the freeze are contract changes, not cleanups.
 */

/** Tracer instrumentation scope of the API business operation layer. */
export const BUSINESS_INSTRUMENTATION_SCOPE = "exam.api";

/** Candidate attempt start (POST /attempts/:examId/start). */
export const SPAN_ATTEMPT_START = "exam.attempt.start";
/** Answer save protocol (POST /attempts/:attemptId/answers/:questionId). */
export const SPAN_ATTEMPT_ANSWER_SAVE = "exam.attempt.answer_save";
/** Candidate submit + grade orchestration (POST /attempts/:attemptId/submit). */
export const SPAN_ATTEMPT_SUBMIT = "exam.attempt.submit";
/** Manual score entry (POST /admin/attempts/:attemptId/grade-question). */
export const SPAN_ATTEMPT_GRADE = "exam.attempt.grade";
/** Disrupted-attempt restore (POST /attempts/:attemptId/restore). */
export const SPAN_ATTEMPT_RESTORE = "exam.attempt.restore";
/** Operator time grant (POST /admin/attempts/:attemptId/time-grants). */
export const SPAN_ATTEMPT_TIME_GRANT = "exam.attempt.time_grant";
/** Operator force submit (POST /admin/attempts/:attemptId/force-submit). */
export const SPAN_ATTEMPT_FORCE_SUBMIT = "exam.attempt.force_submit";
/** Read-time deadline reconciliation (GET /candidate/attempts/:attemptId/take). */
export const SPAN_ATTEMPT_DEADLINE_RECONCILE =
  "exam.attempt.deadline_reconcile";
/** Background deadline auto-submit per attempt (deadlineScanner.autoSubmitAndGrade). */
export const SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT =
  "exam.attempt.deadline_auto_submit";

/** Union of the closed span-name vocabulary — call sites cannot invent a name. */
export type BusinessOperationSpanName =
  | typeof SPAN_ATTEMPT_START
  | typeof SPAN_ATTEMPT_ANSWER_SAVE
  | typeof SPAN_ATTEMPT_SUBMIT
  | typeof SPAN_ATTEMPT_GRADE
  | typeof SPAN_ATTEMPT_RESTORE
  | typeof SPAN_ATTEMPT_TIME_GRANT
  | typeof SPAN_ATTEMPT_FORCE_SUBMIT
  | typeof SPAN_ATTEMPT_DEADLINE_RECONCILE
  | typeof SPAN_ATTEMPT_DEADLINE_AUTO_SUBMIT;

/** Fixed outcome category — always present on a finished business span. */
export const ATTR_OP_OUTCOME = "exam.op.outcome";
/** Normalized wire error code (plugins/errors.ts classification) — rejected only. */
export const ATTR_OP_ERROR_CODE = "exam.op.error_code";
/** Attempt UUID the operation acted on (post-success for start). */
export const ATTR_OP_ATTEMPT_ID = "exam.op.attempt_id";
/** Exam UUID (start — the attempt id does not exist until the command returns). */
export const ATTR_OP_EXAM_ID = "exam.op.exam_id";
/** Question UUID (answer save, manual grade). */
export const ATTR_OP_QUESTION_ID = "exam.op.question_id";
/** Client save sequence number (answer save; numeric, bounded). */
export const ATTR_OP_CLIENT_SEQ = "exam.op.client_seq";
/** Client-generated command identity (time grant, force submit). */
export const ATTR_OP_OPERATION_ID = "exam.op.operation_id";
/**
 * The operation's own classified result fact, re-exported from the existing
 * domain/wire unions — present when the operation has more than one
 * legitimate success-shaped outcome or a value-shaped rejection reason.
 */
export const ATTR_OP_RESULT = "exam.op.result";

export const OUTCOME_SUCCESS = "success";
export const OUTCOME_REJECTED = "rejected";
/** Legitimate "nothing to do" result (e.g. stale deadline-scanner discovery). */
export const OUTCOME_NO_OP = "no_op";
export const OUTCOME_EXCEPTION = "exception";

// exam.op.result value sets — each re-uses an existing closed union verbatim.
/** start: mirrors the 201/200 response split (isNew). */
export const START_RESULT_NEW = "new_attempt";
export const START_RESULT_RESTORED = "restored";
/** answer save: accepted, or one of the SaveAnswerRejectReasonEnum values. */
export const SAVE_RESULT_ACCEPTED = "accepted";
/** restore: RestoreLifecycleOutcomeEnum, verbatim. */
/** time grant: TimeGrantResponse "outcome" union, verbatim (granted | idempotent_replay | terminal). */
/** force submit: AttemptCommandDisposition union, verbatim (applied | no_change | idempotent_replay). */
/** deadline reconcile (read-time): whether the read froze the attempt. */
export const RECONCILE_RESULT_FROZEN = "frozen";
export const RECONCILE_RESULT_UNCHANGED = "unchanged";
/** deadline auto-submit (background). */
export const AUTO_SUBMIT_RESULT_SUBMITTED = "submitted";
export const AUTO_SUBMIT_RESULT_SKIPPED = "skipped";
