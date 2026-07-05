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

// ── Manual Grading Entry (P2D-J2) ────────────────────────────────

/**
 * A single manual grading entry: one grader's score + comment for one
 * subjective question within one attempt.
 *
 * Uniqueness of (attemptId, questionId) is enforced at the DB layer.
 * `questionId` joins `QuestionSnapshot.originalQuestionId`. `gradedBy` is
 * the Admin userId in Phase 2 (the Grader role is a Phase 3+ bundle).
 */
export interface ManualGradingEntry {
  id: string;
  organizationId: string;
  attemptId: string;
  questionId: string;
  score: number;
  maxScore: number;
  /** Free-text grader comment; empty string when none. */
  comment: string;
  gradedBy: string;
  /** Server-authoritative grading timestamp. */
  gradedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
