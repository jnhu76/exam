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

  /**
   * Lists every ACTIVE assignment for a user, scoped to ctx's org
   * (RBAC-M10-E). Deliberately returns the full active set — NO `.limit(1)` —
   * so the assignment-authority resolver can detect multi-primary corruption
   * (multiple `is_primary && is_active` rows for the same user). Inactive rows
   * are excluded by the WHERE clause, not by post-filtering. Ordered by
   * `createdAt` for deterministic regression output.
   */
  async function listActiveForUser(
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
          eq(userRoleAssignments.isActive, true),
        ),
      )
      .orderBy(userRoleAssignments.createdAt);
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
   *
   * This is the standalone (own-transaction) entry point. Code paths that are
   * ALREADY inside an {@link executeInTransaction} caller MUST use
   * {@link assignWithinTransaction} instead — calling this from inside another
   * transaction would nest a second `executeInTransaction` (savepoint + retry
   * policy) and is the wrong primitive (RBAC-M10-E P0-3).
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
    return executeInTransaction(db, (tx) =>
      assignWithinTransaction(tx, ctx, params),
    );
  }

  /**
   * Transaction-aware assignment primitive (RBAC-M10-E P0-3). Writes against a
   * caller-supplied transaction handle — NO `executeInTransaction` wrapper, so
   * it composes into a larger atomic unit (user creation + assignment +
   * profile, all in one txn). Callers that are NOT already in a transaction
   * MUST use {@link assign} instead.
   *
   * Invariant behavior is identical to {@link assign}: when `isPrimary &&
   * isActive`, every other active primary assignment for the same (org, user)
   * is demoted first so the ≤1-primary-active rule holds. This demotion is
   * what keeps the new partial unique index
   * `user_role_assignments_active_primary_unique` satisfiable when a different
   * active primary already exists.
   */
  async function assignWithinTransaction(
    tx: Database,
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
  }

  /**
   * Invariant-aware "make this role the user's primary active assignment"
   * (RBAC-M10-E). Unlike a bare upsert, this never tries to create a SECOND
   * active primary (which the partial unique index would reject). Flow:
   *
   *   1. demote every existing active primary for the (org, user);
   *   2. if an assignment row for (org, user, role) already exists, activate +
   *      promote it;
   *   3. otherwise insert a new active primary row for that role.
   *
   * Used by seed/demo-seed and is the canonical primitive for any path that
   * must guarantee a specific role is the primary active authority.
   *
   * This is the transaction-only variant. Callers already inside an
   * {@link executeInTransaction} scope MUST use this. Callers not in a
   * transaction MUST use {@link ensurePrimaryAssignment} instead.
   */
  async function ensurePrimaryAssignmentWithinTransaction(
    tx: Database,
    ctx: TenantContext | RequestContext,
    params: { userId: string; role: AssignableRole },
  ): Promise<UserRoleAssignmentRow> {
    const orgId = resolveOrganizationId(ctx);
    // 1. Demote existing active primaries for this user.
    await tx
      .update(userRoleAssignments)
      .set({ isPrimary: false, updatedAt: now() })
      .where(
        and(
          eq(userRoleAssignments.organizationId, orgId),
          eq(userRoleAssignments.userId, params.userId),
          eq(userRoleAssignments.isPrimary, true),
          eq(userRoleAssignments.isActive, true),
        ),
      );
    // 2. Look for an existing row for (org, user, role).
    const existing = await tx
      .select()
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.organizationId, orgId),
          eq(userRoleAssignments.userId, params.userId),
          eq(userRoleAssignments.role, params.role),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const updated = await tx
        .update(userRoleAssignments)
        .set({ isPrimary: true, isActive: true, updatedAt: now() })
        .where(eq(userRoleAssignments.id, existing[0]!.id))
        .returning();
      return row(updated[0]!);
    }
    // 3. Insert a new active primary row.
    const inserted = await tx
      .insert(userRoleAssignments)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        userId: params.userId,
        role: params.role,
        isPrimary: true,
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    return row(inserted[0]!);
  }

  /**
   * Public wrapper for {@link ensurePrimaryAssignmentWithinTransaction}. Opens
   * its own transaction; do NOT call from inside another transaction.
   */
  async function ensurePrimaryAssignment(
    ctx: TenantContext | RequestContext,
    params: { userId: string; role: AssignableRole },
  ): Promise<UserRoleAssignmentRow> {
    return executeInTransaction(db, (tx) =>
      ensurePrimaryAssignmentWithinTransaction(tx, ctx, params),
    );
  }

  /**
   * Makes `role` the user's primary active assignment. Demotes any existing
   * active primary to a non-primary active assignment. If the user already has
   * a row for `role`, that row is promoted and activated; otherwise a new row
   * is inserted.
   *
   * Transaction-only variant — call inside an existing transaction.
   */
  async function promoteOrAssignPrimaryWithinTransaction(
    tx: Database,
    ctx: TenantContext | RequestContext,
    params: { userId: string; role: AssignableRole },
  ): Promise<UserRoleAssignmentRow> {
    // Single-sourced: the demote-existing-then-promote-or-insert invariant is
    // owned by ensurePrimaryAssignmentWithinTransaction. Delegating keeps the
    // two copies from drifting independently.
    return ensurePrimaryAssignmentWithinTransaction(tx, ctx, params);
  }

  /**
   * Public wrapper for {@link promoteOrAssignPrimaryWithinTransaction}.
   */
  async function promoteOrAssignPrimary(
    ctx: TenantContext | RequestContext,
    params: { userId: string; role: AssignableRole },
  ): Promise<UserRoleAssignmentRow> {
    return executeInTransaction(db, (tx) =>
      promoteOrAssignPrimaryWithinTransaction(tx, ctx, params),
    );
  }

  /**
   * Replaces the user's primary active role: deactivates the current active
   * primary assignment and makes `role` the new active primary assignment.
   * Preserves secondary assignments.
   *
   * Transaction-only variant — call inside an existing transaction.
   */
  async function replacePrimaryRoleWithinTransaction(
    tx: Database,
    ctx: TenantContext | RequestContext,
    params: { userId: string; role: AssignableRole },
  ): Promise<UserRoleAssignmentRow> {
    const orgId = resolveOrganizationId(ctx);
    await tx
      .update(userRoleAssignments)
      .set({ isActive: false, updatedAt: now() })
      .where(
        and(
          eq(userRoleAssignments.organizationId, orgId),
          eq(userRoleAssignments.userId, params.userId),
          eq(userRoleAssignments.isPrimary, true),
          eq(userRoleAssignments.isActive, true),
        ),
      );
    return promoteOrAssignPrimaryWithinTransaction(tx, ctx, params);
  }

  /**
   * Public wrapper for {@link replacePrimaryRoleWithinTransaction}.
   */
  async function replacePrimaryRole(
    ctx: TenantContext | RequestContext,
    params: { userId: string; role: AssignableRole },
  ): Promise<UserRoleAssignmentRow> {
    return executeInTransaction(db, (tx) =>
      replacePrimaryRoleWithinTransaction(tx, ctx, params),
    );
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

  /**
   * Deactivates an assignment (keeps the row for audit history). If the
   * deactivated assignment was primary, auto-promotes the next active one
   * (RBAC-M7 invariant). Transaction-only variant.
   */
  async function deactivateWithinTransaction(
    tx: Database,
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    const orgId = resolveOrganizationId(ctx);
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
  }

  /**
   * Public wrapper for {@link deactivateWithinTransaction}. Do NOT call from
   * inside another transaction.
   */
  async function deactivate(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    return executeInTransaction(db, async (tx) =>
      deactivateWithinTransaction(tx, ctx, assignmentId),
    );
  }

  /**
   * Hard-removes an assignment row. If it was primary, auto-promotes the
   * next active assignment (RBAC-M7 invariant). Returns the removed row (for
   * callers that need to re-sync users.role), or null if not found.
   * Transaction-only variant.
   */
  async function removeWithinTransaction(
    tx: Database,
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    const orgId = resolveOrganizationId(ctx);
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
  }

  /**
   * Public wrapper for {@link removeWithinTransaction}. Do NOT call from
   * inside another transaction.
   */
  async function remove(
    ctx: TenantContext | RequestContext,
    assignmentId: string,
  ): Promise<UserRoleAssignmentRow | null> {
    return executeInTransaction(db, async (tx) =>
      removeWithinTransaction(tx, ctx, assignmentId),
    );
  }

  return {
    ...repo,
    listForUser,
    listActiveForUser,
    findPrimaryActiveForUser,
    assign,
    assignWithinTransaction,
    ensurePrimaryAssignment,
    ensurePrimaryAssignmentWithinTransaction,
    promoteOrAssignPrimary,
    promoteOrAssignPrimaryWithinTransaction,
    replacePrimaryRole,
    replacePrimaryRoleWithinTransaction,
    setPrimary,
    deactivate,
    deactivateWithinTransaction,
    remove,
    removeWithinTransaction,
  };
}
