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
 * Runs the guarded rollback. Counts rows in
 * `attempt_command_receipts` (0 if the table does not exist); if any exist,
 * throws (fail closed — the transaction rolls back and the table is preserved).
 * Otherwise drops the table. The count and the DROP share ONE transaction, so
 * the rollback is atomic.
 */
export async function rollbackAttemptCommandReceipts(
  db: Database,
): Promise<AttemptCommandReceiptRollbackResult> {
  return db.transaction(async (tx) => {
    // Detect table existence and count rows in one query. A missing table is
    // not an error here: to_regclass returns NULL for an absent OID.
    const existsRows = (await tx.execute(
      sql`SELECT to_regclass(${ATTEMPT_COMMAND_RECEIPTS_TABLE})::regclass AS oid`,
    )) as unknown as Array<{ oid: string | null }>;
    const tableOid = existsRows[0]?.oid ?? null;
    if (tableOid === null) {
      // Table absent: nothing to drop. Still issue an idempotent DROP IF EXISTS
      // so the result is deterministic regardless of the detection path.
      await tx.execute(
        sql.raw(`DROP TABLE IF EXISTS "${ATTEMPT_COMMAND_RECEIPTS_TABLE}"`),
      );
      return { rowCount: 0, dropped: false, absent: true, blocked: false };
    }

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

    // Clean state: drop the table (indexes/constraints drop with it).
    await tx.execute(
      sql.raw(`DROP TABLE IF EXISTS "${ATTEMPT_COMMAND_RECEIPTS_TABLE}"`),
    );
    return { rowCount, dropped: true, absent: false, blocked: false };
  });
}
