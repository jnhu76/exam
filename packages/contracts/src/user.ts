import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

// ── User ──────────────────────────────────────────────────────────

export const RoleSchema = z.enum([
  "SuperAdmin",
  "Admin",
  "Teacher",
  "Proctor",
  "Candidate",
]);

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
  role: RoleSchema.exclude(["SuperAdmin", "Candidate"]),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: RoleSchema.exclude(["SuperAdmin", "Candidate"]).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
