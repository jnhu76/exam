/**
 * Migration 0028 — `attempt_command_receipts` schema contract
 * (J5-I1C Slice 1 / J5-I1C0 audit §6.2, §11.1–§11.8).
 *
 * Verifies the frozen schema contract against a real PostgreSQL schema:
 *
 * 1. fresh-path: applying the full journal (through 0028) creates the table
 *    with the exact named CHECKs, the unique arbiter, the composite FK, the
 *    actor/org FKs, and the per-attempt history index;
 * 2. the idempotency arbiter `attempt_command_receipts_org_operation_unique`
 *    is the ONE cross-command conflict point (audit §11.3);
 * 3. command_type / outcome / jsonb-object CHECKs reject disallowed values
 *    (audit §11.7, §11.8);
 * 4. the composite FK `(organization_id, attempt_id) → exam_attempts` rejects
 *    a cross-org attempt reference (audit §11.6);
 * 5. operationId scope is PER ORGANIZATION: different orgs may reuse the same
 *    operationId (audit §11.4); same org + same operationId across command
 *    types OR across attempts conflicts (audit §11.3, §11.5).
 *
 * Mirrors the migration-application pattern from `0023-incident-fk-and-rollback.test.ts`
 * and `0024-proctor-assignment.test.ts`.
 */

import { randomUUID } from "node:crypto";
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

const ts = (d: Date) => `'${d.toISOString()}'`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

interface FixtureIds {
  orgId: string;
  adminId: string;
  examId: string;
  attemptId: string;
}

/**
 * Insert a full org→user→course→exam→enrollment→attempt chain in one org.
 * Reuses the minimum required columns so the `attempt_command_receipts`
 * composite FK has a valid `(organization_id, attempt_id)` target.
 */
async function insertOrgAttemptChain(
  sql: SqlDriver,
  suffix: string,
): Promise<FixtureIds> {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const orgId = `org-0028-${suffix}`;
  const adminId = `admin-0028-${suffix}`;
  const candidateId = `cand-0028-${suffix}`;
  const courseId = `course-0028-${suffix}`;
  const examId = `exam-0028-${suffix}`;
  const enrollmentId = `enr-0028-${suffix}`;
  const attemptId = `att-0028-${suffix}`;
  await sql.unsafe(`
    INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
    VALUES (${s(orgId)}, 'Org ${suffix}', 'Org ${suffix}', ${s(`slug-0028-${suffix}`)}, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
    VALUES (${s(adminId)}, ${s(orgId)}, ${s(`usr-0028-${suffix}`)}, 'hash', 'Admin', 'Admin', true, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "candidate_profiles" ("id", "organization_id", "user_id", "fields", "created_at", "updated_at")
    VALUES (${s(candidateId)}, ${s(orgId)}, ${s(adminId)}, '{}'::jsonb, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
    VALUES (${s(courseId)}, ${s(orgId)}, 'Course', ${s(`code-0028-${suffix}`)}, '', ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exams" ("id", "organization_id", "title", "description", "course_id", "status", "timing_mode",
      "duration_minutes", "open_at", "close_at", "passing_score", "total_score", "question_selection_mode",
      "question_ids", "question_snapshot", "control_flags", "retake_policy", "score_strategy", "max_attempts",
      "result_publication_mode", "interruption_time_policy", "created_at", "updated_at")
    VALUES (${s(examId)}, ${s(orgId)}, 'Exam', '', ${s(courseId)}, 'open', 'timed_window',
      60, ${ts(createdAt)}, ${ts(new Date("2026-01-02T00:00:00.000Z"))}, 60, 100, 'manual',
      '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'unlimited', 'highest', 1,
      'immediate', 'strict', ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exam_enrollments" ("id", "organization_id", "exam_id", "candidate_id", "status", "attempt_count", "created_at", "updated_at")
    VALUES (${s(enrollmentId)}, ${s(orgId)}, ${s(examId)}, ${s(candidateId)}, 'started', 1, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exam_attempts" ("id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
      "attempt_no", "status", "question_snapshot", "answers",
      "started_at", "deadline_at", "last_activity_at",
      "interruption_policy_snapshot_version", "interruption_time_policy_snapshot",
      "created_at", "updated_at")
    VALUES (${s(attemptId)}, ${s(orgId)}, ${s(examId)}, ${s(enrollmentId)}, ${s(candidateId)},
      1, 'in_progress', '[]'::jsonb, '[]'::jsonb,
      ${ts(createdAt)}, ${ts(new Date("2026-01-01T02:00:00.000Z"))}, ${ts(new Date("2026-01-01T01:00:00.000Z"))},
      1, 'strict', ${ts(createdAt)}, ${ts(createdAt)})
  `);
  return { orgId, adminId, examId, attemptId };
}

async function constraintNames(table: string): Promise<string[]> {
  // Method scoped to the isolated test schema via the shared connection.
  return [];
}

describe(
  "0028 attempt_command_receipts schema contract",
  { timeout: 60_000 },
  () => {
    let iso: IsolatedTestDb;
    let conn: Awaited<ReturnType<typeof createDatabase>>;
    let sql: SqlDriver;
    let alpha: FixtureIds;
    let beta: FixtureIds;

    beforeAll(async () => {
      iso = await setupIsolatedTestDb({
        namespace: "migration-0028-attempt-command-receipts",
      });
      conn = await createDatabase(iso.databaseUrl, iso.schemaName);
      sql = conn.sql;
      await applyAllMigrations(conn.sql, iso.databaseUrl);
      alpha = await insertOrgAttemptChain(sql, "alpha");
      beta = await insertOrgAttemptChain(sql, "beta");
    }, 120_000);

    afterAll(async () => {
      await conn?.sql.end();
      await iso?.cleanup();
    }, 30_000);

    async function constraintsOn(table: string): Promise<string[]> {
      const rows = await sql.unsafe<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = ${s(table)}::regclass
      ORDER BY conname
    `);
      return rows.map((r) => r.conname);
    }

    async function indexesOn(table: string): Promise<string[]> {
      const rows = await sql.unsafe<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = ${s(table)}
      ORDER BY indexname
    `);
      return rows.map((r) => r.indexname);
    }

    async function columnsOf(table: string): Promise<string[]> {
      // Use pg_attribute against the regclass (resolves via search_path to the
      // isolated test schema), so a same-named table in another schema cannot
      // duplicate rows. attnum >= 1 drops the system columns.
      const rows = await sql.unsafe<{ attname: string }[]>(`
      SELECT attname FROM pg_attribute
      WHERE attrelid = ${s(table)}::regclass AND attnum >= 1
        AND NOT attisdropped
      ORDER BY attnum
    `);
      return rows.map((r) => r.attname);
    }

    // ── §11.1 fresh path: table + columns + defaults ──────────────────

    it("creates the table with the exact column set", async () => {
      const cols = await columnsOf("attempt_command_receipts");
      expect(cols).toEqual([
        "id",
        "organization_id",
        "attempt_id",
        "operation_id",
        "command_type",
        "request_payload",
        "result_payload",
        "outcome",
        "actor_id",
        "created_at",
      ]);
    });

    it("creates the frozen named CHECK constraints", async () => {
      const names = await constraintsOn("attempt_command_receipts");
      expect(names).toContain("attempt_command_receipts_command_type_check");
      expect(names).toContain("attempt_command_receipts_outcome_check");
      expect(names).toContain("attempt_command_receipts_request_payload_check");
      expect(names).toContain("attempt_command_receipts_result_payload_check");
      // FKs land as constraints too.
      expect(names).toContain("attempt_command_receipts_org_attempt_fk");
      expect(names).toContain("attempt_command_receipts_org_fk");
      expect(names).toContain("attempt_command_receipts_actor_fk");
      void constraintNames; // unused local placeholder retained for symmetry
    });

    it("creates the unique arbiter and the per-attempt history indexes", async () => {
      const names = await indexesOn("attempt_command_receipts");
      expect(names).toContain("attempt_command_receipts_org_operation_unique");
      expect(names).toContain(
        "attempt_command_receipts_org_attempt_created_idx",
      );
      expect(names).toContain(
        "attempt_command_receipts_org_attempt_command_created_idx",
      );
      // Composite-FK target index on users (actor identity graph).
      const userNames = await indexesOn("users");
      expect(userNames).toContain("users_org_id_unique");
    });

    it("the history indexes carry the exact column orders", async () => {
      // PRIMARY history index: (org, attempt, created_at, id) — equality
      // prefix + (created_at, id) ordering, no sort node for listByAttempt.
      const primary = await sql.unsafe<{ key: string }[]>(`
        SELECT pg_get_indexdef(indexrelid) AS key
        FROM pg_index
        WHERE indrelid = 'attempt_command_receipts'::regclass
          AND indexrelid = 'attempt_command_receipts_org_attempt_created_idx'::regclass
      `);
      expect(primary[0]?.key).toContain(
        "(organization_id, attempt_id, created_at, id)",
      );
      // Command-filtered history index: (org, attempt, command_type, created_at, id).
      const filtered = await sql.unsafe<{ key: string }[]>(`
        SELECT pg_get_indexdef(indexrelid) AS key
        FROM pg_index
        WHERE indrelid = 'attempt_command_receipts'::regclass
          AND indexrelid = 'attempt_command_receipts_org_attempt_command_created_idx'::regclass
      `);
      expect(filtered[0]?.key).toContain(
        "(organization_id, attempt_id, command_type, created_at, id)",
      );
    });

    it("the frozen CHECK constraints carry the exact definitions", async () => {
      const rows = await sql.unsafe<{ conname: string; def: string }[]>(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'attempt_command_receipts'::regclass
        AND contype = 'c'
      ORDER BY conname
    `);
      const byName = new Map(rows.map((r) => [r.conname, r.def]));
      expect(byName.get("attempt_command_receipts_command_type_check")).toBe(
        `CHECK ((command_type = ANY (ARRAY['force_submit'::text, 'misconduct_mark'::text])))`,
      );
      expect(byName.get("attempt_command_receipts_outcome_check")).toBe(
        `CHECK ((outcome = ANY (ARRAY['applied'::text, 'no_change'::text])))`,
      );
      expect(byName.get("attempt_command_receipts_request_payload_check")).toBe(
        `CHECK ((jsonb_typeof(request_payload) = 'object'::text))`,
      );
      expect(byName.get("attempt_command_receipts_result_payload_check")).toBe(
        `CHECK ((jsonb_typeof(result_payload) = 'object'::text))`,
      );
    });

    it("the FKs are composite where required and never CASCADE", async () => {
      const rows = await sql.unsafe<{ conname: string; def: string }[]>(`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'attempt_command_receipts'::regclass
        AND contype = 'f'
      ORDER BY conname
    `);
      const byName = new Map(rows.map((r) => [r.conname, r.def]));
      // Composite org+attempt FK (audit §6.2) — no CASCADE on any FK.
      expect(byName.get("attempt_command_receipts_org_attempt_fk")).toBe(
        `FOREIGN KEY (organization_id, attempt_id) REFERENCES exam_attempts(organization_id, id)`,
      );
      expect(byName.get("attempt_command_receipts_org_fk")).toBe(
        `FOREIGN KEY (organization_id) REFERENCES organizations(id)`,
      );
      // Composite org+actor FK — the actor must be a member of the SAME org.
      expect(byName.get("attempt_command_receipts_actor_fk")).toBe(
        `FOREIGN KEY (organization_id, actor_id) REFERENCES users(organization_id, id)`,
      );
      for (const def of byName.values()) {
        expect(def).not.toContain("CASCADE");
      }
    });

    it("the unique arbiter is a real unique index on (organization_id, operation_id)", async () => {
      const rows = await sql.unsafe<{ indisunique: boolean; def: string }[]>(`
      SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      WHERE i.indexrelid = 'attempt_command_receipts_org_operation_unique'::regclass
    `);
      expect(rows[0]?.indisunique).toBe(true);
      expect(rows[0]?.def).toContain("(organization_id, operation_id)");
    });

    it("created_at defaults to now() on insert", async () => {
      const opId = randomUUID();
      await sql.unsafe(`
      INSERT INTO "attempt_command_receipts"
        ("id", "organization_id", "attempt_id", "operation_id", "command_type",
         "request_payload", "result_payload", "outcome", "actor_id")
      VALUES (
        ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(opId)},
        'force_submit', '{"reason":null}'::jsonb,
        '{"commandType":"force_submit","appliedAt":"2026-01-01T00:00:00.000Z"}'::jsonb,
        'applied', ${s(alpha.adminId)}
      )
    `);
      // Raw unsafe query returns timestamps as strings; parse to confirm a real,
      // recent server-side default value (not NULL, not a frozen constant).
      const rows = await sql.unsafe<{ created_at: string }[]>(`
      SELECT created_at::text FROM "attempt_command_receipts" WHERE operation_id = ${s(opId)}
    `);
      const created = new Date(rows[0]!.created_at);
      expect(Number.isNaN(created.getTime())).toBe(false);
      // Within the last 5 minutes — proves it defaulted to now(), not a constant.
      expect(Date.now() - created.getTime()).toBeLessThan(5 * 60 * 1000);
    });

    // ── §11.8 command_type / outcome CHECKs ───────────────────────────

    it("rejects an unknown command_type", async () => {
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'unknown_command', '{}'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(/attempt_command_receipts_command_type_check/);
    });

    it("rejects an unknown outcome", async () => {
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'force_submit', '{}'::jsonb, '{}'::jsonb, 'idempotent_replay', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(/attempt_command_receipts_outcome_check/);
    });

    // ── §11.7 JSONB object-shape CHECKs ───────────────────────────────

    it("rejects a non-object request_payload (array)", async () => {
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'force_submit', '[]'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(/attempt_command_receipts_request_payload_check/);
    });

    it("rejects a null request_payload", async () => {
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'force_submit', NULL, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow();
    });

    it("rejects a non-object result_payload (scalar)", async () => {
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'force_submit', '{}'::jsonb, '"text"'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(/attempt_command_receipts_result_payload_check/);
    });

    // ── §11.3 shared arbiter: cross-command conflict ──────────────────

    it("the shared arbiter rejects same org + same operationId across command types", async () => {
      const opId = randomUUID();
      await sql.unsafe(`
      INSERT INTO "attempt_command_receipts"
        ("id", "organization_id", "attempt_id", "operation_id", "command_type",
         "request_payload", "result_payload", "outcome", "actor_id")
      VALUES (
        ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(opId)},
        'force_submit', '{"reason":null}'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
      )
    `);
      // Same org + same operationId, but command_type='misconduct_mark' MUST hit
      // the SAME unique constraint — this is the cross-command arbiter proof.
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(opId)},
          'misconduct_mark', '{"severity":"warning","notes":"x"}'::jsonb,
          '{}'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(/attempt_command_receipts_org_operation_unique/);
    });

    // ── §11.5 same org + same operationId, different attempt ──────────

    it("the shared arbiter rejects same org + same operationId across attempts", async () => {
      const opId = randomUUID();
      // A second attempt in org alpha.
      const secondAttempt = `att-0028-alpha-2`;
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      await sql.unsafe(`
      INSERT INTO "exam_attempts" ("id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
        "attempt_no", "status", "question_snapshot", "answers",
        "started_at", "deadline_at", "last_activity_at",
        "interruption_policy_snapshot_version", "interruption_time_policy_snapshot",
        "created_at", "updated_at")
      VALUES (${s(secondAttempt)}, ${s(alpha.orgId)}, ${s(alpha.examId)}, 'enr-0028-alpha', ${s(`cand-0028-alpha`)},
        2, 'in_progress', '[]'::jsonb, '[]'::jsonb,
        ${ts(createdAt)}, ${ts(new Date("2026-01-01T02:00:00.000Z"))}, ${ts(new Date("2026-01-01T01:00:00.000Z"))},
        1, 'strict', ${ts(createdAt)}, ${ts(createdAt)})
    `);
      await sql.unsafe(`
      INSERT INTO "attempt_command_receipts"
        ("id", "organization_id", "attempt_id", "operation_id", "command_type",
         "request_payload", "result_payload", "outcome", "actor_id")
      VALUES (
        ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(opId)},
        'force_submit', '{"reason":null}'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
      )
    `);
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(secondAttempt)}, ${s(opId)},
          'force_submit', '{"reason":null}'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(/attempt_command_receipts_org_operation_unique/);
    });

    // ── §11.4 different orgs may reuse the same operationId ───────────

    it("different organizations may reuse the same operationId", async () => {
      const opId = randomUUID();
      await sql.unsafe(`
      INSERT INTO "attempt_command_receipts"
        ("id", "organization_id", "attempt_id", "operation_id", "command_type",
         "request_payload", "result_payload", "outcome", "actor_id")
      VALUES (
        ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(opId)},
        'force_submit', '{"reason":null}'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
      )
    `);
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(beta.orgId)}, ${s(beta.attemptId)}, ${s(opId)},
          'force_submit', '{"reason":null}'::jsonb, '{}'::jsonb, 'applied', ${s(beta.adminId)}
        )
      `),
      ).resolves.toBeDefined();
    });

    // ── §11.6 composite FK ────────────────────────────────────────────

    it("the composite org+attempt FK rejects an attempt belonging to another org", async () => {
      // organization_id = alpha, attempt_id = beta's attempt → must fail.
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(beta.attemptId)}, ${s(randomUUID())},
          'force_submit', '{}'::jsonb, '{}'::jsonb, 'applied', ${s(alpha.adminId)}
        )
      `),
      ).rejects.toThrow(
        /attempt_command_receipts_org_attempt_fk|violates foreign key/,
      );
    });

    it("the composite org+actor FK rejects an unknown actor", async () => {
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'force_submit', '{}'::jsonb, '{}'::jsonb, 'applied', 'no-such-user'
        )
      `),
      ).rejects.toThrow(
        /attempt_command_receipts_actor_fk|violates foreign key/,
      );
    });

    it("the composite org+actor FK rejects an actor from ANOTHER organization", async () => {
      // organization_id = alpha, actor_id = beta's admin → the actor is a
      // real user but NOT a member of alpha. The identity graph must be
      // DB-enforced (overnight hardening).
      await expect(
        sql.unsafe(`
        INSERT INTO "attempt_command_receipts"
          ("id", "organization_id", "attempt_id", "operation_id", "command_type",
           "request_payload", "result_payload", "outcome", "actor_id")
        VALUES (
          ${s(randomUUID())}, ${s(alpha.orgId)}, ${s(alpha.attemptId)}, ${s(randomUUID())},
          'force_submit', '{}'::jsonb, '{}'::jsonb, 'applied', ${s(beta.adminId)}
        )
      `),
      ).rejects.toThrow(
        /attempt_command_receipts_actor_fk|violates foreign key/,
      );
    });
  },
);
