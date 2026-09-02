import { z } from "zod";
import {
  InterruptionTimePolicySchema,
  POSTGRES_INTEGER_MAX,
} from "./interruption.js";
import {
  Phase1RetakePolicyEnum,
  PhaseATimingModeEnum,
  ScoreStrategyEnum,
  ResultPublicationModeEnum,
} from "./exam.js";

// ── Exam Policy Profile ───────────────────────────────────────────
//
// P7-M2: organization-owned, editable authoring templates. A profile is NOT a
// complete Exam — it carries only the profile-safe policy subset
// (`ExamProfilePolicyDefaults` in `@exam/domain`). Applying a profile to an
// exam is COPY-ON-APPLY: the exam materializes concrete typed columns and never
// reads the profile again at runtime.
//
// Validation layering (M2 design §16/§17): shape/range lives here; the ADR-013
// interruption cross-field caps rule is enforced by the route via
// `normalizeInterruptionPolicyConfiguration` (the shared leaf rule in
// `@exam/domain`). Profiles own NO schedule/scores/questions, so the canonical
// M1 exam-policy validator is NOT applied to profiles — it still runs on the
// materialized exam authoring request after profile application.

/** A persisted exam policy profile (API response shape; ISO date strings). */
export const ExamProfileSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  // #291 Phase A: profiles carry the timing mode they default to (never
  // timed_sync); null duration for deadline/untimed profiles.
  timingMode: PhaseATimingModeEnum,
  durationMinutes: z.number().int().positive().nullable(),
  latestStartOffsetMinutes: z.number().int().min(0).nullable(),
  minSubmitAfterStartMinutes: z.number().int().min(0).nullable(),
  retakePolicy: Phase1RetakePolicyEnum,
  maxAttempts: z.number().int().min(1),
  scoreStrategy: ScoreStrategyEnum,
  resultPublicationMode: ResultPublicationModeEnum,
  interruptionTimePolicy: InterruptionTimePolicySchema,
  interruptionGracePerIncidentSeconds: z
    .number()
    .int()
    .positive()
    .max(POSTGRES_INTEGER_MAX)
    .nullable(),
  interruptionGracePerAttemptSeconds: z
    .number()
    .int()
    .positive()
    .max(POSTGRES_INTEGER_MAX)
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a complete exam policy profile entity. */
export type ExamProfileDTO = z.infer<typeof ExamProfileSchema>;

/**
 * Request schema for creating an exam policy profile. Every profile-owned
 * policy field is explicit (a profile is a deliberate authoring template, not
 * a partial patch); caps are nullable (null for strict/operator_incident).
 * The interruption cross-field caps rule is enforced by the route's
 * `normalizeInterruptionPolicyConfiguration` (shape-only here, matching the
 * exam-create pattern).
 */
export const CreateExamProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).default(""),
  // Omission means the legacy default mode — a profile created before Phase A
  // resolves to timed_window, matching the DB column default.
  timingMode: PhaseATimingModeEnum.default("timed_window"),
  durationMinutes: z.number().int().positive().nullable(),
  latestStartOffsetMinutes: z.number().int().min(0).nullish(),
  minSubmitAfterStartMinutes: z.number().int().min(0).nullish(),
  retakePolicy: Phase1RetakePolicyEnum,
  maxAttempts: z.number().int().min(1),
  scoreStrategy: ScoreStrategyEnum,
  resultPublicationMode: ResultPublicationModeEnum,
  interruptionTimePolicy: InterruptionTimePolicySchema,
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

/** Type for a create-exam-profile request. */
export type CreateExamProfileRequest = z.infer<
  typeof CreateExamProfileRequestSchema
>;

/**
 * Request schema for updating an exam policy profile. All fields optional;
 * only provided fields are updated. `null` explicitly clears a nullable
 * field. The route merges a partial interruption input with the profile's
 * current resolved policy before normalization (mirrors the exam-update path).
 */
export const UpdateExamProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  timingMode: PhaseATimingModeEnum.optional(),
  durationMinutes: z.number().int().positive().nullish(),
  latestStartOffsetMinutes: z.number().int().min(0).nullish(),
  minSubmitAfterStartMinutes: z.number().int().min(0).nullish(),
  retakePolicy: Phase1RetakePolicyEnum.optional(),
  maxAttempts: z.number().int().min(1).optional(),
  scoreStrategy: ScoreStrategyEnum.optional(),
  resultPublicationMode: ResultPublicationModeEnum.optional(),
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

/** Type for an update-exam-profile request. */
export type UpdateExamProfileRequest = z.infer<
  typeof UpdateExamProfileRequestSchema
>;
