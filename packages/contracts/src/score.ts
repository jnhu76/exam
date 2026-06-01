import { z } from "zod";

// ── Score List ────────────────────────────────────────────────────

export const QuestionScoreResultSchema = z.object({
  questionId: z.string(),
  score: z.number(),
  maxScore: z.number(),
  correct: z.boolean(),
  candidateAnswer: z.unknown(),
  standardAnswer: z.unknown(),
});

export const ScoreResultSchema = z.object({
  attemptId: z.string().uuid(),
  totalScore: z.number(),
  passed: z.boolean(),
  questionResults: z.array(QuestionScoreResultSchema),
  gradedAt: z.string().datetime(),
});
export type ScoreResultDTO = z.infer<typeof ScoreResultSchema>;

export const AttemptScoreParamsSchema = z.object({
  attemptId: z.string().uuid(),
});

const AttemptQuestionResultSchema = QuestionScoreResultSchema.extend({
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
  ]),
  content: z.string(),
  order: z.number().int(),
});

const HiddenAttemptResultSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.enum([
    "not_started",
    "queued",
    "in_progress",
    "disrupted",
    "submitted",
    "grading",
    "graded",
    "voided",
  ]),
  showResultImmediately: z.literal(false),
  examTitle: z.string(),
});

const VisibleAttemptResultSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.literal("graded"),
  showResultImmediately: z.literal(true),
  examTitle: z.string(),
  passingScore: z.number(),
  totalScore: z.number(),
  passed: z.boolean(),
  gradedAt: z.string().datetime(),
  questionResults: z.array(AttemptQuestionResultSchema),
});

export const AttemptResultResponseSchema = z.discriminatedUnion(
  "showResultImmediately",
  [HiddenAttemptResultSchema, VisibleAttemptResultSchema],
);
export type AttemptResultResponse = z.infer<typeof AttemptResultResponseSchema>;

export const ScoreListItemSchema = z.object({
  attemptId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateName: z.string(),
  candidateFields: z.record(z.unknown()),
  examId: z.string().uuid(),
  examTitle: z.string(),
  score: z.number(),
  passed: z.boolean(),
  attemptNo: z.number().int(),
  submittedAt: z.string().datetime().optional(),
});
export type ScoreListItem = z.infer<typeof ScoreListItemSchema>;

export const ScoreListQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  passFilter: z.enum(["all", "passed", "failed"]).default("all"),
  search: z.string().optional(),
  sortBy: z
    .enum(["score", "submittedAt", "candidateName"])
    .default("submittedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type ScoreListQuery = z.infer<typeof ScoreListQuerySchema>;

// ── Export ────────────────────────────────────────────────────────

export const ExportScoresRequestSchema = z.object({
  examId: z.string().uuid(),
  format: z.enum(["csv"]).default("csv"),
});
export type ExportScoresRequest = z.infer<typeof ExportScoresRequestSchema>;
