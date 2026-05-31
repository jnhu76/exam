import { z } from "zod";

// ── Exam ──────────────────────────────────────────────────────────

const ExamStatusEnum = z.enum([
  "draft",
  "published",
  "open",
  "closed",
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExamDTO = z.infer<typeof ExamSchema>;

export const CreateExamRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  courseId: z.string().uuid(),
  timingMode: TimingModeEnum.default("timed_window"),
  durationMinutes: z.number().int().positive(),
  openAt: z.string().datetime(),
  closeAt: z.string().datetime(),
  passingScore: z.number().min(0),
  totalScore: z.number().positive(),
  questionSelectionMode: QuestionSelectionModeEnum.default("manual"),
  questionIds: z.array(z.string().uuid()).default([]),
  controlFlags: ControlFlagsSchema.default({}),
  retakePolicy: RetakePolicyEnum.default("unlimited"),
  scoreStrategy: ScoreStrategyEnum.default("highest"),
  maxAttempts: z.number().int().min(1).default(1),
});
export type CreateExamRequest = z.infer<typeof CreateExamRequestSchema>;

export const UpdateExamRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  timingMode: TimingModeEnum.optional(),
  durationMinutes: z.number().int().positive().optional(),
  openAt: z.string().datetime().optional(),
  closeAt: z.string().datetime().optional(),
  passingScore: z.number().min(0).optional(),
  totalScore: z.number().positive().optional(),
  questionIds: z.array(z.string().uuid()).optional(),
  controlFlags: ControlFlagsSchema.partial().optional(),
  retakePolicy: RetakePolicyEnum.optional(),
  scoreStrategy: ScoreStrategyEnum.optional(),
  maxAttempts: z.number().int().min(1).optional(),
});
export type UpdateExamRequest = z.infer<typeof UpdateExamRequestSchema>;

// ── Exam Enrollment ───────────────────────────────────────────────

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
export type ExamEnrollmentDTO = z.infer<typeof ExamEnrollmentSchema>;
