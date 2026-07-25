import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";
import { nullableEmailField, optionalEmailField } from "./emailField.js";

// ── User ──────────────────────────────────────────────────────────

/**
 * Roles assignable to a human user (RBAC-M8). Phase 3 widens the Phase 1
 * {Admin, Candidate} set with Teacher / Proctor / Grader. `System` is excluded
 * (synthetic, non-assignable); `SuperAdmin` is not defined (no ADR).
 *
 * `RoleSchema` mirrors the assignable set because a user's primary active
 * assignment — which becomes `users.role` (the compatibility cache) and the
 * value returned by login/`/auth/me` — may now be any of these five. Route
 * authorization gates are NOT flipped in this PR; assignment is a capability,
 * not an enforcement change (enforcement is PR #3).
 */
export const AssignableRoleSchema = z.enum([
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
]);
// NOTE: AssignableRole is also defined in @exam/db (schema/pg.ts ASSIGNABLE_ROLES).
// The two are structurally identical by design — db cannot depend on contracts
// (dependency layering), so both stay. Keep them in sync when editing.
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

/** Zod enum for user roles (= the assignable set, see {@link AssignableRoleSchema}). */
export const RoleSchema = AssignableRoleSchema;

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
  email: nullableEmailField(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Represents a user entity with role, organization, and active status. */
export type UserDTO = z.infer<typeof UserSchema>;

/**
 * Request schema for creating a new user account. Role is any assignable role
 * (RBAC-M8); the route still gates on legacy `requireRole(["Admin"])` until
 * enforcement (PR #3).
 */
export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(50),
  password: passwordField(),
  name: z.string().min(1).max(100),
  role: AssignableRoleSchema,
  email: optionalEmailField(),
});

/** Type for a create-user request. */
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

/**
 * Request schema for updating an existing user's name, role, or active status.
 * Role may be set to any assignable role (RBAC-M8).
 */
export const UpdateUserRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: AssignableRoleSchema.optional(),
  isActive: z.boolean().optional(),
  email: optionalEmailField(),
});

/** Type for an update-user request. */
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

// ── Role assignments (RBAC-M8) ────────────────────────────────────

/** A user-role-assignment row as exposed over the API. */
export const UserRoleAssignmentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  role: AssignableRoleSchema,
  isPrimary: z.boolean(),
  isActive: z.boolean(),
});
export type UserRoleAssignmentDTO = z.infer<typeof UserRoleAssignmentSchema>;

/** Request body for assigning a role to a user. */
export const AssignRoleRequestSchema = z.object({
  role: AssignableRoleSchema,
  isPrimary: z.boolean().optional(),
});
export type AssignRoleRequest = z.infer<typeof AssignRoleRequestSchema>;

/** Request body for patching an assignment (set primary / activate). */
export const PatchRoleAssignmentRequestSchema = z.object({
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type PatchRoleAssignmentRequest = z.infer<
  typeof PatchRoleAssignmentRequestSchema
>;

/**
 * Request schema for resetting a user's password to a new value.
 */
export const ResetPasswordRequestSchema = z.object({
  newPassword: passwordField(),
});

/** Type for a reset-password request. */
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
