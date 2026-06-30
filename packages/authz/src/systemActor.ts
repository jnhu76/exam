/**
 * System actor identity (SYSTEM-M1).
 *
 * Replaces the hardcoded `role: "Admin"` synthetic contexts in the deadline +
 * heartbeat scanners with a real `System` role (ADR §System Actor Policy).
 * System is non-login, non-assignable, and never a `users.role` row; it exists
 * only as an in-memory {@link RequestContext} for background work.
 *
 * Note on `permissions`: {@link RequestContext.permissions} is typed as the
 * legacy `@exam/domain` `Permission[]` (SCREAMING_SNAKE). The System role's
 * real grants are the dotted `system.*` perms in {@link permissionsForRole} /
 * {@link ROLE_PRESETS}[System]; scanner code paths never read `ctx.permissions`
 * (only `requirePermission` does, which scanners don't call), so the field is
 * kept as `[]` to stay type-correct against the legacy context shape. Audit
 * attribution uses `role: "System"` + `actorId: "system:..."`.
 */
import type { RequestContext } from "@exam/domain";
import { Role } from "@exam/domain";
import { Role as AuthzRole } from "./catalog.js";
import { permissionsForRole } from "./presets.js";

/** Stable synthetic actor ids for the two background scanners. */
export const SYSTEM_ACTOR_IDS = {
  DeadlineScanner: "system:deadline-scanner",
  Heartbeat: "system:heartbeat",
} as const;

/**
 * The system-only permissions granted to the System role preset (dotted keys).
 * Exposed for callers/tests that want to reason about System's real grants
 * without going through the legacy `ctx.permissions` array.
 */
export const SYSTEM_PERMISSIONS = permissionsForRole(AuthzRole.System);

/**
 * Builds a synthetic `System`-role request context for a background scanner.
 * `actorId` MUST be one of {@link SYSTEM_ACTOR_IDS} (stable, audit-traceable).
 */
export function createSystemRequestContext(
  organizationId: string,
  actorId: string,
): RequestContext {
  return {
    actorId,
    organizationId,
    role: Role.System,
    // Legacy flat-perm slot, intentionally empty (see module doc). System's
    // real grants are dotted system.* perms in the preset, not this array.
    permissions: [],
    sessionId: actorId,
    targetOrganizationId: organizationId,
  };
}
