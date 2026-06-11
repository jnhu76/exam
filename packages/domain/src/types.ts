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

export interface Organization {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

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

export interface BrandingView {
  productName: string;
  productSubtitle?: string;
  footerText?: string;
  organizationDisplayName?: string;
}

// ── User ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  organizationId: string;
  username: string;
  passwordHash: string;
  name: string;
  role: Role;
  isActive: boolean;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── Candidate ─────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  organizationId: string;
  userId: string;
  fields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

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

export interface Option {
  id: string;
  content: string;
  isCorrect?: boolean;
}

export interface Attachment {
  url: string;
  type: "image" | "file";
  name: string;
}

// ── Question Snapshot (§3.6) ─────────────────────────────────────

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

export interface OptionSnapshot {
  id: string;
  content: string;
}

// ── Grading Rule ──────────────────────────────────────────────────

export interface GradingRule {
  multiSelectScoring: MultiSelectScoring;
  fillBlankMatchMode: FillBlankMatchMode;
  fillBlankCaseSensitive?: boolean | undefined;
}

// ── Control Flags (§2.6) ─────────────────────────────────────────

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

// ── Exam ──────────────────────────────────────────────────────────

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
  createdAt: Date;
  updatedAt: Date;
}

// ── Exam Enrollment (§2.2) ───────────────────────────────────────

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

export interface AnswerRecord {
  questionId: string;
  answer: unknown;
  version: number;
  savedAt: Date;
}

// ── Save Answer Request/Response (§3.5) ───────────────────────────

export interface SaveAnswerRequest {
  attemptId: string;
  questionId: string;
  answer: unknown;
  clientSeq: number;
  clientSavedAt: string;
  baseVersion: number;
}

export interface SaveAnswerResponse {
  accepted: boolean;
  serverVersion: number;
  savedAt: string;
  conflict?: {
    reason: ConflictReason;
    latestAnswer?: unknown;
  };
}

// ── Score Result (§3.7) ──────────────────────────────────────────

export interface ScoreResult {
  attemptId: string;
  totalScore: number;
  passed: boolean;
  questionResults: QuestionScoreResult[];
  gradedAt: Date;
}

export interface QuestionScoreResult {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  candidateAnswer: unknown;
  standardAnswer: unknown;
}

// ── Audit Log (§3.8) ─────────────────────────────────────────────

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

export interface RequestContext {
  actorId: string;
  organizationId: string;
  role: Role;
  permissions: Permission[];
  sessionId: string;
  sessionVersion?: number;
  targetOrganizationId?: string;
}

export interface PublicBrandingContext {
  purpose: "public_branding";
  organizationId?: string;
}
