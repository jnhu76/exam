import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

// ── Candidate Exam Summary (Phase 1 derived contract) ─────────────

/**
 * All possible availability statuses for a candidate's view of an exam,
 * derived from enrollment state, attempt history, and exam timing.
 */
export const candidateExamAvailabilityStatuses = [
  "available",
  "in_progress",
  "resumable",
  "submitted_pending_grade",
  "graded",
  "max_attempts_exhausted",
  "not_started_yet",
  "expired",
  "unavailable",
] as const;

/**
 * All possible primary actions a candidate can take on an exam,
 * determined by the current availability status.
 */
export const candidateExamPrimaryActions = [
  "start",
  "resume",
  "view_result",
  "view_history",
  "none",
] as const;

/**
 * Zod enum for candidate exam availability statuses.
 */
export const AvailabilityStatusEnum = z.enum(candidateExamAvailabilityStatuses);

/** Availability status of an exam as seen by a candidate. */
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusEnum>;

/**
 * Zod enum for the recommended primary action on an exam from a candidate's perspective.
 */
export const PrimaryActionEnum = z.enum(candidateExamPrimaryActions);

/** Recommended primary action a candidate can take on an exam. */
export type PrimaryAction = z.infer<typeof PrimaryActionEnum>;

/**
 * Schema for a candidate's summary view of an exam, including timing window,
 * attempt counts, best score, and availability/action metadata.
 */
export const CandidateExamSummarySchema = z.object({
  examId: z.string().uuid(),
  title: z.string(),
  windowStartAt: z.string().datetime(),
  windowEndAt: z.string().datetime(),
  durationMinutes: z.number().int().positive(),
  totalQuestions: z.number().int().min(0),
  passingScore: z.number(),
  totalScore: z.number(),
  attemptsUsed: z.number().int().min(0),
  maxAttempts: z.number().int().positive(),
  latestAttemptId: z.string().uuid().optional(),
  latestAttemptStatus: z
    .enum([
      "not_started",
      "queued",
      "in_progress",
      "disrupted",
      "submitted",
      "grading",
      "graded",
      "voided",
    ])
    .optional(),
  bestScore: z.number().optional(),
  bestScorePercent: z.number().optional(),
  availabilityStatus: AvailabilityStatusEnum,
  primaryAction: PrimaryActionEnum,
});

/** Candidate's summary view of a single exam. */
export type CandidateExamSummary = z.infer<typeof CandidateExamSummarySchema>;

// ── Candidate ─────────────────────────────────────────────────────

/**
 * Schema for a candidate entity, linking a user account to candidate-specific identity fields.
 */
export const CandidateSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  fields: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a candidate entity with user linkage and custom identity fields. */
export type CandidateDTO = z.infer<typeof CandidateSchema>;

/**
 * Request schema for creating a new candidate, including login credentials and identity fields.
 */
export const CreateCandidateRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordField(),
  name: z.string().min(1).max(100),
  fields: z.record(z.unknown()),
});

/** Type for a create-candidate request. */
export type CreateCandidateRequest = z.infer<
  typeof CreateCandidateRequestSchema
>;

/**
 * Request schema for updating an existing candidate's name, identity fields, or active status.
 */
export const UpdateCandidateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  fields: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

/** Type for an update-candidate request. */
export type UpdateCandidateRequest = z.infer<
  typeof UpdateCandidateRequestSchema
>;

// ── Candidate Field ───────────────────────────────────────────────

/**
 * Schema for a candidate identity field definition, such as examinee ID or department.
 * Fields define what identity data candidates must provide.
 */
export const CandidateFieldSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(["text", "number", "select"]),
  required: z.boolean(),
  unique: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
});

/** Represents a candidate identity field definition (e.g., examinee ID, department). */
export type CandidateFieldDTO = z.infer<typeof CandidateFieldSchema>;

/**
 * Request schema for creating a new candidate identity field.
 */
export const CreateCandidateFieldRequestSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  fieldType: z.enum(["text", "number", "select"]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

/** Type for a create-candidate-field request. */
export type CreateCandidateFieldRequest = z.infer<
  typeof CreateCandidateFieldRequestSchema
>;

/**
 * Request schema for updating an existing candidate identity field's label, type, or sort order.
 */
export const UpdateCandidateFieldRequestSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  fieldType: z.enum(["text", "number", "select"]).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Type for an update-candidate-field request. */
export type UpdateCandidateFieldRequest = z.infer<
  typeof UpdateCandidateFieldRequestSchema
>;

// ── Candidate Import ──────────────────────────────────────────────

/**
 * Schema for a single row in a candidate import batch.
 */
export const CandidateImportRowSchema = z.strictObject({
  username: z.string(),
  password: z.string().optional(),
  name: z.string(),
  fields: z.record(z.unknown()).optional(),
});

/** Type for a single candidate import row. */
export type CandidateImportRow = z.infer<typeof CandidateImportRowSchema>;

/**
 * Request schema for batch-importing candidates. Accepts 1 to 500 rows.
 */
export const CandidateImportRequestSchema = z.object({
  rows: z.array(CandidateImportRowSchema).min(1).max(500),
});

/** Type for a candidate import request. */
export type CandidateImportRequest = z.infer<
  typeof CandidateImportRequestSchema
>;

/**
 * Response schema for a candidate import result, summarizing created, updated, and errored rows.
 */
export const CandidateImportResultSchema = z.object({
  total: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  errors: z.array(
    z.object({
      row: z.number().int(),
      code: z.string(),
      message: z.string(),
    }),
  ),
  logId: z.string().uuid().optional(),
});

/** Type for a candidate import result. */
export type CandidateImportResult = z.infer<typeof CandidateImportResultSchema>;
