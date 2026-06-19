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
