/**
 * Assignment-backed runtime authority kernel (RBAC-M10-E).
 *
 * This is the single authoritative source of a human actor's effective runtime
 * authority. It replaces the legacy `presetAllows(users.role, permission)`
 * model: instead of trusting a single `users.role` column (or the JWT `role`
 * claim), the runtime resolves the actor's **active `user_role_assignments`
 * rows for the current organization** and derives:
 *
 *   - the primary assignment role (compatibility projection — login response,
 *     `/me` role, JWT compatibility claim, audit/log display);
 *   - the full set of active assigned roles;
 *   - the union of every active role's preset permissions (the authoritative
 *     capability set every gate reads).
 *
 * Design notes (per task §5 / §7):
 *
 *   - Two layers: {@link deriveAssignmentAuthority} is pure (no DB, no I/O) and
 *     unit-testable; {@link loadAssignmentAuthority} is the DB wrapper that
 *     catches lookup failure and delegates to the pure layer.
 *   - The contract is a discriminated `AssignmentAuthorityResult`. Empty active
 *     set is a NORMAL runtime outcome (a user with all assignments deactivated)
 *     and returns `{ ok:false, reason:"no_active_assignments" }` — it is NOT a
 *     thrown programmer error. DB / integrity failures return their own
 *     reasons; the caller (authenticate) maps each to the right HTTP status.
 *   - The field exposing the permission union is named `capabilities` (NOT
 *     `permissions`) to avoid collision with the legacy `ctx.permissions` slot.
 *   - Fail closed: every integrity error (zero primary, multiple primary,
 *     unknown role, cross-org subject mismatch, DB error) is reported as a
 *     non-ok result. The caller MUST NOT fall back to `users.role` on any of
 *     these (ADR §3.9 fail-loud; task §3.6 / §3.7).
 *
 * System actor: this kernel only resolves HUMAN assignment authority. The
 * synthetic System actor (`packages/authz/src/systemActor.ts`) is NOT backed by
 * `user_role_assignments` and never reaches this path (task §3.8).
 */
import type { Database, TenantContext } from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import {
  Role as AuthzRole,
  type PermissionKey,
  type RoleKey,
  permissionsForRole,
} from "@exam/authz";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import type { UserRoleAssignmentRow } from "@exam/db/src/repository/userRoleAssignmentRepo.js";

/**
 * Closed, assignable role set mirror (kept here to avoid a circular import on
 * the DB schema's `ASSIGNABLE_ROLES`). MUST stay in sync with
 * `packages/db/src/schema/pg.ts` `ASSIGNABLE_ROLES` and the DB CHECK
 * constraint `role IN ('Admin','Teacher','Proctor','Grader','Candidate')`.
 * System is intentionally excluded — it is synthetic and non-assignable.
 */
const ASSIGNABLE_ROLE_KEYS: readonly RoleKey[] = [
  AuthzRole.Admin,
  AuthzRole.Teacher,
  AuthzRole.Proctor,
  AuthzRole.Grader,
  AuthzRole.Candidate,
];
const ASSIGNABLE_ROLE_SET: ReadonlySet<string> = new Set(ASSIGNABLE_ROLE_KEYS);

/**
 * A canonical ordering of {@link RoleKey} used to produce STABLE multi-role
 * output regardless of row insertion order (task §3.2: "dedupe and produce a
 * stable order"). Index lookup gives O(1) comparison.
 */
const ROLE_ORDER: ReadonlyMap<string, number> = new Map(
  ASSIGNABLE_ROLE_KEYS.map((r, i) => [r, i]),
);

/** Stable comparator for {@link PermissionKey} union output. */
function comparePermissionKey(a: PermissionKey, b: PermissionKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Resolved, authoritative runtime authority for one human actor. */
export interface AssignmentAuthority {
  /** Primary active assignment role — compatibility projection ONLY. */
  primaryRole: RoleKey;
  /** Every active assigned role (deduped, stable-sorted by RoleKey order). */
  activeRoles: readonly RoleKey[];
  /** Authoritative capability union across all active role presets. */
  capabilities: readonly PermissionKey[];
  /** Row ids of the active assignments that produced this authority. */
  assignmentIds: readonly string[];
}

/** Reason the authority could not be derived. Each maps to a specific HTTP
 *  status in the caller (see authenticate mapping, task §7 / P1-3). */
export type AssignmentAuthorityFailureReason =
  | "no_active_assignments"
  | "zero_primary_with_active"
  | "multiple_primary"
  | "unknown_role"
  | "subject_mismatch"
  | "db_error";

/** Discriminated result contract. Empty active set is a normal runtime
 *  outcome (not a throw). */
export type AssignmentAuthorityResult =
  | { ok: true; authority: AssignmentAuthority }
  | { ok: false; reason: AssignmentAuthorityFailureReason };

/**
 * Minimal row shape {@link deriveAssignmentAuthority} consumes. Defined
 * locally so the pure layer can be unit-tested with hand-built fixtures
 * without a DB; it MUST match {@link UserRoleAssignmentRow}.
 */
export interface AuthorityInputRow {
  organizationId: string;
  userId: string;
  role: string;
  isPrimary: boolean;
  isActive: boolean;
  id: string;
}

/**
 * PURE authority derivation (task §5: `deriveAssignmentAuthority`). No DB, no
 * I/O, no throws on integrity failure. Validates the full active set and the
 * exactly-one-primary invariant, then merges all active role presets into a
 * stable-ordered capability union.
 *
 * @param rows    every assignment row returned for the subject (active and
 *                inactive; the pure layer filters by `isActive` itself so a
 *                future caller cannot accidentally bypass that filter).
 * @param expectedOrganizationId  the org anchor the request is bound to; any
 *                row in a different org is `subject_mismatch` fail-closed.
 * @param expectedUserId           the subject user id; any row for a different
 *                user is `subject_mismatch` fail-closed.
 */
export function deriveAssignmentAuthority(
  rows: readonly AuthorityInputRow[],
  expectedOrganizationId: string,
  expectedUserId: string,
): AssignmentAuthorityResult {
  // Subject anchor check first: a row that is not for THIS (org, user) must
  // never contribute, even if it happens to be active+primary. This guards
  // against a resolver or repository bug that returns cross-org / cross-user
  // rows (task §3.5, §5.1).
  for (const r of rows) {
    if (
      r.organizationId !== expectedOrganizationId ||
      r.userId !== expectedUserId
    ) {
      return { ok: false, reason: "subject_mismatch" };
    }
  }

  const active = rows.filter((r) => r.isActive);

  if (active.length === 0) {
    // Normal runtime outcome (all assignments deactivated/removed). NOT a
    // thrown error — the caller maps this to 401 (task §3.6, P1-2).
    return { ok: false, reason: "no_active_assignments" };
  }

  // Unknown role: a DB row whose `role` is outside the assignable set. The DB
  // CHECK constraint should make this impossible for rows written through the
  // repo, but a backfill mistake or a hand-edited row must fail closed rather
  // than widen access (task §5.2 / §5.9).
  for (const r of active) {
    if (!ASSIGNABLE_ROLE_SET.has(r.role)) {
      return { ok: false, reason: "unknown_role" };
    }
  }

  // Exactly-one-primary invariant over the ACTIVE set (task §3.7). Inactive
  // primary rows are irrelevant — they do not participate in authority.
  const primaries = active.filter((r) => r.isPrimary);
  if (primaries.length === 0) {
    return { ok: false, reason: "zero_primary_with_active" };
  }
  if (primaries.length > 1) {
    return { ok: false, reason: "multiple_primary" };
  }
  const primaryRole = primaries[0]!.role as RoleKey;

  // Dedupe roles and stable-sort by the canonical RoleKey order so two requests
  // that load the same active set always produce identical `activeRoles` /
  // `capabilities` regardless of row createdAt tie-breaking (task §3.2).
  const roleSet = new Set<RoleKey>();
  for (const r of active) {
    roleSet.add(r.role as RoleKey);
  }
  const activeRoles = [...roleSet].sort((a, b) => {
    const ai = ROLE_ORDER.get(a);
    const bi = ROLE_ORDER.get(b);
    if (ai === undefined || bi === undefined) {
      // Defensive: unknown roles were already rejected above; fall back to
      // lexical so the comparator is total.
      return a < b ? -1 : a > b ? 1 : 0;
    }
    return ai - bi;
  });

  // Permission UNION across every active role's preset. Stable-sorted so the
  // output is deterministic (task §3.2 / §5.5-6).
  const capabilitySet = new Set<PermissionKey>();
  for (const role of activeRoles) {
    for (const perm of permissionsForRole(role)) {
      capabilitySet.add(perm);
    }
  }
  const capabilities = [...capabilitySet].sort(comparePermissionKey);

  const assignmentIds = active.map((r) => r.id);

  return {
    ok: true,
    authority: {
      primaryRole,
      activeRoles,
      capabilities,
      assignmentIds,
    },
  };
}

/**
 * Loads the active assignment set for a user from PostgreSQL and derives the
 * authoritative runtime authority (task §5: `loadAssignmentAuthority`).
 *
 * Uses {@link listActiveForUser} — the full active set, NOT a `.limit(1)`
 * primary lookup — so multi-primary corruption is observable. DB lookup
 * failure surfaces as `{ ok:false, reason:"db_error" }` (caller maps to 503,
 * never falls back to `users.role`; task §3.4 / §7 / P1-3).
 *
 * @param db                  Drizzle database handle.
 * @param ctx                 tenant-scoped context carrying the org anchor.
 * @param userId              the subject user id (JWT actorId, verified by the
 *                            caller against the loaded user row).
 */
export async function loadAssignmentAuthority(
  db: Database,
  ctx: TenantContext | RequestContext,
  userId: string,
): Promise<AssignmentAuthorityResult> {
  const organizationId = ctx.organizationId;
  let rows: UserRoleAssignmentRow[];
  try {
    const repo = createUserRoleAssignmentRepo(db);
    rows = await repo.listActiveForUser(ctx, userId);
  } catch {
    // Operational failure: never fail open, never fall back to users.role.
    // The caller surfaces 503 AUTHZ_UNAVAILABLE (ADR §3.9; task §7 Errors).
    return { ok: false, reason: "db_error" };
  }
  return deriveAssignmentAuthority(rows, organizationId, userId);
}
