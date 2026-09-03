/** Base application error with an error code, HTTP status, and optional details. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 500,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input validation failure (HTTP 400). */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

/** Requested entity not found (HTTP 404). */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
  }
}

/** Attempted state transition is not allowed for the current entity state (HTTP 409). */
export class InvalidStateTransitionError extends AppError {
  constructor(message: string) {
    super(message, "INVALID_STATE_TRANSITION", 409);
  }
}

/** Caller lacks the required permission (HTTP 403). */
export class PermissionDeniedError extends AppError {
  constructor(message = "Permission denied") {
    super(message, "PERMISSION_DENIED", 403);
  }
}

/** Caller attempted to access a resource outside their organization boundary (HTTP 403). */
export class TenantAccessDeniedError extends AppError {
  constructor(message = "Tenant access denied") {
    super(message, "TENANT_ACCESS_DENIED", 403);
  }
}

/** Attempt to start an exam that has already been started (HTTP 409). */
export class AttemptAlreadyStartedError extends AppError {
  constructor(message = "Attempt already started") {
    super(message, "ATTEMPT_ALREADY_STARTED", 409);
  }
}

/** Attempt to act on an attempt that is already closed or submitted (HTTP 409). */
export class AttemptClosedError extends AppError {
  constructor(message = "Attempt is closed") {
    super(message, "ATTEMPT_CLOSED", 409);
  }
}

/** Answer save rejected because the client's base version does not match the server (HTTP 409). */
export class AnswerVersionConflictError extends AppError {
  constructor(message = "Answer version conflict") {
    super(message, "ANSWER_VERSION_CONFLICT", 409);
  }
}

/** Exam is not in an open state for the requested operation (HTTP 409). */
export class ExamNotOpenError extends AppError {
  constructor(message = "Exam is not open") {
    super(message, "EXAM_NOT_OPEN", 409);
  }
}

/** Attempt deadline has already passed (HTTP 409). */
export class AttemptDeadlineExceededError extends AppError {
  constructor(message = "Attempt deadline exceeded") {
    super(message, "ATTEMPT_DEADLINE_EXCEEDED", 409);
  }
}

/** Generic conflict error (HTTP 409) when no more specific error applies. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

/**
 * The same stable `operationId` was replayed with a differing payload (HTTP 409).
 *
 * Used by idempotency-keyed commands where `operationId` is command identity,
 * not a dedupe field: the same identity plus the same payload returns the
 * committed result, while the same identity plus a different payload is a
 * conflict (ADR-013 §9).
 */
export class IdempotencyConflictError extends AppError {
  constructor(message = "Operation id reused with a different payload") {
    super(message, "IDEMPOTENCY_CONFLICT", 409);
  }
}

/** User with the same username already exists (HTTP 409). */
export class UserAlreadyExistsError extends AppError {
  constructor(message = "User already exists") {
    super(message, "USER_ALREADY_EXISTS", 409);
  }
}

/**
 * A first-install bootstrap lost the "exactly one first Admin" race: an
 * active Admin already exists in the organization (HTTP 409).
 *
 * Thrown by the canonical bootstrap mutation when the transaction-scoped
 * advisory lock serialization reveals a winner already committed. The
 * Launchpad HTTP adapter maps this expected loser to
 * `LAUNCHPAD_ALREADY_INITIALIZED`; the CLI surfaces the message as-is.
 */
export class AdminAlreadyExistsError extends AppError {
  constructor(message = "An active Admin already exists in this organization") {
    super(message, "ADMIN_ALREADY_EXISTS", 409);
  }
}

/**
 * Operational policy intent version conflict (P7-E3, HTTP 409). The Admin's
 * intent record was modified concurrently — the client must re-read the
 * current version (CAS) and retry.
 */
export class OpsPolicyVersionConflictError extends AppError {
  constructor(message = "Operational policy intent was modified concurrently") {
    super(message, "OPS_POLICY_VERSION_CONFLICT", 409);
  }
}

/** Candidate identity field value conflicts with an existing candidate (HTTP 409). */
export class CandidateIdentityConflictError extends AppError {
  constructor(message = "Candidate identity already exists") {
    super(message, "CANDIDATE_IDENTITY_CONFLICT", 409);
  }
}

/** Exam is already published and cannot be edited (HTTP 409). */
export class ExamAlreadyPublishedError extends AppError {
  constructor(message = "Exam already published") {
    super(message, "EXAM_ALREADY_PUBLISHED", 409);
  }
}

/** Exam is not in draft status for the requested operation (HTTP 409). */
export class ExamNotDraftError extends AppError {
  constructor(message = "Exam is not in draft status") {
    super(message, "EXAM_NOT_DRAFT", 409);
  }
}

/**
 * Admin close is not allowed for the requested exam (HTTP 409).
 *
 * ADR-005 Slice 1 §3.3 / review decision #3: `POST /exams/:id/close` is
 * allowed only from `open`. It is rejected for any other status, or for an
 * `open` exam that still has unresolved attempts. The `details.reason`
 * discriminates the two cases:
 *   - `UNRESOLVED_ATTEMPTS_EXIST` — active/in-flight attempts remain; the
 *     admin must let them finalize (candidate submit, deadline scanner, or a
 *     future force-submit) before close.
 *   - omitted — the exam is not in an `open` (or already-`closed`) state.
 */
export class ExamCloseNotAllowedError extends AppError {
  constructor(
    details?: {
      reason?: "UNRESOLVED_ATTEMPTS_EXIST";
      activeAttemptCount?: number;
    },
    message = "Exam close is not allowed",
  ) {
    super(message, "EXAM_CLOSE_NOT_ALLOWED", 409, details);
  }
}

/**
 * Admin archive is not allowed for the requested exam (HTTP 409).
 *
 * ADR-005 construction hard rule (applied to archive per P2B-J2 follow-up #3):
 * `POST /exams/:id/archive` is allowed only from `published | closed | canceled`
 * (after reconciliation). `draft | open | archived` are rejected. Stale-state
 * protection: a draft exam whose openAt already passed still reconciles to
 * `open`/`published`-then-`open`, not a directly archivable state.
 */
export class ExamArchiveNotAllowedError extends AppError {
  constructor(message = "Exam archive is not allowed") {
    super(message, "EXAM_ARCHIVE_NOT_ALLOWED", 409);
  }
}

/**
 * Admin unpublish is not allowed for the requested exam (HTTP 409).
 *
 * ADR-005 Slice 2 §3.2: `POST /exams/:id/unpublish` is allowed only from
 * `published` AND only if, after reconciliation, the exam is still `published`
 * (now < openAt). Stale-state protection: a published exam whose openAt already
 * passed has reconciled to `open` and cannot be rewound to draft.
 */
export class ExamUnpublishNotAllowedError extends AppError {
  constructor(message = "Exam unpublish is not allowed") {
    super(message, "EXAM_UNPUBLISH_NOT_ALLOWED", 409);
  }
}

/**
 * Admin extend is not allowed for the requested exam (HTTP 409).
 *
 * ADR-005 Slice 2 §3.4: `POST /exams/:id/extend` is allowed only for an `open`
 * exam whose closeAt has not yet elapsed (after reconciliation). Stale-state
 * protection: an open exam whose closeAt already passed has reconciled to
 * `closed` and cannot be revived by extending closeAt.
 */
export class ExamExtendNotAllowedError extends AppError {
  constructor(
    details?: { reason?: "NOT_OPEN" | "ALREADY_CLOSED" },
    message = "Exam extend is not allowed",
  ) {
    super(message, "EXAM_EXTEND_NOT_ALLOWED", 409, details);
  }
}

/**
 * Admin PATCH is not allowed for the requested exam state (HTTP 409).
 *
 * ADR-005 Slice 2 §3.7: generic PATCH is allowed in `draft` (full edit) and
 * `published` (schedule fields only: openAt/closeAt). It is rejected for
 * `open|closed|canceled|archived` — use the dedicated operations instead.
 */
export class ExamUpdateNotAllowedError extends AppError {
  constructor(message = "Exam update is not allowed in this state") {
    super(message, "EXAM_UPDATE_NOT_ALLOWED", 409);
  }
}

/**
 * Admin cancel is not allowed for the requested exam (HTTP 409).
 *
 * ADR-005 Slice 4 (cancel-minimal) §3.5: `POST /exams/:id/cancel` is allowed
 * from `published` and from `open` only when no unfinalized attempts remain.
 * `details.reason = UNRESOLVED_ATTEMPTS_EXIST` (with activeAttemptCount) is set
 * by the route when an open exam still has active attempts. cancel does NOT
 * force-submit; the admin must let attempts resolve first.
 */
export class ExamCancelNotAllowedError extends AppError {
  constructor(
    details?: {
      reason?: "UNRESOLVED_ATTEMPTS_EXIST";
      activeAttemptCount?: number;
    },
    message = "Exam cancel is not allowed",
  ) {
    super(message, "EXAM_CANCEL_NOT_ALLOWED", 409, details);
  }
}

/**
 * Scores/export requested for a canceled exam (HTTP 409).
 *
 * ADR-005 Slice 4 (cancel-minimal): until cancellation-marker result/export
 * semantics are implemented, canceled exams MUST NOT expose normal
 * scores/export. Silent export is forbidden.
 */
export class ExamCanceledResultsUnavailableError extends AppError {
  constructor(
    details?: { reason?: "CANCELLATION_MARKER_NOT_IMPLEMENTED" },
    message = "Results are unavailable for canceled exams",
  ) {
    super(message, "EXAM_CANCELED_RESULTS_UNAVAILABLE", 409, details);
  }
}

/**
 * Candidate manual submit was attempted before the minimum submit duration
 * elapsed (HTTP 409). ADR-005 Slice 3 §4.4. Only `source === "candidate"`
 * submits are subject to this guard; deadline_scanner/proctor/system bypass.
 */
export class AttemptSubmitTooEarlyError extends AppError {
  constructor(
    details: { earliestSubmitAt: Date; remainingSeconds: number },
    message = "Attempt submitted too early",
  ) {
    super(message, "ATTEMPT_SUBMIT_TOO_EARLY", 409, details);
  }
}

/**
 * A new attempt start was attempted after the late-entry cutoff (HTTP 409).
 * ADR-005 Slice 3 §4.3. Applies only to creating a NEW attempt; resume/
 * restore of existing attempts is never blocked.
 */
export class AttemptLateEntryClosedError extends AppError {
  constructor(
    details: { latestStartAt: Date; now: Date },
    message = "Late entry closed for this exam",
  ) {
    super(message, "ATTEMPT_LATE_ENTRY_CLOSED", 409, details);
  }
}

/**
 * A new attempt start is rejected because the candidate-manual-submit window
 * is unreachable (#395). The minimum manual-submit duration
 * (`minSubmitAfterStartMinutes`) leaves no legal candidate submit instant
 * before the canonical effective deadline: a candidate submit is legal only
 * in `[earliestSubmitAt, effectiveDeadline)` — the too-early guard allows
 * `now >= earliestSubmitAt` while deadline expiry freezes at
 * `now >= effectiveDeadline` — so the window is non-empty iff
 * `earliestSubmitAt < effectiveDeadline` (strict; at equality the single
 * guard-passing instant is already expired).
 *
 * Applies only to creating a NEW attempt; resume/restore of existing attempts
 * is never blocked. Null effective deadline (untimed) never rejects here.
 */
export class AttemptStartSubmitInfeasibleError extends AppError {
  constructor(
    details: { earliestSubmitAt: Date; effectiveDeadline: Date },
    message = "Remaining time before the deadline cannot satisfy the minimum manual-submit duration",
  ) {
    super(message, "ATTEMPT_START_SUBMIT_INFEASIBLE", 409, details);
  }
}

/** Candidate has reached the maximum number of allowed attempts (HTTP 409). */
export class MaxAttemptsReachedError extends AppError {
  constructor(message = "Maximum attempt count reached") {
    super(message, "MAX_ATTEMPTS_REACHED", 409);
  }
}

/** Candidate has already passed this exam and retake policy prevents re-attempt (HTTP 409). */
export class ExamAlreadyPassedError extends AppError {
  constructor(message = "Already passed this exam") {
    super(message, "EXAM_ALREADY_PASSED", 409);
  }
}

/**
 * Retake eligibility is deferred because a final result exists but is not yet
 * visible to the candidate (HTTP 409). Issue #324: while the result is hidden,
 * pass_then_stop must reject passed AND failed candidates identically — the
 * durable ExamAlreadyPassedError would otherwise be a one-bit pass/fail oracle.
 * The engine throws this under the enrollment lock (shared with the grading
 * finalizer); the API surfaces it as an opaque conflict so no pass/fail fact
 * leaks.
 */
export class RetakeDeferredError extends AppError {
  constructor(
    message = "Cannot start a new attempt for this exam at this time",
  ) {
    super(message, "RETAKE_DEFERRED", 409);
  }
}

/** Startup / runtime configuration error (HTTP 500). */
export class RuntimeConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "RUNTIME_CONFIG_ERROR", 500, details);
  }
}

/**
 * Admin extend-time would push the attempt deadline past the exam's closeAt
 * (HTTP 409). Per P2C-J3 §17 the extension is rejected rather than silently
 * clamped, so the admin is forced to choose a duration that fits the exam
 * window.
 */
export class AttemptDeadlineExceedsExamCloseError extends AppError {
  constructor(
    details?: { newDeadlineAt: Date; examCloseAt: Date },
    message = "Extended deadline would exceed the exam close time",
  ) {
    super(message, "DEADLINE_EXCEEDS_EXAM_CLOSE", 409, details);
  }
}

/**
 * Admin publish-results is not allowed for the requested exam state (HTTP 409).
 *
 * P2D-J5a: `POST /exams/:id/publish-results` is allowed only from
 * `published | open | closed` (after reconciliation). `draft | canceled |
 * archived` are rejected. Stale-state protection mirrors the other admin
 * operations: the route layer reconciles before calling the engine command.
 */
export class ExamPublishResultsNotAllowedError extends AppError {
  constructor(message = "Exam publish-results is not allowed") {
    super(message, "EXAM_PUBLISH_RESULTS_NOT_ALLOWED", 409);
  }
}

// ── Incident Errors (ADR-014) ────────────────────────────────────

/**
 * The incident's expectedVersion does not match the current version (HTTP 409).
 * Another actor committed a state change since the caller read the incident.
 */
export class IncidentVersionConflictError extends AppError {
  constructor(
    message = "Incident version conflict",
    details?: { expectedVersion: number; currentVersion: number },
  ) {
    super(message, "INCIDENT_VERSION_CONFLICT", 409, details);
  }
}

/**
 * An incident action link, attempt membership, or interruption link already
 * exists (HTTP 409). Covers all three link uniques.
 */
export class IncidentActionAlreadyLinkedError extends AppError {
  constructor(
    message = "Incident action already linked",
    details?: { linkType: string },
  ) {
    super(message, "INCIDENT_ACTION_ALREADY_LINKED", 409, details);
  }
}

/**
 * Authorization infrastructure could not resolve the resource's parent chain
 * (HTTP 503). Fail-closed: the caller must never fall back to an empty or
 * lenient result when the tenant/parent chain cannot be proven — e.g. an
 * Incident whose Exam row is missing or belongs to another organization.
 */
export class AuthzUnavailableError extends AppError {
  constructor(message = "Authorization service unavailable") {
    super(message, "AUTHZ_UNAVAILABLE", 503);
  }
}

/**
 * A password-reset request hit the per-account cooldown: an unconsumed token
 * for the same user already exists, serialized by the
 * `password_reset_tokens_user_open_unique` partial unique index (HTTP 409).
 *
 * Identity reset-request endpoints MUST NOT surface this as a distinct
 * client-visible outcome (anti-enumeration): the HTTP adapter folds it into
 * the same uniform generic response as every other reset request. The typed
 * error exists so the swallow is explicit and testable, never accidental.
 */
export class PasswordResetCooldownError extends AppError {
  constructor(message = "A password reset was requested too recently") {
    super(message, "PASSWORD_RESET_COOLDOWN", 409);
  }
}
