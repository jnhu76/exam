import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

// ── Candidate Exam Summary (Phase 1 derived contract) ─────────────

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

export const candidateExamPrimaryActions = [
  "start",
  "resume",
  "view_result",
  "view_history",
  "none",
] as const;

export const AvailabilityStatusEnum = z.enum(candidateExamAvailabilityStatuses);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusEnum>;

export const PrimaryActionEnum = z.enum(candidateExamPrimaryActions);
export type PrimaryAction = z.infer<typeof PrimaryActionEnum>;

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
export type CandidateExamSummary = z.infer<typeof CandidateExamSummarySchema>;

// ── Candidate ─────────────────────────────────────────────────────

export const CandidateSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  fields: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CandidateDTO = z.infer<typeof CandidateSchema>;

export const CreateCandidateRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordField(),
  name: z.string().min(1).max(100),
  fields: z.record(z.unknown()),
});
export type CreateCandidateRequest = z.infer<
  typeof CreateCandidateRequestSchema
>;

export const UpdateCandidateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  fields: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateCandidateRequest = z.infer<
  typeof UpdateCandidateRequestSchema
>;

// ── Candidate Field ───────────────────────────────────────────────

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
export type CandidateFieldDTO = z.infer<typeof CandidateFieldSchema>;

export const CreateCandidateFieldRequestSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  fieldType: z.enum(["text", "number", "select"]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});
export type CreateCandidateFieldRequest = z.infer<
  typeof CreateCandidateFieldRequestSchema
>;

export const UpdateCandidateFieldRequestSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  fieldType: z.enum(["text", "number", "select"]).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateCandidateFieldRequest = z.infer<
  typeof UpdateCandidateFieldRequestSchema
>;

// ── Candidate Import ──────────────────────────────────────────────

export const CandidateImportRowSchema = z.strictObject({
  username: z.string(),
  password: z.string().optional(),
  name: z.string(),
  fields: z.record(z.unknown()).optional(),
});
export type CandidateImportRow = z.infer<typeof CandidateImportRowSchema>;

export const CandidateImportRequestSchema = z.object({
  rows: z.array(CandidateImportRowSchema).min(1).max(500),
});
export type CandidateImportRequest = z.infer<
  typeof CandidateImportRequestSchema
>;

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
});
export type CandidateImportResult = z.infer<typeof CandidateImportResultSchema>;
