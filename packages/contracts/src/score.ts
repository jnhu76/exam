import { z } from "zod";

// ── Score List ────────────────────────────────────────────────────

/**
 * Schema for a per-question score result, including scores, correctness, and answer comparison.
 */
export const QuestionScoreResultSchema = z.object({
  questionId: z.string(),
  score: z.number(),
  maxScore: z.number(),
  correct: z.boolean(),
  candidateAnswer: z.unknown(),
  standardAnswer: z.unknown(),
});

// ── Manual Grading (P2D-J2) ──────────────────────────────────────

/**
 * Grading workflow status for an attempt.
 *
 * - `auto_graded`: attempt was graded entirely by the auto-grading engine.
 * - `pending_manual`: attempt has subjective questions awaiting manual scoring.
 * - `fully_graded`: all questions (auto + manual) have been scored.
 *
 * Stored as a plain text column on `exam_attempts` (see ADR: repository
 * enum-column convention; `pgEnum` is intentionally not used).
 */
export const GradingStatusEnum = z.enum([
  "auto_graded",
  "pending_manual",
  "fully_graded",
]);

/**
 * Schema for a single manual grading entry — one grader's score + comment
 * for one subjective question within one attempt. Uniqueness of
 * (attemptId, questionId) is enforced at the DB layer.
 *
 * P3-L0-2E Slice 3: manual grading entries now live in
 * `attempt_grading_entries` (status `completed_manual`). The legacy
 * `manual_grading_entries` table and its dedicated DTO are removed; the
 * public grading-details/grade-question response shapes remain unchanged.
 */

// ── Grading Queue (P2D-J3) ───────────────────────────────────────

/**
 * A single row in the admin grading queue: one attempt awaiting manual
 * scoring, joined with candidate + exam identity for display.
 */
export const GradingQueueItemSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  examTitle: z.string(),
  candidateId: z.string().uuid(),
  candidateName: z.string(),
  submittedAt: z.string().datetime().nullable(),
  gradingStatus: GradingStatusEnum,
  /** Count of subjective questions not yet scored. */
  pendingQuestionCount: z.number().int().min(0),
});
/** A grading-queue row. */
export type GradingQueueItem = z.infer<typeof GradingQueueItemSchema>;

/**
 * Query for `GET /admin/grading-queue`: pagination + optional exam filter.
 * Status is implicitly `pending_manual` (the queue only lists attempts
 * awaiting manual grading).
 */
export const GradingQueueListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  examId: z.string().uuid().optional(),
});
/** Query for the grading queue list endpoint. */
export type GradingQueueListQuery = z.infer<typeof GradingQueueListQuerySchema>;

/**
 * Response for `GET /admin/grading-queue`: paginated queue items + total.
 */
export const GradingQueueListResponseSchema = z.object({
  items: z.array(GradingQueueItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
/** Response for the grading queue list endpoint. */
export type GradingQueueListResponse = z.infer<
  typeof GradingQueueListResponseSchema
>;

/**
 * One subjective question's grading state within a grading-details response.
 * `entry` is null until the question has been scored.
 */
export const GradingDetailsQuestionSchema = z.object({
  questionId: z.string(),
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "text_response",
  ]),
  content: z.string(),
  maxScore: z.number(),
  /**
   * Frozen reference answer from the QuestionSnapshot (not the live question
   * row). Null when the text_response had no standardAnswer at freeze time.
   * Grader basis only — never surfaced to candidates via CandidateTakeSnapshot.
   */
  standardAnswer: z.unknown().nullable(),
  /**
   * Frozen scoring rubric from the QuestionSnapshot (text_response grading
   * basis). Null for objective questions or snapshots without a rubric.
   */
  rubric: z.string().nullable(),
  /** The candidate's submitted answer for this question, or null if unanswered. */
  candidateAnswer: z.unknown().nullable(),
  entry: z
    .object({
      score: z.number(),
      comment: z.string(),
      gradedBy: z.string().uuid(),
      gradedAt: z.string().datetime(),
    })
    .nullable(),
});
/** A subjective question's grading state. */
export type GradingDetailsQuestion = z.infer<
  typeof GradingDetailsQuestionSchema
>;

/**
 * Response for `GET /admin/attempts/:attemptId/grading-details`: attempt
 * summary + the subjective questions awaiting manual scoring with their
 * current grading state.
 */
export const GradingDetailsResponseSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  examTitle: z.string(),
  candidateId: z.string().uuid(),
  candidateName: z.string(),
  gradingStatus: GradingStatusEnum,
  questions: z.array(GradingDetailsQuestionSchema),
});
/** Response for the grading-details endpoint. */
export type GradingDetailsResponse = z.infer<
  typeof GradingDetailsResponseSchema
>;

/**
 * Request body for `POST /admin/attempts/:attemptId/grade-question`.
 *
 * `score` must be ≥ 0; the per-question upper bound (maxScore) is enforced
 * server-side in the handler since the snapshot lives on the attempt, not
 * in the request. `comment` is optional and capped at 2000 chars.
 */
export const GradeQuestionRequestSchema = z.object({
  questionId: z.string().min(1),
  score: z.number().min(0),
  comment: z.string().max(2000).default(""),
});
/** Request body for grade-question. */
export type GradeQuestionRequest = z.infer<typeof GradeQuestionRequestSchema>;

/**
 * Response for `POST grade-question`: the updated grading status + whether
 * the attempt is now fully graded. When fully graded, `totalScore`/`passed`
 * carry the reconciled attempt total (objective + manual).
 */
export const GradeQuestionResponseSchema = z.object({
  attemptId: z.string().uuid(),
  gradingStatus: GradingStatusEnum,
  questionId: z.string(),
  score: z.number(),
  fullyGraded: z.boolean(),
  totalScore: z.number().optional(),
  passed: z.boolean().optional(),
});
/** Response for grade-question. */
export type GradeQuestionResponse = z.infer<typeof GradeQuestionResponseSchema>;

/**
 * Schema for the complete score result of an attempt, including per-question results
 * and overall pass/fail status.
 */
export const ScoreResultSchema = z.object({
  attemptId: z.string().uuid(),
  totalScore: z.number(),
  passed: z.boolean(),
  questionResults: z.array(QuestionScoreResultSchema),
  gradedAt: z.string().datetime(),
});

/** Represents the complete grading result for a single attempt. */
export type ScoreResultDTO = z.infer<typeof ScoreResultSchema>;

/**
 * Route params schema for fetching score details for a specific attempt.
 */
export const AttemptScoreParamsSchema = z.object({
  attemptId: z.string().uuid(),
});

const AttemptQuestionResultSchema = QuestionScoreResultSchema.extend({
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "text_response",
  ]),
  content: z.string(),
  order: z.number().int(),
});

/**
 * Reason the full result is withheld in the hidden response variant (P2D-J5a).
 *
 * - `not_graded` — grading is incomplete or pending manual scoring; the result
 *   is not yet computable.
 * - `pending_publish` — manual publication mode and the admin has not yet
 *   called publish-results (resultsPublishedAt is null).
 * - `not_started` — attempt is in any non-graded lifecycle state (in_progress,
 *   submitted, grading, voided, disrupted, etc.). The result is not yet
 *   computable; the label is historical, not literal.
 */
export const HiddenReasonEnum = z.enum([
  "not_graded",
  "pending_publish",
  "not_started",
]);

/** Type for the {@link HiddenReasonEnum} values. */
export type HiddenReason = z.infer<typeof HiddenReasonEnum>;

/**
 * Response variant when the exam's showResultImmediately flag is false.
 * Only returns attempt status and exam title without score details.
 * Optional `hiddenReason` (P2D-J5a) lets the frontend show a precise message.
 */
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
  hiddenReason: HiddenReasonEnum.optional(),
});

/**
 * Response variant when the exam's showResultImmediately flag is true.
 * Includes full score details, per-question results, and pass/fail status.
 */
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

/**
 * Discriminated union of attempt result responses, keyed on showResultImmediately.
 * Hidden variant omits scores; visible variant includes full grading details.
 */
export const AttemptResultResponseSchema = z.discriminatedUnion(
  "showResultImmediately",
  [HiddenAttemptResultSchema, VisibleAttemptResultSchema],
);

/** Type for an attempt result response (hidden or visible variant). */
export type AttemptResultResponse = z.infer<typeof AttemptResultResponseSchema>;

/**
 * Schema for a single row in the score list, including candidate and exam identifiers,
 * score, pass status, and attempt number.
 */
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

/** Type for a single score list row. */
export type ScoreListItem = z.infer<typeof ScoreListItemSchema>;

/**
 * Query schema for listing scores with pagination, pass/fail filtering, search, and sorting.
 */
export const ScoreListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  passFilter: z.enum(["all", "passed", "failed"]).default("all"),
  search: z.string().optional(),
  sortBy: z
    .enum(["score", "submittedAt", "candidateName"])
    .default("submittedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/** Type for a score list query. */
export type ScoreListQuery = z.infer<typeof ScoreListQuerySchema>;

/**
 * Schema for aggregate statistics across a score list, including average, min, max scores
 * and pass rate.
 */
export const ScoreListStatsSchema = z.object({
  averageScore: z.number(),
  maxScore: z.number(),
  minScore: z.number(),
  passRate: z.number(),
  totalGraded: z.number().int(),
});

/** Type for score list aggregate statistics. */
export type ScoreListStats = z.infer<typeof ScoreListStatsSchema>;

/**
 * Response schema for the paginated score list, including items, aggregate stats, and pagination.
 */
export const ScoreListResponseSchema = z.object({
  items: z.array(ScoreListItemSchema),
  stats: ScoreListStatsSchema,
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

/** Type for the paginated score list response. */
export type ScoreListResponse = z.infer<typeof ScoreListResponseSchema>;

// ── Export ────────────────────────────────────────────────────────

/**
 * Request schema for exporting scores for a given exam. Currently supports CSV format.
 */
export const ExportScoresRequestSchema = z.object({
  examId: z.string().uuid(),
  format: z.enum(["csv"]).default("csv"),
});

/** Type for an export-scores request. */
export type ExportScoresRequest = z.infer<typeof ExportScoresRequestSchema>;
