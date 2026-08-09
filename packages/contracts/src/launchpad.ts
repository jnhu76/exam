import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

/**
 * P7-C1 C1.6 — Launchpad first-install handoff contracts.
 *
 * The launchpad is a one-time first-Admin bootstrap page (GET /launchpad)
 * plus two API routes under /api/launchpad. It hands the first-Admin account
 * creation from the deployment operator (who configures LAUNCHPAD_SETUP_TOKEN)
 * to the business administrator (who opens /launchpad and enters the setup
 * code + organization name + credentials).
 *
 * Invariant: the launchpad is usable ONLY when (a) LAUNCHPAD_SETUP_TOKEN is
 * configured AND (b) the deployment is genuinely fresh (no organization AND
 * no user has ever existed). Once any org/user has existed, the installation
 * is permanently COMPLETED and the launchpad never reopens — even if all
 * Admins are later disabled/deleted (no privilege takeover).
 *
 * `/register` remains 403 forever (registration is disabled in Phase 1); the
 * launchpad is the supported first-install path, NOT a reopening of public
 * self-registration.
 */

// ── Status ─────────────────────────────────────────────────────────────

/**
 * The launchpad installation state.
 *
 * - READY: the deployment is fresh AND a setup token is configured → the
 *   business administrator can create the first Admin.
 * - OPERATOR_ACTIVATION_REQUIRED: the deployment is fresh BUT no setup token
 *   is configured → the operator must set LAUNCHPAD_SETUP_TOKEN before the
 *   business administrator can proceed.
 * - COMPLETED: the installation has already been initialized (an organization
 *   or user exists) → the launchpad is permanently unavailable; use /login.
 */
export const LaunchpadStateSchema = z.enum([
  "READY",
  "OPERATOR_ACTIVATION_REQUIRED",
  "COMPLETED",
]);

/** Type of the launchpad state enum. */
export type LaunchpadState = z.infer<typeof LaunchpadStateSchema>;

/**
 * Response schema for GET /api/launchpad/status. Returns ONLY the state — no
 * organization ids, admin counts, or database details (minimal information
 * surface).
 */
export const LaunchpadStatusResponseSchema = z.object({
  state: LaunchpadStateSchema,
});

/** Type for a launchpad status response. */
export type LaunchpadStatusResponse = z.infer<
  typeof LaunchpadStatusResponseSchema
>;

// ── Bootstrap ──────────────────────────────────────────────────────────

/**
 * Request schema for POST /api/launchpad/bootstrap.
 *
 * The caller may NOT specify role, capabilities, organizationId, or force —
 * the first user is ALWAYS an Admin with the primary Admin assignment, and
 * the canonical bootstrap command owns those decisions.
 *
 * `setupToken` is the deployment secret (LAUNCHPAD_SETUP_TOKEN), sent in the
 * request body (never URL/query). It is compared constant-time and is never
 * written to audit/log.
 */
export const LaunchpadBootstrapRequestSchema = z.object({
  setupToken: z.string().min(1).max(256),
  organizationName: z.string().min(1).max(100),
  organizationDisplayName: z.string().min(1).max(100).optional(),
  username: z.string().min(3).max(50),
  name: z.string().min(1).max(100),
  password: passwordField(),
});

/** Type for a launchpad bootstrap request. */
export type LaunchpadBootstrapRequest = z.infer<
  typeof LaunchpadBootstrapRequestSchema
>;

/**
 * Response schema for a successful bootstrap. Returns minimal identity for a
 * "Setup complete" notice; the route does NOT auto-login (bootstrap authority
 * and authentication stay separate — the new Admin proceeds to /login).
 */
export const LaunchpadBootstrapResponseSchema = z.object({
  organizationName: z.string(),
  username: z.string(),
});

/** Type for a launchpad bootstrap response. */
export type LaunchpadBootstrapResponse = z.infer<
  typeof LaunchpadBootstrapResponseSchema
>;
