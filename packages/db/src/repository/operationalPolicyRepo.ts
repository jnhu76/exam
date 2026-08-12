import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database, TenantContext, TransactionDatabase } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { backupOperationalPolicy } from "../schema/pg.js";
import { executeInTransaction, hasPostgresErrorCode } from "../types.js";
import { OpsPolicyVersionConflictError } from "@exam/domain";

/** PostgreSQL unique-violation code (first-create race on the org index). */
const PG_UNIQUE_VIOLATION = "23505";

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
   * Creates or updates the intent record with REAL optimistic concurrency.
   *
   * CAS semantics: the UPDATE carries the version in its predicate
   * (`WHERE id = ? AND version = expectedVersion`), so two concurrent
   * writers that both read version N cannot both succeed — the second
   * UPDATE matches zero rows and is rejected with `VERSION_CONFLICT`
   * (PostgreSQL re-evaluates the predicate against the committed row after
   * the row-lock wait under READ COMMITTED). `expectedVersion` is the
   * version the caller read (0 = no row exists / first creation). On
   * mismatch the write is rejected and nothing changes. A concurrent
   * first-creation race is detected via the unique org index (23505) and
   * mapped to the same conflict error. The mutation runs in one
   * transaction with the audit write performed by the caller's transaction
   * wrapper.
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
      // The version is part of the UPDATE predicate — this is the CAS guard.
      // Under READ COMMITTED a concurrent writer that read the same version
      // blocks on the row lock, then re-evaluates the predicate against the
      // committed row (now one version newer) and matches zero rows.
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
        .where(
          and(
            eq(backupOperationalPolicy.id, current.id),
            eq(backupOperationalPolicy.version, params.expectedVersion),
          ),
        )
        .returning();
      if (updated[0]) return row(updated[0]!);
      // The row was changed between our read and our write — lost update.
      throw new OpsPolicyVersionConflictError(
        `Operational policy intent version mismatch: expected ${params.expectedVersion}, row changed concurrently`,
      );
    }

    if (params.expectedVersion !== 0) {
      throw new OpsPolicyVersionConflictError(
        "Operational policy intent does not exist; expected version 0",
      );
    }
    try {
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
    } catch (err) {
      // Concurrent first creation: another transaction inserted the org row
      // between our read and insert (unique org index). Same conflict class —
      // the caller re-reads and retries with the winner's version. The code
      // check walks the error chain (Drizzle wraps the Postgres error).
      if (hasPostgresErrorCode(err, PG_UNIQUE_VIOLATION)) {
        throw new OpsPolicyVersionConflictError(
          "Operational policy intent was created concurrently; re-read the current version and retry",
        );
      }
      throw err;
    }
  }

  return {
    getPolicy,
    upsertPolicyWithinTransaction,
  };
}
