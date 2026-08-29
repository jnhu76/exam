import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { ConflictError } from "@exam/domain";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database, TenantContext } from "../types.js";
import { staffInvitations, type AssignableRole } from "../schema/pg.js";
import { now, resolveOrganizationId } from "./baseRepo.js";

/**
 * Staff invitation row — the `staff_invitations` select shape (#297).
 * Lifecycle status is never stored; derive with
 * `computeStaffInvitationStatus` (@exam/domain/identity) at read time.
 */
export type StaffInvitationRow = typeof staffInvitations.$inferSelect;

/** Input for issuing a new staff invitation (state only — no raw token). */
export interface CreateStaffInvitationInput {
  email: string;
  role: Exclude<AssignableRole, "Candidate">;
  /** Hex SHA-256 of the raw token (never the raw token itself). */
  tokenHash: string;
  expiresAt: Date;
  createdBy: string;
  /** Explicit clock: the command layer (fastify.now) owns time (ADR-006). */
  now: Date;
}

/**
 * Creates a repository for the `staff_invitations` table (#297).
 *
 * The invitation IS the pending-membership state: the invited person has no
 * user row until acceptance succeeds. All methods are org-scoped through the
 * context's `organizationId`. Concurrency relies on PostgreSQL row locks and
 * the partial unique index `staff_invitations_org_email_open_unique`
 * (one OPEN invitation per org+email), never on application-level checks.
 *
 * @param db - Drizzle database connection (or an open transaction).
 */
export function createStaffInvitationRepo(db: Database) {
  /**
   * Inserts a new invitation, superseding (revoking) any OPEN invitation for
   * the same (organization, email) in the same transaction. Returns the
   * created row.
   *
   * Concurrent duplicate invites for the same email serialize on the partial
   * unique index: the loser's INSERT blocks until the winner commits and then
   * fails with {@link ConflictError} (the supersede statement cannot see the
   * winner's uncommitted row, so the index is the only serialization point).
   */
  async function createWithinTransaction(
    ctx: TenantContext | RequestContext,
    input: CreateStaffInvitationInput,
  ): Promise<StaffInvitationRow> {
    const orgId = resolveOrganizationId(ctx);
    await db
      .update(staffInvitations)
      .set({ revokedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(staffInvitations.organizationId, orgId),
          eq(staffInvitations.email, input.email),
          isNull(staffInvitations.consumedAt),
          isNull(staffInvitations.revokedAt),
        ),
      );
    const inserted = await db
      .insert(staffInvitations)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        email: input.email,
        role: input.role,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
      })
      .returning();
    if (!inserted[0]) {
      throw new ConflictError(
        "An open invitation for this email already exists",
      );
    }
    return inserted[0];
  }

  /**
   * Single-statement CAS consumption. The UPDATE re-evaluates its predicate
   * after any row-lock wait (PostgreSQL READ COMMITTED), so concurrent
   * double-submit yields exactly one `consumed_at` and one returned row; the
   * loser gets `undefined`. Expired and revoked invitations never consume.
   */
  async function consumeByTokenHashWithinTransaction(
    ctx: TenantContext | RequestContext,
    tokenHash: string,
    nowArg: Date,
  ): Promise<StaffInvitationRow | undefined> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .update(staffInvitations)
      .set({ consumedAt: nowArg, updatedAt: nowArg })
      .where(
        and(
          eq(staffInvitations.tokenHash, tokenHash),
          eq(staffInvitations.organizationId, orgId),
          isNull(staffInvitations.consumedAt),
          isNull(staffInvitations.revokedAt),
          gt(staffInvitations.expiresAt, nowArg),
        ),
      )
      .returning();
    return rows[0];
  }

  /**
   * Revokes a PENDING invitation by id. Returns the updated row, or null
   * when the invitation does not exist, is not open, or belongs to another
   * organization (fail-closed; callers fold all three into 404).
   */
  async function revokeById(
    ctx: TenantContext | RequestContext,
    invitationId: string,
    nowArg: Date,
  ): Promise<StaffInvitationRow | null> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .update(staffInvitations)
      .set({ revokedAt: nowArg, updatedAt: nowArg })
      .where(
        and(
          eq(staffInvitations.id, invitationId),
          eq(staffInvitations.organizationId, orgId),
          isNull(staffInvitations.consumedAt),
          isNull(staffInvitations.revokedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Lists invitations for the org, newest first, with pagination. */
  async function listPaginated(
    ctx: TenantContext | RequestContext,
    pagination: { limit: number; offset: number },
  ): Promise<{ items: StaffInvitationRow[]; total: number }> {
    const orgId = resolveOrganizationId(ctx);
    const items = (await db
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.organizationId, orgId))
      .orderBy(desc(staffInvitations.createdAt), desc(staffInvitations.id))
      .limit(pagination.limit)
      .offset(pagination.offset)) as StaffInvitationRow[];
    const totals = await db
      .select({ value: count() })
      .from(staffInvitations)
      .where(eq(staffInvitations.organizationId, orgId));
    return { items, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Deletes expired/consumed/revoked invitations older than `olderThan` for
   * the org. Retention backstop (audit facts live in `audit_logs`, not here);
   * returns the number of rows removed.
   */
  async function deleteTerminalOlderThan(
    ctx: TenantContext | RequestContext,
    olderThan: Date,
    nowArg: Date,
  ): Promise<number> {
    const orgId = resolveOrganizationId(ctx);
    const rows = await db
      .delete(staffInvitations)
      .where(
        and(
          eq(staffInvitations.organizationId, orgId),
          sql`(${staffInvitations.consumedAt} IS NOT NULL OR ${staffInvitations.revokedAt} IS NOT NULL OR ${staffInvitations.expiresAt} <= ${nowArg})`,
          sql`${staffInvitations.updatedAt} < ${olderThan}`,
        ),
      )
      .returning();
    return rows.length;
  }

  return {
    createWithinTransaction,
    consumeByTokenHashWithinTransaction,
    revokeById,
    listPaginated,
    deleteTerminalOlderThan,
  };
}
