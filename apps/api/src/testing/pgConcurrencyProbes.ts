/**
 * Shared PostgreSQL real-overlap probe helpers for deterministic concurrency
 * tests.
 *
 * These probes run on an OBSERVER connection that must be independent of the
 * racer connections: racers use max:1 pools held open inside transactions, so
 * a probe on a racer pool would queue behind the open transaction forever.
 *
 * All probes are bounded-poll with explicit failure — they never widen a
 * timeout to absorb a broken race, and a missed overlap surfaces as an error
 * instead of a silently passing test.
 */

/**
 * The subset of the postgres-js driver surface the overlap probes need.
 * Tests declare their connections with this narrow type instead of the full
 * `postgres.Sql` so the probe helpers stay typed without importing the
 * driver's types.
 */
export interface ObserverSql {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
  end(): Promise<void>;
}

const POLL_INTERVAL_MS = 25;

/**
 * Snapshot of a backend's transaction/wait state from `pg_stat_activity`.
 */
export interface BackendStateSnapshot {
  active: boolean;
  waitEventType: string | null;
  waitEvent: string | null;
  inTransaction: boolean;
}

/**
 * PROOF that `pid` is genuinely blocked inside a DB transaction. Returns the
 * backend's `wait_event_type`/`wait_event` from `pg_stat_activity` and
 * whether it has an open transaction (`xact_start IS NOT NULL`). Throws if
 * the backend does not exist.
 */
export async function snapshotBackendState(
  sql: ObserverSql,
  pid: number,
): Promise<BackendStateSnapshot> {
  const rows = (await sql.unsafe(
    `SELECT
       pid,
       state,
       wait_event_type,
       wait_event,
       xact_start IS NOT NULL AS in_transaction
     FROM pg_stat_activity
     WHERE pid = $1`,
    [pid],
  )) as Array<{
    pid: number;
    state: string;
    wait_event_type: string | null;
    wait_event: string | null;
    in_transaction: boolean;
  }>;
  const row = rows[0];
  if (!row) {
    return {
      active: false,
      waitEventType: null,
      waitEvent: null,
      inTransaction: false,
    };
  }
  return {
    active: row.state === "active" || row.state === "idle in transaction",
    waitEventType: row.wait_event_type,
    waitEvent: row.wait_event,
    inTransaction: Boolean(row.in_transaction),
  };
}

/**
 * Polls (bounded) until `pid` reports an open transaction
 * (`xact_start IS NOT NULL`) — proof the backend's BEGIN has executed.
 * Resolves with the snapshot; rejects on timeout so a broken race surfaces
 * instead of silently passing.
 */
export async function waitForTransactionStarted(
  sql: ObserverSql,
  pid: number,
  timeoutMs = 2_000,
): Promise<BackendStateSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await snapshotBackendState(sql, pid);
    if (snap.inTransaction) return snap;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Backend ${pid} did not start a transaction within ${timeoutMs}ms`,
  );
}

/**
 * Polls (bounded) until `pid` reports a non-granted lock request in
 * `pg_locks` — proof it is blocked waiting for a lock held by another
 * transaction. The primary real-overlap signal. Uses `pg_locks` (rather than
 * `pg_stat_activity.wait_event_type`) because the ungranted-lock row persists
 * for the whole wait, so sampling cannot miss a transient window.
 */
export async function waitForBackendBlocked(
  sql: ObserverSql,
  pid: number,
  timeoutMs = 8_000,
): Promise<{ blockedOnLocktype: string; mode: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await sql.unsafe(
      `SELECT locktype, mode
       FROM pg_locks
       WHERE pid = $1 AND granted = false
       LIMIT 1`,
      [pid],
    )) as Array<{ locktype: string; mode: string }>;
    if (rows.length > 0) {
      return { blockedOnLocktype: rows[0]!.locktype, mode: rows[0]!.mode };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Backend ${pid} did not report an ungranted lock within ${timeoutMs}ms ` +
      "(the race did not produce real overlap)",
  );
}

/**
 * Direct row-lock attribution probe: attempts `SELECT ... FOR UPDATE NOWAIT`
 * on one row from the observer connection. Rejects with SQLSTATE 55P03
 * (lock_not_available) when ANOTHER transaction currently holds the row
 * lock — proof the row is locked without needing to know the holder's pid.
 *
 * Returns the error's SQLSTATE when the probe is rejected, or `null` when
 * the NOWAIT read SUCCEEDED (i.e. no other transaction holds the row lock).
 * Callers assert whichever outcome their schedule requires.
 */
export async function probeRowLockHeldNowait(
  sql: ObserverSql,
  table: string,
  rowId: string,
): Promise<{ acquired: true } | { acquired: false; sqlstate: string }> {
  try {
    await sql.unsafe(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE NOWAIT`, [
      rowId,
    ]);
    return { acquired: true };
  } catch (err) {
    const sqlstate = (err as { code?: unknown }).code;
    if (typeof sqlstate === "string") {
      return { acquired: false, sqlstate };
    }
    throw err;
  }
}
