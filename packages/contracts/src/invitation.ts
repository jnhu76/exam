import { z } from "zod";
import type { StaffInvitationStatus } from "@exam/domain";
import { STAFF_INVITATION_STATUSES } from "@exam/domain";
import { passwordField } from "./passwordPolicy.js";
import { requiredEmailField } from "./emailField.js";
import { AssignableRoleSchema } from "./user.js";

// ── Staff invitations (#297) ──────────────────────────────────────

/**
 * Roles an Admin may invite: the assignable set MINUS Candidate. Candidates
 * have their own creation/import flow; invitations create staff membership
 * only. The literal tuple is compile-checked against the assignable set so
 * the two cannot drift (adding a new assignable role here is an explicit,
 * reviewed decision, not a silent widening).
 */
export const STAFF_INVITATION_ROLES = [
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Maintainer",
] as const satisfies readonly (typeof AssignableRoleSchema.options)[number][];

/** Zod enum of invitable staff roles. */
export const StaffInvitationRoleSchema = z.enum(STAFF_INVITATION_ROLES);
export type StaffInvitationRole = z.infer<typeof StaffInvitationRoleSchema>;

/**
 * Raw invitation/reset token as carried in the URL. Bounds are generous
 * transport bounds around the 43-character base64url encoding of a 256-bit
 * token; the server only ever consumes the SHA-256 hash, so length here is
 * cheap input hygiene, not a security control.
 */
export const identityTokenField = () => z.string().min(16).max(200);

/** Request body for POST /invitations (Admin invites a staff member). */
export const CreateStaffInvitationRequestSchema = z.object({
  email: requiredEmailField(),
  role: StaffInvitationRoleSchema,
});
export type CreateStaffInvitationRequest = z.infer<
  typeof CreateStaffInvitationRequestSchema
>;

/** Computed invitation status surfaced on read DTOs (never stored raw). */
export const StaffInvitationStatusSchema = z.enum(STAFF_INVITATION_STATUSES);
export type StaffInvitationStatusDTO = StaffInvitationStatus;

/** An invitation row as exposed over the API. */
export const StaffInvitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: StaffInvitationRoleSchema,
  status: StaffInvitationStatusSchema,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type StaffInvitationDTO = z.infer<typeof StaffInvitationSchema>;

/** Response of POST /invitations — the row plus its one-time acceptance link. */
export const CreateStaffInvitationResponseSchema = z.object({
  invitation: StaffInvitationSchema,
  /**
   * The raw acceptance URL, returned ONCE at creation. Persisting it is
   * forbidden (only the token hash is stored); the inviting Admin may hand
   * it to the recipient directly when Email delivery is disabled (ADR-011
   * §12 semantics: enqueued rows marked `sent` with no provider id are not
   * proof of delivery).
   */
  acceptUrl: z.string(),
});
export type CreateStaffInvitationResponse = z.infer<
  typeof CreateStaffInvitationResponseSchema
>;

/** Paginated invitation list (GET /invitations). Same paging shape as GET /users. */
export const StaffInvitationListResponseSchema = z.object({
  items: z.array(StaffInvitationSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type StaffInvitationListResponse = z.infer<
  typeof StaffInvitationListResponseSchema
>;

/**
 * Request body for POST /auth/invitations/accept — the public, unauthenticated
 * consumption of an invitation token. The account is created in the invited
 * organization with the invited role; username uniqueness is enforced by the
 * database and a failed acceptance leaves the invitation open.
 */
export const AcceptInvitationRequestSchema = z.object({
  token: identityTokenField(),
  username: z.string().min(3).max(50),
  name: z.string().min(1).max(100),
  password: passwordField(),
});
export type AcceptInvitationRequest = z.infer<
  typeof AcceptInvitationRequestSchema
>;

/** Response of a successful invitation acceptance. */
export const AcceptInvitationResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    name: z.string(),
    role: AssignableRoleSchema,
  }),
});
export type AcceptInvitationResponse = z.infer<
  typeof AcceptInvitationResponseSchema
>;

// ── Email password reset (#297) ───────────────────────────────────

/**
 * Request body for POST /auth/password-reset/request. Deliberately username-
 * keyed (the login identifier) — the reset email goes to the address stored
 * on the account. The response is uniform regardless of whether the account
 * exists, has an email, or is on cooldown (anti-enumeration).
 */
export const PasswordResetRequestSchema = z.object({
  username: z.string().max(50),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/**
 * Uniform response for POST /auth/password-reset/request. Carries no
 * information about account existence — the constant `ok: true` IS the
 * anti-enumeration contract.
 */
export const PasswordResetRequestAcceptedSchema = z.object({
  ok: z.literal(true),
});
export type PasswordResetRequestAccepted = z.infer<
  typeof PasswordResetRequestAcceptedSchema
>;

/** Request body for POST /auth/password-reset/consume. */
export const PasswordResetConsumeRequestSchema = z.object({
  token: identityTokenField(),
  password: passwordField(),
});
export type PasswordResetConsumeRequest = z.infer<
  typeof PasswordResetConsumeRequestSchema
>;

/** Response of a successful password reset (all failures are one 400 shape). */
export const PasswordResetConsumeResponseSchema = z.object({
  ok: z.literal(true),
});
export type PasswordResetConsumeResponse = z.infer<
  typeof PasswordResetConsumeResponseSchema
>;
