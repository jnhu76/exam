import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database, TenantContext, TransactionDatabase } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { backupOperationalPolicy } from "../schema/pg.js";
import { executeInTransaction } from "../types.js";
import { OpsPolicyVersionConflictError } from "@exam/domain";

/** The operational policy INTENT row (P7-E3). */
export type OperationalPolicyRow = {
  id: string;
  organizationId: string;
  desiredRpoSeconds: number;
  desiredRetentionDays: number;
  desiredDrillCadenceDays: number;
  version: number;
  reason: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function row(
  r: typeof backupOperationalPolicy.$inferSelect,
): OperationalPolicyRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    desiredRpoSeconds: r.desiredRpoSeconds,
    desiredRetentionDays: r.desiredRetentionDays,
    desiredDrillCadenceDays: r.desiredDrillCadenceDays,
    version: r.version,
    reason: r.reason,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Operational policy INTENT repository (P7-E3, ADR-017 D9).
 *
 * One typed, versioned row per organization. Writes are CAS-protected
 * (optimistic concurrency): the caller must echo the version it read; a
 * mismatch rejects with `VERSION_CONFLICT`. Absence = NOT_CONFIGURED.
 * The intent NEVER binds infrastructure — this repository only stores the
 * Admin's desired objectives.
 */
export function createOperationalPolicyRepo(db: Database) {
  /** Reads the current intent record (or null). */
  async function getPolicy(
    ctx: TenantContext | RequestContext,
  ): Promise<OperationalPolicyRow | null> {
    const rows = await db
      .select()
      .from(backupOperationalPolicy)
      .where(eq(backupOperationalPolicy.organizationId, ctx.organizationId))
      .limit(1);
    return rows[0] ? row(rows[0]) : null;
  }

  /**
   * Creates or updates the intent record with CAS. `expectedVersion` is the
   * version the caller read (0 = no row exists / first creation). On
   * mismatch the write is rejected and nothing changes. The mutation runs
   * in one transaction with the audit write performed by the caller's
   * transaction wrapper.
   */
  async function upsertPolicyWithinTransaction(
    ctx: TenantContext | RequestContext,
    tx: TransactionDatabase,
    params: {
      desiredRpoSeconds: number;
      desiredRetentionDays: number;
      desiredDrillCadenceDays: number;
      expectedVersion: number;
      reason: string;
      actorId: string;
      now: Date;
    },
  ): Promise<OperationalPolicyRow> {
    const orgId = ctx.organizationId;
    const existing = await tx
      .select()
      .from(backupOperationalPolicy)
      .where(eq(backupOperationalPolicy.organizationId, orgId))
      .limit(1);

    if (existing[0]) {
      const current = existing[0]!;
      if (params.expectedVersion !== current.version) {
        throw new OpsPolicyVersionConflictError(
          `Operational policy intent version mismatch: expected ${params.expectedVersion}, current ${current.version}`,
        );
      }
      const updated = await tx
        .update(backupOperationalPolicy)
        .set({
          desiredRpoSeconds: params.desiredRpoSeconds,
          desiredRetentionDays: params.desiredRetentionDays,
          desiredDrillCadenceDays: params.desiredDrillCadenceDays,
          version: current.version + 1,
          reason: params.reason,
          updatedBy: params.actorId,
          updatedAt: params.now,
        })
        .where(eq(backupOperationalPolicy.id, current.id))
        .returning();
      return row(updated[0]!);
    }

    if (params.expectedVersion !== 0) {
      throw new OpsPolicyVersionConflictError(
        "Operational policy intent does not exist; expected version 0",
      );
    }
    const inserted = await tx
      .insert(backupOperationalPolicy)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        desiredRpoSeconds: params.desiredRpoSeconds,
        desiredRetentionDays: params.desiredRetentionDays,
        desiredDrillCadenceDays: params.desiredDrillCadenceDays,
        version: 1,
        reason: params.reason,
        createdBy: params.actorId,
        updatedBy: params.actorId,
        createdAt: params.now,
        updatedAt: params.now,
      })
      .returning();
    return row(inserted[0]!);
  }

  return {
    getPolicy,
    upsertPolicyWithinTransaction,
  };
}
