import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { schema } from "../schema/pg.js";
import { migratePostgres } from "../postgres.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations/postgres");

/**
 * Read the Drizzle migration journal (`meta/_journal.json`).
 */
function readJournal(): {
  entries: { idx: number; tag: string; breakpoints: boolean }[];
} {
  const raw = readFileSync(resolve(MIGRATIONS_DIR, "meta/_journal.json"), {
    encoding: "utf-8",
  });
  return JSON.parse(raw);
}

/**
 * Read a migration `.sql` file by tag and split it into individual
 * statements using the EXACT semantics the production migration runner uses.
 *
 * The production runner is `migratePostgres` (packages/db/src/postgres.ts),
 * which delegates to Drizzle's `migrate()` from
 * `drizzle-orm/postgres-js/migrator`. Drizzle's `readMigrationFiles`
 * (node_modules/drizzle-orm/migrator.js) reads each `.sql` file and splits on
 * the literal `--> statement-breakpoint` marker. We reproduce that exact
 * split here so the statements executed in this test are the same statements
 * the production runner executes, statement-for-statement.
 */
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

/**
 * Execute a migration file against a raw SQL driver, reproducing BOTH of the
 * production runner's execution semantics:
 *
 * 1. Statement splitting — the `.sql` file is split on the literal
 *    `--> statement-breakpoint` marker (exactly as Drizzle's
 *    `readMigrationFiles` does).
 * 2. Single-transaction execution — Drizzle's `PgDialect.migrate` wraps every
 *    statement of a single migration file inside one `session.transaction()`.
 *    This is load-bearing for 0021, whose backfill creates a
 *    `CREATE TEMPORARY TABLE ... ON COMMIT DROP` and reads it from subsequent
 *    statements: those statements only survive because they share one
 *    transaction. Running each statement on autocommit would drop the temp
 *    table after the first statement and break the backfill.
 *
 * We wrap each file's statements in `sql.begin()` (postgres.js explicit
 * transaction) to match this contract exactly.
 */
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

describe("0021 interruption policy migration — real 0020 → 0021 upgrade", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;

  // Fixture identity — stable, deterministic UUIDs.
  const organizationId = "00000000-0021-4000-8000-000000000001";
  const courseId = "00000000-0021-4000-8000-000000000002";
  const examId = "00000000-0021-4000-8000-000000000003";
  const userId = "00000000-0021-4000-8000-000000000004";
  const candidateId = "00000000-0021-4000-8000-000000000005";
  const enrollmentId = "00000000-0021-4000-8000-000000000006";

  const attemptIds = {
    inProgress: "a0000000-0021-4000-8000-000000000001",
    disruptedA: "b0000000-0021-4000-8000-000000000002",
    disruptedB: "c0000000-0021-4000-8000-000000000003",
    submitted: "d0000000-0021-4000-8000-000000000004",
  };

  // Distinct, custom values per the brief — must survive the migration.
  const deadlines = {
    inProgress: new Date("2026-02-01T01:11:11.000Z"),
    disruptedA: new Date("2026-02-02T02:22:22.000Z"),
    disruptedB: new Date("2026-02-03T03:33:33.000Z"),
    submitted: new Date("2026-02-04T04:44:44.000Z"),
  };
  const lastActivityPerAttempt = {
    inProgress: new Date("2026-01-15T10:00:00.000Z"),
    disruptedA: new Date("2026-01-16T11:11:11.000Z"),
    disruptedB: new Date("2026-01-17T12:22:33.000Z"),
    submitted: new Date("2026-01-18T13:44:55.000Z"),
  };
  const submittedAt = new Date("2026-01-20T00:30:00.000Z");
  const submissionReason = "manual";

  beforeAll(async () => {
    // 1. Create an isolated PostgreSQL schema.
    iso = await setupIsolatedTestDb({ namespace: "mig0021upgrade" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);

    // 2. Apply migrations 0000–0020 ONLY, file-by-file, using the production
    //    runner's exact statement-splitting AND single-transaction semantics.
    //    We do NOT use `migratePostgres` here because it applies the full
    //    journal (including 0021), which would defeat the purpose of this
    //    test. The journal entries are filtered to idx <= 20 (i.e. everything
    //    before 0021_noisy_archangel).
    const journal = readJournal();
    const preUpgradeTags = journal.entries
      .filter((e) => e.idx <= 20)
      .map((e) => e.tag);
    expect(preUpgradeTags.length).toBe(21); // 0000..0020 inclusive
    for (const tag of preUpgradeTags) {
      await executeMigrationFile(conn.sql, tag);
    }

    // 3. Insert pre-0021 historical fixture rows using schema-authentic raw
    //    SQL. Column names are restricted to those that existed at the 0020
    //    schema (snapshot 0015 + migrations 0016–0020 add none to these
    //    tables). In particular, NO interruption columns are referenced —
    //    they do not exist yet.
    await insertHistoricalFixture(conn.sql);

    // 4. Execute the real, repository-committed 0021 migration
    //    (0021_noisy_archangel.sql) using the production runner's exact
    //    splitting + transaction semantics. The backfill SQL is NOT
    //    re-implemented here — it runs straight from the committed file,
    //    including the `ON COMMIT DROP` temp table it depends on.
    await executeMigrationFile(conn.sql, "0021_noisy_archangel");
  }, 120_000);

  afterAll(async () => {
    if (conn) await conn.sql.end();
    if (iso) await iso.cleanup();
  }, 30_000);

  /**
   * Insert historical fixture data into the pre-0021 schema via raw SQL.
   *
   * The inserted columns are exactly the 0020-schema columns. We deliberately
   * set distinct, custom values for deadline_at / last_activity_at /
   * submitted_at / submission_reason so the preservation assertions are
   * meaningful.
   *
   * All interpolated values are emitted as quoted SQL string literals (for
   * text/timestamp columns) or bare numeric literals (for integers). These are
   * fixed, deterministic test constants, not user input.
   */
  async function insertHistoricalFixture(sql: SqlDriver): Promise<void> {
    const createdAt = new Date("2025-12-31T00:00:00.000Z");
    const examOpenAt = new Date("2025-12-31T00:00:00.000Z");
    const examCloseAt = new Date("2026-03-01T00:00:00.000Z");
    const startedAt = new Date("2025-12-31T01:00:00.000Z");

    const ts = (d: Date) => `'${d.toISOString()}'`;
    const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

    // organizations
    await sql.unsafe(`
      INSERT INTO "organizations"
        ("id", "name", "display_name", "slug", "created_at", "updated_at")
      VALUES
        (${s(organizationId)}, 'Mig Org', 'Mig Org',
         ${s(`mig-org-${organizationId.slice(0, 8)}`)},
         ${ts(createdAt)}, ${ts(createdAt)})
    `);

    // courses
    await sql.unsafe(`
      INSERT INTO "courses"
        ("id", "organization_id", "name", "code", "description",
         "created_at", "updated_at")
      VALUES
        (${s(courseId)}, ${s(organizationId)}, 'Mig Course', 'MIG', '',
         ${ts(createdAt)}, ${ts(createdAt)})
    `);

    // users (candidate user)
    await sql.unsafe(`
      INSERT INTO "users"
        ("id", "organization_id", "username", "password_hash", "name",
         "role", "is_active", "created_at", "updated_at")
      VALUES
        (${s(userId)}, ${s(organizationId)},
         ${s(`candidate-${userId.slice(0, 8)}`)}, 'hash', 'Candidate',
         'Candidate', true,
         ${ts(createdAt)}, ${ts(createdAt)})
    `);

    // candidate_profiles
    await sql.unsafe(`
      INSERT INTO "candidate_profiles"
        ("id", "organization_id", "user_id", "fields",
         "created_at", "updated_at")
      VALUES
        (${s(candidateId)}, ${s(organizationId)}, ${s(userId)}, '{}'::jsonb,
         ${ts(createdAt)}, ${ts(createdAt)})
    `);

    // exams — only 0020-era columns; NO interruption columns.
    await sql.unsafe(`
      INSERT INTO "exams"
        ("id", "organization_id", "title", "description", "course_id",
         "status", "timing_mode", "duration_minutes", "open_at", "close_at",
         "passing_score", "total_score", "question_selection_mode",
         "question_ids", "question_snapshot", "control_flags",
         "retake_policy", "score_strategy", "max_attempts",
         "created_at", "updated_at")
      VALUES
        (${s(examId)}, ${s(organizationId)}, 'Historical Exam', '', ${s(courseId)},
         'open', 'timed_window', 60,
         ${ts(examOpenAt)}, ${ts(examCloseAt)},
         60, 100, 'manual',
         '[]'::jsonb, '[]'::jsonb,
         '{"shuffleQuestions":false,"shuffleOptions":false,"detectTabSwitch":false,"disableCopyPaste":false,"requireQueue":false,"batchSize":10,"batchInterval":3,"restrictIp":false,"requireLockdown":false,"showResultImmediately":true}'::jsonb,
         'unlimited', 'highest', 4,
         ${ts(createdAt)}, ${ts(createdAt)})
    `);

    // exam_enrollments
    await sql.unsafe(`
      INSERT INTO "exam_enrollments"
        ("id", "organization_id", "exam_id", "candidate_id", "status",
         "attempt_count", "created_at", "updated_at")
      VALUES
        (${s(enrollmentId)}, ${s(organizationId)}, ${s(examId)}, ${s(candidateId)},
         'started', 4,
         ${ts(createdAt)}, ${ts(createdAt)})
    `);

    // exam_attempts — four historical rows with distinct, custom field values.
    // Columns are strictly the 0020 set (NO interruption columns).
    const attCols = `
      "id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
      "attempt_no", "status", "question_snapshot", "answers",
      "started_at", "deadline_at", "last_activity_at",
      "submitted_at", "submission_reason",
      "created_at", "updated_at"`;
    const attemptRow = (
      id: string,
      attemptNo: number,
      status: string,
      deadline: Date,
      lastActivity: Date,
      submittedSql: string,
    ): string => `(${s(id)}, ${s(organizationId)}, ${s(examId)},
         ${s(enrollmentId)}, ${s(candidateId)}, ${attemptNo}, ${s(status)},
         '[]'::jsonb, '[]'::jsonb,
         ${ts(startedAt)}, ${ts(deadline)}, ${ts(lastActivity)},
         ${submittedSql},
         ${ts(createdAt)}, ${ts(createdAt)})`;

    await sql.unsafe(`
      INSERT INTO "exam_attempts" (${attCols})
      VALUES
        ${attemptRow(attemptIds.inProgress, 1, "in_progress", deadlines.inProgress, lastActivityPerAttempt.inProgress, "NULL, NULL")},
        ${attemptRow(attemptIds.disruptedA, 2, "disrupted", deadlines.disruptedA, lastActivityPerAttempt.disruptedA, "NULL, NULL")},
        ${attemptRow(attemptIds.disruptedB, 3, "disrupted", deadlines.disruptedB, lastActivityPerAttempt.disruptedB, "NULL, NULL")},
        ${attemptRow(attemptIds.submitted, 4, "submitted", deadlines.submitted, lastActivityPerAttempt.submitted, `${ts(submittedAt)}, ${s(submissionReason)}`)}
    `);
  }

  it("backfills Exam-level interruption policy defaults", async () => {
    const exam = await conn.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    expect(exam).toHaveLength(1);
    expect(exam[0]).toMatchObject({
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    });
  });

  it("backfills attempt-level interruption snapshot defaults on every attempt", async () => {
    const attempts = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId))
      .orderBy(schema.examAttempts.attemptNo);
    expect(attempts).toHaveLength(4);
    for (const a of attempts) {
      expect(a).toMatchObject({
        interruptionPolicySnapshotVersion: 1,
        interruptionTimePolicySnapshot: "strict",
        interruptionGracePerIncidentSecondsSnapshot: null,
        interruptionGracePerAttemptSecondsSnapshot: null,
      });
    }
  });

  it("leaves non-disrupted historical attempts without an interruption pointer", async () => {
    const inProgress = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptIds.inProgress));
    expect(inProgress[0]!.currentInterruptionId).toBeNull();
    expect(inProgress[0]!.interruptedAt).toBeNull();

    const submitted = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptIds.submitted));
    expect(submitted[0]!.currentInterruptionId).toBeNull();
    expect(submitted[0]!.interruptedAt).toBeNull();
  });

  it("creates a backfilled parent, detected event, and pointer for each historical disrupted attempt", async () => {
    for (const attemptId of [attemptIds.disruptedA, attemptIds.disruptedB]) {
      const attempt = await conn.db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId));
      expect(attempt).toHaveLength(1);
      const currentInterruptionId = attempt[0]!.currentInterruptionId;
      const interruptedAt = attempt[0]!.interruptedAt;
      expect(currentInterruptionId).not.toBeNull();
      expect(interruptedAt).not.toBeNull();

      // Exactly one parent interruption row.
      const parents = await conn.db
        .select()
        .from(schema.attemptInterruptions)
        .where(
          and(
            eq(schema.attemptInterruptions.attemptId, attemptId),
            eq(schema.attemptInterruptions.organizationId, organizationId),
          ),
        );
      expect(parents).toHaveLength(1);
      const parent = parents[0]!;
      expect(parent.id).toBe(currentInterruptionId);

      // Exactly one detected event row.
      const detectedEvents = await conn.db
        .select()
        .from(schema.attemptInterruptionEvents)
        .where(
          and(
            eq(schema.attemptInterruptionEvents.attemptId, attemptId),
            eq(schema.attemptInterruptionEvents.eventType, "detected"),
          ),
        );
      expect(detectedEvents).toHaveLength(1);
      const event = detectedEvents[0]!;
      expect(event.interruptionId).toBe(currentInterruptionId);

      // Triple-identity: parent.id == attempt.current_interruption_id
      // == event.interruption_id — all point to the SAME UUID.
      expect(parent.id).toBe(currentInterruptionId);
      expect(parent.id).toBe(event.interruptionId);

      // interrupted_at == detected event occurred_at.
      expect(interruptedAt).toEqual(event.occurredAt);

      // Detected-event shape from the migration backfill.
      expect(event).toMatchObject({
        detectionSource: "migration_backfill",
        policy: "strict",
        timeoutSeconds: null,
        reasonCode: "migration_backfill_unknown_detected_at",
      });

      // observed_last_activity_at must carry the historical last_activity_at,
      // NOT be used as detected_at.
      const expectedLastActivity =
        attemptId === attemptIds.disruptedA
          ? lastActivityPerAttempt.disruptedA
          : lastActivityPerAttempt.disruptedB;
      expect(event.observedLastActivityAt).toEqual(expectedLastActivity);
      // occurred_at (== interrupted_at) is transaction_timestamp() of the
      // backfill, which must NOT equal the historical last_activity_at.
      expect(event.occurredAt).not.toEqual(event.observedLastActivityAt);
    }
  });

  it("assigns distinct interruption UUIDs to the two historical disrupted attempts", async () => {
    const a = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptIds.disruptedA));
    const b = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptIds.disruptedB));
    expect(a[0]!.currentInterruptionId).not.toBeNull();
    expect(b[0]!.currentInterruptionId).not.toBeNull();
    expect(a[0]!.currentInterruptionId).not.toBe(b[0]!.currentInterruptionId);
  });

  it("stamps all backfilled rows for one attempt with the same migration transaction timestamp", async () => {
    // The 0021 backfill builds its mapping with transaction_timestamp() in a
    // single statement and propagates that SAME value through
    // parent.created_at, attempt.interrupted_at, event.occurred_at, and
    // event.created_at by reading it back from the temp mapping table. Because
    // the production runner wraps the whole migration in one transaction (and
    // so do we), all four timestamps per attempt must be equal.
    for (const attemptId of [attemptIds.disruptedA, attemptIds.disruptedB]) {
      const attempt = await conn.db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId));
      const parents = await conn.db
        .select()
        .from(schema.attemptInterruptions)
        .where(eq(schema.attemptInterruptions.attemptId, attemptId));
      const events = await conn.db
        .select()
        .from(schema.attemptInterruptionEvents)
        .where(
          and(
            eq(schema.attemptInterruptionEvents.attemptId, attemptId),
            eq(schema.attemptInterruptionEvents.eventType, "detected"),
          ),
        );
      const parent = parents[0]!;
      const event = events[0]!;

      expect(parent.createdAt).toEqual(event.occurredAt);
      expect(parent.createdAt).toEqual(event.createdAt);
      expect(parent.createdAt).toEqual(attempt[0]!.interruptedAt);
    }

    // Both disrupted attempts get their interruption_id+detected_at from the
    // SAME mapping-table statement (one SELECT over all disrupted rows), so
    // they share the same transaction timestamp.
    const aEvents = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        and(
          eq(schema.attemptInterruptionEvents.attemptId, attemptIds.disruptedA),
          eq(schema.attemptInterruptionEvents.eventType, "detected"),
        ),
      );
    const bEvents = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        and(
          eq(schema.attemptInterruptionEvents.attemptId, attemptIds.disruptedB),
          eq(schema.attemptInterruptionEvents.eventType, "detected"),
        ),
      );
    expect(aEvents[0]!.occurredAt).toEqual(bEvents[0]!.occurredAt);
  });

  it("preserves deadline_at, status, submitted_at and submission_reason exactly", async () => {
    const attempts = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId))
      .orderBy(schema.examAttempts.attemptNo);
    expect(attempts.map((a) => a.deadlineAt)).toEqual([
      deadlines.inProgress,
      deadlines.disruptedA,
      deadlines.disruptedB,
      deadlines.submitted,
    ]);
    expect(attempts.map((a) => a.status)).toEqual([
      "in_progress",
      "disrupted",
      "disrupted",
      "submitted",
    ]);
    const submitted = attempts[3]!;
    expect(submitted.submittedAt).toEqual(submittedAt);
    expect(submitted.submissionReason).toBe(submissionReason);

    // Grading / submission fields must be untouched by the migration.
    expect(submitted.gradingStatus).toBe("auto_graded");
    expect(submitted.score).toBeNull();
    expect(submitted.passed).toBeNull();
    expect(submitted.gradedAt).toBeNull();
    expect(submitted.gradingResult).toBeNull();
    expect(submitted.submittedAnswers).toBeNull();
  });

  it("writes zero rows to attempt_time_adjustments", async () => {
    const adjustments = await conn.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.organizationId, organizationId));
    expect(adjustments).toEqual([]);
  });
});

/**
 * Guard test: after migration 0022 adds the status-pointer CHECK constraint,
 * a disrupted attempt WITHOUT a valid interruption pointer is rejected by the
 * database. The scanner must atomically create episode + event + set pointer
 * in the same transaction that flips status to disrupted.
 */
describe("0021 — post-migration disrupted rows are a distinct population", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const userId = randomUUID();
  const candidateId = randomUUID();
  const enrollmentId = randomUUID();

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0021postmig" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });

    const now = new Date("2026-01-01T00:00:00.000Z");
    await conn.db.insert(schema.organizations).values({
      id: organizationId,
      name: "Post-Mig Org",
      displayName: "Post-Mig Org",
      slug: `post-mig-${organizationId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      name: "Post-Mig Course",
      code: `PM-${courseId.slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.users).values({
      id: userId,
      organizationId,
      username: `cand-${userId.slice(0, 8)}`,
      passwordHash: "hash",
      name: "Post-Mig Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId,
      userId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.exams).values({
      id: examId,
      organizationId,
      title: "Post-Mig Exam",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date("2026-12-01T00:00:00.000Z"),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 4,
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId,
      examId,
      candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  }, 120_000);

  afterAll(async () => {
    if (conn) await conn.sql.end();
    if (iso) await iso.cleanup();
  }, 30_000);

  it("CHECK constraint rejects a disrupted attempt without interruption pointer", async () => {
    const attemptId = randomUUID();
    const now = new Date("2026-03-01T00:00:00.000Z");
    await expect(
      conn.db.insert(schema.examAttempts).values({
        id: attemptId,
        organizationId,
        examId,
        enrollmentId,
        candidateId,
        attemptNo: 1,
        status: "disrupted",
        questionSnapshot: [],
        answers: [],
        deadlineAt: new Date("2026-04-01T00:00:00.000Z"),
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("scanner-pattern: in_progress → episode + event + pointer → disrupted succeeds", async () => {
    const attemptId = randomUUID();
    const episodeId = randomUUID();
    const now = new Date("2026-03-01T00:00:00.000Z");
    await conn.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      deadlineAt: new Date("2026-04-01T00:00:00.000Z"),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.attemptInterruptions).values({
      id: episodeId,
      organizationId,
      attemptId,
      createdAt: now,
    });
    await conn.db.insert(schema.attemptInterruptionEvents).values({
      id: randomUUID(),
      organizationId,
      attemptId,
      interruptionId: episodeId,
      eventType: "detected",
      occurredAt: now,
      observedLastActivityAt: now,
      detectionSource: "heartbeat_timeout",
      timeoutSeconds: 60,
      policy: "strict",
      reasonCode: "heartbeat_timeout",
      createdAt: now,
    });
    await conn.db
      .update(schema.examAttempts)
      .set({
        status: "disrupted",
        currentInterruptionId: episodeId,
        interruptedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.examAttempts.id, attemptId));

    const attempt = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    expect(attempt[0]!.status).toBe("disrupted");
    expect(attempt[0]!.currentInterruptionId).toBe(episodeId);
    expect(attempt[0]!.interruptedAt).toEqual(now);
  });
});
