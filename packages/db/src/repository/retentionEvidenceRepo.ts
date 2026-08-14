import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Database, TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { retentionRuns } from "../schema/pg.js";
import type {
  BackupExecutorType,
  BackupVerificationStatus,
  RetentionRunResult,
} from "@exam/domain";

/** A retention evidence row (P7-CLOSE P7-3b). */
export type RetentionRunRow = {
  id: string;
  organizationId: string;
  operationId: string;
  tool: string;
  result: RetentionRunResult;
  startedAt: Date;
  completedAt: Date | null;
  prunedBackups: number | null;
  prunedWalArchives: number | null;
  retentionObjective: string | null;
  verificationStatus: BackupVerificationStatus | null;
  verificationDetail: string | null;
  failureReason: string | null;
  executorType: BackupExecutorType;
  createdAt: Date;
  updatedAt: Date;
};

function retentionRow(r: typeof retentionRuns.$inferSelect): RetentionRunRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    operationId: r.operationId,
    tool: r.tool,
    result: r.result as RetentionRunResult,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    prunedBackups: r.prunedBackups,
    prunedWalArchives: r.prunedWalArchives,
    retentionObjective: r.retentionObjective,
    verificationStatus: r.verificationStatus as BackupVerificationStatus | null,
    verificationDetail: r.verificationDetail,
    failureReason: r.failureReason,
    executorType: r.executorType as BackupExecutorType,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Host-side retention evidence repository (P7-CLOSE P7-3b).
 *
 * Records EVIDENCE of host-operator retention execution. Exam never performs
 * retention — this is read-only observation of host-side operations. Success
 * means: retention operation succeeded AND repository/chain verification
 * succeeded, not merely that a delete command returned zero.
 */
export function createRetentionEvidenceRepo(db: Database) {
  /** Reads the latest retention run (regardless of result). */
  async function latestRetention(
    ctx: TenantContext | RequestContext,
  ): Promise<RetentionRunRow | null> {
    const rows = await db
      .select()
      .from(retentionRuns)
      .where(eq(retentionRuns.organizationId, ctx.organizationId))
      .orderBy(desc(retentionRuns.startedAt))
      .limit(1);
    return rows[0] ? retentionRow(rows[0]) : null;
  }

  /** Reads the latest SUCCEEDED retention run. */
  async function latestSucceededRetention(
    ctx: TenantContext | RequestContext,
  ): Promise<RetentionRunRow | null> {
    const rows = await db
      .select()
      .from(retentionRuns)
      .where(eq(retentionRuns.organizationId, ctx.organizationId))
      .orderBy(desc(retentionRuns.startedAt))
      .limit(20);
    const succeeded = rows.find((r) => r.result === "succeeded");
    return succeeded ? retentionRow(succeeded) : null;
  }

  /** Lists recent retention runs (newest first). */
  async function listRetentionRuns(
    ctx: TenantContext | RequestContext,
    limit = 20,
  ): Promise<RetentionRunRow[]> {
    const rows = await db
      .select()
      .from(retentionRuns)
      .where(eq(retentionRuns.organizationId, ctx.organizationId))
      .orderBy(desc(retentionRuns.startedAt))
      .limit(limit);
    return rows.map(retentionRow);
  }

  /** Records a retention run evidence (start + terminal outcome in one write). */
  async function recordRetentionRun(
    ctx: TenantContext | RequestContext,
    params: {
      operationId: string;
      tool: string;
      result: RetentionRunResult;
      startedAt: Date;
      completedAt: Date | null;
      prunedBackups: number | null;
      prunedWalArchives: number | null;
      retentionObjective: string | null;
      verificationStatus: BackupVerificationStatus | null;
      verificationDetail: string | null;
      failureReason: string | null;
      executorType: BackupExecutorType;
      now: Date;
    },
  ): Promise<RetentionRunRow> {
    const inserted = await db
      .insert(retentionRuns)
      .values({
        id: randomUUID(),
        organizationId: ctx.organizationId,
        operationId: params.operationId,
        tool: params.tool,
        result: params.result,
        startedAt: params.startedAt,
        completedAt: params.completedAt,
        prunedBackups: params.prunedBackups,
        prunedWalArchives: params.prunedWalArchives,
        retentionObjective: params.retentionObjective,
        verificationStatus: params.verificationStatus,
        verificationDetail: params.verificationDetail,
        failureReason: params.failureReason,
        executorType: params.executorType,
        createdAt: params.now,
        updatedAt: params.now,
      })
      .returning();
    return retentionRow(inserted[0]!);
  }

  return {
    latestRetention,
    latestSucceededRetention,
    listRetentionRuns,
    recordRetentionRun,
  };
}
