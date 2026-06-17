import { z } from "zod";

// ── Course ────────────────────────────────────────────────────────

/**
 * Schema for a course entity, representing a grouping of questions for assessment.
 */
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

/** Represents a course entity that groups questions for exams. */
export type CourseDTO = z.infer<typeof CourseSchema>;

/**
 * Request schema for creating a new course.
 */
export const CreateCourseRequestSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  description: z.string().max(2000).default(""),
});

/** Type for a create-course request. */
export type CreateCourseRequest = z.infer<typeof CreateCourseRequestSchema>;

/**
 * Request schema for updating an existing course's name, code, or description.
 */
export const UpdateCourseRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().max(2000).optional(),
});

/** Type for an update-course request. */
export type UpdateCourseRequest = z.infer<typeof UpdateCourseRequestSchema>;
