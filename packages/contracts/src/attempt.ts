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

export const SaveAnswerRejectReasonEnum = z.enum([
  "STALE_VERSION",
  "ATTEMPT_ALREADY_SUBMITTED",
  "ATTEMPT_CLOSED",
  "DEADLINE_EXCEEDED",
] as const);
export type SaveAnswerRejectReason = z.infer<typeof SaveAnswerRejectReasonEnum>;

export const QuestionSnapshotSchema = z.object({
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
    }),
  ),
  options: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
    }),
  ),
  standardAnswer: z.unknown(),
  score: z.number(),
  gradingRule: z.object({
    multiSelectScoring: z.enum(["all_correct_full", "partial_half"]),
    fillBlankMatchMode: z.enum(["exact", "keyword"]),
    fillBlankCaseSensitive: z.boolean().optional(),
  }),
  order: z.number().int(),
});

export const CandidateQuestionSnapshotSchema = QuestionSnapshotSchema.omit({
  standardAnswer: true,
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

export const LoadAttemptResponseSchema = AttemptSchema.extend({
  questionSnapshot: z.array(CandidateQuestionSnapshotSchema),
});
export type LoadAttemptResponse = z.infer<typeof LoadAttemptResponseSchema>;

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

export const SaveAnswerAcceptedSchema = z
  .object({
    accepted: z.literal(true),
    serverVersion: z.number().int(),
    savedAt: z.string().datetime(),
  })
  .strict();

export const SaveAnswerRejectedSchema = z
  .object({
    accepted: z.literal(false),
    reason: SaveAnswerRejectReasonEnum,
    message: z.string(),
    serverVersion: z.number().int(),
    savedAt: z.string().datetime(),
    details: z
      .object({
        serverAnswer: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();

export const SaveAnswerResponseSchema = z.discriminatedUnion("accepted", [
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
]);
export type SaveAnswerResponseDTO = z.infer<typeof SaveAnswerResponseSchema>;

// ── Route Params ─────────────────────────────────────────────────

export const AttemptIdParamsSchema = z.object({
  attemptId: z.string().uuid(),
});

export const LoadAttemptParamsSchema = z.object({
  id: z.string().uuid(),
});

export const SaveAnswerParamsSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
});

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
export type RestoreAttemptRequest = z.infer<typeof RestoreAttemptRequestSchema>;

// ── Queue ─────────────────────────────────────────────────────────

export const QueueStatusResponseSchema = z.object({
  examId: z.string().uuid(),
  status: z.enum(["waiting", "ready"]),
  position: z.number().int().positive(),
  waitCount: z.number().int().min(0),
  estimatedWaitSeconds: z.number().int().min(0),
});
export type QueueStatusResponse = z.infer<typeof QueueStatusResponseSchema>;

export const CandidateExamDetailResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  durationMinutes: z.number().int().positive(),
  passingScore: z.number(),
  totalScore: z.number(),
  questionCount: z.number().int().min(0),
  controlFlags: z.object({
    shuffleQuestions: z.boolean(),
    shuffleOptions: z.boolean(),
    detectTabSwitch: z.boolean(),
    disableCopyPaste: z.boolean(),
    requireQueue: z.boolean(),
    batchSize: z.number().int().positive(),
    batchInterval: z.number().int().positive(),
    restrictIp: z.boolean(),
    requireLockdown: z.boolean(),
    showResultImmediately: z.boolean(),
  }),
  maxAttempts: z.number().int().positive(),
  currentAttempts: z.number().int().min(0),
  activeAttemptId: z.string().uuid().optional(),
  canStartNewAttempt: z.boolean(),
  blockingReason: z.enum(["max_attempts_reached", "already_passed"]).optional(),
});
export type CandidateExamDetailResponse = z.infer<
  typeof CandidateExamDetailResponseSchema
>;
