/**
 * Migration 0044 — `exam_answer_save_receipts` schema contract + legacy
 * receipt backfill (#669 Phase D2, PC-F06 / #673 C5).
 *
 * Verifies against a real PostgreSQL schema:
 *
 * 1. fresh path: applying the full journal (through 0044) creates the table
 *    with the exact column set, the composite PK, the named CHECKs and the
 *    composite FK;
 * 2. the composite PK is the protocol invariant "one replay key → at most one
 *    accepted canonical identity" — and it is organization-scoped (different
 *    orgs own independent replay keys);
 * 3. the identity-representation CHECK admits exactly one of
 *    {digest, legacy payload} per row;
 * 4. the composite FK rejects a cross-org attempt reference and cascades
 *    receipt removal with the attempt;
 * 5. BACKFILL (D2-G / R7): the migration's backfill+strip statements move
 *    every legacy JSONB receipt (inline clientSeq + clientSeqHistory entries)
 *    into the receipts table with payload/version/savedAt preserved, strip the
 *    legacy fields from the draft-answer JSONB, and are a no-op on
 *    already-stripped rows — so a deployment cannot make an accepted
 *    clientSeq on a still-mutable Attempt become unknown.
 *
 * Mirrors the migration-application pattern from
 * `0028-attempt-command-receipts.test.ts`.
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

/**
 * Re-runs ONLY the 0044 backfill + strip statements. The journal application
 * above already created the table and its FK on the fresh schema; this
 * executes the exact production backfill/strip SQL against legacy-shaped
 * data seeded afterwards. Split parts carry leading SQL comments, so the
 * leading comment lines are stripped before matching.
 */
async function runBackfillAndStrip(sql: SqlDriver): Promise<void> {
  const stripCommentLines = (stmt: string) =>
    stmt.replace(/^\s*(--[^\n]*\n)+/, "").trim();
  const statements = readMigrationStatements("0044_answer_save_receipts")
    .map(stripCommentLines)
    .filter(
      (stmt) => stmt.startsWith("INSERT INTO") || stmt.startsWith("UPDATE"),
    );
  await sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
  });
}

const LEGACY_TS = (d: Date) => d.toISOString();

interface FixtureIds {
  orgId: string;
  examId: string;
  attemptId: string;
}

/**
 * Minimal org→…→attempt chain so the composite FK has a valid target. Uses
 * positional bind parameters (never string-interpolated SQL values).
 */
async function insertOrgAttemptChain(
  sql: SqlDriver,
  suffix: string,
  answers: unknown[],
): Promise<FixtureIds> {
  const createdAt = LEGACY_TS(new Date("2026-01-01T00:00:00.000Z"));
  const orgId = `org-0044-${suffix}`;
  const userId = `usr-0044-${suffix}`;
  const candidateId = `cand-0044-${suffix}`;
  const courseId = `course-0044-${suffix}`;
  const examId = `exam-0044-${suffix}`;
  const enrollmentId = `enr-0044-${suffix}`;
  const attemptId = `att-0044-${suffix}`;
  await sql.unsafe(
    `INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      orgId,
      `Org ${suffix}`,
      `Org ${suffix}`,
      `slug-0044-${suffix}`,
      createdAt,
      createdAt,
    ],
  );
  await sql.unsafe(
    `INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      orgId,
      `usr-0044-${suffix}`,
      "hash",
      "Candidate",
      "Candidate",
      true,
      createdAt,
      createdAt,
    ],
  );
  await sql.unsafe(
    `INSERT INTO "candidate_profiles" ("id", "organization_id", "user_id", "fields", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [candidateId, orgId, userId, "{}", createdAt, createdAt],
  );
  await sql.unsafe(
    `INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      courseId,
      orgId,
      "Course",
      `code-0044-${suffix}`,
      "",
      createdAt,
      createdAt,
    ],
  );
  await sql.unsafe(
    `INSERT INTO "exams" ("id", "organization_id", "title", "description", "course_id", "status", "timing_mode",
      "duration_minutes", "open_at", "close_at", "passing_score", "total_score", "question_selection_mode",
      "question_ids", "question_snapshot", "control_flags", "retake_policy", "score_strategy", "max_attempts",
      "result_publication_mode", "interruption_time_policy", "created_at", "updated_at")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
      $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21, $22, $23)`,
    [
      examId,
      orgId,
      "Exam",
      "",
      courseId,
      "open",
      "timed_window",
      60,
      createdAt,
      LEGACY_TS(new Date("2026-01-02T00:00:00.000Z")),
      60,
      100,
      "manual",
      "[]",
      "[]",
      "{}",
      "unlimited",
      "highest",
      1,
      "immediate",
      "strict",
      createdAt,
      createdAt,
    ],
  );
  await sql.unsafe(
    `INSERT INTO "exam_enrollments" ("id", "organization_id", "exam_id", "candidate_id", "status", "attempt_count", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      enrollmentId,
      orgId,
      examId,
      candidateId,
      "started",
      1,
      createdAt,
      createdAt,
    ],
  );
  await sql.unsafe(
    `INSERT INTO "exam_attempts" ("id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
      "attempt_no", "status", "question_snapshot", "answers",
      "started_at", "deadline_at", "last_activity_at",
      "interruption_policy_snapshot_version", "interruption_time_policy_snapshot",
      "created_at", "updated_at")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16)`,
    [
      attemptId,
      orgId,
      examId,
      enrollmentId,
      candidateId,
      1,
      "in_progress",
      "[]",
      JSON.stringify(answers),
      createdAt,
      LEGACY_TS(new Date("2026-01-01T02:00:00.000Z")),
      LEGACY_TS(new Date("2026-01-01T01:00:00.000Z")),
      1,
      "strict",
      createdAt,
      createdAt,
    ],
  );
  return { orgId, examId, attemptId };
}

describe(
  "0044 exam_answer_save_receipts schema contract + legacy backfill",
  { timeout: 60_000 },
  () => {
    let iso: IsolatedTestDb;
    let conn: Awaited<ReturnType<typeof createDatabase>>;
    let sql: SqlDriver;

    const LEGACY_SAVED_AT = new Date("2026-01-01T01:23:45.000Z");

    /**
     * The pre-D2 answers JSONB shape: the current element carries the inline
     * `clientSeq` receipt; older acceptances ride `clientSeqHistory` — each
     * with a FULL answer payload copy.
     */
    function legacyAnswers(): unknown[] {
      return [
        {
          questionId: "q-legacy-1",
          answer: { docVersion: 1, type: "doc", content: ["current"] },
          version: 3,
          savedAt: LEGACY_SAVED_AT.toISOString(),
          clientSeq: 3,
          clientSeqHistory: [
            {
              clientSeq: 1,
              answer: "first plain answer",
              version: 1,
              savedAt: new Date("2026-01-01T01:00:00.000Z").toISOString(),
            },
            {
              clientSeq: 2,
              answer: { docVersion: 1, type: "doc", content: ["second"] },
              version: 2,
              savedAt: new Date("2026-01-01T01:11:00.000Z").toISOString(),
            },
          ],
        },
        {
          // A second, never-idempotent element without receipt fields —
          // pre-#NNN legacy shape that must pass through untouched.
          questionId: "q-legacy-2",
          answer: "untouched",
          version: 1,
          savedAt: new Date("2026-01-01T00:30:00.000Z").toISOString(),
        },
      ];
    }

    let legacy: FixtureIds;

    beforeAll(async () => {
      iso = await setupIsolatedTestDb({
        namespace: "migration-0044-answer-save-receipts",
      });
      conn = await createDatabase(iso.databaseUrl, iso.schemaName);
      sql = conn.sql;
      await applyAllMigrations(conn.sql, iso.databaseUrl);
      legacy = await insertOrgAttemptChain(sql, "legacy", legacyAnswers());
    }, 120_000);

    afterAll(async () => {
      await conn?.sql.end();
      await iso?.cleanup();
    }, 30_000);

    async function constraintsOn(table: string): Promise<string[]> {
      const rows = await sql.unsafe<{ conname: string }[]>(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = $1::regclass
         ORDER BY conname`,
        [table],
      );
      return rows.map((r) => r.conname);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await sql.unsafe<{ attname: string }[]>(
        `SELECT attname FROM pg_attribute
         WHERE attrelid = $1::regclass AND attnum >= 1
           AND NOT attisdropped
         ORDER BY attnum`,
        [table],
      );
      return rows.map((r) => r.attname);
    }

    it("creates the table with the exact column set", async () => {
      const cols = await columnsOf("exam_answer_save_receipts");
      expect(cols).toEqual([
        "organization_id",
        "attempt_id",
        "question_id",
        "client_seq",
        "answer_identity",
        "legacy_answer",
        "accepted_version",
        "saved_at",
      ]);
    });

    it("creates the frozen named constraints (PK, CHECKs, composite FK)", async () => {
      const names = await constraintsOn("exam_answer_save_receipts");
      expect(names).toContain("exam_answer_save_receipts_pk");
      expect(names).toContain("exam_answer_save_receipts_client_seq_check");
      expect(names).toContain("exam_answer_save_receipts_identity_repr_check");
      expect(names).toContain("exam_answer_save_receipts_org_attempt_fk");
    });

    it("rejects a duplicate replay key (one key → at most one accepted identity)", async () => {
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(
            `INSERT INTO "exam_answer_save_receipts"
              ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              legacy.orgId,
              legacy.attemptId,
              "q-dup",
              5,
              "a".repeat(64),
              null,
              1,
              LEGACY_SAVED_AT.toISOString(),
            ],
          );
          await tx.unsafe(
            `INSERT INTO "exam_answer_save_receipts"
              ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              legacy.orgId,
              legacy.attemptId,
              "q-dup",
              5,
              "b".repeat(64),
              null,
              2,
              LEGACY_SAVED_AT.toISOString(),
            ],
          );
        }),
      ).rejects.toThrow(/exam_answer_save_receipts_pk/);
    });

    it("scopes the replay key per organization (different orgs own independent keys)", async () => {
      const other = await insertOrgAttemptChain(sql, "other-org", []);
      await sql.begin(async (tx) => {
        for (const org of [legacy.orgId, other.orgId]) {
          await tx.unsafe(
            `INSERT INTO "exam_answer_save_receipts"
              ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              org,
              org === legacy.orgId ? legacy.attemptId : other.attemptId,
              "q-scope",
              5,
              "c".repeat(64),
              null,
              1,
              LEGACY_SAVED_AT.toISOString(),
            ],
          );
        }
      });
      const rows = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "exam_answer_save_receipts"
         WHERE "question_id" = 'q-scope'`,
      );
      expect(rows[0]!.n).toBe(2);
    });

    it("rejects a row carrying both or neither identity representations", async () => {
      await expect(
        sql.unsafe(
          `INSERT INTO "exam_answer_save_receipts"
            ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            legacy.orgId,
            legacy.attemptId,
            "q-repr",
            6,
            "d".repeat(64),
            JSON.stringify({ x: 1 }),
            1,
            LEGACY_SAVED_AT.toISOString(),
          ],
        ),
      ).rejects.toThrow(/identity_repr_check/);
      await expect(
        sql.unsafe(
          `INSERT INTO "exam_answer_save_receipts"
            ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            legacy.orgId,
            legacy.attemptId,
            "q-repr",
            7,
            null,
            null,
            1,
            LEGACY_SAVED_AT.toISOString(),
          ],
        ),
      ).rejects.toThrow(/identity_repr_check/);
    });

    it("rejects a cross-org attempt reference and cascades removal with the attempt", async () => {
      const other = await insertOrgAttemptChain(sql, "other-fk", []);
      await expect(
        sql.unsafe(
          `INSERT INTO "exam_answer_save_receipts"
            ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            other.orgId,
            legacy.attemptId,
            "q-fk",
            8,
            "e".repeat(64),
            null,
            1,
            LEGACY_SAVED_AT.toISOString(),
          ],
        ),
      ).rejects.toThrow(/exam_answer_save_receipts_org_attempt_fk/);

      // Cascade: receipts follow their attempt's lifetime (protocol metadata,
      // not independent evidence).
      await sql.begin(async (tx) => {
        await tx.unsafe(
          `INSERT INTO "exam_answer_save_receipts"
            ("organization_id", "attempt_id", "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            other.orgId,
            other.attemptId,
            "q-fk",
            8,
            "f".repeat(64),
            null,
            1,
            LEGACY_SAVED_AT.toISOString(),
          ],
        );
        await tx.unsafe(`DELETE FROM "exam_attempts" WHERE "id" = $1`, [
          other.attemptId,
        ]);
      });
      const rows = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "exam_answer_save_receipts"
         WHERE "attempt_id" = $1`,
        [other.attemptId],
      );
      expect(rows[0]!.n).toBe(0);
    });

    it("backfills every legacy JSONB receipt and strips the legacy fields (D2-G / R7)", async () => {
      await runBackfillAndStrip(sql);

      // Three accepted replay keys survived: history seq 1+2 and inline seq 3.
      const receipts = await sql.unsafe<
        {
          question_id: string;
          client_seq: number;
          answer_identity: string | null;
          legacy_answer: unknown;
          accepted_version: number;
          // Raw simple-protocol rows deliver timestamptz as text.
          saved_at: string;
        }[]
      >(
        `SELECT "question_id", "client_seq", "answer_identity", "legacy_answer", "accepted_version", "saved_at"
         FROM "exam_answer_save_receipts"
         WHERE "attempt_id" = $1 AND "question_id" = 'q-legacy-1'
         ORDER BY "question_id", "client_seq"`,
        [legacy.attemptId],
      );
      // (the org-scope test adds an unrelated receipt on the same attempt —
      // this query is scoped to the legacy question)
      expect(receipts).toHaveLength(3);
      const bySeq = new Map(receipts.map((r) => [r.client_seq, r]));

      expect(bySeq.get(1)).toMatchObject({
        question_id: "q-legacy-1",
        answer_identity: null,
        accepted_version: 1,
      });
      expect(bySeq.get(1)!.legacy_answer).toEqual("first plain answer");
      expect(new Date(bySeq.get(1)!.saved_at).toISOString()).toBe(
        "2026-01-01T01:00:00.000Z",
      );
      expect(bySeq.get(2)).toMatchObject({
        question_id: "q-legacy-1",
        answer_identity: null,
        accepted_version: 2,
      });
      expect(bySeq.get(2)!.legacy_answer).toEqual({
        docVersion: 1,
        type: "doc",
        content: ["second"],
      });
      expect(bySeq.get(3)).toMatchObject({
        question_id: "q-legacy-1",
        answer_identity: null,
        accepted_version: 3,
      });
      expect(bySeq.get(3)!.legacy_answer).toEqual({
        docVersion: 1,
        type: "doc",
        content: ["current"],
      });
      expect(new Date(bySeq.get(3)!.saved_at).toISOString()).toBe(
        LEGACY_SAVED_AT.toISOString(),
      );

      // The draft-answer JSONB no longer carries receipt fields; payloads and
      // versions are untouched, element order preserved.
      const attempts = await sql.unsafe<{ answers: unknown[] }[]>(
        `SELECT "answers" FROM "exam_attempts" WHERE "id" = $1`,
        [legacy.attemptId],
      );
      const answers = attempts[0]!.answers as Array<Record<string, unknown>>;
      expect(answers).toHaveLength(2);
      expect(Object.keys(answers[0]!).sort()).toEqual([
        "answer",
        "questionId",
        "savedAt",
        "version",
      ]);
      expect(answers[0]!.answer).toEqual({
        docVersion: 1,
        type: "doc",
        content: ["current"],
      });
      expect(answers[0]!.version).toBe(3);
      expect(Object.keys(answers[1]!).sort()).toEqual([
        "answer",
        "questionId",
        "savedAt",
        "version",
      ]);
    });

    it("backfill is a no-op on already-stripped rows (converged authority)", async () => {
      const before = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "exam_answer_save_receipts"
         WHERE "attempt_id" = $1`,
        [legacy.attemptId],
      );
      await runBackfillAndStrip(sql);
      const after = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "exam_answer_save_receipts"
         WHERE "attempt_id" = $1`,
        [legacy.attemptId],
      );
      expect(after[0]!.n).toBe(before[0]!.n);
    });
  },
);
