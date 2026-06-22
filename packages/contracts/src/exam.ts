import { z } from "zod";

// ── Exam ──────────────────────────────────────────────────────────

const ExamStatusEnum = z.enum([
  "draft",
  "published",
  "open",
  "closed",
  "canceled",
  "archived",
]);
const TimingModeEnum = z.enum([
  "timed_sync",
  "timed_window",
  "deadline",
  "untimed",
]);
const QuestionSelectionModeEnum = z.enum(["manual", "random"]);
const ScoreStrategyEnum = z.enum(["highest", "latest", "first"]);
const RetakePolicyEnum = z.enum([
  "unlimited",
  "max_attempts",
  "daily_limit",
  "weekly_limit",
  "pass_then_stop",
]);
const Phase1TimingModeEnum = z.literal("timed_window");
const Phase1QuestionSelectionModeEnum = z.literal("manual");
const Phase1RetakePolicyEnum = z.enum([
  "unlimited",
  "max_attempts",
  "pass_then_stop",
]);
// P2D-J5a: result publishing policy. Authoritative visibility field;
// showResultImmediately remains as a legacy input only.
const ResultPublicationModeEnum = z.enum([
  "immediate",
  "after_grading",
  "manual",
]);

const ControlFlagsSchema = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  detectTabSwitch: z.boolean().default(false),
  disableCopyPaste: z.boolean().default(false),
  requireQueue: z.boolean().default(false),
  batchSize: z.number().int().min(1).default(10),
  batchInterval: z.number().int().min(1).default(3),
  restrictIp: z.boolean().default(false),
  requireLockdown: z.boolean().default(false),
  showResultImmediately: z.boolean().default(true),
});

/**
 * Schema for an exam entity, containing all configuration including timing, scoring,
 * question selection, control flags, and retake policies.
 */
export const ExamSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  courseId: z.string().uuid(),
  status: ExamStatusEnum,
  timingMode: TimingModeEnum,
  durationMinutes: z.number().int().positive(),
  openAt: z.string().datetime(),
  closeAt: z.string().datetime(),
  passingScore: z.number().min(0),
  totalScore: z.number().positive(),
  questionSelectionMode: QuestionSelectionModeEnum,
  questionIds: z.array(z.string().uuid()),
  controlFlags: ControlFlagsSchema,
  retakePolicy: RetakePolicyEnum,
  scoreStrategy: ScoreStrategyEnum,
  maxAttempts: z.number().int().min(1),
  // ADR-005 Slice 3 timing policy. null = disabled.
  latestStartOffsetMinutes: z.number().int().nullable(),
  minSubmitAfterStartMinutes: z.number().int().nullable(),
  // P2D-J5a: result publishing policy + manual publish timestamp.
  resultPublicationMode: ResultPublicationModeEnum,
  resultsPublishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a complete exam entity with all configuration and metadata. */
export type ExamDTO = z.infer<typeof ExamSchema>;

/**
 * Request schema for enrolling candidates into an exam.
 */
export const EnrollCandidatesRequestSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1),
});

/** Type for an enroll-candidates request. */
export type EnrollCandidatesRequest = z.infer<
  typeof EnrollCandidatesRequestSchema
>;

/**
 * Request schema for creating a new exam. Phase 1 supports only `timed_window` timing
 * and `manual` question selection.
 */
export const CreateExamRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  courseId: z.string().uuid(),
  timingMode: Phase1TimingModeEnum.default("timed_window"),
  durationMinutes: z.number().int().positive(),
  openAt: z.string().datetime(),
  closeAt: z.string().datetime(),
  passingScore: z.number().min(0),
  totalScore: z.number().positive(),
  questionSelectionMode: Phase1QuestionSelectionModeEnum.default("manual"),
  questionIds: z.array(z.string().uuid()).default([]),
  controlFlags: ControlFlagsSchema.default({}),
  retakePolicy: Phase1RetakePolicyEnum.default("unlimited"),
  scoreStrategy: ScoreStrategyEnum.default("highest"),
  maxAttempts: z.number().int().min(1).default(1),
  // ADR-005 Slice 3 timing policy. null/omitted = disabled.
  latestStartOffsetMinutes: z.number().int().min(0).nullish(),
  minSubmitAfterStartMinutes: z.number().int().min(0).nullish(),
  // P2D-J5a: result publishing policy. Optional here so the API boundary can
  // detect "caller did not send it" and coerce from the legacy
  // controlFlags.showResultImmediately; the route handler applies the
  // 'immediate' default after coercion.
  resultPublicationMode: ResultPublicationModeEnum.optional(),
});

/** Type for a create-exam request. */
export type CreateExamRequest = z.infer<typeof CreateExamRequestSchema>;

/**
 * Request schema for updating an existing exam. All fields are optional;
 * only provided fields will be updated.
 */
export const UpdateExamRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  timingMode: Phase1TimingModeEnum.optional(),
  durationMinutes: z.number().int().positive().optional(),
  openAt: z.string().datetime().optional(),
  closeAt: z.string().datetime().optional(),
  passingScore: z.number().min(0).optional(),
  totalScore: z.number().positive().optional(),
  questionIds: z.array(z.string().uuid()).optional(),
  controlFlags: ControlFlagsSchema.partial().optional(),
  retakePolicy: Phase1RetakePolicyEnum.optional(),
  scoreStrategy: ScoreStrategyEnum.optional(),
  maxAttempts: z.number().int().min(1).optional(),
  latestStartOffsetMinutes: z.number().int().min(0).nullish(),
  minSubmitAfterStartMinutes: z.number().int().min(0).nullish(),
  // P2D-J5a: result publishing policy. Optional on update (only draft exams
  // accept full edits; published is schedule-only per ADR-005 Slice 2 §3.7).
  resultPublicationMode: ResultPublicationModeEnum.optional(),
});

/** Type for an update-exam request. */
export type UpdateExamRequest = z.infer<typeof UpdateExamRequestSchema>;

// ── Exam Enrollment ───────────────────────────────────────────────

/**
 * Schema for an exam enrollment record, tracking a candidate's enrollment status,
 * attempt count, and final score for a specific exam.
 */
export const ExamEnrollmentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  examId: z.string().uuid(),
  candidateId: z.string().uuid(),
  status: z.enum(["assigned", "started", "completed", "blocked"]),
  attemptCount: z.number().int(),
  finalScore: z.number().optional(),
  finalPassed: z.boolean().optional(),
  finalAttemptId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a candidate's enrollment in an exam with attempt tracking. */
export type ExamEnrollmentDTO = z.infer<typeof ExamEnrollmentSchema>;
