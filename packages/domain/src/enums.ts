/**
 * Product roles within the platform.
 *
 * Mirrors `@exam/authz` `RoleKey` (ADR-010 §Role Presets) — the authoritative
 * closed set for authorization. This module's `Role` is the domain-side
 * vocabulary used by `RequestContext.role` and audit.
 *
 * `System` is a **synthetic, non-login, non-assignable** actor identity used
 * only by background scanners (deadline auto-submit, heartbeat disrupted-scan)
 * — it never originates from a `users.role` row and never appears in
 * user-management UI. See ADR-010 §System Actor Policy.
 *
 * `Maintainer` (ADR-017 D2) is the application-side System Operations Owner —
 * operational observation only, zero business permissions.
 */
export const Role = {
  Admin: "Admin",
  Teacher: "Teacher",
  Proctor: "Proctor",
  Grader: "Grader",
  Candidate: "Candidate",
  Maintainer: "Maintainer",
  System: "System",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/**
 * Legacy SCREAMING_SNAKE permission keys, superseded as the grantable catalog
 * by `@exam/authz` `Permission` (ADR-010 §Permission Catalog v0). Retained for
 * the domain-side `RequestContext.permissions` / audit vocabulary — do not add
 * new grants here.
 */
export const Permission = {
  // Organization
  MANAGE_ORGANIZATION: "MANAGE_ORGANIZATION",
  MANAGE_CANDIDATE_FIELDS: "MANAGE_CANDIDATE_FIELDS",
  // Users
  MANAGE_USERS: "MANAGE_USERS",
  // Question Bank
  CREATE_QUESTION: "CREATE_QUESTION",
  EDIT_QUESTION: "EDIT_QUESTION",
  DELETE_QUESTION: "DELETE_QUESTION",
  IMPORT_QUESTIONS: "IMPORT_QUESTIONS",
  // Course
  MANAGE_COURSES: "MANAGE_COURSES",
  // Exam
  CREATE_EXAM: "CREATE_EXAM",
  EDIT_EXAM: "EDIT_EXAM",
  PUBLISH_EXAM: "PUBLISH_EXAM",
  ARCHIVE_EXAM: "ARCHIVE_EXAM",
  DELETE_EXAM: "DELETE_EXAM",
  // Proctor
  VIEW_EXAM_ROOM: "VIEW_EXAM_ROOM",
  MARK_MISCONDUCT: "MARK_MISCONDUCT",
  FORCE_SUBMIT: "FORCE_SUBMIT",
  // Candidate
  TAKE_EXAM: "TAKE_EXAM",
  VIEW_OWN_SCORE: "VIEW_OWN_SCORE",
  // Scores
  VIEW_ALL_SCORES: "VIEW_ALL_SCORES",
  EXPORT_SCORES: "EXPORT_SCORES",
  // System
  VIEW_SYSTEM_HEALTH: "VIEW_SYSTEM_HEALTH",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Question type enum.
 *
 * Determines the answer format and grading strategy.
 * `single_choice` and `true_false` use exact-match grading;
 * `multiple_choice` uses set comparison with configurable partial scoring;
 * `fill_blank` uses configurable string matching.
 */
export const QuestionType = {
  SingleChoice: "single_choice",
  MultipleChoice: "multiple_choice",
  FillBlank: "fill_blank",
  TrueFalse: "true_false",
  // text_response is an independent QuestionType, not a fill_blank variant:
  // gradingMode=inputMode derivation is owned by
  // docs/architecture/exam-runtime.md §1.2/§1.3.
  TextResponse: "text_response",
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

/**
 * Exam attempt lifecycle status.
 *
 * Canonical transition table: `attemptStateMachine.ts` `TRANSITION_TABLE`.
 *
 * INVARIANT (#542): `not_started`, `queued`, and `voided` are reserved
 * vocabulary with no current writer (docs/SPEC.md §2.2 target design);
 * `grading` was a historical production intermediate (older code wrote
 * `status='grading'` between `submitted` and `graded`; a crash between the two
 * writes could leave a residue row). That writer is gone: terminal grading
 * closes `submitted → graded` in one locked transaction, and the durable
 * grading-pipeline state is `gradingStatus` (P2D-J2), orthogonal to this
 * lifecycle. Legacy rows require explicit operator disposition.
 */
export const AttemptStatus = {
  NotStarted: "not_started",
  Queued: "queued",
  InProgress: "in_progress",
  Disrupted: "disrupted",
  Submitted: "submitted",
  Graded: "graded",
  Voided: "voided",
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

/**
 * Grading workflow status for an attempt (P2D-J2).
 *
 * Tracks where an attempt sits in the grading pipeline. Orthogonal to
 * {@link AttemptStatus}: an attempt may be `status=graded` (lifecycle done)
 * while `gradingStatus=pending_manual` (still needs subjective scoring).
 *
 * - `auto_graded`: scored entirely by the auto-grading engine.
 * - `pending_manual`: has subjective questions awaiting manual scoring.
 * - `fully_graded`: all questions (auto + manual) scored.
 */
export const GradingStatus = {
  AutoGraded: "auto_graded",
  PendingManual: "pending_manual",
  FullyGraded: "fully_graded",
} as const;
export type GradingStatus = (typeof GradingStatus)[keyof typeof GradingStatus];

/**
 * Result publication policy for an exam (P2D-J5a).
 *
 * Governs when candidates may see their graded results. Orthogonal to the
 * exam lifecycle status and to {@link GradingStatus}.
 *
 * - `immediate`: result visible as soon as it is computable (auto_graded or
 *   fully_graded). Does NOT show partial results while subjective grading is
 *   pending.
 * - `after_grading`: result visible only when `gradingStatus = fully_graded`.
 * - `manual`: result hidden until an admin calls publish-results
 *   (`resultsPublishedAt` becomes non-null). Publish does not itself advance
 *   grading — if grading is still pending the result stays hidden.
 */
export const ResultPublicationMode = {
  Immediate: "immediate",
  AfterGrading: "after_grading",
  Manual: "manual",
} as const;
export type ResultPublicationMode =
  (typeof ResultPublicationMode)[keyof typeof ResultPublicationMode];

/**
 * Candidate enrollment status for an exam.
 *
 * Tracks whether a candidate has been assigned, has started, completed, or
 * is blocked from an exam.
 */
export const EnrollmentStatus = {
  Assigned: "assigned",
  Started: "started",
  Completed: "completed",
  Blocked: "blocked",
} as const;
export type EnrollmentStatus =
  (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];

/**
 * Exam lifecycle status.
 *
 * Canonical transition table: `examStateMachine.ts` `EXAM_VALID_TRANSITIONS`
 * (includes the abnormal `canceled` path from ADR-005).
 *
 * Full-field edits are draft-only; a `published` exam accepts schedule fields
 * (openAt/closeAt) only.
 */
export const ExamStatus = {
  Draft: "draft",
  Published: "published",
  Open: "open",
  Closed: "closed",
  // Abnormal cancellation path (ADR-005). US spelling: "canceled".
  Canceled: "canceled",
  Archived: "archived",
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

/**
 * Exam timing strategy.
 *
 * `timed_window` (personal duration in an open window), `deadline` (global
 * cutoff), `untimed` (open-ended). `timed_sync` (operator-triggered shared
 * clock) is a decision-gated mode: its semantics are frozen in
 * `docs/contracts/timed-sync-semantics.md`, and
 * `docs/contracts/exam-policy-authority.md` §4 is the current
 * admission/timing support authority.
 */
export const TimingMode = {
  TimedSync: "timed_sync",
  TimedWindow: "timed_window",
  Deadline: "deadline",
  Untimed: "untimed",
} as const;
export type TimingMode = (typeof TimingMode)[keyof typeof TimingMode];

/**
 * Timing modes authoring (exams and policy profiles) may select.
 *
 * `timed_sync` is excluded here and rejected by the canonical exam-policy
 * validator, so no authoring path can produce it while its activation is
 * decision-gated.
 */
export type AuthoringTimingMode = Exclude<TimingMode, "timed_sync">;

/** How questions are selected for an exam paper: manually curated or randomly drawn. */
export const QuestionSelectionMode = {
  Manual: "manual",
  Random: "random",
} as const;
export type QuestionSelectionMode =
  (typeof QuestionSelectionMode)[keyof typeof QuestionSelectionMode];

/** Which attempt score counts as the final score when a candidate has multiple attempts. */
export const ScoreStrategy = {
  Highest: "highest",
  Latest: "latest",
  First: "first",
} as const;
export type ScoreStrategy = (typeof ScoreStrategy)[keyof typeof ScoreStrategy];

/**
 * Retake policy for an exam.
 *
 * Controls how many times a candidate may re-attempt after the first try.
 */
export const RetakePolicy = {
  Unlimited: "unlimited",
  MaxAttempts: "max_attempts",
  DailyLimit: "daily_limit",
  WeeklyLimit: "weekly_limit",
  PassThenStop: "pass_then_stop",
} as const;
export type RetakePolicy = (typeof RetakePolicy)[keyof typeof RetakePolicy];

/**
 * Multi-select question scoring mode.
 *
 * - `all_correct_full`: full score only if every selected option is correct.
 * - `partial_half`: half score if some selections are correct and none are wrong.
 */
export const MultiSelectScoring = {
  AllCorrectFull: "all_correct_full",
  PartialHalf: "partial_half",
} as const;
export type MultiSelectScoring =
  (typeof MultiSelectScoring)[keyof typeof MultiSelectScoring];

/** Fill-blank answer matching mode: exact string equality or keyword containment. */
export const FillBlankMatchMode = {
  Exact: "exact",
  Keyword: "keyword",
} as const;
export type FillBlankMatchMode =
  (typeof FillBlankMatchMode)[keyof typeof FillBlankMatchMode];

/**
 * Answer save conflict reason.
 *
 * Returned when the server rejects a save due to a version mismatch or state
 * violation.
 */
export const ConflictReason = {
  StaleVersion: "STALE_VERSION",
  FutureVersion: "FUTURE_VERSION",
  AttemptAlreadySubmitted: "ATTEMPT_ALREADY_SUBMITTED",
  AttemptClosed: "ATTEMPT_CLOSED",
  DeadlineExceeded: "DEADLINE_EXCEEDED",
  ConflictingPayload: "CONFLICTING_PAYLOAD",
  /** Answer payload failed the frozen question's shape validation (#301). */
  InvalidAnswer: "INVALID_ANSWER",
} as const;
export type ConflictReason =
  (typeof ConflictReason)[keyof typeof ConflictReason];

/**
 * Misconduct flag severity (P2C-J4).
 *
 * - `warning`: minor irregularity, logged but does not affect validity.
 * - `serious`: serious violation; may inform grading/validity review.
 */
export const MisconductSeverity = {
  Warning: "warning",
  Serious: "serious",
} as const;
export type MisconductSeverity =
  (typeof MisconductSeverity)[keyof typeof MisconductSeverity];

// ── Incident (ADR-014) ────────────────────────────────────────────

/** Incident status (terminal-monotonic). */
export const IncidentStatus = {
  Open: "open",
  Investigating: "investigating",
  Resolved: "resolved",
  Dismissed: "dismissed",
} as const;
export type IncidentStatus =
  (typeof IncidentStatus)[keyof typeof IncidentStatus];

/** Incident type (immutable after creation). */
export const IncidentType = {
  NetworkInterruption: "network_interruption",
  DeviceFailure: "device_failure",
  PowerFailure: "power_failure",
  CandidateUnableToContinue: "candidate_unable_to_continue",
  SuspectedMisconduct: "suspected_misconduct",
  OperatorError: "operator_error",
  SystemOutage: "system_outage",
  EnvironmentalDisruption: "environmental_disruption",
  Other: "other",
} as const;
export type IncidentType = (typeof IncidentType)[keyof typeof IncidentType];

/** Incident severity (informs prioritization only). */
export const IncidentSeverity = {
  Info: "info",
  Minor: "minor",
  Major: "major",
  Critical: "critical",
} as const;
export type IncidentSeverity =
  (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

/** Incident event type (append-only). */
export const IncidentEventType = {
  IncidentCreated: "incident_created",
  InvestigationStarted: "investigation_started",
  NoteAdded: "note_added",
  SeverityChanged: "severity_changed",
  IncidentResolved: "incident_resolved",
  IncidentDismissed: "incident_dismissed",
  ActionLinked: "action_linked",
  AttemptLinked: "attempt_linked",
  InterruptionLinked: "interruption_linked",
} as const;
export type IncidentEventType =
  (typeof IncidentEventType)[keyof typeof IncidentEventType];

/** Incident action type (linkable operator actions). */
export const IncidentActionType = {
  TimeGrant: "time_grant",
  ForceSubmit: "force_submit",
} as const;
export type IncidentActionType =
  (typeof IncidentActionType)[keyof typeof IncidentActionType];

/** Incident attempt relationship type. */
export const IncidentRelationshipType = {
  Affected: "affected",
  Referenced: "referenced",
} as const;
export type IncidentRelationshipType =
  (typeof IncidentRelationshipType)[keyof typeof IncidentRelationshipType];

/** Wire outcome for incident write commands. */
export const IncidentOutcome = {
  Applied: "applied",
  IdempotentReplayed: "idempotent_replayed",
} as const;
export type IncidentOutcome =
  (typeof IncidentOutcome)[keyof typeof IncidentOutcome];

// ── Proctor-to-Exam assignment (ADR-015) ──────────────────────────

/** Proctor-to-Exam assignment episode status (monotonic revocation). */
export const ExamProctorAssignmentStatus = {
  Active: "active",
  Revoked: "revoked",
} as const;
export type ExamProctorAssignmentStatus =
  (typeof ExamProctorAssignmentStatus)[keyof typeof ExamProctorAssignmentStatus];

/** Command type recorded on a proctor-assignment operation receipt. */
export const ExamProctorAssignmentCommandType = {
  Assign: "assign",
  Revoke: "revoke",
} as const;
export type ExamProctorAssignmentCommandType =
  (typeof ExamProctorAssignmentCommandType)[keyof typeof ExamProctorAssignmentCommandType];

/** Outcome recorded on a proctor-assignment operation receipt (event table). */
export const ExamProctorAssignmentEventOutcome = {
  Applied: "applied",
  NoChange: "no_change",
} as const;
export type ExamProctorAssignmentEventOutcome =
  (typeof ExamProctorAssignmentEventOutcome)[keyof typeof ExamProctorAssignmentEventOutcome];

/** Wire outcome for proctor-assignment write commands. */
export const ExamProctorAssignmentCommandOutcome = {
  Applied: "applied",
  NoChange: "no_change",
  IdempotentReplayed: "idempotent_replayed",
} as const;
export type ExamProctorAssignmentCommandOutcome =
  (typeof ExamProctorAssignmentCommandOutcome)[keyof typeof ExamProctorAssignmentCommandOutcome];

// ── Teacher-to-Course assignment ──────────────────────────────────

/**
 * Teacher-course assignment episode status (monotonic revocation, same
 * episode semantics as Proctor-to-Exam assignments).
 */
export const TeacherCourseAssignmentStatus = {
  Active: "active",
  Revoked: "revoked",
} as const;
export type TeacherCourseAssignmentStatus =
  (typeof TeacherCourseAssignmentStatus)[keyof typeof TeacherCourseAssignmentStatus];

/** Wire outcome for teacher-course assignment write operations. */
export const TeacherCourseAssignmentOutcome = {
  Applied: "applied",
  NoChange: "no_change",
} as const;
export type TeacherCourseAssignmentOutcome =
  (typeof TeacherCourseAssignmentOutcome)[keyof typeof TeacherCourseAssignmentOutcome];

// ── Grader-to-Exam assignment ──────────────────────────────────────

/**
 * Grader-exam assignment episode status (monotonic revocation, same
 * episode semantics as Teacher-to-Course assignments).
 */
export const GraderExamAssignmentStatus = {
  Active: "active",
  Revoked: "revoked",
} as const;
export type GraderExamAssignmentStatus =
  (typeof GraderExamAssignmentStatus)[keyof typeof GraderExamAssignmentStatus];

/** Wire outcome for grader-exam assignment write operations. */
export const GraderExamAssignmentOutcome = {
  Applied: "applied",
  NoChange: "no_change",
} as const;
export type GraderExamAssignmentOutcome =
  (typeof GraderExamAssignmentOutcome)[keyof typeof GraderExamAssignmentOutcome];
