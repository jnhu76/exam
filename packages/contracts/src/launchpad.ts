import { z } from "zod";
import { passwordField } from "./passwordPolicy.js";

// ── Launchpad (first-install only, P7-C1) ──────────────────────────

/**
 * Response schema for the installation-status probe.
 *
 * `initialized` is true once the internal default organization exists
 * (slug "default"). This is the FIRST-INSTALL gate only: removing/disabling
 * the last Admin does NOT reopen launchpad. The endpoint reveals only the
 * init state (which `/login` UX implies anyway) — it is NOT a
 * token-validity oracle and never reveals token state.
 */
export const LaunchpadStatusResponseSchema = z.object({
  initialized: z.boolean(),
});

/** Type for the launchpad installation-status response. */
export type LaunchpadStatusResponse = z.infer<
  typeof LaunchpadStatusResponseSchema
>;

/**
 * Request schema for the first-Admin bootstrap via launchpad.
 *
 * The role is NOT selectable — the server always creates role = Admin. The
 * `setupToken` is the deployment bootstrap secret (body-only, never URL,
 * never audit-logged). Field names mirror the canonical
 * `bootstrapAdminOnFreshDb` parameters so the HTTP adapter is a thin shim
 * over the same atomic mutation body the CLI uses.
 */
export const LaunchpadBootstrapRequestSchema = z.object({
  organizationName: z.string().min(1).max(200),
  organizationDisplayName: z.string().min(1).max(200).optional(),
  adminUsername: z.string().min(3).max(50),
  adminPassword: passwordField(),
  adminName: z.string().min(1).max(100),
  setupToken: z.string().min(1).max(1024),
});

/** Type for a launchpad bootstrap request. */
export type LaunchpadBootstrapRequest = z.infer<
  typeof LaunchpadBootstrapRequestSchema
>;

/**
 * Response schema returned after a successful first-Admin bootstrap.
 *
 * Mirrors the minimal public subset of the canonical
 * `bootstrapAdminOnFreshDb` result: organization slug + the created Admin's
 * username. No secrets, no internal ids beyond what a login flow needs to
 * hint the operator toward `/login`.
 */
export const LaunchpadBootstrapResponseSchema = z.object({
  ok: z.literal(true),
  organizationSlug: z.string(),
  adminUsername: z.string(),
});

/** Type for a launchpad bootstrap response. */
export type LaunchpadBootstrapResponse = z.infer<
  typeof LaunchpadBootstrapResponseSchema
>;
