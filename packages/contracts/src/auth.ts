import { z } from "zod";
import { RoleSchema } from "./user.js";
import { passwordField, passwordLoginField } from "./passwordPolicy.js";

// ── Register ──────────────────────────────────────────────────────

/**
 * Request schema for registering a new user account with a bootstrap token.
 */
export const RegisterRequestSchema = z.object({
  organizationSlug: z.string().min(1).max(100),
  bootstrapToken: z.string().min(1),
  username: z.string().min(3).max(50),
  password: passwordField(),
  name: z.string().min(1).max(100),
});

/** Type for a registration request. */
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * Response schema returned after successful user registration.
 */
export const RegisterResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
});

/** Type for a registration response. */
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

// ── Login ─────────────────────────────────────────────────────────

/**
 * Request schema for logging in with username and password.
 */
export const LoginRequestSchema = z.object({
  username: z.string(),
  password: passwordLoginField(),
});

/** Type for a login request. */
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Response schema returned after successful login, including user identity,
 * role, and the actor's effective capability set (the union of all active
 * role assignments' presets — RBAC-M10-E).
 */
export const LoginResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: RoleSchema,
  organizationId: z.string().uuid(),
  capabilities: z.array(z.string()),
});

/** Type for a login response. */
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ── Me ────────────────────────────────────────────────────────────

/**
 * Response schema for the current authenticated user's profile (GET /auth/me).
 *
 * `capabilities` mirrors {@link LoginResponseSchema}: the authoritative union
 * of every active role assignment's preset, resolved fresh on each request
 * from `user_role_assignments` (RBAC-M10-E). Including it on `/me` (and on
 * `PATCH /auth/me/profile`) closes the session-restore / profile-update gap
 * where `AuthContext` previously lost capabilities and the frontend had to
 * re-derive visibility from `presetFor(user.role)` — a primary-role projection
 * that hid secondary-role capabilities from navigation.
 */
export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  role: RoleSchema,
  organizationId: z.string().uuid(),
  capabilities: z.array(z.string()),
});

/** Type for the current-user profile response. */
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ── Update Profile ────────────────────────────────────────────────

/**
 * Request schema for updating the authenticated user's own profile.
 * Phase 1 supports editing the display name only.
 */
export const UpdateProfileRequestSchema = z.object({
  name: z.string().min(1).max(100),
});

/** Type for an update-profile request. */
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

// ── Logout ────────────────────────────────────────────────────────

/**
 * Request schema for logging out. The body is empty; the session cookie is cleared server-side.
 */
export const LogoutRequestSchema = z.object({}).strict();

/** Type for a logout request. */
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

// ── Change Password ───────────────────────────────────────────────

/**
 * Request schema for changing the current user's password, requiring the existing password for verification.
 */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordField(),
});

/** Type for a change-password request. */
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/**
 * Response schema returned after a successful password change.
 */
export const ChangePasswordResponseSchema = z.object({
  ok: z.literal(true),
});

/** Type for a change-password response. */
export type ChangePasswordResponse = z.infer<
  typeof ChangePasswordResponseSchema
>;
