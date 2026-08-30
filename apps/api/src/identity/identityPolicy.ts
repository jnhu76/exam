// Identity lifecycle policy constants (#297).
//
// Fixed constants, not env knobs: TTLs for credential-grade tokens are a
// security policy, not a deployment tuning surface. Changing them is a code
// review decision.

/** Invitation validity: 7 days (long-lived by design — ADR-011 §12.3). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Display form of {@link INVITATION_TTL_MS} for the invitation email. */
export const INVITATION_TTL_DAYS = 7;

/** Password-reset token validity: 60 minutes. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
/** Display form of {@link PASSWORD_RESET_TTL_MS} for the reset email. */
export const PASSWORD_RESET_TTL_MINUTES = 60;

/**
 * Minimum interval between password-reset emails for the same account.
 * Requests inside the window get the same uniform response as a successful
 * one, but no token and no email (anti-bombing: ADR-011 §15 assigns reset
 * rate limiting to the identity flow).
 */
export const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
