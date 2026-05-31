export enum UserRole {
  SuperAdmin = "super_admin",
  Admin = "admin",
  Teacher = "teacher",
  Proctor = "proctor",
  Candidate = "candidate",
}

export enum QuestionType {
  SingleChoice = "single_choice",
  MultipleChoice = "multiple_choice",
  FillBlank = "fill_blank",
  TrueFalse = "true_false",
}

export enum ExamTiming {
  TimedSync = "timed_sync",
  TimedWindow = "timed_window",
  Deadline = "deadline",
  Untimed = "untimed",
}

export enum ExamStatus {
  Draft = "draft",
  Published = "published",
  Open = "open",
  Closed = "closed",
  Archived = "archived",
}

export enum AttemptStatus {
  NotStarted = "not_started",
  Queued = "queued",
  InProgress = "in_progress",
  Disrupted = "disrupted",
  Submitted = "submitted",
  Grading = "grading",
  Graded = "graded",
  Voided = "voided",
}

export enum EnrollmentStatus {
  Assigned = "assigned",
  Started = "started",
  Completed = "completed",
  Blocked = "blocked",
}

export enum RetakePolicy {
  Unlimited = "unlimited",
  MaxAttempts = "max_attempts",
  DailyLimit = "daily_limit",
  WeeklyLimit = "weekly_limit",
  PassThenStop = "pass_then_stop",
}

export enum ScoreStrategy {
  Highest = "highest",
  Latest = "latest",
  First = "first",
}

export enum DegradationLevel {
  Normal = "normal",
  PowerSave = "power_save",
  Extreme = "extreme",
}

export enum FillBlankMatchMode {
  Exact = "exact",
  Keyword = "keyword",
}

export enum MultiSelectScoring {
  AllOrNothing = "all_or_nothing",
  PartialHalf = "partial_half",
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  parentId?: string;
  createdAt: string;
}

export interface CandidateField {
  id: string;
  organizationId: string;
  name: string;
  label: string;
  type: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
  options?: string[];
  sortOrder: number;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  organizationId: string;
  createdAt: string;
}

export interface CandidateProfile {
  userId: string;
  organizationId: string;
  fields: Record<string, string>;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  organizationId: string;
  teacherId: string;
  semester: string;
}

export interface Question {
  id: string;
  courseId: string;
  organizationId: string;
  createdBy: string;
  type: QuestionType;
  content: string;
  attachments?: string[];
  options?: QuestionOption[];
  standardAnswer?: string;
  score: number;
  difficulty: number;
  tags: string[];
  createdAt: string;
}

export interface QuestionOption {
  label: string;
  content: string;
  isCorrect?: boolean;
}

export interface Exam {
  id: string;
  organizationId: string;
  courseId: string;
  title: string;
  description?: string;
  timing: ExamTiming;
  durationMinutes: number;
  totalScore: number;
  passingScore: number;
  status: ExamStatus;
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
  retakePolicy: RetakePolicy;
  maxRetakeAttempts?: number;
  retakeCooldown: number;
  scoreStrategy: ScoreStrategy;
  passThenStop: boolean;
  startTime: string;
  endTime: string;
  createdBy: string;
  createdAt: string;
}

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
}

export interface ExamAttempt {
  id: string;
  organizationId: string;
  examId: string;
  candidateId: string;
  attemptNo: number;
  status: AttemptStatus;
  questionSnapshot: QuestionSnapshot[];
  answers: AnswerRecord[];
  score?: number;
  passed?: boolean;
  startedAt?: string;
  submittedAt?: string;
  deadlineAt?: string;
  lastActivityAt?: string;
}

export interface QuestionSnapshot {
  originalQuestionId: string;
  type: QuestionType;
  content: string;
  attachments?: string[];
  options?: QuestionOption[];
  standardAnswer?: string;
  score: number;
  gradingRule?: GradingRule;
  order: number;
}

export interface GradingRule {
  fillBlankMatchMode?: FillBlankMatchMode;
  multiSelectScoring?: MultiSelectScoring;
}

export interface AnswerRecord {
  questionId: string;
  answer: unknown;
  clientSeq: number;
  clientSavedAt: string;
  serverVersion: number;
  serverSavedAt: string;
  score?: number;
}

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
    reason: "STALE_VERSION" | "SUBMITTED" | "ATTEMPT_CLOSED";
    latestAnswer?: unknown;
  };
}

export interface ScoreResult {
  attemptId: string;
  totalScore: number;
  passed: boolean;
  questionResults: QuestionScoreResult[];
  gradedAt: string;
}

export interface QuestionScoreResult {
  questionId: string;
  correct: boolean;
  score: number;
  maxScore: number;
  answer: unknown;
  standardAnswer: unknown;
}

export interface RequestContext {
  actorId: string;
  organizationId: string;
  role: UserRole;
  permissions: string[];
  sessionId: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}
