import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

// ── User ──────────────────────────────────────────────────────────

export const RoleSchema = z.enum(["Admin", "Candidate"]);

export const UserSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: RoleSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserDTO = z.infer<typeof UserSchema>;

export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordField(),
  name: z.string().min(1).max(100),
  role: z.literal("Admin"),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.literal("Admin").optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  newPassword: passwordField(),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
