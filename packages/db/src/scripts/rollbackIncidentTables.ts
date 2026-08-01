/**
 * Guarded rollback core for the five exam-incident tables (ADR-014 §14).
 *
 * Lives in the db package (not api) so it can be imported by db-layer tests
 * without a reverse package dependency. The api script
 * (`apps/api/src/scripts/rollback-incident-tables.ts`) wraps this core with
 * env resolution + the `--confirm` flag.
 *
 * The migration runner is forward-only; this is the executable, opt-in,
 * pre-activation guard. It runs the guard check and the DROPs in a SINGLE
 * transaction against the provided drizzle `db`, so a non-null incident_id
 * rollback leaves every table intact.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../types.js";

/** The five incident tables in reverse dependency order (children first). */
export const INCIDENT_TABLES_IN_REVERSE_ORDER = [
  "exam_incident_interruption_links",
  "exam_incident_attempts",
  "exam_incident_actions",
  "exam_incident_events",
  "exam_incidents",
] as const;

/**
 * Result of {@link rollbackIncidentTables}. `dropped` is true only when the
 * guard passed and all five tables were dropped; `blocked` is true when the
 * guard refused to drop (non-null incident_id exists).
 */
export interface RollbackResult {
  /** The count of non-null attempt_time_adjustments.incident_id rows. */
  nonNullIncidentCount: number;
  /** True when the five tables were dropped. */
  dropped: boolean;
  /** True when the guard refused to drop (tables preserved). */
  blocked: boolean;
}

/**
 * Runs the guarded rollback: counts non-null
 * `attempt_time_adjustments.incident_id` rows; if any exist, throws (fail
 * closed — the transaction rolls back and all five tables are preserved).
 * Otherwise drops the five incident tables in reverse dependency order.
 *
 * The guard and the DROPs share ONE transaction, so the rollback is atomic:
 * either the guard passes AND all five DROPs commit, or nothing is dropped.
 */
export async function rollbackIncidentTables(
  db: Database,
): Promise<RollbackResult> {
  return db.transaction(async (tx) => {
    // Pre-activation guard: count non-null incident_id rows.
    const countRows = (await tx.execute(
      sql`SELECT count(*)::int AS n FROM attempt_time_adjustments WHERE incident_id IS NOT NULL`,
    )) as unknown as Array<{ n: number }>;
    const nonNullIncidentCount = Number(countRows[0]?.n ?? 0);

    if (nonNullIncidentCount > 0) {
      // Fail closed: drop nothing. The transaction rolls back (no DROPs were
      // issued), so all five tables and the adjustment row remain intact.
      throw new Error(
        `Guard tripped: ${nonNullIncidentCount} non-null attempt_time_adjustments.incident_id row(s) exist. ` +
          "A destructive DROP is prohibited after activation (ADR-014 §14). " +
          "Use a data-preserving rollback instead.",
      );
    }

    // Clean state: drop the five tables in reverse dependency order.
    for (const table of INCIDENT_TABLES_IN_REVERSE_ORDER) {
      await tx.execute(sql.raw(`DROP TABLE IF EXISTS "${table}"`));
    }
    return { nonNullIncidentCount, dropped: true, blocked: false };
  });
}
