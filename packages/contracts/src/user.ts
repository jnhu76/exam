import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

// ── User ──────────────────────────────────────────────────────────

/**
 * Zod enum for user roles. Phase 1 supports only Admin and Candidate.
 */
export const RoleSchema = z.enum(["Admin", "Candidate"]);

/**
 * Schema for a user entity, representing a platform user with role, organization, and status.
 */
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

/** Represents a user entity with role, organization, and active status. */
export type UserDTO = z.infer<typeof UserSchema>;

/**
 * Request schema for creating a new Admin user account.
 */
export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordField(),
  name: z.string().min(1).max(100),
  role: z.literal("Admin"),
});

/** Type for a create-user request. */
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

/**
 * Request schema for updating an existing user's name, role, or active status.
 */
export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.literal("Admin").optional(),
  isActive: z.boolean().optional(),
});

/** Type for an update-user request. */
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/**
 * Request schema for resetting a user's password to a new value.
 */
export const ResetPasswordRequestSchema = z.object({
  newPassword: passwordField(),
});

/** Type for a reset-password request. */
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
