/**
 * Identity lifecycle domain types (#297 — staff invitation + email password
 * reset + account lifecycle).
 *
 * This module is the leaf-domain source of truth for the identity-token
 * abstractions. It lives in `@exam/domain` so it carries no Fastify / Drizzle
 * dependency and can be imported by `@exam/contracts`, `@exam/db`, and
 * `@exam/api` without layering violations.
 *
 * Authority model (INVARIANT):
 *  - A staff invitation is a pending-membership fact. The invited person has
 *    NO user row until acceptance succeeds, so `users.is_active` keeps exactly
 *    one meaning (admin-controlled enabled/disabled) and never means
 *    "invitation pending".
 *  - Invitation lifecycle state is persisted as nullable timestamps
 *    (`consumed_at`, `revoked_at`); `StaffInvitationStatus` is computed at
 *    read time, never stored.
 *  - A password-reset token belongs to an existing user. At most one
 *    unconsumed token per user exists (DB partial unique index). Issuing a
 *    new token invalidates the previous open token in the same transaction
 *    (newest-token-wins).
 *  - Raw tokens are never persisted. Only the SHA-256 token hash is stored;
 *    the email body is the only carrier of the raw token.
 */

/**
 * Computed lifecycle status of a staff invitation, derived from the nullable
 * timestamps in persistence order of authority: accepted > revoked > expired
 * > pending.
 */
export const STAFF_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const satisfies readonly string[];

export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

/**
 * Derives the invitation status from its persisted timestamps. Pure so the
 * contracts DTO, the API list endpoint, and tests share one derivation.
 */
export function computeStaffInvitationStatus(input: {
  consumedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  now: Date;
}): StaffInvitationStatus {
  if (input.consumedAt !== null) return "accepted";
  if (input.revokedAt !== null) return "revoked";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "pending";
}
