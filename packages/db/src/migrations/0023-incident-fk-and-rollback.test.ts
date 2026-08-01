/**
 * Migration 0023 — composite FK parity + guarded rollback (ADR-014 §12, §14).
 *
 * Two concerns verified against a real PostgreSQL schema:
 *
 * 1. The `exam_incidents_org_attempt_fk` composite FK declared in `pg.ts`
 *    actually exists in migration 0023's SQL (Fix Group A.1 — the migration
 *    previously had only the index, not the FK). Verified by attempting inserts
 *    that must be accepted/rejected by the FK and by querying pg_constraint.
 *
 * 2. The executable guarded rollback (`rollbackIncidentTables`) honors
 *    ADR-014 §14: clean → drops five tables; non-null incident_id → fails
 *    closed, all tables preserved.
 *
 * Mirrors the migration-application pattern from `0022-cutover.test.ts`.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { rollbackIncidentTables } from "../scripts/rollbackIncidentTables.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations/postgres");

function readJournal(): {
  entries: { idx: number; tag: string }[];
} {
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

async function applyAllMigrations(sql: SqlDriver): Promise<void> {
  const journal = readJournal();
  for (const entry of journal.entries) {
    await executeMigrationFile(sql, entry.tag);
  }
}

const ts = (d: Date) => `'${d.toISOString()}'`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

interface FixtureIds {
  orgId: string;
  userId: string;
  courseId: string;
  examId: string;
  candidateId: string;
  enrollmentId: string;
  attemptId: string;
}

async function seedFixture(
  sql: SqlDriver,
  orgId: string,
  suffix: string,
): Promise<FixtureIds> {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const userId = `u-${suffix}`;
  const courseId = `c-${suffix}`;
  const examId = `e-${suffix}`;
  const candidateId = `cd-${suffix}`;
  const enrollmentId = `en-${suffix}`;
  const attemptId = `at-${suffix}`;
  await sql.unsafe(`
    INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
    VALUES (${s(orgId)}, ${s(suffix)}, ${s(suffix)}, ${s(`slug-${suffix}`)}, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
    VALUES (${s(userId)}, ${s(orgId)}, ${s(`usr-${suffix}`)}, 'hash', ${s(suffix)}, 'Admin', true, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "candidate_profiles" ("id", "organization_id", "user_id", "fields", "created_at", "updated_at")
    VALUES (${s(candidateId)}, ${s(orgId)}, ${s(userId)}, '{}'::jsonb, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
    VALUES (${s(courseId)}, ${s(orgId)}, ${s(suffix)}, ${s(`code-${suffix}`)}, '', ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exams" (
      "id", "organization_id", "title", "description", "course_id",
      "status", "timing_mode", "duration_minutes", "open_at", "close_at",
      "passing_score", "total_score", "question_selection_mode",
      "question_ids", "question_snapshot", "control_flags",
      "retake_policy", "score_strategy", "max_attempts",
      "interruption_time_policy", "created_at", "updated_at"
    ) VALUES (
      ${s(examId)}, ${s(orgId)}, ${s(suffix)}, '', ${s(courseId)},
      'open', 'timed_window', 60,
      '2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z',
      60, 100, 'manual', '[]'::jsonb, '[]'::jsonb,
      '{"shuffleQuestions":false,"shuffleOptions":false,"detectTabSwitch":false,"disableCopyPaste":false,"requireQueue":false,"batchSize":10,"batchInterval":3,"restrictIp":false,"requireLockdown":false,"showResultImmediately":true}'::jsonb,
      'unlimited', 'highest', 10,
      'operator_incident', ${ts(createdAt)}, ${ts(createdAt)}
    )
  `);
  await sql.unsafe(`
    INSERT INTO "exam_enrollments" ("id", "organization_id", "exam_id", "candidate_id", "status", "attempt_count", "created_at", "updated_at")
    VALUES (${s(enrollmentId)}, ${s(orgId)}, ${s(examId)}, ${s(candidateId)}, 'started', 1, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exam_attempts" (
      "id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
      "attempt_no", "status", "question_snapshot", "answers",
      "started_at", "deadline_at", "last_activity_at",
      "interruption_policy_snapshot_version", "interruption_time_policy_snapshot",
      "created_at", "updated_at"
    ) VALUES (
      ${s(attemptId)}, ${s(orgId)}, ${s(examId)}, ${s(enrollmentId)}, ${s(candidateId)},
      1, 'in_progress', '[]'::jsonb, '[]'::jsonb,
      '2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z', '2026-01-01T01:00:00.000Z',
      1, 'operator_incident',
      ${ts(createdAt)}, ${ts(createdAt)}
    )
  `);
  return {
    orgId,
    userId,
    courseId,
    examId,
    candidateId,
    enrollmentId,
    attemptId,
  };
}

async function insertIncident(
  sql: SqlDriver,
  orgId: string,
  examId: string,
  attemptId: string | null,
  reportedBy: string,
): Promise<string> {
  const id = randomUUID();
  const now = "2026-01-01T00:00:00.000Z";
  await sql.unsafe(`
    INSERT INTO "exam_incidents" (
      "id", "organization_id", "exam_id", "attempt_id", "type", "severity",
      "status", "description", "reported_by", "version", "created_at", "updated_at"
    ) VALUES (
      ${s(id)}, ${s(orgId)}, ${s(examId)}, ${attemptId ? s(attemptId) : "NULL"},
      'other', 'info', 'open', 'test', ${s(reportedBy)}, 1, ${ts(new Date(now))}, ${ts(new Date(now))}
    )
  `);
  return id;
}

async function tableExists(sql: SqlDriver, name: string): Promise<boolean> {
  // Search across all schemas (the isolated test schema is not `public`).
  const rows = (await sql.unsafe(`
    SELECT to_regclass(${s(name)})::text AS reg
  `)) as Array<{ reg: string | null }>;
  return rows[0]?.reg != null;
}

describe("0023 incident composite FK + guarded rollback", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let alpha: FixtureIds;
  let beta: FixtureIds;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0023fk" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await applyAllMigrations(conn.sql);
    alpha = await seedFixture(conn.sql, "org-alpha-0023", "alpha");
    beta = await seedFixture(conn.sql, "org-beta-0023", "beta");
  }, 120_000);

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  });

  describe("composite FK exam_incidents_org_attempt_fk", () => {
    it("accepts a same-org existing attempt anchor", async () => {
      await expect(
        insertIncident(
          conn.sql,
          alpha.orgId,
          alpha.examId,
          alpha.attemptId,
          alpha.userId,
        ),
      ).resolves.toBeDefined();
    });

    it("accepts a null attempt_id (exam-wide incident)", async () => {
      await expect(
        insertIncident(conn.sql, alpha.orgId, alpha.examId, null, alpha.userId),
      ).resolves.toBeDefined();
    });

    it("rejects a cross-org attempt (composite FK organization mismatch)", async () => {
      // Alpha incident referencing a Beta attempt — the composite FK
      // (organization_id, attempt_id) → exam_attempts rejects this.
      await expect(
        insertIncident(
          conn.sql,
          alpha.orgId,
          alpha.examId,
          beta.attemptId,
          alpha.userId,
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it("rejects a nonexistent attempt", async () => {
      await expect(
        insertIncident(
          conn.sql,
          alpha.orgId,
          alpha.examId,
          "no-such-attempt-9999",
          alpha.userId,
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it("the FK constraint exists by name (schema/pg.ts parity)", async () => {
      // pg_constraint is database-global, so isolated test schemas created by
      // parallel workers all contribute rows with this name. Assert at least
      // one exists and that it is a foreign key on exam_incidents.
      const rows = (await conn.sql.unsafe(`
        SELECT conname, contype
        FROM pg_constraint
        WHERE conname = 'exam_incidents_org_attempt_fk'
      `)) as Array<{ conname: string; contype: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.conname).toBe("exam_incidents_org_attempt_fk");
      expect(rows[0]!.contype).toBe("f");
    });
  });

  describe("guarded rollback (ADR-014 §14)", () => {
    it("drops the five tables when no non-null incident_id exists", async () => {
      const dropIso = await setupIsolatedTestDb({
        namespace: "mig0023rb1",
      });
      const dropConn = await createDatabase(
        dropIso.databaseUrl,
        dropIso.schemaName,
      );
      try {
        await applyAllMigrations(dropConn.sql);
        const result = await rollbackIncidentTables(dropConn.db);
        expect(result.dropped).toBe(true);
        for (const table of [
          "exam_incidents",
          "exam_incident_events",
          "exam_incident_actions",
          "exam_incident_attempts",
          "exam_incident_interruption_links",
        ]) {
          expect(await tableExists(dropConn.sql, table)).toBe(false);
        }
      } finally {
        await dropConn.sql.end();
        await dropIso.cleanup();
      }
    });

    it("fails closed and preserves all five tables when a non-null incident_id exists", async () => {
      const dropIso = await setupIsolatedTestDb({
        namespace: "mig0023rb2",
      });
      const dropConn = await createDatabase(
        dropIso.databaseUrl,
        dropIso.schemaName,
      );
      try {
        await applyAllMigrations(dropConn.sql);
        const fix = await seedFixture(dropConn.sql, "org-rb-0023", "rb");
        // Insert an adjustment with a NON-NULL incident_id — activation has
        // occurred, so a destructive DROP must be refused.
        const incidentId = randomUUID();
        await dropConn.sql.unsafe(`
          INSERT INTO "exam_incidents" (
            "id", "organization_id", "exam_id", "type", "severity", "status",
            "description", "reported_by", "version", "created_at", "updated_at"
          ) VALUES (
            ${s(incidentId)}, ${s(fix.orgId)}, ${s(fix.examId)}, 'other', 'info', 'open',
            'activation', ${s(fix.userId)}, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `);
        await dropConn.sql.unsafe(`
          INSERT INTO "attempt_time_adjustments" (
            "id", "organization_id", "operation_id", "attempt_id", "incident_id",
            "policy", "source", "before_deadline", "after_deadline",
            "added_seconds", "reason_code", "reason_text", "actor_id"
          ) VALUES (
            ${s(randomUUID())}, ${s(fix.orgId)}, ${s(randomUUID())}, ${s(fix.attemptId)}, ${s(incidentId)},
            'operator_incident', 'operator',
            '2026-01-01T01:00:00.000Z', '2026-01-01T01:05:00.000Z',
            300, 'operator_grant', 'test', ${s(fix.userId)}
          )
        `);

        await expect(rollbackIncidentTables(dropConn.db)).rejects.toThrow(
          /Guard tripped/,
        );
        // All five tables still exist; the adjustment row remains.
        for (const table of [
          "exam_incidents",
          "exam_incident_events",
          "exam_incident_actions",
          "exam_incident_attempts",
          "exam_incident_interruption_links",
        ]) {
          expect(await tableExists(dropConn.sql, table)).toBe(true);
        }
        const adjRows = (await dropConn.sql.unsafe(`
          SELECT count(*)::int AS n FROM attempt_time_adjustments WHERE incident_id IS NOT NULL
        `)) as Array<{ n: number }>;
        expect(Number(adjRows[0]?.n ?? 0)).toBe(1);
      } finally {
        await dropConn.sql.end();
        await dropIso.cleanup();
      }
    });
  });
});
