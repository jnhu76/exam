/**
 * Migration 0025 — Recovery Queue keyset index (J5-I1A1 §5.4).
 *
 * Verifies the frozen queue read path has a matching index:
 *
 * 1. `exam_incidents_org_created_at_id_idx` exists (pg_indexes);
 * 2. EXPLAIN evidence (enable_seqscan=off) that BOTH the default page query
 *    (`WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
 *    and the keyset-cursor page query use that index — the org-wide queue
 *    must not degrade to org-range scan + sort as incident volume grows.
 *
 * Mirrors the migration-application pattern from `0024-proctor-assignment.test.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { withTestInfraLifecycleLock } from "../testInfraLock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations/postgres");

function readJournal(): { entries: { idx: number; tag: string }[] } {
  const raw = readFileSync(resolve(MIGRATIONS_DIR, "meta/_journal.json"), {
    encoding: "utf-8",
  });
  return JSON.parse(raw);
}

function readMigrationStatements(tag: string): string[] {
  const content = readFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), {
    encoding: "utf-8",
  });
  return content
    .split("--> statement-breakpoint")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

type SqlDriver = Awaited<ReturnType<typeof createDatabase>>["sql"];

async function executeMigrationFile(
  sql: SqlDriver,
  tag: string,
): Promise<void> {
  const statements = readMigrationStatements(tag);
  await sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
  });
}

async function applyAllMigrations(
  sql: SqlDriver,
  lockUrl: string,
): Promise<void> {
  await withTestInfraLifecycleLock(lockUrl, async () => {
    const journal = readJournal();
    for (const entry of journal.entries) {
      await executeMigrationFile(sql, entry.tag);
    }
  });
}

describe("0025 recovery-queue keyset index (J5-I1A1 §5.4)", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let sql: SqlDriver;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "migration-0025-recovery-queue-index",
    });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    sql = conn.sql;
    await applyAllMigrations(conn.sql, iso.databaseUrl);
  }, 120_000);

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  });

  it("the (organization_id, created_at, id) index exists", async () => {
    const rows = await sql.unsafe<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'exam_incidents'
        AND indexname = 'exam_incidents_org_created_at_id_idx'
    `);
    expect(rows).toHaveLength(1);
  });

  it("the default page query uses the index (EXPLAIN, enable_seqscan=off)", async () => {
    const plan = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      const rows = await tx.unsafe<Record<string, unknown>[]>(`
        EXPLAIN SELECT * FROM exam_incidents
        WHERE organization_id = '00000000-0000-0000-0000-000000000000'
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      `);
      return rows;
    });
    expect(plan.map((r) => Object.values(r)[0]).join("\n")).toContain(
      "exam_incidents_org_created_at_id_idx",
    );
  });

  it("the keyset-cursor page query uses the index (EXPLAIN, enable_seqscan=off)", async () => {
    const plan = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      const rows = await tx.unsafe<Record<string, unknown>[]>(`
        EXPLAIN SELECT * FROM exam_incidents
        WHERE organization_id = '00000000-0000-0000-0000-000000000000'
          AND (
            created_at < '2026-08-03T12:00:00.123456Z'::timestamptz
            OR (
              created_at = '2026-08-03T12:00:00.123456Z'::timestamptz
              AND id < '00000000-0000-0000-0000-000000000001'
            )
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      `);
      return rows;
    });
    expect(plan.map((r) => Object.values(r)[0]).join("\n")).toContain(
      "exam_incidents_org_created_at_id_idx",
    );
  });
});
