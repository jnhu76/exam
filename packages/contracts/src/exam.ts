import { z } from "zod";
import {
  InterruptionTimePolicySchema,
  POSTGRES_INTEGER_MAX,
  normalizeInterruptionPolicyConfiguration,
} from "./interruption.js";

// ── Exam ──────────────────────────────────────────────────────────

export const ExamStatusEnum = z.enum([
  "draft",
  "published",
  "open",
  "closed",
  "canceled",
  "archived",
]);
export type ExamStatus = z.infer<typeof ExamStatusEnum>;
const TimingModeEnum = z.enum([
  "timed_sync",
  "timed_window",
  "deadline",
  "untimed",
]);
const QuestionSelectionModeEnum = z.enum(["manual", "random"]);
export const ScoreStrategyEnum = z.enum(["highest", "latest", "first"]);
const RetakePolicyEnum = z.enum([
  "unlimited",
  "max_attempts",
  "daily_limit",
  "weekly_limit",
  "pass_then_stop",
]);
const Phase1TimingModeEnum = z.literal("timed_window");
const Phase1QuestionSelectionModeEnum = z.literal("manual");
export const Phase1RetakePolicyEnum = z.enum([
  "unlimited",
  "max_attempts",
  "pass_then_stop",
]);
// P2D-J5a: result publishing policy. Authoritative visibility field;
// showResultImmediately remains as a legacy input only.
export const ResultPublicationModeEnum = z.enum([
  "immediate",
  "after_grading",
  "manual",
]);
export type ResultPublicationMode = z.infer<typeof ResultPublicationModeEnum>;

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
  // ADR-013 §3: interruption time-compensation policy. The DB column is
  // NOT NULL with a `strict` default, so the response always carries the
  // resolved policy. Caps are nullable (null for strict / operator_incident;
  // required positive integers for bounded_grace).
  interruptionTimePolicy: InterruptionTimePolicySchema,
  interruptionGracePerIncidentSeconds: z.number().int().positive().nullable(),
  interruptionGracePerAttemptSeconds: z.number().int().positive().nullable(),
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
 * Raw authoring shape for creating an exam (P7-M2 §20 Option A).
 *
 * This is the FASTIFY-BOUNDARY schema: it validates the raw request shape
 * WITHOUT applying any defaults (and without the canonical refine). Because
 * the fastify zod validator writes its parsed output back into
 * `request.body`, a defaults-applying schema would inject code defaults into
 * the body and defeat the profile presence detection ("caller omitted field"
 * would be indistinguishable from "Zod inserted the code default"). With this
 * raw schema the handler can detect TRUE omission, overlay profile defaults,
 * and then run the canonical full parse (`CreateExamRequestSchema`) which
 * applies code defaults to whatever is still omitted.
 *
 * Phase 1 supports only `timed_window` timing and `manual` question selection.
 */
export const CreateExamRequestBaseSchema = z.object({
  title: z.string().min(1).max(200),
  // Every field that carries a code default in the canonical schema is
  // OPTIONAL here (shape-only, no default, no required): the canonical parse
  // in the handler applies the defaults. `durationMinutes` is optional
  // because a selected exam policy profile may supply it — without a
  // profileId the canonical refine keeps it REQUIRED, so no-profile create
  // behavior is unchanged.
  description: z.string().max(2000).optional(),
  courseId: z.string().uuid(),
  timingMode: Phase1TimingModeEnum.optional(),
  durationMinutes: z.number().int().positive().optional(),
  openAt: z.string().datetime(),
  closeAt: z.string().datetime(),
  passingScore: z.number().min(0),
  totalScore: z.number().positive(),
  questionSelectionMode: Phase1QuestionSelectionModeEnum.optional(),
  questionIds: z.array(z.string().uuid()).optional(),
  // Raw passthrough at the fastify boundary: ControlFlagsSchema applies nested
  // defaults (showResultImmediately etc.), which would make the route's legacy
  // showResultImmediately presence check see a defaulted flag as explicit
  // input. The full schema parse in the handler validates the real shape.
  controlFlags: z.record(z.unknown()).optional(),
  retakePolicy: Phase1RetakePolicyEnum.optional(),
  scoreStrategy: ScoreStrategyEnum.optional(),
  maxAttempts: z.number().int().min(1).optional(),
  // ADR-005 Slice 3 timing policy. null/omitted = disabled.
  latestStartOffsetMinutes: z.number().int().min(0).nullish(),
  minSubmitAfterStartMinutes: z.number().int().min(0).nullish(),
  // P2D-J5a: result publishing policy. Optional here so the API boundary can
  // detect "caller did not send it" and coerce from the legacy
  // controlFlags.showResultImmediately; the route handler applies the
  // 'immediate' default after coercion.
  resultPublicationMode: ResultPublicationModeEnum.optional(),
  // ADR-013 §3: interruption time-compensation authoring fields. Optional
  // input; omitted resolves to `strict` with null caps. The route normalizes
  // via `normalizeInterruptionPolicyConfiguration`, which enforces the
  // ADR-013 cross-field rules (strict/operator_incident ⇒ null caps;
  // bounded_grace ⇒ both caps present, positive, perIncident ≤ perAttempt).
  interruptionTimePolicy: InterruptionTimePolicySchema.optional(),
  // Per-field shape bounds only (design §10): `.positive()` + PostgreSQL int
  // max. Cross-field caps rules (strict/op_incident ⇒ null caps; bounded_grace
  // ⇒ both caps, perIncident ≤ perAttempt) are enforced by the route's
  // `normalizeInterruptionPolicyConfiguration` + the canonical engine
  // validator, not by this schema.
  interruptionGracePerIncidentSeconds: z
    .number()
    .int()
    .positive()
    .max(POSTGRES_INTEGER_MAX)
    .nullish(),
  interruptionGracePerAttemptSeconds: z
    .number()
    .int()
    .positive()
    .max(POSTGRES_INTEGER_MAX)
    .nullish(),
  // P7-M2: optional authoring input selecting an exam policy profile. The
  // profile's defaults are COPY-ON-APPLY into the concrete Exam columns at
  // creation; the created Exam never depends on the profile at runtime.
  profileId: z.string().uuid().optional(),
});

/**
 * Canonical create-exam schema: the raw shape + the existing code defaults +
 * the P7-M2 guard. `durationMinutes` may be omitted ONLY when a profile is
 * selected (the profile supplies it). Without a profile, omitting
 * `durationMinutes` fails with the exact same `invalid_type` issue the schema
 * previously produced for the required field — no-profile behavior is
 * byte-identical.
 */
export const CreateExamRequestSchema = CreateExamRequestBaseSchema.extend({
  description: z.string().max(2000).default(""),
  timingMode: Phase1TimingModeEnum.default("timed_window"),
  questionSelectionMode: Phase1QuestionSelectionModeEnum.default("manual"),
  questionIds: z.array(z.string().uuid()).default([]),
  controlFlags: ControlFlagsSchema.default({}),
  retakePolicy: Phase1RetakePolicyEnum.default("unlimited"),
  scoreStrategy: ScoreStrategyEnum.default("highest"),
  maxAttempts: z.number().int().min(1).default(1),
}).superRefine((data, ctx) => {
  if (data.profileId === undefined && data.durationMinutes === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.invalid_type,
      expected: "number",
      received: "undefined",
      path: ["durationMinutes"],
      message: "Required",
    });
  }
});

/** Type for a create-exam request. */
export type CreateExamRequest = z.infer<typeof CreateExamRequestSchema>;

/**
 * Request schema for updating an existing exam. All fields are optional;
 * only provided fields will be updated.
 */
export const UpdateExamRequestBaseSchema = z.object({
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
  // ADR-013 §3: interruption time-compensation authoring fields. Optional on
  // update. The route normalizes the partial input together with the existing
  // exam's resolved policy via `normalizeInterruptionPolicyConfiguration`,
  // enforcing the cross-field rules against the POST-resolution shape.
  // These fields are substantive authoring fields and may only be mutated
  // while the exam is `draft` (enforced by the route's draft-only guard).
  interruptionTimePolicy: InterruptionTimePolicySchema.optional(),
  interruptionGracePerIncidentSeconds: z
    .number()
    .int()
    .positive()
    .max(POSTGRES_INTEGER_MAX)
    .nullish(),
  interruptionGracePerAttemptSeconds: z
    .number()
    .int()
    .positive()
    .max(POSTGRES_INTEGER_MAX)
    .nullish(),
});

export const UpdateExamRequestSchema = UpdateExamRequestBaseSchema;

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
