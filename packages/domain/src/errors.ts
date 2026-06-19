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

/** User with the same username already exists (HTTP 409). */
export class UserAlreadyExistsError extends AppError {
  constructor(message = "User already exists") {
    super(message, "USER_ALREADY_EXISTS", 409);
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

/** Startup / runtime configuration error (HTTP 500). */
export class RuntimeConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "RUNTIME_CONFIG_ERROR", 500, details);
  }
}
