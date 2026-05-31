export const Role = {
  SuperAdmin: "SuperAdmin",
  Admin: "Admin",
  Teacher: "Teacher",
  Proctor: "Proctor",
  Candidate: "Candidate",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

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

export const QuestionType = {
  SingleChoice: "single_choice",
  MultipleChoice: "multiple_choice",
  FillBlank: "fill_blank",
  TrueFalse: "true_false",
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

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

export const EnrollmentStatus = {
  Assigned: "assigned",
  Started: "started",
  Completed: "completed",
  Blocked: "blocked",
} as const;
export type EnrollmentStatus =
  (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];

export const ExamStatus = {
  Draft: "draft",
  Published: "published",
  Open: "open",
  Closed: "closed",
  Archived: "archived",
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

export const TimingMode = {
  TimedSync: "timed_sync",
  TimedWindow: "timed_window",
  Deadline: "deadline",
  Untimed: "untimed",
} as const;
export type TimingMode = (typeof TimingMode)[keyof typeof TimingMode];

export const QuestionSelectionMode = {
  Manual: "manual",
  Random: "random",
} as const;
export type QuestionSelectionMode =
  (typeof QuestionSelectionMode)[keyof typeof QuestionSelectionMode];

export const ScoreStrategy = {
  Highest: "highest",
  Latest: "latest",
  First: "first",
} as const;
export type ScoreStrategy =
  (typeof ScoreStrategy)[keyof typeof ScoreStrategy];

export const RetakePolicy = {
  Unlimited: "unlimited",
  MaxAttempts: "max_attempts",
  DailyLimit: "daily_limit",
  WeeklyLimit: "weekly_limit",
  PassThenStop: "pass_then_stop",
} as const;
export type RetakePolicy =
  (typeof RetakePolicy)[keyof typeof RetakePolicy];

export const MultiSelectScoring = {
  AllCorrectFull: "all_correct_full",
  PartialHalf: "partial_half",
} as const;
export type MultiSelectScoring =
  (typeof MultiSelectScoring)[keyof typeof MultiSelectScoring];

export const FillBlankMatchMode = {
  Exact: "exact",
  Keyword: "keyword",
} as const;
export type FillBlankMatchMode =
  (typeof FillBlankMatchMode)[keyof typeof FillBlankMatchMode];

export const ConflictReason = {
  StaleVersion: "STALE_VERSION",
  Submitted: "SUBMITTED",
  AttemptClosed: "ATTEMPT_CLOSED",
} as const;
export type ConflictReason =
  (typeof ConflictReason)[keyof typeof ConflictReason];
