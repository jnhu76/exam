/**
 * Runtime request context augmentation (RBAC-M10-E).
 *
 * The authoritative runtime authority for a human actor is now derived from
 * their ACTIVE `user_role_assignments` rows, not from `users.role`. This
 * interface extends the legacy {@link RequestContext} (in `@exam/domain`,
 * which is a leaf package and CANNOT depend on `@exam/authz`) with the two
 * fields every authenticated HTTP request now carries:
 *
 *   - `roles`        every active assigned role (deduped, stable-ordered);
 *   - `capabilities` the authoritative permission union across all active
 *                    role presets — what every capability gate reads.
 *
 * Only authenticated HTTP requests hold a {@link RuntimeRequestContext};
 * synthetic / CLI / resolver / system-actor contexts stay as plain
 * {@link RequestContext} and never participate in capability gating (they do
 * not need `roles` / `capabilities`). This keeps the domain leaf-package
 * invariant intact (P1-1): no `@exam/domain → @exam/authz` dependency.
 *
 * `permissions` (the legacy `Permission[]` slot on RequestContext) is kept as
 * a documented NON-authoritative compatibility field. It is `[]` on every
 * runtime context; zero production authorization decisions read it. The dead
 * legacy `requirePermission` decorator that read it was removed in P4-C1
 * (zero route consumers, read only the always-empty `ctx.permissions`); see
 * docs/archive/audits/P4-C1-AUTHORIZATION-RESIDUE-CLEANUP.md. The field itself is
 * retained as a compatibility surface because it is part of the base
 * `RequestContext` in the `@exam/domain` leaf package, and every resolver /
 * system-actor / auth context still initializes it to `[]`.
 */
import type { RequestContext } from "@exam/domain";
import type { PermissionKey, RoleKey } from "@exam/authz";

export interface RuntimeRequestContext extends RequestContext {
  /** Every active assigned role for the actor (compatibility + multi-role). */
  roles: readonly RoleKey[];
  /** Authoritative capability union — what every capability gate reads. */
  capabilities: readonly PermissionKey[];
}
