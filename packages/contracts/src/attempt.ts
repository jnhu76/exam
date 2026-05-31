import { z } from "zod";

// ── Attempt ───────────────────────────────────────────────────────

const AttemptStatusEnum = z.enum([
  "not_started",
  "queued",
  "in_progress",
  "disrupted",
  "submitted",
  "grading",
  "graded",
  "voided",
]);

const ConflictReasonEnum = z.enum([
  "STALE_VERSION",
  "SUBMITTED",
  "ATTEMPT_CLOSED",
]);

const QuestionSnapshotSchema = z.object({
  originalQuestionId: z.string(),
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
  ]),
  content: z.string(),
  attachments: z.array(
    z.object({
      url: z.string(),
      type: z.enum(["image", "file"]),
      name: z.string(),
    })
  ),
  options: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
    })
  ),
  standardAnswer: z.unknown(),
  score: z.number(),
  gradingRule: z.object({
    multiSelectScoring: z.enum(["all_correct_full", "partial_half"]),
    fillBlankMatchMode: z.enum(["exact", "keyword"]),
  }),
  order: z.number().int(),
});

const AnswerRecordSchema = z.object({
  questionId: z.string(),
  answer: z.unknown(),
  version: z.number().int(),
  savedAt: z.string().datetime(),
});

export const AttemptSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  examId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  candidateId: z.string().uuid(),
  attemptNo: z.number().int(),
  status: AttemptStatusEnum,
  questionSnapshot: z.array(QuestionSnapshotSchema),
  answers: z.array(AnswerRecordSchema),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  startedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  deadlineAt: z.string().datetime().optional(),
  lastActivityAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttemptDTO = z.infer<typeof AttemptSchema>;

// ── Save Answer (§3.5) ───────────────────────────────────────────

export const SaveAnswerRequestSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: z.unknown(),
  clientSeq: z.number().int().min(0),
  clientSavedAt: z.string().datetime(),
  baseVersion: z.number().int().min(0),
});
export type SaveAnswerRequestDTO = z.infer<typeof SaveAnswerRequestSchema>;

export const SaveAnswerResponseSchema = z.object({
  accepted: z.boolean(),
  serverVersion: z.number().int(),
  savedAt: z.string().datetime(),
  conflict: z
    .object({
      reason: ConflictReasonEnum,
      latestAnswer: z.unknown().optional(),
    })
    .optional(),
});
export type SaveAnswerResponseDTO = z.infer<typeof SaveAnswerResponseSchema>;

// ── Start Attempt ─────────────────────────────────────────────────

export const StartAttemptRequestSchema = z.object({
  examId: z.string().uuid(),
});
export type StartAttemptRequest = z.infer<typeof StartAttemptRequestSchema>;

// ── Heartbeat ─────────────────────────────────────────────────────

export const HeartbeatRequestSchema = z.object({
  attemptId: z.string().uuid(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

// ── Submit ────────────────────────────────────────────────────────

export const SubmitAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
});
export type SubmitAttemptRequest = z.infer<typeof SubmitAttemptRequestSchema>;

// ── Restore ───────────────────────────────────────────────────────

export const RestoreAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
});
export type RestoreAttemptRequest = z.infer<
  typeof RestoreAttemptRequestSchema
>;
