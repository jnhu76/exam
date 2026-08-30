import type { Database } from "../types.js";
import {
  users,
  userRoleAssignments,
  ASSIGNABLE_ROLES,
  type AssignableRole,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  now,
  resolveOptionalOrganizationId,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import { UserAlreadyExistsError, type RequestContext } from "@exam/domain";
import { and, count, eq, exists, inArray, or, sql } from "drizzle-orm";

/**
 * Staff roles for the admin user-management list. Derived from the canonical
 * assignable set minus Candidate — staff membership is assignment-aware
 * (see {@link listStaffPaginated}), never a `users.role` projection.
 * `System` is not in ASSIGNABLE_ROLES (synthetic, non-assignable);
 * `SuperAdmin` is not defined (no ADR) and can never match.
 */
const STAFF_ROLES: readonly AssignableRole[] = ASSIGNABLE_ROLES.filter(
  (r) => r !== "Candidate",
);

/** Extracts the PostgreSQL constraint name from an error object. */
function getConstraintName(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const error = err as Record<string, unknown>;
  if (typeof error.constraint === "string") return error.constraint;
  const cause = error.cause;
  if (typeof cause === "object" && cause !== null) {
    const causeRecord = cause as Record<string, unknown>;
    if (typeof causeRecord.constraint === "string")
      return causeRecord.constraint;
  }
  return undefined;
}

/**
 * Creates a tenant-scoped user repository with username uniqueness checks
 * and role-based queries.
 * @param db - Database instance.
 */
export function createUserRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, users);

  /**
   * Finds a user by organization ID and username, scoped to the tenant.
   * Used for authentication and uniqueness checks.
   */
  async function findByOrganizationAndUsername(
    ctx: TenantContext | RequestContext,
    username: string,
  ) {
    const orgId = resolveOptionalOrganizationId(ctx);
    const rows = await db
      .select()
      .from(users)
      .where(
        and(eq(users.organizationId, orgId), eq(users.username, username)),
      );
    return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
  }

  /**
   * LOCK ORDER (#297 credential lifecycle): these row locks are the USER
   * node of the canonical order USER → PASSWORD_RESET_TOKEN(S) → credential
   * mutation. Every password-reset issuance, reset consume, and account
   * deactivation transaction must acquire the user row lock FIRST (see
   * passwordResetTokenRepo); acquiring token rows before the user row is a
   * deadlock against deactivation. Callers revalidate user state AFTER the
   * lock returns — a pre-transaction read is never authority.
   */

  /**
   * Locks the user row (SELECT ... FOR UPDATE) for a credential-lifecycle
   * transaction. Returns the locked row, or null when no user with this
   * username exists in the organization. The row stays locked until the
   * surrounding transaction ends.
   */
  async function lockByUsernameWithinTransaction(
    ctx: TenantContext | RequestContext,
    username: string,
  ) {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, orgId), eq(users.username, username)))
      .for("update")
      .limit(1);
    return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
  }

  /**
   * Locks the user row (SELECT ... FOR UPDATE) by id for a credential
   * mutation (reset-consume path: the token identifies the user, then the
   * user row serializes the credential change). Returns null when the user
   * does not exist in the organization.
   */
  async function lockByIdWithinTransaction(
    ctx: TenantContext | RequestContext,
    userId: string,
  ) {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, orgId), eq(users.id, userId)))
      .for("update")
      .limit(1);
    return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
  }

  /**
   * Batch-loads users by id, scoped to the tenant. Empty input returns [].
   * Used by the result_published recipient composition (P5-N1-I2) to resolve
   * userId -> email without an N+1.
   */
  async function findByIds(
    ctx: TenantContext | RequestContext,
    userIds: string[],
  ) {
    if (userIds.length === 0) return [];
    const orgId = resolveOptionalOrganizationId(ctx);
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, orgId), inArray(users.id, userIds)));
    return rows as (typeof users.$inferSelect)[];
  }

  return {
    ...repo,
    findByOrganizationAndUsername,
    lockByUsernameWithinTransaction,
    lockByIdWithinTransaction,
    findByIds,
    /**
     * Finds a user by organization ID and user ID, scoped to the tenant.
     */
    async findByOrganizationAndId(
      ctx: TenantContext | RequestContext,
      id: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.id, id)));
      return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
    },
    /**
     * Lists staff users with pagination, scoped to the tenant. The staff
     * membership filter runs BEFORE pagination (F-03, P7-RBAC-REMEDIATION).
     *
     * Staff membership is NOT decided by `users.role` (a compatibility cache
     * of the primary active assignment). A user is a staff member iff:
     *   - they hold at least one ACTIVE assignment with a staff role
     *     (Admin/Teacher/Proctor/Grader/Maintainer), OR
     *   - their cached `users.role` is a staff role — the stale zero-primary
     *     fallback (F-06): when no primary active assignment exists the cache
     *     keeps its last value, so a historical staff account that lost its
     *     active assignment never vanishes from the management UI.
     *
     * Candidate-only users (no staff assignment, cache = Candidate) are
     * excluded before pagination, so candidate volume can never crowd staff
     * rows off the page. A user with a staff-secondary assignment (e.g.
     * primary Candidate + active Teacher) matches the EXISTS branch exactly
     * once — the correlated subquery cannot duplicate user rows.
     *
     * @returns `{ items, total }` where `total` is the unpaginated staff count.
     */
    async listStaffPaginated(
      ctx: TenantContext | RequestContext,
      page: number,
      pageSize: number,
    ): Promise<{
      items: (typeof users.$inferSelect)[];
      total: number;
    }> {
      const orgId = resolveOrganizationId(ctx);
      const offset = (page - 1) * pageSize;
      const staffRoles = STAFF_ROLES;
      const hasActiveStaffAssignment = exists(
        db
          .select({ one: sql`1` })
          .from(userRoleAssignments)
          .where(
            and(
              eq(userRoleAssignments.organizationId, orgId),
              eq(userRoleAssignments.userId, users.id),
              inArray(userRoleAssignments.role, staffRoles),
              eq(userRoleAssignments.isActive, true),
            ),
          ),
      );
      const where = and(
        eq(users.organizationId, orgId),
        or(inArray(users.role, staffRoles), hasActiveStaffAssignment),
      );
      const items = (await db
        .select()
        .from(users)
        .where(where)
        .orderBy(users.createdAt, users.id)
        .limit(pageSize)
        .offset(offset)) as (typeof users.$inferSelect)[];
      const total = (await db.select({ id: users.id }).from(users).where(where))
        .length;
      return { items, total };
    },
    /**
     * Counts active users with the given role, scoped to the tenant.
     */
    async countActiveByRole(
      ctx: TenantContext | RequestContext,
      role: string,
    ): Promise<number> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, orgId),
            eq(users.role, role),
            eq(users.isActive, true),
          ),
        );
      return rows.length;
    },
    /**
     * Counts active users who hold ANY ACTIVE role assignment of the given
     * role, scoped to the tenant (RBAC-M10-E effective authority).
     *
     * A user is counted iff:
     *   - their `users` row is active, AND
     *   - they have at least one assignment row with `role = <role>` and
     *     `is_active = true` under the same org anchor.
     *
     * Uses an EXISTS subquery so the count is not inflated by multiple
     * assignments per user.
     */
    async countEffectiveActiveUsersWithRole(
      ctx: TenantContext | RequestContext,
      role: AssignableRole,
    ): Promise<number> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({ cnt: count() })
        .from(users)
        .where(
          and(
            eq(users.organizationId, orgId),
            eq(users.isActive, true),
            exists(
              db
                .select({ one: sql`1` })
                .from(userRoleAssignments)
                .where(
                  and(
                    eq(userRoleAssignments.organizationId, orgId),
                    eq(userRoleAssignments.userId, users.id),
                    eq(userRoleAssignments.role, role),
                    eq(userRoleAssignments.isActive, true),
                  ),
                ),
            ),
          ),
        );
      return Number(rows[0]?.cnt ?? 0);
    },
    /**
     * Creates a user with a pre-check for username uniqueness. Throws
     * `UserAlreadyExistsError` if the username is already taken in the tenant,
     * including on unique-constraint violations from the database.
     */
    async createUnique(
      ctx: TenantContext | RequestContext,
      input: Parameters<typeof repo.create>[1],
    ) {
      const existing = await findByOrganizationAndUsername(ctx, input.username);
      if (existing) {
        throw new UserAlreadyExistsError();
      }
      try {
        return await repo.create(ctx, input);
      } catch (err) {
        if (getConstraintName(err) === "users_org_username_unique") {
          throw new UserAlreadyExistsError();
        }
        throw err;
      }
    },
    /**
     * #325: conditional (CAS) credential-epoch advance — the logout
     * revocation primitive. Increments `auth_epoch` ONLY when the row's
     * current epoch still equals `expectedEpoch` (the epoch embedded in the
     * presenting token). A stale/revoked token therefore cannot advance the
     * authority over a newer session, and an absent user/org pair matches
     * zero rows.
     *
     * @returns the new epoch when the CAS matched, else null.
     */
    async advanceAuthEpochIfCurrent(
      ctx: TenantContext | RequestContext,
      userId: string,
      expectedEpoch: number,
    ): Promise<number | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .update(users)
        .set({
          authEpoch: sql`${users.authEpoch} + 1`,
          updatedAt: now(),
        })
        .where(
          and(
            eq(users.organizationId, orgId),
            eq(users.id, userId),
            eq(users.authEpoch, expectedEpoch),
          ),
        )
        .returning({ authEpoch: users.authEpoch });
      return rows[0]?.authEpoch ?? null;
    },
    /**
     * #325: atomically replace the password hash AND advance the credential
     * epoch in one write. Every JWT issued under the previous generation
     * fails closed on the next authenticated request. Used by
     * self-service password change, admin candidate password reset, and the
     * local admin-reset CLI so no credential-change path can preserve
     * stolen tokens.
     */
    async updatePasswordAndAdvanceAuthEpoch(
      ctx: TenantContext | RequestContext,
      userId: string,
      passwordHash: string,
    ): Promise<typeof users.$inferSelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .update(users)
        .set({
          passwordHash,
          authEpoch: sql`${users.authEpoch} + 1`,
          updatedAt: now(),
        })
        .where(and(eq(users.organizationId, orgId), eq(users.id, userId)))
        .returning();
      return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
    },
    /**
     * #297: unconditionally advance the credential epoch WITHOUT touching the
     * password. Deactivation is a credential-revocation-grade event — every
     * JWT issued before it must fail closed, and re-activation must never
     * resurrect pre-deactivation tokens. Unlike {@link advanceAuthEpochIfCurrent}
     * there is no expected-epoch CAS: the admin command owns the account, and
     * concurrent logins racing the deactivation are blocked by `is_active`
     * anyway.
     */
    async advanceAuthEpoch(
      ctx: TenantContext | RequestContext,
      userId: string,
    ): Promise<number | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .update(users)
        .set({
          authEpoch: sql`${users.authEpoch} + 1`,
          updatedAt: now(),
        })
        .where(and(eq(users.organizationId, orgId), eq(users.id, userId)))
        .returning({ authEpoch: users.authEpoch });
      return rows[0]?.authEpoch ?? null;
    },
  };
}
