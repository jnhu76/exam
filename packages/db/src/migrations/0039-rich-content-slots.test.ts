/**
 * Migration 0039 — Question rich content slots (#301).
 *
 * Verifies the B′ additive projection storage contract against a real
 * PostgreSQL schema:
 *
 * 1. `questions.content_document` jsonb and `questions.answer_mode` text
 *    exist and are nullable (legacy rows are Plain without backfill);
 * 2. the `questions_answer_mode_check` CHECK accepts NULL, 'plain', 'rich'
 *    and rejects any other value (NULL passes the CHECK — the plain default);
 * 3. a rich question row round-trips its ContentDocumentV1 JSONB payload.
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

const ts = (d: Date) => `'${d.toISOString()}'`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

const RICH_DOCUMENT = JSON.stringify({
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Solve " },
        { type: "inlineMath", latex: "x^2-1=0" },
      ],
    },
  ],
});

async function insertQuestion(
  sql: SqlDriver,
  overrides: {
    id: string;
    contentDocument: string | null;
    answerMode: string | null;
  },
): Promise<void> {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  await sql.unsafe(`
    INSERT INTO "questions" (
      "id", "organization_id", "course_id", "type", "content",
      "content_document", "answer_mode", "options", "standard_answer",
      "attachments", "score", "difficulty", "tags", "grading_rule",
      "created_at", "updated_at"
    ) VALUES (
      ${s(overrides.id)}, 'org-0039', 'course-0039', 'text_response', 'prompt',
      ${overrides.contentDocument === null ? "NULL" : `'${overrides.contentDocument}'::jsonb`},
      ${overrides.answerMode === null ? "NULL" : s(overrides.answerMode)},
      '[]'::jsonb, NULL,
      '[]'::jsonb, 5, 3, '[]'::jsonb,
      '{"multiSelectScoring":"all_correct_full","fillBlankMatchMode":"exact"}'::jsonb,
      ${ts(createdAt)}, ${ts(createdAt)}
    )
  `);
}

describe("0039 question rich content slots schema contract (#301)", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let sql: SqlDriver;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "migration-0039-rich-content",
    });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    sql = conn.sql;
    await applyAllMigrations(conn.sql, iso.databaseUrl);

    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    await sql.unsafe(`
      INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES ('org-0039', 'Org', 'Org', 'slug-0039', ${ts(createdAt)}, ${ts(createdAt)})
    `);
    await sql.unsafe(`
      INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
      VALUES ('course-0039', 'org-0039', 'Course', 'C-0039', '', ${ts(createdAt)}, ${ts(createdAt)})
    `);
  });

  afterAll(async () => {
    await conn?.sql.end();
    await iso?.cleanup();
  });

  it("adds nullable content_document and answer_mode columns", async () => {
    const result = await sql.unsafe(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'questions'
        AND column_name IN ('content_document', 'answer_mode')
      ORDER BY column_name
    `);
    expect(result).toHaveLength(2);
    const columns = new Map(
      result.map((row: Record<string, unknown>) => [
        row.column_name as string,
        row,
      ]),
    );
    expect(columns.get("answer_mode")?.data_type).toBe("text");
    expect(columns.get("answer_mode")?.is_nullable).toBe("YES");
    expect(columns.get("content_document")?.data_type).toBe("jsonb");
    expect(columns.get("content_document")?.is_nullable).toBe("YES");
  });

  it("legacy rows (both columns NULL) stay valid — Plain without backfill", async () => {
    await insertQuestion(sql, {
      id: "q-0039-legacy",
      contentDocument: null,
      answerMode: null,
    });
    const rows = await sql.unsafe(
      `SELECT content_document, answer_mode FROM questions WHERE id = 'q-0039-legacy'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content_document).toBeNull();
    expect(rows[0]?.answer_mode).toBeNull();
  });

  it("answer_mode CHECK accepts 'plain' and 'rich' but rejects other values", async () => {
    await insertQuestion(sql, {
      id: "q-0039-plain",
      contentDocument: null,
      answerMode: "plain",
    });
    await insertQuestion(sql, {
      id: "q-0039-rich",
      contentDocument: RICH_DOCUMENT,
      answerMode: "rich",
    });

    await expect(
      insertQuestion(sql, {
        id: "q-0039-bad",
        contentDocument: null,
        answerMode: "markdown",
      }),
    ).rejects.toThrow(/questions_answer_mode_check/);
  });

  it("round-trips a rich ContentDocumentV1 JSONB payload", async () => {
    const rows = await sql.unsafe(
      `SELECT content_document FROM questions WHERE id = 'q-0039-rich'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content_document).toEqual(JSON.parse(RICH_DOCUMENT));
  });
});
