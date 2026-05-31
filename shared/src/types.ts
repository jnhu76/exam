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

export enum ExamMode {
  OpenBook = "open_book",
  ClosedBook = "closed_book",
}

export enum ExamStatus {
  Draft = "draft",
  Published = "published",
  InProgress = "in_progress",
  Ended = "ended",
  Graded = "graded",
}

export enum ExamPaperStatus {
  NotStarted = "not_started",
  InProgress = "in_progress",
  Disrupted = "disrupted",
  Submitted = "submitted",
  Graded = "graded",
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
  mode: ExamMode;
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
  allowGoBack: boolean;
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

export interface ExamSection {
  id: string;
  examId: string;
  title: string;
  description?: string;
  questionIds: string[];
  scorePerQuestion: number;
  sortOrder: number;
}

export interface ExamRoom {
  id: string;
  organizationId: string;
  name: string;
  capacity: number;
  ipRange?: string;
  examIds: string[];
}

export interface ExamRoomAssignment {
  id: string;
  examRoomId: string;
  examId: string;
  candidateId: string;
  seatNo: number;
}

export interface ExamPaper {
  id: string;
  examId: string;
  candidateId: string;
  examRoomId: string;
  status: ExamPaperStatus;
  questionSnapshot: Question[];
  answers: Record<string, Answer>;
  score?: number;
  passed?: boolean;
  attemptNumber: number;
  startedAt?: string;
  submittedAt?: string;
  gradedAt?: string;
  lastActivityAt?: string;
}

export interface Answer {
  questionId: string;
  content: string;
  score?: number;
  gradedBy?: string;
  gradedAt?: string;
  feedback?: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  detail?: string;
  ip: string;
  timestamp: string;
}
