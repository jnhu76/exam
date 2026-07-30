/**
 * REC-I4-V1 — Operator Grant Concurrency Test Harness (test-only).
 *
 * This harness contains NO duplicate of the production grant/recovery logic.
 * The deterministic concurrency test calls the SAME production function
 * (`grantWithOperationRaceRecovery` from
 * `orchestrators/operatorGrantExecution.ts`) that the HTTP route calls. This
 * file owns only the test-only concerns:
 *
 *   - {@link getBackendPid} / {@link collectConnectionEvidence}: prove the two
 *     PostgreSQL connections are physically distinct (distinct PIDs) and
 *     share the same isolated schema.
 *   - {@link createBarrierBackedObserver}: builds the
 *     {@link OperatorGrantExecutionObserver} the test passes into the
 *     production function, wiring its hooks to a {@link RaceBarrier} so the
 *     test controller can fix T1-before-T2 ordering and observe the real
 *     in-transaction evidence (PID, txid, and the SQLSTATE/constraint
 *     extracted from the caught error).
 *
 * Nothing here re-declares `OPERATION_UNIQUE_CONSTRAINT`,
 * re-implements the constraint matcher, or re-runs the grant transaction. If
 * the production recovery logic changes, this harness needs no change.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@exam/db/src/types.js";
import type { OperatorGrantExecutionObserver } from "../orchestrators/operatorGrantExecution.js";
import type { RaceBarrier } from "./barrier.js";

/**
 * Returns the current PostgreSQL backend PID for the given database
 * connection. Used in `beforeAll` to fail fast if the two connections
 * collapse into one backend. (In-transaction identity — PID + txid — is
 * captured by the production module itself.)
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

/** Connection + schema evidence collected by {@link collectConnectionEvidence}. */
export interface ConnectionEvidence {
  /** Backend PID of this connection. */
  pid: number;
  /** `current_schema()` as seen by this connection. */
  currentSchema: string;
  /** `current_setting('search_path')` as seen by this connection. */
  searchPath: string;
}

/**
 * Proves two connections are (a) physically distinct (distinct PIDs) and
 * (b) running in the same isolated schema (same `current_schema()` and
 * `search_path`). This is the runtime proof the V1 race is real: two
 * distinct backends, one shared constraint, in one schema.
 */
export async function collectConnectionEvidence(
  db: Database,
): Promise<ConnectionEvidence> {
  const rows = (await db.execute(
    sql`SELECT pg_backend_pid() AS pid, current_schema()::text AS schema, current_setting('search_path')::text AS search_path`,
  )) as unknown as Array<{ pid: number; schema: string; search_path: string }>;
  const row = rows[0];
  if (!row) throw new Error("Connection evidence query returned no rows");
  return {
    pid: Number(row.pid),
    currentSchema: String(row.schema),
    searchPath: String(row.search_path),
  };
}

/**
 * Builds a barrier-backed {@link OperatorGrantExecutionObserver} for one label
 * (T1 or T2). The test passes this observer into the production
 * `grantWithOperationRaceRecovery` call.
 *
 * Hook wiring:
 *   - `afterOperationLookupAbsent` → resolves `t1ReadAbsent`/`t2ReadAbsent`
 *     (with the real in-transaction PID/txid from the production module),
 *     then AWAITS `releaseT1`/`releaseT2` — this is the barrier gate that
 *     lets the test controller fix T1-before-T2 ordering.
 *   - `onPrimaryCommitted` → resolves `t1PrimaryCommitted` (T1 only) so the
 *     test can assert T1 committed before T2's violation.
 *   - `onUniqueViolation` → resolves `t2UniqueViolation` with the real
 *     SQLSTATE/constraint extracted by the production matcher (T2 only).
 *   - `onRecoveryTransaction` → resolves `t2RecoveryStarted` with the
 *     recovery transaction's txid (T2 only).
 */
export function createBarrierBackedObserver(
  barrier: RaceBarrier,
  label: "T1" | "T2",
  operationId: string,
  attemptId: string,
): OperatorGrantExecutionObserver {
  return {
    afterOperationLookupAbsent: async (obs) => {
      if (obs.operationId !== operationId) return;
      const observation = {
        label: obs.label,
        pid: obs.pid,
        txid: obs.txid,
        operationId: obs.operationId,
        attemptId: obs.attemptId,
      };
      if (label === "T1") {
        barrier.t1ReadAbsent.resolve(observation);
        await barrier.releaseT1.promise;
      } else {
        barrier.t2ReadAbsent.resolve(observation);
        await barrier.releaseT2.promise;
      }
    },
    onPrimaryCommitted: async (obs) => {
      // Only T1 is expected to commit on the primary path; T2's primary
      // transaction violates. Resolve the T1 deferred regardless of label so
      // the assertion has the evidence it needs.
      if (obs.label === "T1") {
        barrier.t1PrimaryCommitted.resolve({
          pid: obs.pid,
          txid: obs.txid,
          outcome: obs.outcome,
        });
      }
    },
    onUniqueViolation: async (obs) => {
      barrier.t2UniqueViolation.resolve({
        code: obs.code,
        constraint: obs.constraint,
        ...(obs.table ? { table: obs.table } : {}),
        pid: obs.pid,
        txid: obs.txid,
      });
    },
    onRecoveryTransaction: async (obs) => {
      barrier.t2RecoveryStarted.resolve({
        pid: obs.pid,
        txid: obs.txid,
      });
    },
  };
}
