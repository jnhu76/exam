import type {
  Role,
  Permission,
  QuestionType,
  AttemptStatus,
  EnrollmentStatus,
  ExamStatus,
  TimingMode,
  QuestionSelectionMode,
  ScoreStrategy,
  RetakePolicy,
  MultiSelectScoring,
  FillBlankMatchMode,
  ConflictReason,
  MisconductSeverity,
  GradingStatus,
  ResultPublicationMode,
  IncidentStatus,
  IncidentType,
  IncidentSeverity,
  IncidentEventType,
  IncidentActionType,
  IncidentRelationshipType,
  ExamProctorAssignmentStatus,
  ExamProctorAssignmentCommandType,
  ExamProctorAssignmentEventOutcome,
  ExamProctorAssignmentCommandOutcome,
} from "./enums.js";

// ── Organization ──────────────────────────────────────────────────

/** Internal organization record. Represents the top-level tenant boundary. */
export interface Organization {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Organization-level display and localization settings.
 *
 * Overrides the defaults from `Organization` when set. Fields are optional;
 * unset values fall back to the organization record.
 */
export interface OrganizationSettings {
  id: string;
  organizationId: string;
  productName?: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
  timezone?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Resolved branding view combining organization defaults with organization settings overrides. */
export interface BrandingView {
  productName: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
}

// ── User ──────────────────────────────────────────────────────────

/** Platform user account with role and organization membership. */
export interface User {
  id: string;
  organizationId: string;
  username: string;
  passwordHash: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Candidate ─────────────────────────────────────────────────────

/** Candidate profile linked to a user, holding dynamic identity fields. */
export interface Candidate {
  id: string;
  organizationId: string;
  userId: string;
  fields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Metadata definition for a single candidate identity field. */
export interface CandidateField {
  id: string;
  organizationId: string;
  name: string;
  label: string;
  fieldType: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
  sortOrder: number;
  createdAt: Date;
}

// ── Course ────────────────────────────────────────────────────────

/** Course (or training module) that groups questions and exams. */
export interface Course {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Question ──────────────────────────────────────────────────────

/** A question in the question bank, with content, options, answer, and grading metadata. */
export interface Question {
  id: string;
  organizationId: string;
  courseId: string;
  type: QuestionType;
  content: string;
  options: Option[];
  standardAnswer: unknown;
  attachments: Attachment[];
  score: number;
  difficulty: number;
  tags: string[];
  gradingRule: GradingRule;
  /**
   * P3-L0-1: rubric authoring/editing source (dual-layer storage).
   * text_response requires non-empty at publish (P3-L0-5); objective
   * questions carry null. Copied into QuestionSnapshot.rubric at attempt
   * creation. Existing rows read via the db repo normalize undefined → null.
   */
  rubric: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A single answer option for a choice-type question. */
export interface Option {
  id: string;
  content: string;
  isCorrect?: boolean;
}

/** File or image attachment linked to a question. */
export interface Attachment {
  url: string;
  type: "image" | "file";
  name: string;
}

// ── Question Snapshot (§3.6) ─────────────────────────────────────

/**
 * Immutable snapshot of a question at exam creation time.
 *
 * Stored in `ExamAttempt.questionSnapshot` so that later edits to the
 * question bank do not affect in-progress or completed attempts.
 */
export interface QuestionSnapshot {
  originalQuestionId: string;
  type: QuestionType;
  content: string;
  attachments: Attachment[];
  options: OptionSnapshot[];
  standardAnswer: unknown;
  score: number;
  gradingRule: GradingRule;
  order: number;
  /**
   * P3-L0-1: frozen grading source (dual-layer). Copied from
   * Question.rubric at attempt creation; always string | null on newly
   * built snapshots. Historical JSONB rows may omit the key — readers
   * normalize missing to null (see QuestionSnapshotSchema transform).
   */
  rubric: string | null;
}

/** Answer option within a question snapshot (no correctness flag — grading uses standardAnswer). */
export interface OptionSnapshot {
  id: string;
  content: string;
}

// ── Grading Rule ──────────────────────────────────────────────────

/** Grading configuration for a question, controlling multi-select and fill-blank behavior. */
export interface GradingRule {
  multiSelectScoring: MultiSelectScoring;
  fillBlankMatchMode: FillBlankMatchMode;
  fillBlankCaseSensitive?: boolean | undefined;
}

// ── Control Flags (§2.6) ─────────────────────────────────────────

/**
 * Runtime control flags for an exam session.
 *
 * Controls shuffle, anti-cheat, queue, IP restriction, lockdown, and
 * result-display behavior. Not all flags are used in Phase 1.
 */
export interface ControlFlags {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  detectTabSwitch: boolean;
  disableCopyPaste: boolean;
  requireQueue: boolean;
  batchSize: number;
  batchInterval: number;
  restrictIp: boolean;
  requireLockdown: boolean;
  showResultImmediately: boolean;
}

// ── Submit source (ADR-005 Slice 3) ────────────────────────────────

/**
 * Discriminator for who initiated an attempt submit. Used by submitAttempt
 * to gate the minimum-submit-duration policy: only `candidate` manual submits
 * are subject to minSubmitAfterStartMinutes; deadline_scanner/proctor/system
 * bypass it. Never client-controlled — set explicitly at the command boundary.
 */
export type SubmitSource =
  | "candidate"
  | "deadline_scanner"
  | "proctor"
  | "system";

// ── Exam ──────────────────────────────────────────────────────────

/**
 * Core exam entity.
 *
 * Holds all configuration for an exam: timing, scoring, question selection,
 * control flags, and the question snapshot. State transitions go through
 * command functions, not direct mutation.
 */
export interface Exam {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  courseId: string;
  status: ExamStatus;
  timingMode: TimingMode;
  durationMinutes: number;
  openAt: Date;
  closeAt: Date;
  passingScore: number;
  totalScore: number;
  questionSelectionMode: QuestionSelectionMode;
  questionIds: string[];
  questionSnapshot: QuestionSnapshot[];
  controlFlags: ControlFlags;
  retakePolicy: RetakePolicy;
  scoreStrategy: ScoreStrategy;
  maxAttempts: number;
  // ADR-005 Slice 3: candidate runtime timing policy. null = disabled.
  latestStartOffsetMinutes: number | null;
  minSubmitAfterStartMinutes: number | null;
  // P2D-J5a: result publishing policy. Authoritative field for candidate
  // result visibility; supersedes the legacy ControlFlags.showResultImmediately.
  resultPublicationMode: ResultPublicationMode;
  // P2D-J5a: server time authority instant when an admin published results
  // for a manual-mode exam. Null until the first publish-results call; once
  // set, it is never updated (idempotent re-publish is a no-op on this field).
  resultsPublishedAt: Date | null;
  interruptionTimePolicy?: InterruptionTimePolicy;
  interruptionGracePerIncidentSeconds?: number | null;
  interruptionGracePerAttemptSeconds?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Exam Enrollment (§2.2) ───────────────────────────────────────

/**
 * Tracks a candidate's enrollment in an exam.
 *
 * Records attempt count, final score (computed by `ScoreStrategy`), and
 * pass/fail status.
 */
export interface ExamEnrollment {
  id: string;
  organizationId: string;
  examId: string;
  candidateId: string;
  status: EnrollmentStatus;
  attemptCount: number;
  finalScore?: number;
  finalPassed?: boolean;
  finalAttemptId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Exam Attempt (§2.2) ──────────────────────────────────────────

/** Governs whether and how interruption time may produce a deadline grant. */
export type InterruptionTimePolicy =
  | "strict"
  | "bounded_grace"
  | "operator_incident";

/** Lifecycle event recorded for one durable interruption episode. */
export type InterruptionEventType = "detected" | "restored" | "terminalized";

/** Server-side evidence source used when detecting an interruption episode. */
export type InterruptionDetectionSource =
  | "heartbeat_timeout"
  | "migration_backfill";

/** Authority that produced a positive deadline adjustment. */
export type TimeAdjustmentSource =
  | "bounded_grace"
  | "operator"
  | "system_incident"
  | "administrative_correction";

/** Immutable interruption policy copied from the Exam when an attempt starts. */
export interface AttemptTimingPolicySnapshot {
  schemaVersion: 1;
  policy: InterruptionTimePolicy;
  perIncidentCapSeconds: number | null;
  perAttemptAggregateCapSeconds: number | null;
}

/** Stable identity for one interruption episode on an attempt. */
export interface AttemptInterruption {
  id: string;
  organizationId: string;
  attemptId: string;
  createdAt: Date;
}

/** Append-only evidence and outcome event for an interruption episode. */
export interface AttemptInterruptionEvent {
  id: string;
  organizationId: string;
  attemptId: string;
  interruptionId: string;
  eventType: InterruptionEventType;
  occurredAt: Date;
  observedLastActivityAt: Date | null;
  detectionSource: InterruptionDetectionSource | null;
  timeoutSeconds: number | null;
  policy: InterruptionTimePolicy;
  eligibleSeconds: number | null;
  timeAdjustmentId: string | null;
  actorId: string | null;
  reasonCode: string;
  createdAt: Date;
}

/** Append-only record of one positive deadline adjustment. */
export interface AttemptTimeAdjustment {
  id: string;
  operationId: string;
  organizationId: string;
  attemptId: string;
  interruptionId: string | null;
  incidentId: string | null;
  policy: InterruptionTimePolicy;
  source: TimeAdjustmentSource;
  beforeDeadline: Date;
  afterDeadline: Date;
  addedSeconds: number;
  eligibleSeconds: number | null;
  reasonCode: string;
  reasonText: string | null;
  actorId: string | null;
  createdAt: Date;
}

/**
 * A single attempt by a candidate to take an exam.
 *
 * Contains the question snapshot at attempt creation, answer records,
 * grading results, and timing metadata. The `lastActivityAt` field
 * serves as the heartbeat for disconnect detection.
 */
export interface ExamAttempt {
  id: string;
  organizationId: string;
  examId: string;
  enrollmentId: string;
  candidateId: string;
  attemptNo: number;
  status: AttemptStatus;
  questionSnapshot: QuestionSnapshot[];
  answers: AnswerRecord[];
  gradingResult?: QuestionScoreResult[];
  score?: number;
  passed?: boolean;
  startedAt?: Date;
  submittedAt?: Date;
  gradedAt?: Date;
  deadlineAt?: Date;
  lastActivityAt?: Date;
  interruptionTimingPolicySnapshot?: AttemptTimingPolicySnapshot;
  currentInterruptionId?: string | null;
  interruptedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Admin/Proctor misconduct flag (P2C-J4). Null when the attempt has not
   * been flagged; set via the flag-misconduct command (idempotent re-flag
   * overwrites). Does not change `status`.
   */
  misconduct?: MisconductFlag | null;
  /**
   * Grading workflow status (P2D-J2). Orthogonal to `status`: tracks where
   * the attempt sits in the grading pipeline. Undefined for attempts graded
   * before this field existed (migration backfills `auto_graded`); defaults
   * to `auto_graded` at the application boundary.
   */
  gradingStatus?: GradingStatus;
  /**
   * Frozen snapshot of answers at submit time (L0 §4.1).
   * Written once in the submit transaction; immutable after submit.
   * Used exclusively by grading and result computation.
   */
  submittedAnswers?: SubmittedAnswersSnapshot | null;
  /**
   * P3-L0-1: why this attempt was submitted. `'manual'` for candidate
   * submit; `'deadline'` for lazy deadline reconciliation; null for
   * legacy rows predating the column (treated as unknown). Future
   * submit paths must populate this.
   */
  submissionReason?: "manual" | "deadline" | null;
}

/**
 * Frozen snapshot of answers written to `submitted_answers` at submit
 * time (L0 §4.1 / §2.3). Built by normalizing draft {@link AnswerRecord}s
 * against the question snapshot — strips protocol metadata (clientSeq /
 * baseVersion / timestamps). Immutable after submit.
 */
export interface SubmittedAnswersSnapshot {
  schemaVersion: 1;
  answers: { questionId: string; value: unknown }[];
}

/**
 * Misconduct flag recorded on an exam attempt (P2C-J4).
 *
 * Stored as a single jsonb column on `exam_attempts`.
 */
export interface MisconductFlag {
  /** When the flag was recorded (server time authority). */
  flaggedAt: Date;
  /** Actor id of the admin/proctor who recorded the flag. */
  flaggedBy: string;
  /** Free-text note describing the irregularity. */
  notes: string;
  /** Severity of the misconduct. */
  severity: MisconductSeverity;
}

// ── Answer Record ─────────────────────────────────────────────────

/** A single saved answer within an attempt, versioned for conflict detection. */
export interface AnswerRecord {
  questionId: string;
  answer: unknown;
  version: number;
  savedAt: Date;
}

// ── Save Answer Request/Response (§3.5) ───────────────────────────

/** Client request to save or update an answer during an exam attempt. */
export interface SaveAnswerRequest {
  attemptId: string;
  questionId: string;
  answer: unknown;
  clientSeq: number;
  clientSavedAt: string;
  baseVersion: number;
}

/** Server response when an answer save is accepted (no conflict). */
export interface SaveAnswerAcceptedResponse {
  accepted: true;
  serverVersion: number;
  savedAt: string;
  conflict?: undefined;
}

/** Server response when an answer save is rejected due to a version conflict. */
export interface SaveAnswerRejectedResponse {
  accepted: false;
  serverVersion: number;
  savedAt: string;
  conflict: {
    reason: ConflictReason;
    latestAnswer?: unknown;
  };
}

/** Discriminated union of accepted/rejected answer save responses. */
export type SaveAnswerResponse =
  | SaveAnswerAcceptedResponse
  | SaveAnswerRejectedResponse;

// ── Score Result (§3.7) ──────────────────────────────────────────

/** Aggregated score result for a completed attempt. */
export interface ScoreResult {
  attemptId: string;
  totalScore: number;
  passed: boolean;
  questionResults: QuestionScoreResult[];
  gradedAt: Date;
}

/** Per-question scoring result including the candidate's answer and the standard answer. */
export interface QuestionScoreResult {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  candidateAnswer: unknown;
  standardAnswer: unknown;
}

// ── Attempt Grading Entry (P3-L0-2E) ─────────────────────────────

/**
 * Grading mode for a single question within an attempt's materialized grading
 * workset. Derived from {@link QuestionSnapshot.type} at submit-freeze time:
 * `text_response` → `manual`; all other types → `auto`.
 */
export const GradingEntryMode = {
  Auto: "auto",
  Manual: "manual",
} as const;
export type GradingEntryMode =
  (typeof GradingEntryMode)[keyof typeof GradingEntryMode];

/**
 * Status of a single question's grading entry within the materialized grading
 * workset.
 *
 * - `completed_auto`: objective question auto-graded at submit-freeze time.
 *   `earnedScore`/`correct`/`candidateAnswer`/`standardAnswer` are populated.
 * - `pending_manual`: text_response question awaiting manual scoring.
 *   `earnedScore` is null; `candidateAnswer`/`standardAnswer` are frozen for
 *   the grading view.
 * - `completed_manual`: text_response question scored by a grader.
 *   `earnedScore`/`comment`/`gradedBy`/`gradedAt` are populated.
 */
export const GradingEntryStatus = {
  CompletedAuto: "completed_auto",
  PendingManual: "pending_manual",
  CompletedManual: "completed_manual",
} as const;
export type GradingEntryStatus =
  (typeof GradingEntryStatus)[keyof typeof GradingEntryStatus];

/**
 * A materialized grading workset entry for exactly one question within one
 * attempt (P3-L0-2E).
 *
 * Created at submit-freeze time from `submitted_answers` + the frozen
 * `QuestionSnapshot`. This is the single durable grading truth: the manual
 * grading queue reads pending entries, manual scoring updates entries, and
 * terminal final aggregation reads completed entries. `attempt.gradingResult`
 * is a denormalized projection generated from these entries — never consumed
 * as scoring input.
 *
 * Uniqueness of `(attemptId, questionId)` is enforced at the DB layer.
 * `questionId` joins `QuestionSnapshot.originalQuestionId`.
 */
export interface AttemptGradingEntry {
  id: string;
  organizationId: string;
  attemptId: string;
  questionId: string;
  gradingMode: GradingEntryMode;
  status: GradingEntryStatus;
  /** Frozen max score from `QuestionSnapshot.score`. */
  maxScore: number;
  /** Awarded score; null until the entry is completed (auto or manual). */
  earnedScore: number | null;
  /** Frozen submitted answer for this question (from `submitted_answers`). */
  candidateAnswer: unknown;
  /** Frozen standard answer from `QuestionSnapshot.standardAnswer`. */
  standardAnswer: unknown;
  /** Whether the answer is correct; null for pending_manual entries. */
  correct: boolean | null;
  /** Grader comment; empty string for auto-graded / unscored entries. */
  comment: string;
  /** Grader id; null for auto-graded / unscored entries. */
  gradedBy: string | null;
  /** Server-authoritative grading timestamp; null for pending entries. */
  gradedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Audit Log (§3.8) ─────────────────────────────────────────────

/** Audit log entry recording an actor's action on a target entity. */
export interface AuditLog {
  id: string;
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

// ── Request Context (§3.1) ───────────────────────────────────────

/**
 * Authenticated request context carrying the actor's identity,
 * organization, role, and permissions. Passed to all repository and
 * command functions as the first argument (`ctx`).
 */
export interface RequestContext {
  actorId: string;
  organizationId: string;
  role: Role;
  permissions: Permission[];
  sessionId: string;
  targetOrganizationId?: string;
}

/** Lightweight context for public branding endpoints that do not require authentication. */
export interface PublicBrandingContext {
  purpose: "public_branding";
  organizationId?: string;
}

// ── Exam Incident (ADR-014) ──────────────────────────────────────

/** Exam incident — durable operational case record. */
export interface ExamIncident {
  id: string;
  organizationId: string;
  examId: string;
  attemptId: string | null;
  candidateId: string | null;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: Date | null;
  description: string;
  resolutionSummary: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  reportedBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Exam incident event — append-only history entry. */
export interface ExamIncidentEvent {
  id: string;
  organizationId: string;
  incidentId: string;
  eventSequence: number;
  eventType: IncidentEventType;
  commandType: string;
  operationId: string;
  actorId: string | null;
  beforeVersion: number;
  afterVersion: number;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** Exam incident action link — correlation to an authoritative operator action. */
export interface ExamIncidentAction {
  id: string;
  organizationId: string;
  incidentId: string;
  actionType: IncidentActionType;
  actionId: string;
  attemptId: string;
  actorId: string | null;
  linkedAt: Date;
  operationId: string;
}

/** Exam incident attempt membership — affected/referenced attempt for exam-wide incidents. */
export interface ExamIncidentAttempt {
  id: string;
  organizationId: string;
  incidentId: string;
  attemptId: string;
  relationshipType: IncidentRelationshipType;
  linkedAt: Date;
  linkedBy: string;
  operationId: string;
}

/** Exam incident interruption link — evidence correlation. */
export interface ExamIncidentInterruptionLink {
  id: string;
  organizationId: string;
  incidentId: string;
  attemptId: string;
  interruptionId: string;
  linkedAt: Date;
  linkedBy: string;
  operationId: string;
}

// ── Proctor-to-Exam assignment (ADR-015) ──────────────────────────

/**
 * Proctor-to-Exam assignment episode — current state row.
 * At most one active episode per (organization, exam, proctor); revoked
 * episodes remain as history (append-preserving aggregate, ADR-015 §4).
 */
export interface ExamProctorAssignment {
  id: string;
  organizationId: string;
  examId: string;
  proctorUserId: string;
  status: ExamProctorAssignmentStatus;
  assignedBy: string;
  assignedAt: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Append-only command receipt for a proctor-assignment write command.
 * `UNIQUE (organization_id, operation_id)` on this table is the sole
 * idempotency arbiter (ADR-015 §4.2); `canonical_payload` carries
 * reasonCode (never a separate column) and no operationId.
 */
export interface ExamProctorAssignmentEvent {
  id: string;
  organizationId: string;
  assignmentId: string;
  commandType: ExamProctorAssignmentCommandType;
  operationId: string;
  canonicalPayload: Record<string, unknown>;
  outcome: ExamProctorAssignmentEventOutcome;
  actorId: string;
  createdAt: Date;
}

/** Command result for assignProctorToExam / revokeProctorFromExam. */
export interface ExamProctorAssignmentCommandResult {
  outcome: ExamProctorAssignmentCommandOutcome;
  assignment: ExamProctorAssignment;
}

// ── Attempt Command Receipts (J5-I1C Slice 1) ─────────────────────
//
// Pure domain types for the durable Attempt command receipt foundation. Per
// AGENTS.md, domain types live in `types.ts`; the canonicalizers, equality
// primitive, and replay classifier live in `attemptCommandPayload.ts`. This
// split keeps the type authority in one place while the logic module stays a
// leaf consumer of these types (review J5-I1C0 PR #261 P2-1).

/**
 * The two dangerous Attempt commands sharing one receipt table. This is the
 * domain-level canonical literal union; the contract layer mirrors it as
 * `AttemptCommandTypeSchema` (single source of truth is this union).
 */
export type AttemptCommandType = "force_submit" | "misconduct_mark";

/**
 * Canonical `force_submit` request payload stored in a receipt's
 * `request_payload` jsonb (audit §4.1/§4.2). `reason` is REQUIRED and
 * non-empty after trim (J5-R0 §8.1 upgraded it to server-required; the
 * durable shape never contains null/blank).
 */
export interface ForceSubmitRequestPayload {
  reason: string;
}

/**
 * Canonical `misconduct_mark` request payload stored in a receipt's
 * `request_payload` jsonb (audit §4.3/§4.4). `severity` is the validated
 * literal; `notes` is trimmed and non-empty.
 */
export interface MisconductMarkRequestPayload {
  severity: "warning" | "serious";
  notes: string;
}

/** Union of the canonical per-command request payloads. */
export type AttemptCommandRequestPayload =
  | ForceSubmitRequestPayload
  | MisconductMarkRequestPayload;

/**
 * Canonical `force_submit` result payload stored in a receipt's
 * `result_payload` jsonb (audit §4.2). The immutable committed fact: the
 * statuses observed under the EA lock and the attempt timestamps at commit —
 * returned verbatim on replay, NEVER re-derived from the live attempt.
 * Timestamps are ISO-8601 strings (the jsonb wire shape). `commandType` is
 * duplicated inside the payload so the stored fact is self-describing and the
 * discriminated union is usable at the db layer.
 */
export interface ForceSubmitResultPayload {
  commandType: "force_submit";
  beforeStatus: AttemptStatus;
  afterStatus: AttemptStatus;
  submittedAt: string | null;
  gradedAt: string | null;
  appliedAt: string;
}

/**
 * Wire/receipt form of {@link MisconductFlag}: `flaggedAt` is an ISO-8601
 * string. The receipt `result_payload` jsonb and the wire response validate
 * against `MisconductFlagSchema` (`z.string().datetime()`); the domain
 * {@link MisconductFlag} (`flaggedAt: Date`) remains the engine-time shape,
 * and the orchestrator owns the boundary where the flag is canonicalized to
 * the wire form.
 */
export interface MisconductFlagWire {
  flaggedAt: string;
  flaggedBy: string;
  notes: string;
  severity: MisconductSeverity;
}

/**
 * Canonical `misconduct_mark` result payload stored in a receipt's
 * `result_payload` jsonb (audit §4.4). The immutable committed fact: the
 * MisconductFlag this receipt establishes (null on no_change) and the
 * receipt's server time. `misconduct.flaggedAt` is the wire/ISO form
 * ({@link MisconductFlagWire}), not the engine-time `Date`.
 */
export interface MisconductMarkResultPayload {
  commandType: "misconduct_mark";
  misconduct: MisconductFlagWire | null;
  appliedAt: string;
}

/** Union of the canonical per-command result payloads. */
export type AttemptCommandResultPayload =
  | ForceSubmitResultPayload
  | MisconductMarkResultPayload;

/**
 * Per-command canonical INPUT shapes. `canonicalizeAttemptCommandRequest`
 * (in `attemptCommandPayload.ts`) is generic over this map, so a `force_submit`
 * call can only ever pass a force-submit-shaped input and a `misconduct_mark`
 * call can only ever pass a misconduct-shaped input — a mismatched payload is
 * a TypeScript error, not a runtime `as` cast.
 */
export interface AttemptCommandInputByType {
  force_submit: { reason: string };
  misconduct_mark: { severity: "warning" | "serious"; notes: string };
}

/**
 * Per-command canonical PAYLOAD shapes returned by
 * `canonicalizeAttemptCommandRequest` (compile-time bound to the input via
 * {@link AttemptCommandInputByType}).
 */
export interface AttemptCommandPayloadByType {
  force_submit: ForceSubmitRequestPayload;
  misconduct_mark: MisconductMarkRequestPayload;
}
