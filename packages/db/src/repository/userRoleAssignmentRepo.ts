import { randomUUID } from "node:crypto";
import type { Database, TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { userRoleAssignments, type AssignableRole } from "../schema/pg.js";
import {
  resolveOrganizationId,
  createAsyncTenantCrudRepo,
  now,
} from "./baseRepo.js";
import { and, eq } from "drizzle-orm";
import { executeInTransaction } from "../types.js";

/** A user-role-assignment row shape returned by the repo. */
export type UserRoleAssignmentRow = {
  id: string;
  organizationId: string;
  userId: string;
  role: AssignableRole;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function row(
  r: typeof userRoleAssignments.$inferSelect,
): UserRoleAssignmentRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    userId: r.userId,
    role: r.role as AssignableRole,
    isPrimary: r.isPrimary,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Tenant-scoped user-role-assignment repository (RBAC-M7).
 *
 * Multi-role: a user may hold several role rows per org, exactly one of which
 * is the primary active role. The ≤1-primary-active invariant is enforced
 * transactionally in {@link assign} / {@link setPrimary} by clearing other
 * primary flags for the same user before setting a new one.
 */
export function createUserRoleAssignmentRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, userRoleAssignments);

  /** Lists all assignments for a user, scoped to ctx's org. */
  async function listForUser(
    ctx: TenantContext | RequestContext,
    userId: string,
  ): Promise<UserRoleAssignmentRow[]> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select()
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.organizationId, orgId),
          eq(userRoleAssignments.userId, userId),
        ),
      );
    return rows.map(row);
  }

  /** Returns the single primary active assignment for a user, or null. */
  async function findPrimaryActiveForUser(
    ctx: TenantContext | RequestContext,
    userId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .select()
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.organizationId, orgId),
          eq(userRoleAssignments.userId, userId),
          eq(userRoleAssignments.isPrimary, true),
          eq(userRoleAssignments.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ? row(rows[0]) : null;
  }

  /**
   * Assigns a role to a user. When `isPrimary`, demotes the user's prior
   * primary active assignment(s) first (transactional) to preserve the
   * ≤1-primary invariant. Returns the new assignment row.
   */
  async function assign(
    ctx: TenantContext | RequestContext,
    params: {
      userId: string;
      role: AssignableRole;
      isPrimary?: boolean;
      isActive?: boolean;
    },
  ): Promise<UserRoleAssignmentRow> {
    const orgId = resolveOrganizationId(ctx);
    const isPrimary = params.isPrimary ?? false;
    const isActive = params.isActive ?? true;

    return executeInTransaction(db, async (tx) => {
      if (isPrimary && isActive) {
        // Demote any existing primary active assignment(s) for this user.
        await tx
          .update(userRoleAssignments)
          .set({ isPrimary: false, updatedAt: now() })
          .where(
            and(
              eq(userRoleAssignments.organizationId, orgId),
              eq(userRoleAssignments.userId, params.userId),
              eq(userRoleAssignments.isPrimary, true),
            ),
          );
      }
      const inserted = await tx
        .insert(userRoleAssignments)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          userId: params.userId,
          role: params.role,
          isPrimary,
          isActive,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      return row(inserted[0]!);
    });
  }

  /** Promotes an assignment to be the user's primary active role, demoting
   *  any other primary active assignment for the same user (transactional). */
  async function setPrimary(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    const orgId = resolveOrganizationId(ctx);
    return executeInTransaction(db, async (tx) => {
      const target = await tx
        .select()
        .from(userRoleAssignments)
        .where(
          and(
            eq(userRoleAssignments.organizationId, orgId),
            eq(userRoleAssignments.id, assignmentId),
          ),
        )
        .limit(1);
      if (!target[0]) return null;
      const t = target[0];
      // Demote other primaries for the same user.
      await tx
        .update(userRoleAssignments)
        .set({ isPrimary: false, updatedAt: now() })
        .where(
          and(
            eq(userRoleAssignments.organizationId, orgId),
            eq(userRoleAssignments.userId, t.userId),
            eq(userRoleAssignments.isPrimary, true),
          ),
        );
      // Promote + activate the target.
      const updated = await tx
        .update(userRoleAssignments)
        .set({ isPrimary: true, isActive: true, updatedAt: now() })
        .where(eq(userRoleAssignments.id, assignmentId))
        .returning();
      return updated[0] ? row(updated[0]) : null;
    });
  }

  /**
   * Promotes the user's first remaining active (non-primary) assignment to
   * primary, if any. Used after the primary is removed/deactivated to keep
   * the "one primary active role" invariant (RBAC-M7 review #7). No-op if
   * there is no other active assignment (the user then has zero primaries,
   * which is allowed — callers re-sync users.role accordingly).
   */
  async function promoteNextActiveForUser(
    tx: Parameters<Parameters<typeof executeInTransaction>[1]>[0],
    orgId: string,
    userId: string,
  ): Promise<void> {
    const next = await tx
      .select()
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.organizationId, orgId),
          eq(userRoleAssignments.userId, userId),
          eq(userRoleAssignments.isActive, true),
        ),
      )
      .orderBy(userRoleAssignments.createdAt)
      .limit(1);
    if (next[0]) {
      await tx
        .update(userRoleAssignments)
        .set({ isPrimary: true, updatedAt: now() })
        .where(eq(userRoleAssignments.id, next[0]!.id));
    }
  }

  /** Deactivates an assignment (keeps the row for audit history). If the
   *  deactivated assignment was primary, auto-promotes the next active one
   *  (RBAC-M7 invariant). */
  async function deactivate(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    const orgId = resolveOrganizationId(ctx);
    return executeInTransaction(db, async (tx) => {
      const before = await tx
        .select()
        .from(userRoleAssignments)
        .where(
          and(
            eq(userRoleAssignments.organizationId, orgId),
            eq(userRoleAssignments.id, assignmentId),
          ),
        )
        .limit(1);
      if (!before[0]) return null;
      const updated = await tx
        .update(userRoleAssignments)
        .set({ isActive: false, updatedAt: now() })
        .where(eq(userRoleAssignments.id, assignmentId))
        .returning();
      if (before[0]!.isPrimary) {
        await promoteNextActiveForUser(tx, orgId, before[0]!.userId);
      }
      return updated[0] ? row(updated[0]) : null;
    });
  }

  /** Hard-removes an assignment row. If it was primary, auto-promotes the
   *  next active assignment (RBAC-M7 invariant). Returns the removed row (for
   *  callers that need to re-sync users.role), or null if not found. */
  async function remove(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    const orgId = resolveOrganizationId(ctx);
    return executeInTransaction(db, async (tx) => {
      const before = await tx
        .select()
        .from(userRoleAssignments)
        .where(
          and(
            eq(userRoleAssignments.organizationId, orgId),
            eq(userRoleAssignments.id, assignmentId),
          ),
        )
        .limit(1);
      if (!before[0]) return null;
      await tx
        .delete(userRoleAssignments)
        .where(eq(userRoleAssignments.id, assignmentId));
      if (before[0]!.isPrimary) {
        await promoteNextActiveForUser(tx, orgId, before[0]!.userId);
      }
      return row(before[0]!);
    });
  }

  return {
    ...repo,
    listForUser,
    findPrimaryActiveForUser,
    assign,
    setPrimary,
    deactivate,
    remove,
  };
}
