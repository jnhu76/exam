// Real-PostgreSQL convergence test matrix for migration 0027.
//
// 0027 converges databases that permanently skipped the out-of-order journal
// entries 0004 / 0022 / 0024 (issue #259 / #256). These tests run 0027 against
// controlled PostgreSQL baselines built in isolated schemas and assert the
// authoritative postconditions. They are NOT unit tests: they exercise the
// actual 0027 SQL against the actual Drizzle-migrated schema.
//
// Matrix:
//   A. Fresh            — empty (post-migrate) schema → 0027 is a pure verify no-op
//   B. Healthy          — fully converged schema → 0027 is a pure verify no-op
//   C. Missing 0024     — proctor tables + exams_org_id_unique dropped → 0027 recreates
//   D. Missing 0022     — status_pointer_check dropped + I1 transitional rows → 0027 repairs
//   E. Missing 0004     — grading_status column dropped → 0027 re-adds + backfills
//   F. Partial supported — one proctor table present, the other + its FKs absent → completes
//   G. Partial incompatible — proctor table with wrong column type → 0027 fails closed
//   H. Repeat safety    — re-running 0027's SQL on a converged schema → no duplicates/drift
//   I. Exact shape      — PK/default/CHECK/index/FK drift → repair or fail closed
//   J. Open episode     — reuse one legal episode; reject multiple legal episodes
//   K. Pointer CHECK    — canonical semantics and validation state are authoritative
//
// Each scenario uses its own isolated schema so parallel workers don't collide.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { withTestInfraLifecycleLock } from "../testInfraLock.js";
import { createDatabase } from "../database.js";
import { migratePostgres } from "../postgres.js";
import type { Database } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0027 = resolve(
  __dirname,
  "../../migrations/postgres/0027_converge_skipped_migrations.sql",
);

/** Read and return the 0027 migration SQL. */
function read0027Sql(): string {
  return readFileSync(MIGRATION_0027, "utf8");
}

/**
 * Execute the 0027 migration SQL (multi-statement, statement-breakpoint-split)
 * against a connection whose search_path points at an isolated schema. All
 * statements run inside ONE explicit transaction (matching how the Drizzle
 * migrator applies migrations), so ON COMMIT DROP temp tables survive across
 * statements and a mid-migration failure rolls the whole thing back.
 */
async function run0027(conn: { sql: import("postgres").Sql }): Promise<void> {
  const file = read0027Sql();
  const statements = file
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    // Keep only statements that contain non-comment SQL. A real statement may
    // begin with `--` comments, so we strip comment lines before testing for
    // emptiness (a pure-comment chunk must be dropped).
    .filter((s) => {
      const codeOnly = s
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      return codeOnly.length > 0;
    });
  await conn.sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
  });
}

interface Env {
  iso: IsolatedTestDb;
  conn: Awaited<ReturnType<typeof createDatabase>>;
}

async function makeEnv(namespace: string): Promise<Env> {
  const iso = await setupIsolatedTestDb({ namespace });
  const conn = await createDatabase(iso.databaseUrl, iso.schemaName);
  await withTestInfraLifecycleLock(iso.databaseUrl, () =>
    migratePostgres(conn.db, { migrationsSchema: iso.schemaName }),
  );
  return { iso, conn };
}

async function teardown(env: Env): Promise<void> {
  await env.conn.sql.end();
  await env.iso.cleanup();
}

/**
 * Run a query that selects exactly one column from (at most) one row, returning
 * that scalar. The query MUST alias the column to `v` (e.g.
 * `SELECT x AS v FROM ...`) so the result is shape-stable regardless of the
 * driver's column-naming.
 */
async function scalar<T>(
  conn: { sql: import("postgres").Sql },
  query: string,
): Promise<T | undefined> {
  const rows = (await conn.sql.unsafe(query)) as unknown as Array<
    Record<string, unknown>
  >;
  const row = rows[0];
  if (!row) return undefined;
  // Prefer the explicit `v` alias (present even when its value is null); only
  // fall back to the first column value when `v` is absent.
  if ("v" in row) return row.v as T | undefined;
  return Object.values(row)[0] as T | undefined;
}

async function seedDisruptedAttempt(env: Env, suffix: string): Promise<void> {
  await env.conn.sql.unsafe(`
    ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_pointer_check;
    INSERT INTO organizations (id, name, display_name, slug, created_at, updated_at)
    VALUES ('org-${suffix}', 'Org', 'Org', 'org-${suffix}', now(), now());
    INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at)
    VALUES ('candidate-user-${suffix}', 'org-${suffix}', 'candidate-${suffix}', 'h', 'Candidate', 'Candidate', true, now(), now());
    INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at)
    VALUES ('candidate-${suffix}', 'org-${suffix}', 'candidate-user-${suffix}', '{}', now(), now());
    INSERT INTO courses (id, organization_id, name, code, description, created_at, updated_at)
    VALUES ('course-${suffix}', 'org-${suffix}', 'Course', 'course-${suffix}', '', now(), now());
    INSERT INTO exams (id, organization_id, title, description, course_id, status, timing_mode,
      duration_minutes, open_at, close_at, passing_score, total_score,
      question_selection_mode, question_ids, question_snapshot, control_flags,
      retake_policy, score_strategy, max_attempts, created_at, updated_at)
    VALUES ('exam-${suffix}', 'org-${suffix}', 'Exam', '', 'course-${suffix}', 'open', 'timed_window',
      60, now(), now(), 60, 100, 'manual', '[]', '[]', '{}'::jsonb,
      'none', 'latest', 1, now(), now());
    INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
    VALUES ('enrollment-${suffix}', 'org-${suffix}', 'exam-${suffix}', 'candidate-${suffix}', 'open', 0, now(), now());
    INSERT INTO exam_attempts (id, organization_id, exam_id, enrollment_id, candidate_id, attempt_no,
      status, question_snapshot, answers, created_at, updated_at)
    VALUES ('attempt-${suffix}', 'org-${suffix}', 'exam-${suffix}', 'enrollment-${suffix}', 'candidate-${suffix}', 1,
      'disrupted', '[]', '[]', now(), now());
  `);
}

async function insertOpenEpisode(
  env: Env,
  suffix: string,
  interruptionId: string,
  detectedAt: string,
): Promise<void> {
  await env.conn.sql.unsafe(`
    INSERT INTO attempt_interruptions (id, organization_id, attempt_id, created_at)
    VALUES ('${interruptionId}', 'org-${suffix}', 'attempt-${suffix}', '${detectedAt}');
    INSERT INTO attempt_interruption_events (
      id, organization_id, attempt_id, interruption_id, event_type, occurred_at,
      observed_last_activity_at, detection_source, timeout_seconds, policy,
      eligible_seconds, time_adjustment_id, actor_id, reason_code, created_at
    ) VALUES (
      'event-${interruptionId}', 'org-${suffix}', 'attempt-${suffix}', '${interruptionId}', 'detected', '${detectedAt}',
      NULL, 'migration_backfill', NULL, 'strict', NULL, NULL, NULL,
      'migration_backfill_unknown_detected_at', '${detectedAt}'
    );
  `);
}

// ============================================================
// A. Fresh: empty schema (post-migrate, no business data) — 0027 is a no-op
// ============================================================
describe("0027 convergence — A. fresh schema", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027fresh");
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("runs 0027 as a no-op verify on an empty post-migrate schema", async () => {
    await run0027(env.conn);
    // Postconditions hold on a fresh schema.
    const gs = await scalar<string>(
      env.conn,
      `SELECT atttypid::regtype FROM pg_attribute WHERE attrelid='exam_attempts'::regclass AND attname='grading_status'`,
    );
    expect(gs).toBe("text");
    const proctor = await scalar<string>(
      env.conn,
      `SELECT to_regclass('exam_proctor_assignments')::regclass::text`,
    );
    expect(proctor).toBe("exam_proctor_assignments");
    const events = await scalar<string>(
      env.conn,
      `SELECT to_regclass('exam_proctor_assignment_events')::regclass::text`,
    );
    expect(events).toBe("exam_proctor_assignment_events");
    const check = await scalar<string>(
      env.conn,
      `SELECT conname FROM pg_constraint WHERE conrelid='exam_attempts'::regclass AND conname='exam_attempts_status_pointer_check'`,
    );
    expect(check).toBe("exam_attempts_status_pointer_check");
  });
});

// ============================================================
// B. Healthy: fully converged — 0027 is a pure verify no-op
// ============================================================
describe("0027 convergence — B. healthy schema", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027healthy");
    // Seed a minimal organization + user, then a full fixture chain so we can
    // create an exam_attempts row with an EXPLICIT non-default grading_status.
    // This exercises the convergence's "do not overwrite a legit value" path.
    await env.conn.sql.unsafe(`
      INSERT INTO organizations (id, name, display_name, slug, created_at, updated_at)
      VALUES ('org-b', 'OrgB', 'OrgB', 'org-b', now(), now());
      INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at)
      VALUES ('u-b', 'org-b', 'ub', 'h', 'UB', 'Admin', true, now(), now()),
             ('c-b', 'org-b', 'cb', 'h', 'CB', 'Candidate', true, now(), now());
      INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at)
      VALUES ('cp-b', 'org-b', 'c-b', '{}', now(), now());
      INSERT INTO courses (id, organization_id, name, code, description, created_at, updated_at)
      VALUES ('co-b', 'org-b', 'C', 'cb', '', now(), now());
      INSERT INTO exams (id, organization_id, title, description, course_id, status, timing_mode,
        duration_minutes, open_at, close_at, passing_score, total_score,
        question_selection_mode, question_ids, question_snapshot, control_flags,
        retake_policy, score_strategy, max_attempts, created_at, updated_at)
      VALUES ('ex-b', 'org-b', 'E', '', 'co-b', 'open', 'timed_window',
        60, now(), now(), 60, 100, 'manual', '[]', '[]', '{}'::jsonb,
        'none', 'latest', 1, now(), now());
      INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
      VALUES ('en-b', 'org-b', 'ex-b', 'cp-b', 'open', 0, now(), now());
      INSERT INTO exam_attempts (id, organization_id, exam_id, enrollment_id, candidate_id, attempt_no,
        status, grading_status, question_snapshot, answers, created_at, updated_at)
      VALUES ('at-b', 'org-b', 'ex-b', 'en-b', 'cp-b', 1, 'graded', 'manual_graded', '[]', '[]', now(), now());
    `);
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("is a verify no-op: counts unchanged AND a legit non-default grading_status is preserved", async () => {
    const beforeProctor = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM exam_proctor_assignments`,
    );
    const beforeGs = await scalar<string>(
      env.conn,
      `SELECT grading_status AS v FROM exam_attempts WHERE id='at-b'`,
    );
    await run0027(env.conn);
    const afterProctor = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM exam_proctor_assignments`,
    );
    const afterGs = await scalar<string>(
      env.conn,
      `SELECT grading_status AS v FROM exam_attempts WHERE id='at-b'`,
    );
    expect(afterProctor).toBe(beforeProctor);
    // The convergence backfills only NULL grading_status values; a legit
    // 'manual_graded' must be untouched, not reset to the 'auto_graded' default.
    expect(beforeGs).toBe("manual_graded");
    expect(afterGs).toBe("manual_graded");
  });
});

// ============================================================
// C. Missing 0024: drop proctor tables + exams_org_id_unique → 0027 recreates
// ============================================================
describe("0027 convergence — C. missing 0024 proctor tables", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027no0024");
    // Simulate the skip: drop the 0024 objects that 0023+ would have recorded
    // a later created_at for, so a plain migrate would never re-add them.
    await env.conn.sql.unsafe(`
      DROP TABLE IF EXISTS exam_proctor_assignment_events CASCADE;
      DROP TABLE IF EXISTS exam_proctor_assignments CASCADE;
      DROP INDEX IF EXISTS exams_org_id_unique;
    `);
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("recreates both proctor tables, indexes, FKs, and exams_org_id_unique", async () => {
    await run0027(env.conn);

    // Tables present.
    expect(
      await scalar(env.conn, `SELECT to_regclass('exam_proctor_assignments')`),
    ).toBe("exam_proctor_assignments");
    expect(
      await scalar(
        env.conn,
        `SELECT to_regclass('exam_proctor_assignment_events')`,
      ),
    ).toBe("exam_proctor_assignment_events");

    // Composite-FK target index present and unique.
    const uniqueFlag = await scalar<boolean>(
      env.conn,
      `SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
       WHERE i.indrelid='exams'::regclass AND c.relname='exams_org_id_unique'`,
    );
    expect(uniqueFlag).toBe(true);

    // FKs present and validated.
    const fkCount = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint
       WHERE conrelid='exam_proctor_assignments'::regclass AND contype='f'`,
    );
    expect(fkCount).toBe(5);
    const eventFkCount = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint
       WHERE conrelid='exam_proctor_assignment_events'::regclass AND contype='f'`,
    );
    expect(eventFkCount).toBe(3);

    // All FKs validated (convalidated = true).
    const invalidFks = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint
       WHERE (conrelid='exam_proctor_assignments'::regclass OR conrelid='exam_proctor_assignment_events'::regclass)
         AND contype='f' AND NOT convalidated`,
    );
    expect(invalidFks).toBe(0);

    // Representative indexes present (schema-scoped like Scenario H).
    const idxCount = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename IN ('exam_proctor_assignments','exam_proctor_assignment_events')`,
    );
    // assignments: pkey + 5 indexes; events: pkey + 2 indexes = 9 total
    expect(idxCount).toBe(9);
  });
});

// ============================================================
// D. Missing 0022: drop status_pointer_check + I1 transitional rows → repairs
// ============================================================
describe("0027 convergence — D. missing 0022 status/pointer CHECK", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027no0022");
    // Simulate the skip: drop the 0022 CHECK. (0021 tables/columns remain,
    // which is exactly the state of a DB that has 0021 but skipped 0022.)
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_pointer_check;
    `);
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("installs the status/pointer CHECK on a schema missing it", async () => {
    await run0027(env.conn);
    const check = await scalar<string>(
      env.conn,
      `SELECT conname FROM pg_constraint WHERE conrelid='exam_attempts'::regclass AND conname='exam_attempts_status_pointer_check' AND contype='c'`,
    );
    expect(check).toBe("exam_attempts_status_pointer_check");
  });

  it("creates a disrupted episode for an I1 transitional attempt (no pointer)", async () => {
    // Re-drop the CHECK so we can insert a transitional row it would forbid,
    // then re-run 0027 to confirm episode creation.
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_pointer_check;
      INSERT INTO organizations (id, name, display_name, slug, created_at, updated_at)
      VALUES ('org-d', 'OrgD', 'OrgD', 'org-d', now(), now()) ON CONFLICT DO NOTHING;
      INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at)
      VALUES ('u-d', 'org-d', 'ud', 'h', 'UD', 'Admin', true, now(), now()),
             ('c-d', 'org-d', 'cd', 'h', 'CD', 'Candidate', true, now(), now())
      ON CONFLICT DO NOTHING;
    `);
    // Candidate profile (candidate_id in exam_enrollments references this).
    await env.conn.sql.unsafe(`
      INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at)
      VALUES ('cp-d', 'org-d', 'c-d', '{}', now(), now()) ON CONFLICT DO NOTHING;
    `);
    // Course + exam with all NOT-NULL columns.
    await env.conn.sql.unsafe(`
      INSERT INTO courses (id, organization_id, name, code, description, created_at, updated_at)
      VALUES ('co-d', 'org-d', 'C', 'cd', '', now(), now()) ON CONFLICT DO NOTHING;
      INSERT INTO exams (id, organization_id, title, description, course_id, status, timing_mode,
        duration_minutes, open_at, close_at, passing_score, total_score,
        question_selection_mode, question_ids, question_snapshot, control_flags,
        retake_policy, score_strategy, max_attempts, created_at, updated_at)
      VALUES ('ex-d', 'org-d', 'E', '', 'co-d', 'open', 'timed_window',
        60, now(), now(), 60, 100,
        'manual', '[]', '[]', '{}'::jsonb,
        'none', 'latest', 1, now(), now())
      ON CONFLICT DO NOTHING;
      INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
      VALUES ('en-d', 'org-d', 'ex-d', 'cp-d', 'open', 0, now(), now()) ON CONFLICT DO NOTHING;
    `);
    // Insert a disrupted attempt WITHOUT a pointer (the I1 transitional state).
    await env.conn.sql.unsafe(`
      INSERT INTO exam_attempts (id, organization_id, exam_id, enrollment_id, candidate_id, attempt_no,
        status, question_snapshot, answers, created_at, updated_at)
      VALUES ('at-d', 'org-d', 'ex-d', 'en-d', 'cp-d', 1, 'disrupted', '[]', '[]', now(), now())
      ON CONFLICT DO NOTHING;
    `);

    await run0027(env.conn);

    // The disrupted attempt now has an authoritative episode + detected event.
    const ptr = await scalar<string>(
      env.conn,
      `SELECT current_interruption_id::text FROM exam_attempts WHERE id='at-d'`,
    );
    expect(ptr).toBeTruthy();
    const detected = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM attempt_interruption_events e
       JOIN attempt_interruptions p ON p.id = e.interruption_id
       WHERE p.attempt_id='at-d' AND e.event_type='detected'`,
    );
    expect(detected).toBe(1);
    // CHECK re-installed.
    const check = await scalar<string>(
      env.conn,
      `SELECT conname FROM pg_constraint WHERE conrelid='exam_attempts'::regclass AND conname='exam_attempts_status_pointer_check'`,
    );
    expect(check).toBe("exam_attempts_status_pointer_check");
  });
});

// ============================================================
// E. Missing 0004: drop grading_status column → 0027 re-adds + backfills
// ============================================================
describe("0027 convergence — E. missing 0004 grading_status column", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027no0004");
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_attempts DROP COLUMN IF EXISTS grading_status;
    `);
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("re-adds grading_status as nullable text with 'auto_graded' default", async () => {
    await run0027(env.conn);
    const rows = (await env.conn.sql.unsafe(`
        SELECT a.atttypid::regtype::text AS type, a.attnotnull AS notnull,
               pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid='exam_attempts'::regclass AND a.attname='grading_status' AND NOT a.attisdropped
      `)) as unknown as Array<{
      type: string;
      notnull: boolean;
      def: string | null;
    }>;
    const row = rows[0];
    expect(row?.type).toBe("text");
    expect(row?.notnull).toBe(false);
    expect(row?.def).toContain("auto_graded");
  });
});

// ============================================================
// F. Partial supported: assignments present, events table + FKs absent
// ============================================================
describe("0027 convergence — F. partial supported (events table absent)", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027partial");
    // Drop only the events table (assignments stays, exact-shape). This is the
    // supported partial state: assignments validated, events created + FKs added.
    await env.conn.sql.unsafe(`
      DROP TABLE IF EXISTS exam_proctor_assignment_events CASCADE;
    `);
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("recreates the events table and its FK to the existing assignments table", async () => {
    await run0027(env.conn);
    expect(
      await scalar(
        env.conn,
        `SELECT to_regclass('exam_proctor_assignment_events')`,
      ),
    ).toBe("exam_proctor_assignment_events");
    const eventFkCount = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint
       WHERE conrelid='exam_proctor_assignment_events'::regclass AND contype='f'`,
    );
    expect(eventFkCount).toBe(3);
    const assignFkCount = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint
       WHERE conrelid='exam_proctor_assignments'::regclass AND contype='f'`,
    );
    expect(assignFkCount).toBe(5);
  });
});

// ============================================================
// G. Partial incompatible: wrong column type → 0027 fails closed
// ============================================================
describe("0027 convergence — G. partial incompatible (wrong column type)", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027incompat");
    // Sabotage: recreate exam_proctor_assignments with status as integer.
    await env.conn.sql.unsafe(`
      DROP TABLE IF EXISTS exam_proctor_assignment_events CASCADE;
      DROP TABLE IF EXISTS exam_proctor_assignments CASCADE;
      CREATE TABLE exam_proctor_assignments (
        "id" text PRIMARY KEY NOT NULL,
        "organization_id" text NOT NULL,
        "exam_id" text NOT NULL,
        "proctor_user_id" text NOT NULL,
        "status" integer NOT NULL,
        "assigned_by" text NOT NULL,
        "assigned_at" timestamp with time zone NOT NULL,
        "revoked_by" text,
        "revoked_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("fails closed with an incompatible-shape error (transaction rolls back)", async () => {
    await expect(run0027(env.conn)).rejects.toThrow(
      /incompatible column shape/,
    );
    // The events table must NOT have been created (failure rolled back).
    expect(
      await scalar(
        env.conn,
        `SELECT to_regclass('exam_proctor_assignment_events')`,
      ),
    ).toBeNull();
  });

  it(
    "fails closed when a required column is missing (not a raw missing-column DB error)",
    // This case is the only one that bootstraps a SECOND isolated schema
    // inside the test body (makeEnv → full migrate → sabotage DDL). Under
    // full-suite coverage contention that can exceed the 5s default
    // (BUG-FLAKE-001 family; issue #280) — heavier budget for this specific
    // test per the packages/db vitest.config.ts stress-note pattern, not a
    // package-wide override.
    { timeout: 15_000 },
    async () => {
      // A table that omits exam_id but keeps every other expected column. Before
      // the count=11 set-equality fix this slipped past the B1 subset check (every
      // remaining column was still in the allow-list) and only failed later in B2
      // with a raw "column does not exist" error during index CREATE. With the
      // fix it must be rejected up front with the named 0027-B1 shape error.
      const env2 = await makeEnv("mig0027incompat2");
      try {
        await env2.conn.sql.unsafe(`
          DROP TABLE IF EXISTS exam_proctor_assignment_events CASCADE;
          DROP TABLE IF EXISTS exam_proctor_assignments CASCADE;
          CREATE TABLE exam_proctor_assignments (
            "id" text PRIMARY KEY NOT NULL,
            "organization_id" text NOT NULL,
            "proctor_user_id" text NOT NULL,
            "status" text DEFAULT 'active' NOT NULL,
            "assigned_by" text NOT NULL,
            "assigned_at" timestamp with time zone NOT NULL,
            "revoked_by" text,
            "revoked_at" timestamp with time zone,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL,
            "updated_at" timestamp with time zone DEFAULT now() NOT NULL
          );
        `);
        await expect(run0027(env2.conn)).rejects.toThrow(
          /0027-B1: exam_proctor_assignments exists with an incompatible column shape/,
        );
      } finally {
        await teardown(env2);
      }
    },
  );
});

// ============================================================
// H. Repeat safety: re-running 0027 on a converged schema → no drift
// ============================================================
describe("0027 convergence — H. repeat safety", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027repeat");
  });
  afterAll(async () => {
    await teardown(env);
  });

  it("re-running 0027 produces no duplicate objects or row drift", async () => {
    // First run (converged schema → verify no-op).
    await run0027(env.conn);
    const indexesBefore = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename IN ('exam_proctor_assignments','exam_proctor_assignment_events','exams')`,
    );
    const constraintsBefore = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = current_schema()
         AND c.conrelid IN ('exam_proctor_assignments'::regclass,'exam_proctor_assignment_events'::regclass,'exam_attempts'::regclass)`,
    );
    const checksBefore = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = current_schema()
         AND c.conrelid='exam_attempts'::regclass
         AND c.conname='exam_attempts_status_pointer_check'`,
    );

    // Second run (must be identical).
    await run0027(env.conn);
    const indexesAfter = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_indexes
       WHERE schemaname = current_schema()
         AND tablename IN ('exam_proctor_assignments','exam_proctor_assignment_events','exams')`,
    );
    const constraintsAfter = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = current_schema()
         AND c.conrelid IN ('exam_proctor_assignments'::regclass,'exam_proctor_assignment_events'::regclass,'exam_attempts'::regclass)`,
    );
    const checksAfter = await scalar<number>(
      env.conn,
      `SELECT count(*)::int FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = current_schema()
         AND c.conrelid='exam_attempts'::regclass
         AND c.conname='exam_attempts_status_pointer_check'`,
    );

    expect(indexesAfter).toBe(indexesBefore);
    expect(constraintsAfter).toBe(constraintsBefore);
    expect(checksAfter).toBe(checksBefore);
    expect(checksAfter).toBe(1);
  });
});

describe("0027 convergence — I. exact 0024 authoritative effects", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027exact0024");
  }, 60_000);
  afterAll(async () => {
    if (env) await teardown(env);
  }, 60_000);

  it("adds a missing assignments primary key", async () => {
    await env.conn.sql.unsafe(
      `ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_pkey`,
    );
    await run0027(env.conn);
    expect(
      await scalar<string>(
        env.conn,
        `SELECT contype FROM pg_constraint
         WHERE conrelid='exam_proctor_assignments'::regclass
           AND conname='exam_proctor_assignments_pkey'`,
      ),
    ).toBe("p");
  });

  it("adds a missing assignment-events primary key", async () => {
    await env.conn.sql.unsafe(
      `ALTER TABLE exam_proctor_assignment_events DROP CONSTRAINT exam_proctor_assignment_events_pkey`,
    );
    await run0027(env.conn);
    expect(
      await scalar<string>(
        env.conn,
        `SELECT contype FROM pg_constraint
         WHERE conrelid='exam_proctor_assignment_events'::regclass
           AND conname='exam_proctor_assignment_events_pkey'`,
      ),
    ).toBe("p");
  });

  it("fails closed on a wrong status default", async () => {
    try {
      await env.conn.sql.unsafe(
        `ALTER TABLE exam_proctor_assignments ALTER COLUMN status SET DEFAULT 'revoked'`,
      );
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments\.status default is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(
        `ALTER TABLE exam_proctor_assignments ALTER COLUMN status SET DEFAULT 'active'`,
      );
    }
  });

  it("adds a missing status CHECK", async () => {
    await env.conn.sql.unsafe(
      `ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_status_check`,
    );
    await run0027(env.conn);
    expect(
      await scalar<string>(
        env.conn,
        `SELECT contype FROM pg_constraint
         WHERE conrelid='exam_proctor_assignments'::regclass
           AND conname='exam_proctor_assignments_status_check'`,
      ),
    ).toBe("c");
  });

  it("fails closed on a wrong same-named status CHECK", async () => {
    try {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_status_check;
        ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_status_check
          CHECK (status IN ('active', 'revoked', 'invalid'));
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments_status_check is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_status_check;
        ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_status_check
          CHECK (status IN ('active', 'revoked'));
      `);
    }
  });

  it("validates an exact business CHECK created NOT VALID", async () => {
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_status_check;
      ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_status_check
        CHECK (status IN ('active', 'revoked')) NOT VALID;
    `);
    await run0027(env.conn);
    expect(
      await scalar<boolean>(
        env.conn,
        `SELECT convalidated FROM pg_constraint
         WHERE conrelid='exam_proctor_assignments'::regclass
           AND conname='exam_proctor_assignments_status_check'`,
      ),
    ).toBe(true);
  });

  it("fails closed when active_unique is not unique", async () => {
    try {
      await env.conn.sql.unsafe(`
        DROP INDEX exam_proctor_assignments_active_unique;
        CREATE INDEX exam_proctor_assignments_active_unique
          ON exam_proctor_assignments (organization_id, exam_id, proctor_user_id)
          WHERE status = 'active';
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments_active_unique is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(`
        DROP INDEX exam_proctor_assignments_active_unique;
        CREATE UNIQUE INDEX exam_proctor_assignments_active_unique
          ON exam_proctor_assignments (organization_id, exam_id, proctor_user_id)
          WHERE status = 'active';
      `);
    }
  });

  it("fails closed when active_unique has the wrong predicate", async () => {
    try {
      await env.conn.sql.unsafe(`
        DROP INDEX exam_proctor_assignments_active_unique;
        CREATE UNIQUE INDEX exam_proctor_assignments_active_unique
          ON exam_proctor_assignments (organization_id, exam_id, proctor_user_id)
          WHERE status = 'revoked';
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments_active_unique is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(`
        DROP INDEX exam_proctor_assignments_active_unique;
        CREATE UNIQUE INDEX exam_proctor_assignments_active_unique
          ON exam_proctor_assignments (organization_id, exam_id, proctor_user_id)
          WHERE status = 'active';
      `);
    }
  });

  it("fails closed when a secondary index has the wrong sort direction", async () => {
    try {
      await env.conn.sql.unsafe(`
        DROP INDEX exam_proctor_assignments_revoke_target_idx;
        CREATE INDEX exam_proctor_assignments_revoke_target_idx
          ON exam_proctor_assignments
          (organization_id, exam_id, proctor_user_id, status, revoked_at ASC, id DESC);
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments_revoke_target_idx is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(`
        DROP INDEX exam_proctor_assignments_revoke_target_idx;
        CREATE INDEX exam_proctor_assignments_revoke_target_idx
          ON exam_proctor_assignments
          (organization_id, exam_id, proctor_user_id, status, revoked_at DESC, id DESC);
      `);
    }
  });

  it("fails closed when a same-named FK points to the wrong table", async () => {
    try {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_proctor_user_fk;
        ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_proctor_user_fk
          FOREIGN KEY (proctor_user_id) REFERENCES organizations(id);
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments_proctor_user_fk is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_proctor_user_fk;
        ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_proctor_user_fk
          FOREIGN KEY (proctor_user_id) REFERENCES users(id);
      `);
    }
  });

  it("fails closed when a same-named FK points to the wrong target column", async () => {
    try {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_org_fk;
        ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_org_fk
          FOREIGN KEY (organization_id) REFERENCES organizations(slug);
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_proctor_assignments_org_fk is incompatible/,
      );
    } finally {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_org_fk;
        ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_org_fk
          FOREIGN KEY (organization_id) REFERENCES organizations(id);
      `);
    }
  });

  it("validates an exact same-named FK created NOT VALID", async () => {
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_proctor_assignments DROP CONSTRAINT exam_proctor_assignments_proctor_user_fk;
      ALTER TABLE exam_proctor_assignments ADD CONSTRAINT exam_proctor_assignments_proctor_user_fk
        FOREIGN KEY (proctor_user_id) REFERENCES users(id) NOT VALID;
    `);
    await run0027(env.conn);
    expect(
      await scalar<boolean>(
        env.conn,
        `SELECT convalidated FROM pg_constraint
         WHERE conrelid='exam_proctor_assignments'::regclass
           AND conname='exam_proctor_assignments_proctor_user_fk'`,
      ),
    ).toBe(true);
  });
});

describe("0027 convergence — J. open interruption episode reuse", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027episodes");
  }, 60_000);
  afterAll(async () => {
    if (env) await teardown(env);
  }, 60_000);

  it("reuses one legal open episode without inserting rows", async () => {
    const interruptionId = "00000000-0000-4000-8000-000000000101";
    await seedDisruptedAttempt(env, "reuse");
    await insertOpenEpisode(
      env,
      "reuse",
      interruptionId,
      "2026-08-05T10:00:00Z",
    );
    await run0027(env.conn);
    expect(
      await scalar<string>(
        env.conn,
        `SELECT current_interruption_id::text AS v FROM exam_attempts WHERE id='attempt-reuse'`,
      ),
    ).toBe(interruptionId);
    expect(
      await scalar<number>(
        env.conn,
        `SELECT count(*)::int AS v FROM attempt_interruptions WHERE attempt_id='attempt-reuse'`,
      ),
    ).toBe(1);
    expect(
      await scalar<number>(
        env.conn,
        `SELECT count(*)::int AS v FROM attempt_interruption_events WHERE attempt_id='attempt-reuse'`,
      ),
    ).toBe(1);
  });

  it("fails closed when a disrupted attempt has multiple legal open episodes", async () => {
    await seedDisruptedAttempt(env, "multiple");
    await insertOpenEpisode(
      env,
      "multiple",
      "00000000-0000-4000-8000-000000000201",
      "2026-08-05T10:00:00Z",
    );
    await insertOpenEpisode(
      env,
      "multiple",
      "00000000-0000-4000-8000-000000000202",
      "2026-08-05T10:01:00Z",
    );
    await expect(run0027(env.conn)).rejects.toThrow(
      /multiple legal open interruption episodes/,
    );
  });
});

describe("0027 convergence — K. exact status-pointer CHECK", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeEnv("mig0027exactcheck");
  }, 60_000);
  afterAll(async () => {
    if (env) await teardown(env);
  }, 60_000);

  async function restoreStatusPointerCheck(): Promise<void> {
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_pointer_check;
      ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_pointer_check CHECK (
        (status = 'disrupted' AND current_interruption_id IS NOT NULL AND interrupted_at IS NOT NULL)
        OR (status != 'disrupted' AND current_interruption_id IS NULL AND interrupted_at IS NULL)
      );
    `);
  }

  it("fails closed on a same-named authoritative expression widened by OR true", async () => {
    try {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_status_pointer_check;
        ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_pointer_check CHECK (
          ((status = 'disrupted' AND current_interruption_id IS NOT NULL AND interrupted_at IS NOT NULL)
          OR (status != 'disrupted' AND current_interruption_id IS NULL AND interrupted_at IS NULL))
          OR true
        );
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_attempts_status_pointer_check is incompatible/,
      );
    } finally {
      await restoreStatusPointerCheck();
    }
  });

  it("fails closed on the right predicates with the wrong grouping", async () => {
    try {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_status_pointer_check;
        ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_pointer_check CHECK (
          (status = 'disrupted' AND current_interruption_id IS NOT NULL)
          OR (interrupted_at IS NOT NULL AND status != 'disrupted'
              AND current_interruption_id IS NULL AND interrupted_at IS NULL)
        );
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_attempts_status_pointer_check is incompatible/,
      );
    } finally {
      await restoreStatusPointerCheck();
    }
  });

  it("fails closed on an exact status-pointer CHECK that is NOT ENFORCED", async () => {
    try {
      await env.conn.sql.unsafe(`
        ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_status_pointer_check;
        ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_pointer_check CHECK (
          (status = 'disrupted' AND current_interruption_id IS NOT NULL AND interrupted_at IS NOT NULL)
          OR (status != 'disrupted' AND current_interruption_id IS NULL AND interrupted_at IS NULL)
        ) NOT ENFORCED;
      `);
      await expect(run0027(env.conn)).rejects.toThrow(
        /exam_attempts_status_pointer_check is incompatible/,
      );
    } finally {
      await restoreStatusPointerCheck();
    }
  });

  it("validates an exact status-pointer CHECK created NOT VALID", async () => {
    await env.conn.sql.unsafe(`
      ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_status_pointer_check;
      ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_pointer_check CHECK (
        (status = 'disrupted' AND current_interruption_id IS NOT NULL AND interrupted_at IS NOT NULL)
        OR (status != 'disrupted' AND current_interruption_id IS NULL AND interrupted_at IS NULL)
      ) NOT VALID;
    `);
    await run0027(env.conn);
    expect(
      await scalar<boolean>(
        env.conn,
        `SELECT convalidated FROM pg_constraint
         WHERE conrelid='exam_attempts'::regclass
           AND conname='exam_attempts_status_pointer_check'`,
      ),
    ).toBe(true);
  });
});
