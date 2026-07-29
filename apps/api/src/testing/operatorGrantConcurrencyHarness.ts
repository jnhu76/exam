/**
 * REC-I4-V1 — Operator Grant Concurrency Test Harness.
 *
 * Provides the infrastructure to run two concurrent operator-grant transactions
 * with a deterministic barrier, using two separate PostgreSQL connections.
 *
 * Each transaction wraps the `TimeAdjustmentRepository.findByOperationId` seam
 * with a barrier hook that fires when the lookup returns absent. The test
 * controller orchestrates the ordering: T1 releases first, commits, then T2
 * releases and hits the unique constraint.
 */

import { sql } from "drizzle-orm";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type {
  GrantAttemptTimeInput,
  GrantAttemptTimeResult,
} from "@exam/exam-engine";
import { grantAttemptTime, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import type { TimeAdjustmentRepository } from "@exam/exam-engine";
import { createAttemptTimeAdjustmentRepo } from "@exam/db/src/repository/attemptTimeAdjustmentRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import {
  createExamEngineRepos,
  createTimeAdjustmentRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
  createGradingWorksetRepoAdapter,
} from "../adapters/repoAdapters.js";
import type { RaceBarrier } from "./barrier.js";

/**
 * The exact constraint name for the `(organization_id, operation_id)` unique
 * index on `attempt_time_adjustments`, matching the constant in
 * `attempts.admin.ts`.
 */
export const OPERATION_UNIQUE_CONSTRAINT =
  "attempt_time_adjustments_org_operation_unique";

/**
 * Walks the error cause chain looking for a PostgreSQL unique_violation (23505)
 * whose `constraint` is exactly the operator-grant operation unique index.
 * Mirrors the same function in `attempts.admin.ts`.
 */
export function isOrgOperationUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        const constraint = String(e.constraint ?? e.constraint_name ?? "");
        if (constraint === OPERATION_UNIQUE_CONSTRAINT) return true;
      }
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

/**
 * Returns the current PostgreSQL backend PID for the given database connection.
 * Must be called while the connection is active (inside a transaction).
 */
export async function getBackendPid(db: Database): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT pg_backend_pid() AS pid`,
  )) as unknown as Array<{ pid: number }>;
  const pid = Number(rows[0]?.pid ?? 0);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid backend PID: ${pid}`);
  }
  return pid;
}

/**
 * Wraps a `TimeAdjustmentRepository` with barrier hooks for the deterministic
 * race. The `findByOperationId` method signals the barrier when the lookup
 * returns absent, then waits for the controller to release the transaction.
 */
export function wrapAdjustmentRepoWithBarrier(
  inner: TimeAdjustmentRepository,
  barrier: RaceBarrier,
  label: "T1" | "T2",
  operationId: string,
  attemptId: string,
  db: Database,
): TimeAdjustmentRepository {
  return {
    ...inner,
    findByOperationId: async (opId: string) => {
      const result = await inner.findByOperationId(opId);
      if (opId === operationId && result === null) {
        const pid = await getBackendPid(db);
        const observation = { label, pid, operationId: opId, attemptId };
        if (label === "T1") {
          barrier.t1ReadAbsent.resolve(observation);
          await barrier.releaseT1.promise;
        } else {
          barrier.t2ReadAbsent.resolve(observation);
          await barrier.releaseT2.promise;
        }
      }
      return result;
    },
  } as TimeAdjustmentRepository;
}

/**
 * Runs one operator time grant inside a transaction with barrier-wrapped
 * adjustment repos. This is the "primary" transaction — it may be rolled
 * back by a unique violation.
 */
export async function runGrantTransactionWithBarrier(
  db: Database,
  ctx: TenantContext,
  input: GrantAttemptTimeInput,
  barrier: RaceBarrier,
  label: "T1" | "T2",
): Promise<GrantAttemptTimeResult> {
  return executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const txEnrollmentRepo = createEnrollmentRepo(tx);

    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: txEnrollmentRepo,
      },
      ctx as never,
    );

    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      input.attemptId,
    );

    const episodeRepo = createInterruptionEpisodeRepoAdapter(
      createAttemptInterruptionRepo(tx),
      ctx as never,
    );
    const eventRepo = createInterruptionEventRepoAdapter(
      createAttemptInterruptionEventRepo(tx),
      ctx as never,
    );

    const rawAdjustmentRepo = createTimeAdjustmentRepoAdapter(
      createAttemptTimeAdjustmentRepo(tx),
      ctx as never,
    );
    const adjustmentRepo = wrapAdjustmentRepoWithBarrier(
      rawAdjustmentRepo,
      barrier,
      label,
      input.operationId,
      input.attemptId,
      tx,
    );

    const gradingWorksetRepo = createGradingWorksetRepoAdapter(
      createAttemptGradingEntryRepo(tx),
      ctx as never,
    );

    return grantAttemptTime(
      exams,
      attempts,
      enrollments,
      episodeRepo,
      eventRepo,
      adjustmentRepo,
      gradingWorksetRepo,
      cap,
      input,
    );
  });
}

/**
 * Runs one operator time grant inside a transaction WITHOUT barrier hooks.
 * Used for the recovery transaction after a unique violation.
 */
export async function runGrantTransaction(
  db: Database,
  ctx: TenantContext,
  input: GrantAttemptTimeInput,
): Promise<GrantAttemptTimeResult> {
  return executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const txEnrollmentRepo = createEnrollmentRepo(tx);

    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: txEnrollmentRepo,
      },
      ctx as never,
    );

    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      input.attemptId,
    );

    const episodeRepo = createInterruptionEpisodeRepoAdapter(
      createAttemptInterruptionRepo(tx),
      ctx as never,
    );
    const eventRepo = createInterruptionEventRepoAdapter(
      createAttemptInterruptionEventRepo(tx),
      ctx as never,
    );
    const adjustmentRepo = createTimeAdjustmentRepoAdapter(
      createAttemptTimeAdjustmentRepo(tx),
      ctx as never,
    );
    const gradingWorksetRepo = createGradingWorksetRepoAdapter(
      createAttemptGradingEntryRepo(tx),
      ctx as never,
    );

    return grantAttemptTime(
      exams,
      attempts,
      enrollments,
      episodeRepo,
      eventRepo,
      adjustmentRepo,
      gradingWorksetRepo,
      cap,
      input,
    );
  });
}

/**
 * Runs an operator time grant with recovery (matching the production route's
 * `grantWithOperationRaceRecovery`). If the primary transaction hits a 23505
 * unique violation on the operation constraint, records the observation,
 * starts a fresh transaction, and re-runs the same command.
 *
 * @param db - Database connection for the primary + recovery transactions.
 * @param ctx - Tenant context.
 * @param input - Grant command input.
 * @param barrier - Race barrier for observations.
 * @param label - "T1" or "T2".
 * @returns The grant result.
 */
export async function runGrantWithRaceRecovery(
  db: Database,
  ctx: TenantContext,
  input: GrantAttemptTimeInput,
  barrier: RaceBarrier,
  label: "T1" | "T2",
): Promise<GrantAttemptTimeResult> {
  const pid = await getBackendPid(db);

  try {
    const result = await runGrantTransactionWithBarrier(
      db,
      ctx,
      input,
      barrier,
      label,
    );
    // T1 path: transaction committed successfully.
    if (label === "T1") {
      barrier.t1Committed.resolve({ pid, outcome: result.outcome });
    }
    return result;
  } catch (err) {
    if (!isOrgOperationUniqueViolation(err)) throw err;

    // T2 path: record the unique violation.
    barrier.t2UniqueViolation.resolve({
      code: "23505",
      constraint: OPERATION_UNIQUE_CONSTRAINT,
      pid,
    });

    // Fresh recovery transaction.
    const recoveryPid = await getBackendPid(db);
    barrier.t2RecoveryStarted.resolve({ pid: recoveryPid });

    // Re-run the SAME command in a fresh transaction (no barrier).
    const recoveryResult = await runGrantTransaction(db, ctx, input);

    barrier.t2RecoveryCompleted.resolve({
      pid: recoveryPid,
      outcome: recoveryResult.outcome,
    });

    return recoveryResult;
  }
}
