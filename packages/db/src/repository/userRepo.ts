import type { Database } from "../types.js";
import {
  users,
  userRoleAssignments,
  type AssignableRole,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import { UserAlreadyExistsError, type RequestContext } from "@exam/domain";
import { and, count, eq, exists, inArray, sql } from "drizzle-orm";

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
     * Lists users filtered by roles with pagination, scoped to the tenant.
     * @returns `{ items, total }` where `total` is the unpaginated count of matching users.
     */
    async listPaginatedByRoles(
      ctx: TenantContext | RequestContext,
      roles: readonly string[],
      page: number,
      pageSize: number,
    ): Promise<{
      items: (typeof users.$inferSelect)[];
      total: number;
    }> {
      const orgId = resolveOrganizationId(ctx);
      const offset = (page - 1) * pageSize;
      const where = and(
        eq(users.organizationId, orgId),
        inArray(users.role, roles as string[]),
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
  };
}
