import { z } from "zod";

// ── Course ────────────────────────────────────────────────────────

export const CourseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string(),
  questionCount: z.number().int().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CourseDTO = z.infer<typeof CourseSchema>;

export const CreateCourseRequestSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  description: z.string().max(2000).default(""),
});
export type CreateCourseRequest = z.infer<typeof CreateCourseRequestSchema>;

export const UpdateCourseRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().max(2000).optional(),
});
export type UpdateCourseRequest = z.infer<typeof UpdateCourseRequestSchema>;
