import { z } from "zod";
import { AvailabilityStatusEnum, PrimaryActionEnum } from "./candidate.js";
import { GradingStatusEnum as GradingStatusFromScore } from "./score.js";

// ── Attempt ───────────────────────────────────────────────────────

const MisconductSeverityEnum = z.enum(["warning", "serious"]);

/**
 * Schema for a misconduct flag recorded on an attempt (P2C-J4).
 */
export const MisconductFlagSchema = z.object({
  flaggedAt: z.string().datetime(),
  flaggedBy: z.string(),
  notes: z.string().min(1).max(1000),
  severity: MisconductSeverityEnum,
});
/** DTO for a misconduct flag. */
export type MisconductFlagDTO = z.infer<typeof MisconductFlagSchema>;

export const AttemptStatusEnum = z.enum([
  "not_started",
  "queued",
  "in_progress",
  "disrupted",
  "submitted",
  "grading",
  "graded",
  "voided",
]);
export type AttemptStatusValue = z.infer<typeof AttemptStatusEnum>;

/**
 * Zod enum of reasons a save-answer request may be rejected by the server.
 */
export const SaveAnswerRejectReasonEnum = z.enum([
  "STALE_VERSION",
  "ATTEMPT_ALREADY_SUBMITTED",
  "ATTEMPT_CLOSED",
  "DEADLINE_EXCEEDED",
  "CONFLICTING_PAYLOAD",
] as const);

/** Discriminated reason why the server rejected a save-answer request. */
export type SaveAnswerRejectReason = z.infer<typeof SaveAnswerRejectReasonEnum>;

/**
 * Schema for a frozen snapshot of a question copied into an attempt at creation time.
 * Edits to the original question do not affect existing snapshots.
 */
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

/**
 * Candidate-safe question snapshot that omits the standardAnswer field.
 * Used when returning attempt data to candidates.
 */
export const CandidateQuestionSnapshotSchema = QuestionSnapshotSchema.omit({
  standardAnswer: true,
});

const AnswerRecordSchema = z.object({
  questionId: z.string(),
  answer: z.unknown(),
  version: z.number().int(),
  savedAt: z.string().datetime(),
});

/**
 * Schema for an exam attempt record, including status, question snapshots, answers, scores, and timing.
 */
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
  misconduct: MisconductFlagSchema.nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a single exam attempt including all question snapshots, answers, and scoring data. */
export type AttemptDTO = z.infer<typeof AttemptSchema>;

/**
 * Response schema for loading an attempt, with question snapshots stripped of standardAnswer
 * to prevent candidates from seeing correct answers.
 */
export const LoadAttemptResponseSchema = AttemptSchema.extend({
  questionSnapshot: z.array(CandidateQuestionSnapshotSchema),
  serverNow: z.string().datetime(),
});

/** Type for the load-attempt response with candidate-safe question snapshots. */
export type LoadAttemptResponse = z.infer<typeof LoadAttemptResponseSchema>;

// ── Save Answer (§3.5) ───────────────────────────────────────────

/**
 * Request schema for saving an answer with versioned conflict detection.
 * Uses baseVersion for optimistic concurrency control.
 */
export const SaveAnswerRequestSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: z.unknown(),
  clientSeq: z.number().int().min(0),
  clientSavedAt: z.string().datetime(),
  baseVersion: z.number().int().min(0),
});

/** Type for a save-answer request with client-side version metadata. */
export type SaveAnswerRequestDTO = z.infer<typeof SaveAnswerRequestSchema>;

/**
 * Response when the server accepts a save-answer request.
 */
export const SaveAnswerAcceptedSchema = z
  .object({
    accepted: z.literal(true),
    serverVersion: z.number().int(),
    savedAt: z.string().datetime(),
  })
  .strict();

/**
 * Response when the server rejects a save-answer request due to a version conflict or attempt state issue.
 */
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

/**
 * Discriminated union of accepted and rejected save-answer responses,
 * keyed on the `accepted` field.
 */
export const SaveAnswerResponseSchema = z.discriminatedUnion("accepted", [
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
]);

/** Type for a save-answer response (accepted or rejected). */
export type SaveAnswerResponseDTO = z.infer<typeof SaveAnswerResponseSchema>;

// ── Route Params ─────────────────────────────────────────────────

/**
 * Route params schema for endpoints that operate on a specific attempt by UUID.
 */
export const AttemptIdParamsSchema = z.object({
  attemptId: z.string().uuid(),
});

/**
 * Route params schema for the load-attempt endpoint, identified by attempt `id`.
 */
export const LoadAttemptParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Route params schema for save-answer endpoints, requiring both attemptId and questionId.
 */
export const SaveAnswerParamsSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
});

// ── Start Attempt ─────────────────────────────────────────────────

/**
 * Request schema for starting a new exam attempt. Requires the exam UUID.
 */
export const StartAttemptRequestSchema = z.object({
  examId: z.string().uuid(),
});

/** Type for a start-attempt request. */
export type StartAttemptRequest = z.infer<typeof StartAttemptRequestSchema>;

// ── Heartbeat ─────────────────────────────────────────────────────

/**
 * Request schema for sending a periodic heartbeat to indicate the candidate is still active.
 */
export const HeartbeatRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

/** Type for a heartbeat request. */
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

// ── Submit ────────────────────────────────────────────────────────

/**
 * Request schema for submitting an attempt for grading.
 */
export const SubmitAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

/** Type for a submit-attempt request. */
export type SubmitAttemptRequest = z.infer<typeof SubmitAttemptRequestSchema>;

// ── Restore ───────────────────────────────────────────────────────

/**
 * Request schema for restoring a disrupted attempt, recovering saved answers and remaining time from the server.
 */
export const RestoreAttemptRequestSchema = z.object({
  attemptId: z.string().uuid(),
});

/** Type for a restore-attempt request. */
export type RestoreAttemptRequest = z.infer<typeof RestoreAttemptRequestSchema>;

// ── Flag Misconduct (Admin) ──────────────────────────────────────

/**
 * Request body schema for an admin flagging misconduct on an attempt.
 */
export const FlagMisconductRequestSchema = z.object({
  severity: MisconductSeverityEnum,
  notes: z.string().min(1).max(1000),
});

/** Type for a flag-misconduct request body. */
export type FlagMisconductRequest = z.infer<typeof FlagMisconductRequestSchema>;

/** Response schema for a flag-misconduct action. */
export const FlagMisconductResponseSchema = z.object({
  ok: z.literal(true),
});

/** Type for a flag-misconduct response. */
export type FlagMisconductResponse = z.infer<
  typeof FlagMisconductResponseSchema
>;

// ── Proctor Incident (P3-M9) ────────────────────────────────────

/**
 * Allowed incident types for proctor incident logging v0.
 * Each value maps to a specific proctor observation category.
 */
export const ProctorIncidentTypeEnum = z.enum([
  "suspicious_behavior_marked",
  "network_issue_marked",
  "identity_check_failed",
  "manual_note_added",
]);
/** Type for proctor incident type enum. */
export type ProctorIncidentType = z.infer<typeof ProctorIncidentTypeEnum>;

/**
 * Request body schema for a proctor marking an incident on an attempt.
 * Audit-event-only storage — no dedicated incident table.
 * `note` is optional, length-limited, and must not contain candidate answers.
 */
export const MarkProctorIncidentRequestSchema = z.object({
  incidentType: ProctorIncidentTypeEnum,
  examId: z.string().uuid(),
  candidateId: z.string().uuid().optional(),
  attemptId: z.string().uuid().optional(),
  reasonCode: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});
/** Type for a proctor incident request body. */
export type MarkProctorIncidentRequest = z.infer<
  typeof MarkProctorIncidentRequestSchema
>;

/** Response schema for a proctor incident action. */
export const MarkProctorIncidentResponseSchema = z.object({
  ok: z.literal(true),
});
/** Type for a proctor incident response. */
export type MarkProctorIncidentResponse = z.infer<
  typeof MarkProctorIncidentResponseSchema
>;

// ── Force Submit (Admin) ──────────────────────────────────────────

/**
 * Request body schema for an admin force-submitting an attempt.
 * `reason` is an optional human-readable note recorded in the audit log.
 */
export const ForceSubmitRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});

/** Type for a force-submit request body. */
export type ForceSubmitRequest = z.infer<typeof ForceSubmitRequestSchema>;

// ── Extend Time (Admin) ──────────────────────────────────────────

/**
 * Request body schema for an admin extending an attempt's deadline by a
 * positive number of minutes. Only in_progress/disrupted attempts may be
 * extended; an extension beyond exam.closeAt is rejected.
 */
export const ExtendTimeRequestSchema = z.object({
  additionalMinutes: z.number().int().positive(),
});

/** Type for an extend-time request body. */
export type ExtendTimeRequest = z.infer<typeof ExtendTimeRequestSchema>;

// ── Attempt Export (P2E-J4) ────────────────────────────────────────

/**
 * Schema for a single question result in the export payload.
 * Represents the candidate's answer, the standard answer, and scoring.
 */
export const AttemptExportQuestionResultSchema = z.object({
  order: z.number().int(),
  type: z.string(),
  content: z.string(),
  candidateAnswer: z.unknown(),
  standardAnswer: z.unknown(),
  score: z.number().nullish(),
  maxScore: z.number(),
  correct: z.boolean().nullish(),
});

/** Type for a single question result in the export payload. */
export type AttemptExportQuestionResult = z.infer<
  typeof AttemptExportQuestionResultSchema
>;

/**
 * Schema for the full attempt export data payload returned by
 * `GET /api/admin/attempts/:id/export`.
 */
export const AttemptExportDataSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  attemptNo: z.number().int(),
  status: z.string(),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  startedAt: z.string().datetime().optional(),
  submittedAt: z.string().datetime().optional(),
  deadlineAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  questionResults: z.array(AttemptExportQuestionResultSchema),
});

/** Type for the full attempt export data payload. */
export type AttemptExportData = z.infer<typeof AttemptExportDataSchema>;

/**
 * Response schema for `GET /api/admin/attempts/:id/export` (JSON format).
 */
export const AttemptExportResponseSchema = AttemptExportDataSchema;

/** Type for the attempt export JSON response. */
export type AttemptExportResponse = z.infer<typeof AttemptExportResponseSchema>;

// ── Queue ─────────────────────────────────────────────────────────

/**
 * Response schema for queue status when an exam uses batched entry (requireQueue mode).
 * Shows the candidate's position and estimated wait time.
 */
export const QueueStatusResponseSchema = z.object({
  examId: z.string().uuid(),
  status: z.enum(["waiting", "ready"]),
  position: z.number().int().positive(),
  waitCount: z.number().int().min(0),
  estimatedWaitSeconds: z.number().int().min(0),
});

/** Type for queue status response. */
export type QueueStatusResponse = z.infer<typeof QueueStatusResponseSchema>;

/**
 * Detailed exam view for a candidate, including exam metadata, control flags, attempt history,
 * availability status, and the recommended primary action.
 */
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
  bestScore: z.number().optional(),
  bestScorePercent: z.number().optional(),
  availabilityStatus: AvailabilityStatusEnum,
  primaryAction: PrimaryActionEnum,
});

/** Type for a candidate's detailed exam view response. */
export type CandidateExamDetailResponse = z.infer<
  typeof CandidateExamDetailResponseSchema
>;

// ── CandidateTakeSnapshot (L0 §6.1) ─────────────────────────────

/**
 * InputMode derived from QuestionType. Not stored in DB.
 */
export const InputModeEnum = z.enum([
  "choice",
  "boolean",
  "single_line",
  "multi_line",
]);
export type InputMode = z.infer<typeof InputModeEnum>;

/**
 * GradingMode derived from QuestionType. Not stored in DB.
 */
export const GradingModeEnum = z.enum(["auto", "manual"]);
export type GradingMode = z.infer<typeof GradingModeEnum>;

/**
 * Answer source routing — which column the answerValue comes from.
 */
export const AnswerSourceEnum = z.enum(["draft", "submitted", "none"]);
export type AnswerSource = z.infer<typeof AnswerSourceEnum>;

/**
 * Visibility flags for candidate result/answer views.
 */
export const VisibilityEnum = z.enum(["hidden", "visible"]);
export type Visibility = z.infer<typeof VisibilityEnum>;

/**
 * Lock reason when isEditable is false.
 */
export const LockReasonEnum = z.enum([
  "deadline",
  "submitted",
  "voided",
  "disrupted",
]);
export type LockReason = z.infer<typeof LockReasonEnum>;

/**
 * Candidate-safe question with derived inputMode and answerValue/answerSource.
 * Part of CandidateTakeSnapshot (L0 §6.1).
 */
export const CandidateTakeQuestionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "text_response",
  ]),
  prompt: z.string(),
  options: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
    }),
  ),
  inputMode: InputModeEnum,
  maxScore: z.number(),
  answerValue: z.unknown().nullable(),
  answerSource: AnswerSourceEnum,
});
export type CandidateTakeQuestion = z.infer<typeof CandidateTakeQuestionSchema>;

/**
 * CandidateTakeSnapshot — the unified response from
 * GET /candidate/attempts/:attemptId/take (L0 §6.1).
 *
 * Contains attempt metadata, derived capabilities, safe questions with
 * answerValue/answerSource, server time fields, and visibility flags.
 * Never contains standardAnswer, rubric, gradingMode, correctOption,
 * teacher notes, or unreleased scores.
 */
export const CandidateTakeSnapshotSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  attemptStatus: AttemptStatusEnum,
  gradingStatus: GradingStatusFromScore,
  isEditable: z.boolean(),
  canStart: z.boolean(),
  canResume: z.boolean(),
  canSave: z.boolean(),
  canSubmit: z.boolean(),
  lockReason: LockReasonEnum.optional(),
  resultVisibility: VisibilityEnum,
  answerVisibility: VisibilityEnum,
  submittedAt: z.string().datetime().nullable(),
  serverNow: z.string().datetime(),
  effectiveDeadline: z.string().datetime().nullable(),
  serverRevision: z.union([z.string(), z.number()]),
  questions: z.array(CandidateTakeQuestionSchema),
});
export type CandidateTakeSnapshot = z.infer<typeof CandidateTakeSnapshotSchema>;

// ── Candidate Status (Admin / Proctor) ──────────────────────────

/**
 * Schema for a single candidate's live status in the proctor dashboard.
 * Used by GET /api/admin/exams/:examId/candidates/status (P2C-J5).
 */
export const CandidateStatusItemSchema = z.object({
  candidateId: z.string().uuid(),
  name: z.string(),
  attemptId: z.string().uuid().nullable(),
  status: z.enum([
    "not_started",
    "in_progress",
    "disrupted",
    "submitted",
    "grading",
    "graded",
    "voided",
  ]),
  deadlineAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime().nullable(),
  misconduct: MisconductFlagSchema.nullable(),
});

/** DTO for a single candidate's live status in the proctor dashboard. */
export type CandidateStatusItem = z.infer<typeof CandidateStatusItemSchema>;

/**
 * Response schema for the proctor dashboard candidate status endpoint.
 */
export const CandidateStatusResponseSchema = z.object({
  candidates: z.array(CandidateStatusItemSchema),
  total: z.number().int().nonnegative(),
});

/** Response type for the proctor dashboard candidate status endpoint. */
export type CandidateStatusResponse = z.infer<
  typeof CandidateStatusResponseSchema
>;
