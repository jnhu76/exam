import { z } from "zod";

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
  password: z.string().min(6).max(100),
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
      message: z.string(),
    }),
  ),
});
export type CandidateImportResult = z.infer<typeof CandidateImportResultSchema>;
