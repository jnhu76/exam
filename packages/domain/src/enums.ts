/**
 * Product roles within the platform.
 *
 * The 7 Phase 3+ role presets (matches `@exam/authz` RoleKey): Admin, Teacher,
 * Proctor, Grader, Candidate, Maintainer are human, login-capable, assignable
 * roles. `System` is a **synthetic, non-login, non-assignable** actor identity
 * used only by background scanners (deadline auto-submit, heartbeat
 * disrupted-scan) — it never originates from a `users.role` row and never
 * appears in user-management UI. See ADR §System Actor Policy.
 *
 * Maintainer (P7-E2A, ADR-017 D2) is the application-side System Operations
 * Owner — operational observation only, zero business permissions.
 *
 * Widening to the full set (RBAC runtime activation) lets Proctor/Grader log
 * in and be gated by `requireCapability`. The login path does not reject any
 * human role; `@exam/authz` RoleKey remains the authoritative closed set.
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
 * RBAC permission keys.
 *
 * Each key represents a single permission grant that can be assigned to a role.
 * Permissions are grouped by domain: organization, users, question bank, course,
 * exam, proctor, candidate, scores, and system.
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
  EXTEND_TIME: "EXTEND_TIME",
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
  // P3-L0-1: independent QuestionType for constructed free-text responses.
  // Not a fill_blank variant. gradingMode is manual; inputMode is multi_line.
  TextResponse: "text_response",
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

/**
 * Exam attempt lifecycle status.
 *
 * Transitions: not_started → queued → in_progress → disrupted | submitted → grading → graded | voided.
 */
export const AttemptStatus = {
  NotStarted: "not_started",
  Queued: "queued",
  InProgress: "in_progress",
  Disrupted: "disrupted",
  Submitted: "submitted",
  Grading: "grading",
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
 * Transitions: draft → published → open → closed → archived.
 * Only `draft` exams can be edited.
 */
export const ExamStatus = {
  Draft: "draft",
  Published: "published",
  Open: "open",
  Closed: "closed",
  // ADR-005 Slice 4 (cancel-minimal): abnormal cancellation. US spelling.
  Canceled: "canceled",
  Archived: "archived",
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

/**
 * Exam timing strategy.
 *
 * - `timed_sync`: all candidates start and end simultaneously (Phase 2).
 * - `timed_window`: each candidate has a fixed duration within an open window (Phase 1).
 * - `deadline`: candidates must submit before a fixed deadline (Phase 2).
 * - `untimed`: no time constraints (Phase 2).
 */
export const TimingMode = {
  TimedSync: "timed_sync",
  TimedWindow: "timed_window",
  Deadline: "deadline",
  Untimed: "untimed",
} as const;
export type TimingMode = (typeof TimingMode)[keyof typeof TimingMode];

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

// ── Teacher-to-Course assignment (issue #286) ─────────────────────

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

// ── Grader-to-Exam assignment (issue #296) ─────────────────────────

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
