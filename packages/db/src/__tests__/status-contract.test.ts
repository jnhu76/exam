import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  AttemptStatus,
  EnrollmentStatus,
  ExamStatus,
  GradingStatus,
} from "@exam/domain";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { createDatabase } from "../database.js";
import { withTestInfraLifecycleLock } from "../testInfraLock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations/postgres");
const STATUS_CHECK_TAG = "0043_persisted_state_status_checks";

/**
 * EXAM-542 persisted-state contract — real-DB verification that
 *
 *   accepted domain vocabulary == DB allowed vocabulary
 *
 * for exams.status, exam_enrollments.status, exam_attempts.status and
 * exam_attempts.grading_status. Three layers:
 *
 * 1. INTEGRITY — direct SQL writes against the fully-migrated schema: valid
 *    current + reserved values pass, arbitrary values are rejected by the DB
 *    (not by TypeScript), and the `grading` fossil is rejected.
 * 2. DRIFT — the CHECK value sets are parsed out of pg_constraint and
 *    compared to the @exam/domain enums, so the domain enum stays the single
 *    semantic vocabulary owner and any divergence fails here.
 * 3. MIGRATION SAFETY — a simulated 0042-state database containing a legacy
 *    `status='grading'` row: the 0043 preflight FAILS CLOSED, rewrites
 *    nothing, installs nothing; after the operator explicitly dispositions
 *    the row, the same statements converge (forward-fix only — this repo's
 *    migration policy has no downgrades).
 */

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

const STATUS_CHECK_NAMES = [
  "exams_status_check",
  "exam_enrollments_status_check",
  "exam_attempts_status_check",
  "exam_attempts_grading_status_check",
] as const;

describe("EXAM-542 status-contract — DB CHECKs, drift, migration safety", () => {
  const isoRef: { iso?: IsolatedTestDb; sql?: postgres.Sql } = {};
  let sql: postgres.Sql;
  let orgId: string;
  let courseId: string;
  let examId: string;
  let userId: string;
  let candidateId: string;
  let enrollmentId: string;
  let attemptCounter: number;
  const insertedAttemptIds: string[] = [];

  async function constraintDef(conname: string): Promise<string | undefined> {
    // pg_constraint is cluster-global and sibling workers create the same
    // constraint names in their own schemas — resolve the relations through
    // THIS schema's search_path so only our own constraint row can match
    // (and no dropped sibling relation can be dereferenced).
    const res = await sql`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = ${conname}
        AND conrelid IN (
          'exams'::regclass,
          'exam_enrollments'::regclass,
          'exam_attempts'::regclass
        )
    `;
    const row = res[0] as { def: string } | undefined;
    return row?.def;
  }

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({ namespace: "mig542" });
    const conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await applyAllMigrations(conn.sql, iso.databaseUrl);
    isoRef.iso = iso;
    sql = conn.sql;
    attemptCounter = 0;

    // Minimal fixture: one org → course → exam → candidate → enrollment.
    orgId = `542-org-${Date.now()}`;
    courseId = `542-course-${Date.now()}`;
    examId = `542-exam-${Date.now()}`;
    userId = `542-user-${Date.now()}`;
    candidateId = `542-cand-${Date.now()}`;
    enrollmentId = `542-enr-${Date.now()}`;
    const now = new Date().toISOString();
    await sql.unsafe(
      `INSERT INTO organizations (id, name, display_name, slug, created_at, updated_at)
       VALUES ('${orgId}', '542 Org', '542 Org', '542-org', '${now}', '${now}')`,
    );
    await sql.unsafe(
      `INSERT INTO courses (id, organization_id, name, code, description, created_at, updated_at)
       VALUES ('${courseId}', '${orgId}', '542 Course', '542C', '', '${now}', '${now}')`,
    );
    await sql.unsafe(
      `INSERT INTO exams (id, organization_id, title, description, course_id, status, timing_mode,
         duration_minutes, open_at, close_at, passing_score, total_score, question_selection_mode,
         question_ids, question_snapshot, control_flags, retake_policy, score_strategy, max_attempts,
         result_publication_mode, interruption_time_policy, created_at, updated_at)
       VALUES ('${examId}', '${orgId}', '542 Exam', '', '${courseId}', 'open', 'timed_window',
         60, '${now}', '${now}', 0, 100, 'manual', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
         'unlimited', 'highest', 3, 'immediate', 'strict', '${now}', '${now}')`,
    );
    await sql.unsafe(
      `INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at)
       VALUES ('${userId}', '${orgId}', '542-user', 'hash', '542 User', 'Candidate', true, '${now}', '${now}')`,
    );
    await sql.unsafe(
      `INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at)
       VALUES ('${candidateId}', '${orgId}', '${userId}', '{}'::jsonb, '${now}', '${now}')`,
    );
    await sql.unsafe(
      `INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
       VALUES ('${enrollmentId}', '${orgId}', '${examId}', '${candidateId}', 'started', 0, '${now}', '${now}')`,
    );
  }, 180_000);

  afterAll(async () => {
    await isoRef.sql?.end().catch(() => {});
    await isoRef.iso?.cleanup().catch(() => {});
  }, 30_000);

  /** Inserts one attempt row with the given status (+ optional grading status). */
  async function insertAttempt(
    status: string,
    opts: { gradingStatus?: string | null; withPointers?: boolean } = {},
  ): Promise<string> {
    attemptCounter += 1;
    const id = `542-att-${attemptCounter}`;
    const gradingStatus =
      opts.gradingStatus === undefined
        ? `'auto_graded'`
        : opts.gradingStatus === null
          ? `NULL`
          : `'${opts.gradingStatus}'`;
    await sql.unsafe(
      `INSERT INTO exam_attempts (id, organization_id, exam_id, enrollment_id, candidate_id,
         attempt_no, status, question_snapshot, answers, grading_status)
       VALUES ('${id}', '${orgId}', '${examId}', '${enrollmentId}', '${candidateId}',
         ${attemptCounter}, '${opts.withPointers ? "in_progress" : status}', '[]'::jsonb, '[]'::jsonb, ${gradingStatus})`,
    );
    if (opts.withPointers) {
      // A disrupted row needs a REAL interruption episode: the attempt→
      // interruption composite FK resolves after the attempt row exists, and
      // the pointer pair must exist before the status flips to `disrupted`.
      const iid = crypto.randomUUID();
      await sql.unsafe(
        `INSERT INTO attempt_interruptions (id, organization_id, attempt_id, created_at)
         VALUES ('${iid}', '${orgId}', '${id}', now())`,
      );
      await sql.unsafe(
        `UPDATE exam_attempts SET status = 'disrupted',
           current_interruption_id = '${iid}', interrupted_at = now()
         WHERE id = '${id}'`,
      );
    }
    insertedAttemptIds.push(id);
    return id;
  }

  it("installs the four status CHECK constraints", async () => {
    for (const conname of STATUS_CHECK_NAMES) {
      const def = await constraintDef(conname);
      expect(def, conname).toBeDefined();
    }
  });

  it("accepts every current and reserved attempt status, including historical NULL grading_status", async () => {
    // CURRENT_REACHABLE / CURRENT_TERMINAL + reserved vocabulary. `disrupted`
    // is excluded here: it additionally requires the interruption pointer
    // pair (exam_attempts_status_pointer_check) and is inserted right after.
    for (const status of Object.values(AttemptStatus)) {
      if (status === "disrupted") continue;
      await expect(insertAttempt(status)).resolves.toBeDefined();
    }
    await expect(
      insertAttempt("disrupted", { withPointers: true }),
    ).resolves.toBeDefined();
    // grading_status NULL is the legacy shape — legal, never rewritten.
    await expect(
      insertAttempt("submitted", { gradingStatus: null }),
    ).resolves.toBeDefined();
    await expect(
      insertAttempt("graded", { gradingStatus: "fully_graded" }),
    ).resolves.toBeDefined();
  });

  it("rejects the grading fossil and arbitrary unknown values at the DB layer", async () => {
    // The disposed fossil: no runtime writer since the lifecycle converged,
    // and now the DB itself refuses it.
    await expect(insertAttempt("grading")).rejects.toThrow(
      /exam_attempts_status_check/,
    );
    await expect(insertAttempt("bogus")).rejects.toThrow(
      /exam_attempts_status_check/,
    );
    await expect(insertAttempt("IN_PROGRESS")).rejects.toThrow(
      /exam_attempts_status_check/,
    );
    await expect(
      insertAttempt("submitted", { gradingStatus: "bogus" }),
    ).rejects.toThrow(/exam_attempts_grading_status_check/);
  });

  it("rejects unknown exam and enrollment status values at the DB layer", async () => {
    const now = new Date().toISOString();
    await expect(
      sql.unsafe(
        `INSERT INTO exams (id, organization_id, title, description, course_id, status, timing_mode,
           duration_minutes, open_at, close_at, passing_score, total_score, question_selection_mode,
           question_ids, question_snapshot, control_flags, retake_policy, score_strategy, max_attempts,
           result_publication_mode, interruption_time_policy, created_at, updated_at)
         VALUES ('542-exam-bad', '${orgId}', 'bad', '', '${courseId}', 'activ', 'timed_window',
           60, '${now}', '${now}', 0, 100, 'manual', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
           'unlimited', 'highest', 3, 'immediate', 'strict', '${now}', '${now}')`,
      ),
    ).rejects.toThrow(/exams_status_check/);
    await expect(
      sql.unsafe(
        `INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
         VALUES ('542-enr-bad', '${orgId}', '${examId}', '${candidateId}', 'enrolled', 0, '${now}', '${now}')`,
      ),
    ).rejects.toThrow(/exam_enrollments_status_check/);
    // The reserved enrollment target stays legal (own candidate row: the
    // org+exam+candidate unique key allows one enrollment per candidate).
    const blockedCandUserId = `542-user-b-${Date.now()}`;
    const blockedCandidateId = `542-cand-b-${Date.now()}`;
    const blockedEnrollmentId = `542-enr-b-${Date.now()}`;
    const nowIso = new Date().toISOString();
    await sql.unsafe(
      `INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at)
       VALUES ('${blockedCandUserId}', '${orgId}', '542-user-b', 'hash', '542 User B', 'Candidate', true, '${nowIso}', '${nowIso}')`,
    );
    await sql.unsafe(
      `INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at)
       VALUES ('${blockedCandidateId}', '${orgId}', '${blockedCandUserId}', '{}'::jsonb, '${nowIso}', '${nowIso}')`,
    );
    await expect(
      sql.unsafe(
        `INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
         VALUES ('${blockedEnrollmentId}', '${orgId}', '${examId}', '${blockedCandidateId}', 'blocked', 0, '${nowIso}', '${nowIso}')`,
      ),
    ).resolves.toBeDefined();
  });

  it("CHECK value sets stay identical to the domain enums (drift detection)", async () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["exams_status_check", Object.values(ExamStatus)],
      ["exam_enrollments_status_check", Object.values(EnrollmentStatus)],
      ["exam_attempts_status_check", Object.values(AttemptStatus)],
      ["exam_attempts_grading_status_check", Object.values(GradingStatus)],
    ];
    for (const [conname, domainValues] of expectations) {
      const def = await constraintDef(conname);
      expect(def, conname).toBeDefined();
      // Every single-quoted literal in the constraint definition is a
      // vocabulary value (identifiers use double quotes in the def).
      const dbValues = (def!.match(/'([^']*)'/g) ?? [])
        .map((v) => v.slice(1, -1))
        .sort();
      expect(dbValues, conname).toEqual([...domainValues].sort());
    }
  });

  it("0043 fails closed on a legacy grading row, rewrites nothing, then converges after explicit disposition", async () => {
    // Simulate a 0042-state database: constraints not yet installed.
    await sql.begin(async (tx) => {
      await tx.unsafe(`ALTER TABLE exams DROP CONSTRAINT exams_status_check`);
      await tx.unsafe(
        `ALTER TABLE exam_enrollments DROP CONSTRAINT exam_enrollments_status_check`,
      );
      await tx.unsafe(
        `ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_status_check`,
      );
      await tx.unsafe(
        `ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_grading_status_check`,
      );
    });

    // A legacy row of the kind a pre-#J2-convergence deployment can hold.
    const legacyId = await insertAttempt("grading", {
      gradingStatus: "auto_graded",
    });

    // The whole 0043 statement sequence runs in ONE transaction: the
    // preflight raises → the transaction aborts → no constraint is added.
    const statements = readMigrationStatements(STATUS_CHECK_TAG);
    await expect(
      sql.begin(async (tx) => {
        for (const stmt of statements) {
          await tx.unsafe(stmt);
        }
      }),
    ).rejects.toThrow(/0043 preflight/);

    // No partial install, and the unknown row was NOT rewritten or deleted.
    for (const conname of STATUS_CHECK_NAMES) {
      expect(await constraintDef(conname), conname).toBeUndefined();
    }
    const legacyRows = (await sql`
      SELECT status FROM exam_attempts WHERE id = ${legacyId}
    `) as unknown as Array<{ status: string }>;
    expect(legacyRows[0]?.status).toBe("grading");

    // Forward convergence: the operator dispositions the row EXPLICITLY
    // (this test plays that role), then the migration applies cleanly.
    await sql.unsafe(
      `UPDATE exam_attempts SET status = 'graded', graded_at = now() WHERE id = '${legacyId}'`,
    );
    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
    });
    for (const conname of STATUS_CHECK_NAMES) {
      expect(await constraintDef(conname), conname).toBeDefined();
    }
    // Pre-existing allowed rows all survived the upgrade (the legacy row is
    // included: it was inserted above and explicitly dispositioned to graded).
    const counts = (await sql`
      SELECT count(*)::int AS n FROM exam_attempts
    `) as unknown as Array<{ n: number }>;
    expect(counts[0]?.n).toBe(insertedAttemptIds.length);
  });
});
