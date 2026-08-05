/**
 * Guarded rollback core for the `attempt_command_receipts` table
 * (J5-I1C Slice 1 / J5-I1C0 audit §8 Slice 1, §10).
 *
 * Lives in the db package (not api) so it can be imported by db-layer tests
 * without a reverse package dependency. The api script
 * (`apps/api/src/scripts/rollback-attempt-command-receipts.ts`) wraps this core
 * with env resolution + the `--confirm` flag.
 *
 * The migration runner is forward-only; this is the executable, opt-in,
 * pre-activation guard. Semantics (audit §10):
 *
 *   - table absent            → success / no-op (DROP IF EXISTS is harmless)
 *   - table present, 0 rows   → allowed; DROP the table
 *   - table present, rows > 0 → fail closed (throw); preserve all receipt data
 *
 * The count check and the DROP share ONE transaction, so a non-empty table
 * leaves everything intact. The DROP is a plain `DROP TABLE IF EXISTS`: any
 * indexes/constraints on the table are removed automatically with it — no
 * per-object destructive drops, no CASCADE (audit §10).
 *
 * Concurrency (why the LOCK comes FIRST): the count and the DROP in one
 * transaction are NOT by themselves race-safe. If the count ran before an
 * ACCESS EXCLUSIVE lock, a concurrent command could commit its first receipt
 * between the count and the DROP, and the DROP would then destroy the
 * committed receipt while the rollback reports success. The transaction
 * therefore acquires `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` before any
 * snapshot-establishing read: the lock serializes against every concurrent
 * insert, so the count cannot miss a receipt that commits before the DROP.
 * A missing table raises SQLSTATE 42P01 from the LOCK itself, which is
 * detected and treated as the absent no-op — no prior `to_regclass()` query
 * fixes an old snapshot before the lock is held.
 *
 * After activation (the first receipt row is written), a destructive DROP is
 * prohibited: it would silently destroy durable command-receipt evidence. Use
 * a data-preserving rollback (mark deprecated / add a CHECK blocking new
 * writes) instead.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../types.js";

/** The receipt table managed by this guard. */
export const ATTEMPT_COMMAND_RECEIPTS_TABLE =
  "attempt_command_receipts" as const;

/**
 * True when the thrown error chain carries PostgreSQL SQLSTATE 42P01
 * (`undefined_table`). Walks the driver error chain like the repository-level
 * constraint matchers so the check works across driver error wrappings.
 */
function isUndefinedTableError(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "42P01") return true;
      current = "cause" in e ? e.cause : null;
    } else {
      current = null;
    }
  }
  return false;
}

/**
 * Result of {@link rollbackAttemptCommandReceipts}.
 */
export interface AttemptCommandReceiptRollbackResult {
  /** Row count observed before the DROP (0 when the table was absent). */
  rowCount: number;
  /** True when the table was dropped. */
  dropped: boolean;
  /** True when the table was already absent (no-op). */
  absent: boolean;
  /** True when the guard refused to drop a non-empty table (preserved). */
  blocked: boolean;
}

/**
 * Runs the guarded rollback. First takes `LOCK TABLE ... IN ACCESS EXCLUSIVE
 * MODE` so no concurrent insert can commit between the row count and the DROP
 * (the DROP itself needs the same lock, but the count must run AFTER the lock
 * is held — otherwise a receipt committed mid-transaction would be invisible
 * to the count and then destroyed). If the table does not exist, the LOCK
 * raises 42P01, which is the absent no-op path. If any rows exist after the
 * lock, throws (fail closed — the transaction rolls back and the table is
 * preserved). Otherwise drops the table. All statements share ONE transaction,
 * so the rollback is atomic.
 */
export async function rollbackAttemptCommandReceipts(
  db: Database,
): Promise<AttemptCommandReceiptRollbackResult> {
  try {
    return await db.transaction(async (tx) => {
      // LOCK FIRST — before any SELECT. The lock is the serialization point:
      // with ACCESS EXCLUSIVE held, no concurrent insert can commit until the
      // DROP has committed, so the count below is authoritative. A missing
      // table surfaces here as 42P01 (undefined_table), which aborts the
      // transaction; there is intentionally no prior to_regclass() read that
      // would establish an old MVCC snapshot before the lock is held.
      await tx.execute(
        sql.raw(
          `LOCK TABLE "${ATTEMPT_COMMAND_RECEIPTS_TABLE}" IN ACCESS EXCLUSIVE MODE`,
        ),
      );

      // The lock is held and the table exists: the count is race-free.
      const countRows = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM "${sql.raw(ATTEMPT_COMMAND_RECEIPTS_TABLE)}"`,
      )) as unknown as Array<{ n: number }>;
      const rowCount = Number(countRows[0]?.n ?? 0);

      if (rowCount > 0) {
        // Fail closed: drop nothing. The transaction rolls back (no DROP was
        // issued), so the table and every receipt row remain intact.
        throw new Error(
          `Guard tripped: ${rowCount} row(s) exist in ` +
            `${ATTEMPT_COMMAND_RECEIPTS_TABLE}. A destructive DROP is ` +
            "prohibited after activation (J5-I1C0 audit §10). Receipt data is " +
            "durable command evidence; use a data-preserving rollback instead.",
        );
      }

      // Clean state: drop the table (indexes/constraints drop with it). The
      // ACCESS EXCLUSIVE lock is already held, so the DROP cannot be overtaken
      // by a concurrent insert.
      await tx.execute(
        sql.raw(`DROP TABLE IF EXISTS "${ATTEMPT_COMMAND_RECEIPTS_TABLE}"`),
      );
      return { rowCount, dropped: true, absent: false, blocked: false };
    });
  } catch (err) {
    // The LOCK on a missing table aborts the transaction; the wrapper rolls
    // back and rethrows. Match the SQLSTATE OUTSIDE the callback: catching
    // inside would return from the callback with the server-side transaction
    // already aborted, and the wrapper would then surface a second raw driver
    // error instead of a clean result.
    if (isUndefinedTableError(err)) {
      return { rowCount: 0, dropped: false, absent: true, blocked: false };
    }
    throw err;
  }
}
