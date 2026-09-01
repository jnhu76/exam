/**
 * Migration 0026 — Recovery Exam aggregate attempt-status index (J5-I1B4 §6.5).
 *
 * Verifies the attempt-status-distribution `GROUP BY status` read path has a
 * supporting index:
 *
 * 1. `exam_attempts_org_exam_status_idx` exists (pg_indexes);
 * 2. the migration applies cleanly (idempotent re-run via the journal loop).
 *
 * Per plan amendment #8: EXPLAIN evidence is human/audit material only —
 * PostgreSQL may rightly choose a sequential scan on small tables, so this
 * test does NOT assert a specific plan shape. CI asserts index existence +
 * clean migration application only.
 *
 * Mirrors the migration-application pattern from `0025-recovery-queue-index.test.ts`.
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

describe("0026 exam_attempts org+exam+status index (J5-I1B4 §6.5)", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let sql: SqlDriver;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "migration-0026-exam-attempts-org-exam-status-idx",
    });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    sql = conn.sql;
    await applyAllMigrations(conn.sql, iso.databaseUrl);
  }, 120_000);

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  }, 30_000);

  it("the (organization_id, exam_id, status) index exists", async () => {
    const rows = await sql.unsafe<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'exam_attempts'
        AND indexname = 'exam_attempts_org_exam_status_idx'
    `);
    expect(rows).toHaveLength(1);
  });
});
