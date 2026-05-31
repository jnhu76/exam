import { z } from "zod";

// ── User ──────────────────────────────────────────────────────────

export const UserSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserDTO = z.infer<typeof UserSchema>;

export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(100),
  role: z.enum(["Admin", "Teacher", "Proctor", "Candidate"]),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["Admin", "Teacher", "Proctor", "Candidate"]).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
