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

/** Closed union of allowed system actor ids (compile-time enforcement). */
export type SystemActorId =
  (typeof SYSTEM_ACTOR_IDS)[keyof typeof SYSTEM_ACTOR_IDS];

const ALLOWED_SYSTEM_ACTOR_IDS: ReadonlySet<string> = new Set(
  Object.values(SYSTEM_ACTOR_IDS),
);

/**
 * The system-only permissions granted to the System role preset (dotted keys).
 * Exposed for callers/tests that want to reason about System's real grants
 * without going through the legacy `ctx.permissions` array.
 */
export const SYSTEM_PERMISSIONS = permissionsForRole(AuthzRole.System);

/**
 * Builds a synthetic `System`-role request context for a background scanner.
 *
 * `actorId` MUST be one of {@link SYSTEM_ACTOR_IDS} — enforced at both
 * compile time (typed param) and runtime (throws on an out-of-set id) so a
 * stray string can never produce an untracked audit actor. ADR §3.9 fail-loud.
 */
export function createSystemRequestContext(
  organizationId: string,
  actorId: SystemActorId,
): RequestContext {
  if (!ALLOWED_SYSTEM_ACTOR_IDS.has(actorId)) {
    throw new Error(
      `Unknown system actor id: ${actorId}. Use SYSTEM_ACTOR_IDS.* from @exam/authz.`,
    );
  }
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
