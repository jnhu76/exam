import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database, TenantContext, TransactionDatabase } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { backupRunEvents, backupRuns, restoreDrillRuns } from "../schema/pg.js";
import type {
  BackupExecutorType,
  BackupRunEventType,
  BackupRunStatus,
  BackupType,
  BackupVerificationStatus,
  RestoreDrillResult,
  RestoreDrillSource,
} from "@exam/domain";
import { executeInTransaction, hasPostgresErrorCode } from "../types.js";

/** A backup-run evidence row (P7-E2B). */
export type BackupRunRow = {
  id: string;
  organizationId: string;
  operationId: string;
  backupType: BackupType;
  status: BackupRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  artifactLabel: string | null;
  artifactSizeBytes: number | null;
  verificationMethod: string | null;
  verificationStatus: BackupVerificationStatus | null;
  verifiedAt: Date | null;
  failureReason: string | null;
  executorType: BackupExecutorType;
  createdAt: Date;
  updatedAt: Date;
};

function runRow(r: typeof backupRuns.$inferSelect): BackupRunRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    operationId: r.operationId,
    backupType: r.backupType as BackupType,
    status: r.status as BackupRunStatus,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    artifactLabel: r.artifactLabel,
    artifactSizeBytes: r.artifactSizeBytes,
    verificationMethod: r.verificationMethod,
    verificationStatus: r.verificationStatus as BackupVerificationStatus | null,
    verifiedAt: r.verifiedAt,
    failureReason: r.failureReason,
    executorType: r.executorType as BackupExecutorType,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** A restore-drill evidence row (P7-E2B). */
export type RestoreDrillRow = {
  id: string;
  organizationId: string;
  operationId: string;
  backupType: BackupType;
  result: RestoreDrillResult;
  source: RestoreDrillSource;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function drillRow(r: typeof restoreDrillRuns.$inferSelect): RestoreDrillRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    operationId: r.operationId,
    backupType: r.backupType as BackupType,
    result: r.result as RestoreDrillResult,
    source: r.source as RestoreDrillSource,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    durationMs: r.durationMs,
    failureReason: r.failureReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Backup / restore-drill evidence repository (P7-E2B).
 *
 * Every write is a typed evidence mutation with SUCCESS semantics (ADR-017
 * D10): `succeeded` requires artifact + readability + verification +
 * durable commit; a duplicate logical run can never produce contradictory
 * terminal evidence; a crash before verified evidence never claims success.
 */
export function createBackupEvidenceRepo(db: Database) {
  /** Records an append-only transition event for a run. The event timestamp
   *  is the caller-provided authority time (`now`) — ADR-006. */
  async function recordEvent(
    tx: TransactionDatabase,
    ctx: TenantContext | RequestContext,
    runId: string,
    operationId: string,
    eventType: BackupRunEventType,
    now: Date,
    detail?: string,
  ): Promise<void> {
    await tx.insert(backupRunEvents).values({
      id: randomUUID(),
      organizationId: ctx.organizationId,
      runId,
      operationId,
      eventType,
      detail: detail ?? null,
      createdAt: now,
    });
  }

  /**
   * Starts a backup run: closes any stale `running` rows for the same
   * operationId as `abandoned` (crash recovery — a process that died without
   * completing is never promoted to success), then inserts a fresh `running`
   * row. Transactional under the caller's transaction.
   */
  async function startRunWithinTransaction(
    tx: TransactionDatabase,
    ctx: TenantContext | RequestContext,
    params: {
      operationId: string;
      backupType: BackupType;
      artifactLabel: string;
      executorType: BackupExecutorType;
      now: Date;
    },
  ): Promise<BackupRunRow> {
    const orgId = ctx.organizationId;
    // Close stale running attempts for the same logical run.
    const stale = await tx
      .select()
      .from(backupRuns)
      .where(
        and(
          eq(backupRuns.organizationId, orgId),
          eq(backupRuns.operationId, params.operationId),
          eq(backupRuns.status, "running"),
        ),
      );
    for (const s of stale) {
      await tx
        .update(backupRuns)
        .set({ status: "abandoned", updatedAt: params.now })
        .where(eq(backupRuns.id, s.id));
      await recordEvent(
        tx,
        ctx,
        s.id,
        params.operationId,
        "abandoned",
        params.now,
        "stale running attempt closed by a new start (crash recovery)",
      );
    }
    const inserted = await tx
      .insert(backupRuns)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        operationId: params.operationId,
        backupType: params.backupType,
        status: "running",
        startedAt: params.now,
        artifactLabel: params.artifactLabel,
        verificationStatus: "pending",
        executorType: params.executorType,
        createdAt: params.now,
        updatedAt: params.now,
      })
      .returning();
    const run = runRow(inserted[0]!);
    await recordEvent(
      tx,
      ctx,
      run.id,
      params.operationId,
      "started",
      params.now,
      `type=${params.backupType}`,
    );
    return run;
  }

  /**
   * Public wrapper for {@link startRunWithinTransaction}: opens its own
   * transaction. Do NOT call from inside another transaction.
   */
  async function startRun(
    ctx: TenantContext | RequestContext,
    params: {
      operationId: string;
      backupType: BackupType;
      artifactLabel: string;
      executorType: BackupExecutorType;
      now: Date;
    },
  ): Promise<BackupRunRow> {
    return executeInTransaction(db, (tx) =>
      startRunWithinTransaction(tx, ctx, params),
    );
  }

  /**
   * Completes a run with VERIFIED success evidence. This is the ONLY path
   * that produces status `succeeded`.
   *
   * SUCCESS semantics (D10 #1): the caller MUST have performed and passed the
   * artifact verification before calling complete — the method records
   * `verificationStatus = verified` atomically with the terminal state; a
   * caller that did not verify MUST use {@link failRun} instead.
   *
   * Duplicate-run semantics (D10 #2): if a `succeeded` row already exists for
   * the same operationId with a DIFFERENT artifact, the new attempt is
   * recorded as `failed` with reason `duplicate_operation_conflict` — two
   * contradictory terminal successes can never coexist (backed by the
   * partial unique index). An identical artifact is an idempotent no-op
   * returning the existing success.
   */
  async function completeRun(
    ctx: TenantContext | RequestContext,
    params: {
      operationId: string;
      backupType: BackupType;
      artifactLabel: string;
      artifactSizeBytes: number;
      verificationMethod: string;
      verifiedAt: Date;
      executorType: BackupExecutorType;
      now: Date;
      /** True start of the run, when the caller knows it (e.g. cold-import
       *  spool); defaults to `now` when start evidence was not recorded. */
      startedAt?: Date;
      /** True completion of the run, when the caller knows it (e.g. cold-import
       *  spool); defaults to `now`. The RPO projection reads `verifiedAt`, so
       *  a caller with older evidence MUST pass the real completion here and
       *  as `verifiedAt` — importing an old backup with `now` would falsify
       *  its age (P7-E truthful evidence). */
      completedAt?: Date;
    },
  ): Promise<BackupRunRow> {
    // Evidence time authority: the run's terminal timestamps come from the
    // caller-provided completion when known, otherwise from `now`. `now`
    // remains the ledger-ingestion time (createdAt/updatedAt/events).
    const completedAt = params.completedAt ?? params.now;
    try {
      return await executeInTransaction(db, async (tx) => {
        const orgId = ctx.organizationId;
        const existingSuccess = await tx
          .select()
          .from(backupRuns)
          .where(
            and(
              eq(backupRuns.organizationId, orgId),
              eq(backupRuns.operationId, params.operationId),
              eq(backupRuns.status, "succeeded"),
            ),
          )
          .limit(1);
        if (existingSuccess[0]) {
          const prior = runRow(existingSuccess[0]!);
          if (prior.artifactLabel === params.artifactLabel) {
            // Idempotent re-completion of the same artifact: no-op.
            return prior;
          }
          // Contradictory duplicate: record the new attempt as failed and
          // never touch the existing success (fail closed). The rejected
          // attempt carries verificationStatus 'failed' (matching failRun) —
          // a failed row must never render as verification-verified.
          const inserted = await tx
            .insert(backupRuns)
            .values({
              id: randomUUID(),
              organizationId: orgId,
              operationId: params.operationId,
              backupType: params.backupType,
              status: "failed",
              startedAt: params.startedAt ?? params.now,
              // The REJECTED attempt happened now (at completion/import time) —
              // never back-dated to the artifact's completion.
              completedAt: params.now,
              artifactLabel: params.artifactLabel,
              artifactSizeBytes: params.artifactSizeBytes,
              verificationStatus: "failed",
              verifiedAt: null,
              failureReason: "duplicate_operation_conflict",
              executorType: params.executorType,
              createdAt: params.now,
              updatedAt: params.now,
            })
            .returning();
          const rejected = runRow(inserted[0]!);
          await recordEvent(
            tx,
            ctx,
            rejected.id,
            params.operationId,
            "duplicate_rejected",
            params.now,
            "a verified success already exists for this operationId with a different artifact",
          );
          return rejected;
        }

        // Find the current attempt (started row) or create one if the start
        // evidence was lost (crash before the start hook / start unrecorded).
        const attempt = await tx
          .select()
          .from(backupRuns)
          .where(
            and(
              eq(backupRuns.organizationId, orgId),
              eq(backupRuns.operationId, params.operationId),
              eq(backupRuns.status, "running"),
            ),
          )
          .orderBy(desc(backupRuns.startedAt))
          .limit(1);
        let runId: string;
        if (attempt[0]) {
          runId = attempt[0]!.id;
          await tx
            .update(backupRuns)
            .set({
              status: "succeeded",
              completedAt,
              artifactLabel: params.artifactLabel,
              artifactSizeBytes: params.artifactSizeBytes,
              verificationMethod: params.verificationMethod,
              verificationStatus: "verified",
              verifiedAt: params.verifiedAt,
              updatedAt: params.now,
            })
            .where(eq(backupRuns.id, runId));
        } else {
          const inserted = await tx
            .insert(backupRuns)
            .values({
              id: randomUUID(),
              organizationId: orgId,
              operationId: params.operationId,
              backupType: params.backupType,
              status: "succeeded",
              // Start evidence was not recorded (crash before the start hook):
              // the ledger records start==complete (evidence time) unless the
              // caller knows the true start (e.g. cold-import spool).
              // Truthful: no claim is made about when the run actually began.
              startedAt: params.startedAt ?? completedAt,
              completedAt,
              artifactLabel: params.artifactLabel,
              artifactSizeBytes: params.artifactSizeBytes,
              verificationMethod: params.verificationMethod,
              verificationStatus: "verified",
              verifiedAt: params.verifiedAt,
              executorType: params.executorType,
              createdAt: params.now,
              updatedAt: params.now,
            })
            .returning();
          runId = inserted[0]!.id;
        }
        await recordEvent(
          tx,
          ctx,
          runId,
          params.operationId,
          "succeeded",
          params.now,
          `method=${params.verificationMethod}`,
        );
        const final = await tx
          .select()
          .from(backupRuns)
          .where(eq(backupRuns.id, runId))
          .limit(1);
        return runRow(final[0]!);
      });
    } catch (err) {
      // Concurrent duplicate completion: another transaction committed a
      // `succeeded` row between our read and insert (23505 on the partial
      // unique index). Fail closed — re-read and classify. The code check
      // walks the error chain (Drizzle wraps the Postgres error).
      if (hasPostgresErrorCode(err, "23505")) {
        const existing = await latestSucceededRun(ctx, params.operationId);
        if (existing && existing.artifactLabel === params.artifactLabel) {
          return existing;
        }
        // Contradictory concurrent success: record a failed attempt.
        return failRun(ctx, {
          operationId: params.operationId,
          backupType: params.backupType,
          executorType: params.executorType,
          reason: "duplicate_operation_conflict",
          now: params.now,
        });
      }
      throw err;
    }
  }

  /**
   * Records a deterministic failure for the current attempt of a logical run
   * (or creates a failed row if no running attempt exists). Sanitized reason
   * only — the repo never stores secrets/credentials/paths.
   */
  async function failRun(
    ctx: TenantContext | RequestContext,
    params: {
      operationId: string;
      backupType: BackupType;
      executorType: BackupExecutorType;
      reason: string;
      now: Date;
    },
  ): Promise<BackupRunRow> {
    return executeInTransaction(db, async (tx) => {
      const orgId = ctx.organizationId;
      const attempt = await tx
        .select()
        .from(backupRuns)
        .where(
          and(
            eq(backupRuns.organizationId, orgId),
            eq(backupRuns.operationId, params.operationId),
            eq(backupRuns.status, "running"),
          ),
        )
        .orderBy(desc(backupRuns.startedAt))
        .limit(1);
      let runId: string;
      if (attempt[0]) {
        runId = attempt[0]!.id;
        await tx
          .update(backupRuns)
          .set({
            status: "failed",
            completedAt: params.now,
            verificationStatus: "failed",
            failureReason: params.reason,
            updatedAt: params.now,
          })
          .where(eq(backupRuns.id, runId));
      } else {
        const inserted = await tx
          .insert(backupRuns)
          .values({
            id: randomUUID(),
            organizationId: orgId,
            operationId: params.operationId,
            backupType: params.backupType,
            status: "failed",
            startedAt: params.now,
            completedAt: params.now,
            verificationStatus: "failed",
            failureReason: params.reason,
            executorType: params.executorType,
            createdAt: params.now,
            updatedAt: params.now,
          })
          .returning();
        runId = inserted[0]!.id;
      }
      await recordEvent(
        tx,
        ctx,
        runId,
        params.operationId,
        "failed",
        params.now,
        params.reason,
      );
      const final = await tx
        .select()
        .from(backupRuns)
        .where(eq(backupRuns.id, runId))
        .limit(1);
      return runRow(final[0]!);
    });
  }

  /** Lists backup runs newest-first (bounded). */
  async function listRuns(
    ctx: TenantContext | RequestContext,
    limit = 50,
  ): Promise<BackupRunRow[]> {
    const rows = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.organizationId, ctx.organizationId))
      .orderBy(desc(backupRuns.startedAt))
      .limit(limit);
    return rows.map(runRow);
  }

  /** The most recent run record for the organization (any status). */
  async function latestRun(
    ctx: TenantContext | RequestContext,
  ): Promise<BackupRunRow | null> {
    const rows = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.organizationId, ctx.organizationId))
      .orderBy(desc(backupRuns.startedAt))
      .limit(1);
    return rows[0] ? runRow(rows[0]) : null;
  }

  /** The most recent VERIFIED run for a given logical operation (or null). */
  async function latestSucceededRun(
    ctx: TenantContext | RequestContext,
    operationId?: string,
  ): Promise<BackupRunRow | null> {
    const rows = await db
      .select()
      .from(backupRuns)
      .where(
        and(
          eq(backupRuns.organizationId, ctx.organizationId),
          eq(backupRuns.status, "succeeded"),
          ...(operationId ? [eq(backupRuns.operationId, operationId)] : []),
        ),
      )
      .orderBy(sql`${backupRuns.verifiedAt} DESC NULLS LAST`)
      .limit(1);
    return rows[0] ? runRow(rows[0]) : null;
  }

  /** The most recent failed run (for the "last failure" projection). */
  async function lastFailure(
    ctx: TenantContext | RequestContext,
  ): Promise<BackupRunRow | null> {
    const rows = await db
      .select()
      .from(backupRuns)
      .where(
        and(
          eq(backupRuns.organizationId, ctx.organizationId),
          eq(backupRuns.status, "failed"),
        ),
      )
      .orderBy(sql`${backupRuns.completedAt} DESC NULLS LAST`)
      .limit(1);
    return rows[0] ? runRow(rows[0]) : null;
  }

  /** Aggregate status counts for the summary projection. */
  async function statusCounts(
    ctx: TenantContext | RequestContext,
  ): Promise<Record<BackupRunStatus, number>> {
    const rows = await db
      .select({
        status: backupRuns.status,
        count: sql<number>`count(*)`,
      })
      .from(backupRuns)
      .where(eq(backupRuns.organizationId, ctx.organizationId))
      .groupBy(backupRuns.status);
    const counts: Record<BackupRunStatus, number> = {
      running: 0,
      succeeded: 0,
      failed: 0,
      abandoned: 0,
    };
    for (const r of rows) {
      counts[r.status as BackupRunStatus] = Number(r.count);
    }
    return counts;
  }

  /** Lists restore-drill records newest-first (bounded). */
  async function listDrills(
    ctx: TenantContext | RequestContext,
    limit = 20,
  ): Promise<RestoreDrillRow[]> {
    const rows = await db
      .select()
      .from(restoreDrillRuns)
      .where(eq(restoreDrillRuns.organizationId, ctx.organizationId))
      .orderBy(desc(restoreDrillRuns.startedAt))
      .limit(limit);
    return rows.map(drillRow);
  }

  /** The most recent restore-drill record. */
  async function latestDrill(
    ctx: TenantContext | RequestContext,
    source?: RestoreDrillSource,
  ): Promise<RestoreDrillRow | null> {
    const rows = await db
      .select()
      .from(restoreDrillRuns)
      .where(
        and(
          eq(restoreDrillRuns.organizationId, ctx.organizationId),
          ...(source ? [eq(restoreDrillRuns.source, source)] : []),
        ),
      )
      .orderBy(desc(restoreDrillRuns.startedAt))
      .limit(1);
    return rows[0] ? drillRow(rows[0]) : null;
  }

  /** The most recent SUCCESSFUL restore-drill record, unbounded — a long
   *  history of recent failures must not hide an older automated success. */
  async function latestSucceededDrill(
    ctx: TenantContext | RequestContext,
    source?: RestoreDrillSource,
  ): Promise<RestoreDrillRow | null> {
    const rows = await db
      .select()
      .from(restoreDrillRuns)
      .where(
        and(
          eq(restoreDrillRuns.organizationId, ctx.organizationId),
          eq(restoreDrillRuns.result, "succeeded"),
          ...(source ? [eq(restoreDrillRuns.source, source)] : []),
        ),
      )
      .orderBy(desc(restoreDrillRuns.startedAt))
      .limit(1);
    return rows[0] ? drillRow(rows[0]) : null;
  }

  /**
   * Records a restore-drill outcome. `source` distinguishes automated proof
   * from operator declaration — the read projection must keep that
   * distinction visible.
   */
  async function recordDrill(
    ctx: TenantContext | RequestContext,
    params: {
      operationId: string;
      backupType: BackupType;
      result: RestoreDrillResult;
      source: RestoreDrillSource;
      startedAt: Date;
      completedAt: Date;
      durationMs?: number;
      failureReason?: string;
    },
  ): Promise<RestoreDrillRow> {
    return executeInTransaction(db, async (tx) => {
      const inserted = await tx
        .insert(restoreDrillRuns)
        .values({
          id: randomUUID(),
          organizationId: ctx.organizationId,
          operationId: params.operationId,
          backupType: params.backupType,
          result: params.result,
          source: params.source,
          startedAt: params.startedAt,
          completedAt: params.completedAt,
          durationMs: params.durationMs ?? null,
          failureReason: params.failureReason ?? null,
          createdAt: params.completedAt,
          updatedAt: params.completedAt,
        })
        .onConflictDoUpdate({
          target: [
            restoreDrillRuns.organizationId,
            restoreDrillRuns.operationId,
          ],
          // A re-recorded drill for the same operationId updates in place
          // (the drill is re-run, not a new logical identity) — EXCEPT that
          // an existing AUTOMATED record is preserved: operator-declared
          // evidence must never overwrite automated proof (setWhere skips the
          // update; the returned row is then the preserved automated one).
          setWhere: sql`${restoreDrillRuns.source} <> 'automated'`,
          set: {
            result: params.result,
            source: params.source,
            startedAt: params.startedAt,
            completedAt: params.completedAt,
            durationMs: params.durationMs ?? null,
            failureReason: params.failureReason ?? null,
            updatedAt: params.completedAt,
          },
        })
        .returning();
      if (inserted[0]) return drillRow(inserted[0]!);
      // setWhere skipped the update: the conflicting row is preserved
      // automated evidence — return the row that won.
      const preserved = await tx
        .select()
        .from(restoreDrillRuns)
        .where(
          and(
            eq(restoreDrillRuns.organizationId, ctx.organizationId),
            eq(restoreDrillRuns.operationId, params.operationId),
          ),
        )
        .limit(1);
      return drillRow(preserved[0]!);
    });
  }

  return {
    startRun,
    startRunWithinTransaction,
    completeRun,
    failRun,
    listRuns,
    latestRun,
    latestSucceededRun,
    lastFailure,
    statusCounts,
    listDrills,
    latestDrill,
    latestSucceededDrill,
    recordDrill,
  };
}
