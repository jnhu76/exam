import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";
import { nullableEmailField, optionalEmailField } from "./emailField.js";

// ── User ──────────────────────────────────────────────────────────

/**
 * Roles assignable to a human user (RBAC-M8). `System` is excluded (synthetic,
 * non-assignable); `SuperAdmin` is not defined (no ADR).
 *
 * `RoleSchema` mirrors the assignable set because a user's primary active
 * assignment — which becomes `users.role` (the compatibility cache) and the
 * value returned by login/`/auth/me` — may be any of them.
 */
export const AssignableRoleSchema = z.enum([
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
  "Maintainer",
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
 * Request schema for creating a new user account. Role is any assignable role.
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

// ── Role assignments ──────────────────────────────────────────────

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

/**
 * Request body for patching an assignment — an XOR command contract: exactly
 * ONE of the three commands per PATCH.
 *
 *   { isPrimary: true }  → promote this assignment to primary active
 *   { isActive: true }   → (re)activate this assignment
 *   { isActive: false }  → deactivate this assignment
 *
 * Anything else — `{}`, `{ isPrimary: false }`, or a mixed payload like
 * `{ isPrimary: true, isActive: false }` — is an invalid command and must be
 * rejected with 400, never silently half-applied.
 */
export const PatchRoleAssignmentRequestSchema = z
  .object({
    isPrimary: z.literal(true).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const present = [
      value.isPrimary !== undefined ? "isPrimary" : null,
      value.isActive !== undefined ? "isActive" : null,
    ].filter((k): k is string => k !== null);
    if (present.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "exactly one of { isPrimary: true } | { isActive: true } | { isActive: false } is required",
      });
    }
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
