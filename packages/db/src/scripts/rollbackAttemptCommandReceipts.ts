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
 *   - table absent            → success / no-op
 *   - table present, 0 rows   → allowed; DROP the table
 *   - table present, rows > 0 → fail closed (throw); preserve all receipt data
 *
 * 0028 owns TWO schema effects (review J5-I1C0 PR #261 P1-1): the receipt
 * table AND the `users_org_id_unique` composite-FK target index on `users`.
 * The rollback must own the full 0028 effect lifecycle — dropping only the
 * table leaves a leftover index that makes a re-deploy of 0028 fail with
 * `duplicate relation`. After a clean table drop the rollback therefore also
 * drops `users_org_id_unique`, but ONLY when it can prove the index is exactly
 * the one 0028 created and nothing else depends on it; otherwise it fails
 * closed and leaves both effects in place (manual repair).
 *
 * The count check, the table DROP, and the index DROP share ONE transaction,
 * so a non-empty table (or a fail-closed index state) leaves everything
 * intact. The table DROP is a plain `DROP TABLE IF EXISTS`; the index DROP is
 * a plain `DROP INDEX IF EXISTS` — no CASCADE (audit §10).
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
 * The `users` composite-FK target index created by 0028 (the second 0028
 * effect the rollback must own). Plain name — it resolves via search_path, so
 * isolated test schemas see their own copy.
 */
export const USERS_ORG_ID_UNIQUE_INDEX = "users_org_id_unique" as const;

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
  /** True when the `users_org_id_unique` index was dropped alongside the table. */
  indexDropped: boolean;
}

/**
 * Outcome of verifying the leftover `users_org_id_unique` index against the
 * 0028 definition after a clean table drop.
 */
type IndexVerificationOutcome =
  | { kind: "absent" }
  | { kind: "matches" }
  | { kind: "incompatible"; existingDefinition: string }
  | { kind: "in-use"; dependentConstraints: string[] };

/**
 * Classify the current state of `users_org_id_unique`. Mirrors the
 * exact-shape validation 0027 uses for `exams_org_id_unique`: the index must
 * be UNIQUE, btree, valid, non-partial, exactly the two key columns
 * (organization_id, id) in that order, with default options. Anything else is
 * a same-name index that 0028 did NOT create → fail closed (manual repair).
 *
 * Also collects any foreign-key constraints that currently reference this
 * index as a referenced unique key. After the receipt table is dropped, the
 * only 0028-era dependent is gone — but a FUTURE migration might add another
 * composite FK targeting users(organization_id, id). Such a dependent would
 * make the index DROP fail or silently weaken a newer invariant, so it is
 * treated as fail-closed: the rollback refuses and leaves the index in place.
 */
async function verifyUsersOrgIdUniqueIndex(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
): Promise<IndexVerificationOutcome> {
  // Existence + exact-shape probe in one round trip. Returns exactly one row
  // whose columns describe the index; absent → all NULLs.
  const rows = (await tx.execute(
    sql`SELECT
          (c.oid IS NOT NULL)                       AS exists,
          (i.indisunique
            AND NOT coalesce(i.indnullsnotdistinct, false)
            AND i.indimmediate
            AND i.indisvalid
            AND i.indisready
            AND i.indislive
            AND i.indpred IS NULL
            AND i.indexprs IS NULL
            AND i.indnatts = 2
            AND i.indnkeyatts = 2
            AND coalesce(i.indoption::text, '') = '0 0'
            AND am.amname = 'btree')               AS shape_ok,
          string_agg(a.attname, ',' ORDER BY k.ord) AS cols_text,
          pg_get_indexdef(c.oid)                    AS definition
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_index i ON i.indexrelid = c.oid
        LEFT JOIN pg_am am ON am.oid = c.relam
        LEFT JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        LEFT JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE n.nspname = current_schema()
          AND c.relname = ${USERS_ORG_ID_UNIQUE_INDEX}
          AND c.relkind = 'i'
        GROUP BY c.oid, i.indisunique, i.indnullsnotdistinct, i.indimmediate,
                 i.indisvalid, i.indisready, i.indislive, i.indpred, i.indexprs,
                 i.indnatts, i.indnkeyatts, i.indoption, am.amname`,
  )) as unknown as Array<{
    exists: boolean | null;
    shape_ok: boolean | null;
    cols_text: string | null;
    definition: string | null;
  }>;
  const row = rows[0];
  if (!row || !row.exists) {
    return { kind: "absent" };
  }
  const shapeOk =
    row.shape_ok === true && row.cols_text === "organization_id,id";
  if (!shapeOk) {
    return {
      kind: "incompatible",
      existingDefinition: row.definition ?? "<unknown>",
    };
  }

  // Dependent foreign keys: any constraint referencing users(organization_id,
  // id). After the receipt table is dropped this set should be empty; a
  // non-empty set means a newer migration depends on the index and the
  // rollback must not drop it.
  //
  // Resolve the referenced attnums by NAME via pg_attribute (review J5-I1C0
  // PR #261 P2-3): `users` physical column order is id (attnum 1) then
  // organization_id (attnum 2), so the composite FK
  // `(organization_id, actor_id) → users(organization_id, id)` carries
  // confkey = [2, 1], NOT [1, 2]. Hardcoding `con.confkey = ARRAY[1, 2]` (the
  // previous code) never matched the real 0028 FK, so the in-use branch was
  // dead. The name-based resolution below is robust to physical column
  // reordering and matches a FK whose referenced columns are exactly
  // (organization_id, id) in that referenced order.
  const dependents = (await tx.execute(
    sql`SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        JOIN pg_class u ON u.oid = con.confrelid
        JOIN pg_namespace un ON un.oid = u.relnamespace
        WHERE con.contype = 'f'
          AND n.nspname = current_schema()
          AND un.nspname = current_schema()
          AND u.relname = 'users'
          AND array_length(con.confkey, 1) = 2
          AND con.confkey[1] = (
            SELECT a.attnum FROM pg_attribute a
            WHERE a.attrelid = u.oid AND a.attname = 'organization_id'
          )
          AND con.confkey[2] = (
            SELECT a.attnum FROM pg_attribute a
            WHERE a.attrelid = u.oid AND a.attname = 'id'
          )`,
  )) as unknown as Array<{ conname: string }>;
  if (dependents.length > 0) {
    return {
      kind: "in-use",
      dependentConstraints: dependents.map((d) => d.conname),
    };
  }
  return { kind: "matches" };
}

/**
 * Drop the `users_org_id_unique` index when it is provably the 0028 index and
 * nothing else depends on it. Runs inside the provided transaction so the
 * table DROP and the index DROP commit atomically (table-present path) or the
 * leftover-index cleanup commits on its own (table-absent path). See
 * {@link verifyUsersOrgIdUniqueIndex} for the exact-shape contract.
 *
 * Returns whether the index was dropped. Throws (fail closed) on an
 * incompatible or in-use same-name index.
 */
async function maybeDropUsersOrgIdUniqueIndex(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
): Promise<boolean> {
  const verdict = await verifyUsersOrgIdUniqueIndex(tx);
  if (verdict.kind === "absent") {
    return false;
  }
  if (verdict.kind === "matches") {
    await tx.execute(sql.raw(`DROP INDEX IF EXISTS "users_org_id_unique"`));
    return true;
  }
  if (verdict.kind === "incompatible") {
    throw new Error(
      `Refusing to drop ${USERS_ORG_ID_UNIQUE_INDEX}: a same-name index ` +
        "exists but its definition does not match the 0028 index (expected " +
        "UNIQUE btree on exactly (organization_id, id)). Manual repair " +
        "required. Existing definition: " +
        verdict.existingDefinition,
    );
  }
  throw new Error(
    `Refusing to drop ${USERS_ORG_ID_UNIQUE_INDEX}: it is still ` +
      "referenced by foreign-key constraint(s) (" +
      verdict.dependentConstraints.join(", ") +
      "). These were not created by 0028 and may belong to a newer " +
      "migration; manual repair required.",
  );
}

/**
 * Runs the guarded rollback. First takes `LOCK TABLE ... IN ACCESS EXCLUSIVE
 * MODE` so no concurrent insert can commit between the row count and the DROP
 * (the DROP itself needs the same lock, but the count must run AFTER the lock
 * is held — otherwise a receipt committed mid-transaction would be invisible
 * to the count and then destroyed). If the table does not exist, the LOCK
 * raises 42P01, which is the absent no-op path. If any rows exist after the
 * lock, throws (fail closed — the transaction rolls back and the table is
 * preserved). Otherwise drops the table, then drops `users_org_id_unique`
 * when it is provably the 0028 index and nothing else depends on it. All
 * statements share ONE transaction, so the rollback is atomic.
 *
 * The absent path still owns the second 0028 effect: if the table is gone but
 * a leftover exact `users_org_id_unique` remains (e.g. the table was dropped
 * manually without the index), the rollback cleans it up in a follow-up
 * transaction so a re-deploy of 0028 does not fail with `duplicate relation`.
 * An incompatible or in-use same-name index fails closed on the absent path
 * too.
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
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(
          ATTEMPT_COMMAND_RECEIPTS_TABLE,
        )}`,
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

      // Clean state: drop the table (the table's own indexes/constraints drop
      // with it). The ACCESS EXCLUSIVE lock is already held, so the DROP
      // cannot be overtaken by a concurrent insert.
      await tx.execute(
        sql.raw(`DROP TABLE IF EXISTS "${ATTEMPT_COMMAND_RECEIPTS_TABLE}"`),
      );

      // The receipt table is gone. Now own the second 0028 effect: the
      // composite-FK target index on `users`. The only 0028-era dependent FK
      // (attempt_command_receipts_actor_fk) dropped with the table above.
      const indexDropped = await maybeDropUsersOrgIdUniqueIndex(tx);

      return {
        rowCount,
        dropped: true,
        absent: false,
        blocked: false,
        indexDropped,
      };
    });
  } catch (err) {
    // The LOCK on a missing table aborts the transaction; the wrapper rolls
    // back and rethrows. Match the SQLSTATE OUTSIDE the callback: catching
    // inside would return from the callback with the server-side transaction
    // already aborted, and the wrapper would then surface a second raw driver
    // error instead of a clean result.
    if (isUndefinedTableError(err)) {
      // Table is absent — but the 0028 effect set also includes
      // users_org_id_unique. Clean up a leftover exact index in a fresh
      // transaction so a re-deploy of 0028 does not fail with
      // `duplicate relation`. An incompatible/in-use index fails closed here
      // too (the schema did not reach a clean 0028-applied state).
      let indexDropped = false;
      try {
        indexDropped = await db.transaction((tx) =>
          maybeDropUsersOrgIdUniqueIndex(tx),
        );
      } catch (cleanupErr) {
        // Surface the index-state failure with the table-absent context so an
        // operator knows the table is gone but the index needs manual repair.
        throw new Error(
          `Table ${ATTEMPT_COMMAND_RECEIPTS_TABLE} absent, but the ` +
            `users_org_id_unique cleanup failed: ${
              cleanupErr instanceof Error
                ? cleanupErr.message
                : String(cleanupErr)
            }`,
        );
      }
      return {
        rowCount: 0,
        dropped: false,
        absent: true,
        blocked: false,
        indexDropped,
      };
    }
    throw err;
  }
}
