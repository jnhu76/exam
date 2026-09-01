import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { schema } from "../schema/pg.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../migrations/postgres");

function readJournal(): {
  entries: { idx: number; tag: string; breakpoints: boolean }[];
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

async function applyMigrationsThrough0021(sql: SqlDriver): Promise<void> {
  const journal = readJournal();
  const tags = journal.entries.filter((e) => e.idx <= 21).map((e) => e.tag);
  expect(tags.length).toBe(22);
  for (const tag of tags) {
    await executeMigrationFile(sql, tag);
  }
}

const ORG_ID = "00000000-0022-4000-8000-000000000001";
const COURSE_ID = "00000000-0022-4000-8000-000000000002";
const EXAM_ID = "00000000-0022-4000-8000-000000000003";
const USER_ID = "00000000-0022-4000-8000-000000000004";
const CANDIDATE_ID = "00000000-0022-4000-8000-000000000005";
const ENROLLMENT_ID = "00000000-0022-4000-8000-000000000006";

const ts = (d: Date) => `'${d.toISOString()}'`;
const s = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function insertBaseFixture(sql: SqlDriver): Promise<void> {
  const createdAt = new Date("2025-12-31T00:00:00.000Z");
  await sql.unsafe(`
    INSERT INTO "organizations" ("id", "name", "display_name", "slug", "created_at", "updated_at")
    VALUES (${s(ORG_ID)}, 'Mig22 Org', 'Mig22 Org', ${s(`mig22-${ORG_ID.slice(0, 8)}`)}, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "courses" ("id", "organization_id", "name", "code", "description", "created_at", "updated_at")
    VALUES (${s(COURSE_ID)}, ${s(ORG_ID)}, 'Mig22 Course', 'M22', '', ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "users" ("id", "organization_id", "username", "password_hash", "name", "role", "is_active", "created_at", "updated_at")
    VALUES (${s(USER_ID)}, ${s(ORG_ID)}, ${s(`cand22-${USER_ID.slice(0, 8)}`)}, 'hash', 'Cand22', 'Candidate', true, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "candidate_profiles" ("id", "organization_id", "user_id", "fields", "created_at", "updated_at")
    VALUES (${s(CANDIDATE_ID)}, ${s(ORG_ID)}, ${s(USER_ID)}, '{}'::jsonb, ${ts(createdAt)}, ${ts(createdAt)})
  `);
  await sql.unsafe(`
    INSERT INTO "exams" (
      "id", "organization_id", "title", "description", "course_id",
      "status", "timing_mode", "duration_minutes", "open_at", "close_at",
      "passing_score", "total_score", "question_selection_mode",
      "question_ids", "question_snapshot", "control_flags",
      "retake_policy", "score_strategy", "max_attempts",
      "interruption_time_policy", "interruption_grace_per_incident_seconds",
      "interruption_grace_per_attempt_seconds",
      "created_at", "updated_at"
    ) VALUES (
      ${s(EXAM_ID)}, ${s(ORG_ID)}, 'Mig22 Exam', '', ${s(COURSE_ID)},
      'open', 'timed_window', 60,
      '2025-12-31T00:00:00.000Z', '2026-03-01T00:00:00.000Z',
      60, 100, 'manual', '[]'::jsonb, '[]'::jsonb,
      '{"shuffleQuestions":false,"shuffleOptions":false,"detectTabSwitch":false,"disableCopyPaste":false,"requireQueue":false,"batchSize":10,"batchInterval":3,"restrictIp":false,"requireLockdown":false,"showResultImmediately":true}'::jsonb,
      'unlimited', 'highest', 10,
      'strict', NULL, NULL,
      ${ts(createdAt)}, ${ts(createdAt)}
    )
  `);
  await sql.unsafe(`
    INSERT INTO "exam_enrollments" ("id", "organization_id", "exam_id", "candidate_id", "status", "attempt_count", "created_at", "updated_at")
    VALUES (${s(ENROLLMENT_ID)}, ${s(ORG_ID)}, ${s(EXAM_ID)}, ${s(CANDIDATE_ID)}, 'started', 10, ${ts(createdAt)}, ${ts(createdAt)})
  `);
}

function insertAttemptSql(
  id: string,
  attemptNo: number,
  status: string,
  deadline: Date,
  opts?: {
    interruptedAt?: Date | null;
    currentInterruptionId?: string | null;
    submittedAt?: Date;
  },
): string {
  const startedAt = new Date("2025-12-31T01:00:00.000Z");
  const lastActivity = new Date("2026-01-15T10:00:00.000Z");
  const createdAt = new Date("2025-12-31T00:00:00.000Z");
  const interruptedAtSql = opts?.interruptedAt
    ? ts(opts.interruptedAt)
    : "NULL";
  const pointerSql = opts?.currentInterruptionId
    ? s(opts.currentInterruptionId)
    : "NULL";
  const submittedAtSql = opts?.submittedAt ? ts(opts.submittedAt) : "NULL";
  const submissionReasonSql = opts?.submittedAt ? "'manual'" : "NULL";
  return `(${s(id)}, ${s(ORG_ID)}, ${s(EXAM_ID)}, ${s(ENROLLMENT_ID)}, ${s(CANDIDATE_ID)},
    ${attemptNo}, ${s(status)}, '[]'::jsonb, '[]'::jsonb,
    ${ts(startedAt)}, ${ts(deadline)}, ${ts(lastActivity)},
    ${submittedAtSql}, ${submissionReasonSql},
    1, 'strict', NULL, NULL,
    ${pointerSql}, ${interruptedAtSql},
    ${ts(createdAt)}, ${ts(createdAt)})`;
}

const ATTEMPT_COLS = `
  "id", "organization_id", "exam_id", "enrollment_id", "candidate_id",
  "attempt_no", "status", "question_snapshot", "answers",
  "started_at", "deadline_at", "last_activity_at",
  "submitted_at", "submission_reason",
  "interruption_policy_snapshot_version", "interruption_time_policy_snapshot",
  "interruption_grace_per_incident_seconds_snapshot",
  "interruption_grace_per_attempt_seconds_snapshot",
  "current_interruption_id", "interrupted_at",
  "created_at", "updated_at"`;

function insertEpisodeSql(
  interruptionId: string,
  attemptId: string,
  createdAt: Date,
): string {
  return `(${s(interruptionId)}, ${s(ORG_ID)}, ${s(attemptId)}, ${ts(createdAt)})`;
}

function insertDetectedEventSql(
  id: string,
  attemptId: string,
  interruptionId: string,
  occurredAt: Date,
  opts?: { policy?: string },
): string {
  const policy = opts?.policy ?? "strict";
  return `(${s(id)}, ${s(ORG_ID)}, ${s(attemptId)}, ${s(interruptionId)},
    'detected', ${ts(occurredAt)}, '2026-01-15T10:00:00.000Z',
    'heartbeat_timeout', 60, ${s(policy)},
    NULL, NULL, NULL, 'heartbeat_timeout_detected', ${ts(occurredAt)})`;
}

function insertOutcomeEventSql(
  id: string,
  attemptId: string,
  interruptionId: string,
  eventType: "restored" | "terminalized",
  occurredAt: Date,
  reasonCode: string,
): string {
  return `(${s(id)}, ${s(ORG_ID)}, ${s(attemptId)}, ${s(interruptionId)},
    ${s(eventType)}, ${ts(occurredAt)}, NULL,
    NULL, NULL, 'strict',
    NULL, NULL, NULL, ${s(reasonCode)}, ${ts(occurredAt)})`;
}

const EVENT_COLS = `
  "id", "organization_id", "attempt_id", "interruption_id",
  "event_type", "occurred_at", "observed_last_activity_at",
  "detection_source", "timeout_seconds", "policy",
  "eligible_seconds", "time_adjustment_id", "actor_id",
  "reason_code", "created_at"`;

describe("0022 cutover — Clean I1", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;

  const cleanAttemptId = "a0000000-0022-4000-8000-000000000001";
  const cleanDeadline = new Date("2026-02-01T01:11:11.000Z");

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0022clean" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await applyMigrationsThrough0021(conn.sql);
    await insertBaseFixture(conn.sql);
    await conn.sql.unsafe(`
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS})
      VALUES ${insertAttemptSql(cleanAttemptId, 1, "in_progress", cleanDeadline)}
    `);
    await executeMigrationFile(conn.sql, "0022_engine_policy_seam");
  }, 120_000);

  afterAll(async () => {
    if (conn) await conn.sql.end();
    if (iso) await iso.cleanup();
  });

  it("installs the status/pointer CHECK constraint", async () => {
    const rows = await conn.sql.unsafe(`
      SELECT conname FROM pg_constraint
      WHERE conname = 'exam_attempts_status_pointer_check'
        AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
    `);
    expect(rows.length).toBe(1);
  });

  it("leaves clean in_progress attempt unchanged", async () => {
    const rows = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, cleanAttemptId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("in_progress");
    expect(rows[0]!.currentInterruptionId).toBeNull();
    expect(rows[0]!.interruptedAt).toBeNull();
    expect(rows[0]!.deadlineAt).toEqual(cleanDeadline);
  });

  it("fabricates no events or adjustments", async () => {
    const events = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(eq(schema.attemptInterruptionEvents.organizationId, ORG_ID));
    expect(events).toEqual([]);
    const adjustments = await conn.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.organizationId, ORG_ID));
    expect(adjustments).toEqual([]);
  });
});

describe("0022 cutover — Transitional I1", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;

  const disruptedNullPtr = "b0000000-0022-4000-8000-000000000001";
  const inProgressPtr = "c0000000-0022-4000-8000-000000000002";
  const submittedPtr = "d0000000-0022-4000-8000-000000000003";
  const gradedWithOutcome = "e0000000-0022-4000-8000-000000000004";
  const multiEpisodeAttempt = "f0000000-0022-4000-8000-000000000005";

  const ep1 = "10000000-0022-4000-8000-000000000001";
  const ep2 = "20000000-0022-4000-8000-000000000002";
  const ep3 = "30000000-0022-4000-8000-000000000003";
  const ep4 = "40000000-0022-4000-8000-000000000004";
  const ep5a = "50000000-0022-4000-8000-000000000005";
  const ep5b = "60000000-0022-4000-8000-000000000006";

  const ev1 = "ev000000-0022-4000-8000-000000000001";
  const ev2 = "ev000000-0022-4000-8000-000000000002";
  const ev3 = "ev000000-0022-4000-8000-000000000003";
  const ev4det = "ev000000-0022-4000-8000-000000000004";
  const ev4out = "ev000000-0022-4000-8000-000000000005";
  const ev5a = "ev000000-0022-4000-8000-000000000006";
  const ev5b = "ev000000-0022-4000-8000-000000000007";
  const ev5bout = "ev000000-0022-4000-8000-000000000008";

  const detectedAt1 = new Date("2026-01-10T08:00:00.000Z");
  const detectedAt2 = new Date("2026-01-11T09:00:00.000Z");
  const detectedAt3 = new Date("2026-01-12T10:00:00.000Z");
  const detectedAt4 = new Date("2026-01-13T11:00:00.000Z");
  const detectedAt5a = new Date("2026-01-14T12:00:00.000Z");
  const detectedAt5b = new Date("2026-01-15T13:00:00.000Z");
  const outcomeAt4 = new Date("2026-01-13T12:00:00.000Z");
  const outcomeAt5b = new Date("2026-01-15T14:00:00.000Z");

  const deadlineDisrupted = new Date("2026-02-02T02:22:22.000Z");
  const deadlineInProgress = new Date("2026-02-03T03:33:33.000Z");
  const deadlineSubmitted = new Date("2026-02-04T04:44:44.000Z");
  const deadlineGraded = new Date("2026-02-05T05:55:55.000Z");
  const deadlineMulti = new Date("2026-02-06T06:06:06.000Z");

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0022trans" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await applyMigrationsThrough0021(conn.sql);
    await insertBaseFixture(conn.sql);

    await conn.sql.unsafe(`
      ALTER TABLE "exam_attempts" DROP CONSTRAINT IF EXISTS "exam_attempts_current_interruption_fk";
      ALTER TABLE "exam_attempts" DROP CONSTRAINT IF EXISTS "exam_attempts_current_interruption_pair_check";
    `);

    await conn.sql.unsafe(`
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(disruptedNullPtr, 1, "disrupted", deadlineDisrupted)},
        ${insertAttemptSql(inProgressPtr, 2, "in_progress", deadlineInProgress, { currentInterruptionId: ep2, interruptedAt: detectedAt2 })},
        ${insertAttemptSql(submittedPtr, 3, "submitted", deadlineSubmitted, { currentInterruptionId: ep3, interruptedAt: detectedAt3, submittedAt: new Date("2026-01-20T00:30:00.000Z") })},
        ${insertAttemptSql(gradedWithOutcome, 4, "graded", deadlineGraded, { currentInterruptionId: ep4, interruptedAt: detectedAt4 })},
        ${insertAttemptSql(multiEpisodeAttempt, 5, "submitted", deadlineMulti, { currentInterruptionId: ep5b, interruptedAt: detectedAt5b, submittedAt: new Date("2026-01-21T00:30:00.000Z") })}
    `);

    await conn.sql.unsafe(`
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(ep2, inProgressPtr, detectedAt2)},
        ${insertEpisodeSql(ep3, submittedPtr, detectedAt3)},
        ${insertEpisodeSql(ep4, gradedWithOutcome, detectedAt4)},
        ${insertEpisodeSql(ep5a, multiEpisodeAttempt, detectedAt5a)},
        ${insertEpisodeSql(ep5b, multiEpisodeAttempt, detectedAt5b)}
    `);

    await conn.sql.unsafe(`
      ALTER TABLE "exam_attempts"
      ADD CONSTRAINT "exam_attempts_current_interruption_fk"
        FOREIGN KEY ("organization_id", "id", "current_interruption_id")
        REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");
      ALTER TABLE "exam_attempts"
      ADD CONSTRAINT "exam_attempts_current_interruption_pair_check" CHECK (
        ("current_interruption_id" IS NULL AND "interrupted_at" IS NULL)
        OR
        ("current_interruption_id" IS NOT NULL AND "interrupted_at" IS NOT NULL)
      );
    `);

    await conn.sql.unsafe(`
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql(ev2, inProgressPtr, ep2, detectedAt2)},
        ${insertDetectedEventSql(ev3, submittedPtr, ep3, detectedAt3)},
        ${insertDetectedEventSql(ev4det, gradedWithOutcome, ep4, detectedAt4)},
        ${insertOutcomeEventSql(ev4out, gradedWithOutcome, ep4, "terminalized", outcomeAt4, "submit_terminalized")},
        ${insertDetectedEventSql(ev5a, multiEpisodeAttempt, ep5a, detectedAt5a)},
        ${insertDetectedEventSql(ev5b, multiEpisodeAttempt, ep5b, detectedAt5b)},
        ${insertOutcomeEventSql(ev5bout, multiEpisodeAttempt, ep5b, "restored", outcomeAt5b, "restore_resolved")}
    `);

    await executeMigrationFile(conn.sql, "0022_engine_policy_seam");
  }, 120_000);

  afterAll(async () => {
    if (conn) await conn.sql.end();
    if (iso) await iso.cleanup();
  });

  it("disrupted + null pointer gets parent + detected + pointer", async () => {
    const attempt = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, disruptedNullPtr));
    expect(attempt).toHaveLength(1);
    const ptr = attempt[0]!.currentInterruptionId;
    expect(ptr).not.toBeNull();
    expect(attempt[0]!.interruptedAt).not.toBeNull();
    expect(attempt[0]!.status).toBe("disrupted");

    const parents = await conn.db
      .select()
      .from(schema.attemptInterruptions)
      .where(eq(schema.attemptInterruptions.attemptId, disruptedNullPtr));
    expect(parents).toHaveLength(1);
    expect(parents[0]!.id).toBe(ptr);

    const detected = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        and(
          eq(schema.attemptInterruptionEvents.attemptId, disruptedNullPtr),
          eq(schema.attemptInterruptionEvents.eventType, "detected"),
        ),
      );
    expect(detected).toHaveLength(1);
    expect(detected[0]!.interruptionId).toBe(ptr);
    expect(detected[0]!.detectionSource).toBe("migration_backfill");
    expect(detected[0]!.reasonCode).toBe(
      "migration_backfill_unknown_detected_at",
    );
    expect(attempt[0]!.interruptedAt).toEqual(detected[0]!.occurredAt);
  });

  it("in_progress + pointer gets restored outcome then pointer cleared", async () => {
    const attempt = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, inProgressPtr));
    expect(attempt[0]!.currentInterruptionId).toBeNull();
    expect(attempt[0]!.interruptedAt).toBeNull();
    expect(attempt[0]!.status).toBe("in_progress");

    const outcomes = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        and(
          eq(schema.attemptInterruptionEvents.interruptionId, ep2),
          eq(schema.attemptInterruptionEvents.eventType, "restored"),
        ),
      );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.reasonCode).toBe("migration_stale_pointer_resolved");
  });

  it("submitted + pointer gets terminalized outcome then pointer cleared", async () => {
    const attempt = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, submittedPtr));
    expect(attempt[0]!.currentInterruptionId).toBeNull();
    expect(attempt[0]!.interruptedAt).toBeNull();

    const outcomes = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        and(
          eq(schema.attemptInterruptionEvents.interruptionId, ep3),
          eq(schema.attemptInterruptionEvents.eventType, "terminalized"),
        ),
      );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.reasonCode).toBe("migration_stale_pointer_resolved");
  });

  it("graded + existing terminalized outcome: not duplicated, pointer cleared", async () => {
    const attempt = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, gradedWithOutcome));
    expect(attempt[0]!.currentInterruptionId).toBeNull();
    expect(attempt[0]!.interruptedAt).toBeNull();

    const outcomes = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        and(
          eq(schema.attemptInterruptionEvents.interruptionId, ep4),
          eq(schema.attemptInterruptionEvents.eventType, "terminalized"),
        ),
      );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.reasonCode).toBe("submit_terminalized");
  });

  it("multiple historical episodes: only current pointer resolved, history intact", async () => {
    const attempt = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, multiEpisodeAttempt));
    expect(attempt[0]!.currentInterruptionId).toBeNull();

    const allEvents = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        eq(schema.attemptInterruptionEvents.attemptId, multiEpisodeAttempt),
      );
    const ep5aEvents = allEvents.filter((e) => e.interruptionId === ep5a);
    const ep5bEvents = allEvents.filter((e) => e.interruptionId === ep5b);
    expect(ep5aEvents).toHaveLength(1);
    expect(ep5aEvents[0]!.eventType).toBe("detected");
    expect(ep5bEvents).toHaveLength(2);
    expect(ep5bEvents.map((e) => e.eventType).sort()).toEqual([
      "detected",
      "restored",
    ]);
  });

  it("deadlines exactly unchanged", async () => {
    const attempts = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, ORG_ID))
      .orderBy(schema.examAttempts.attemptNo);
    expect(attempts.map((a) => a.deadlineAt)).toEqual([
      deadlineDisrupted,
      deadlineInProgress,
      deadlineSubmitted,
      deadlineGraded,
      deadlineMulti,
    ]);
  });

  it("no adjustments fabricated", async () => {
    const adjustments = await conn.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.organizationId, ORG_ID));
    expect(adjustments).toEqual([]);
  });

  it("one detected per episode, at most one outcome per episode", async () => {
    const allEvents = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(eq(schema.attemptInterruptionEvents.organizationId, ORG_ID));
    const byEpisode = new Map<string, { detected: number; outcome: number }>();
    for (const e of allEvents) {
      const entry = byEpisode.get(e.interruptionId) ?? {
        detected: 0,
        outcome: 0,
      };
      if (e.eventType === "detected") entry.detected++;
      else entry.outcome++;
      byEpisode.set(e.interruptionId, entry);
    }
    for (const [, counts] of byEpisode) {
      expect(counts.detected).toBe(1);
      expect(counts.outcome).toBeLessThanOrEqual(1);
    }
  });
});

describe("0022 cutover — Corrupt states", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0022corrupt" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await applyMigrationsThrough0021(conn.sql);
    await insertBaseFixture(conn.sql);
  }, 120_000);

  afterAll(async () => {
    if (conn) await conn.sql.end();
    if (iso) await iso.cleanup();
  });

  async function expectMigrationThrows(
    setupSql: string,
    errorPattern: RegExp,
  ): Promise<void> {
    await conn.sql.unsafe(`
      ALTER TABLE "exam_attempts" DROP CONSTRAINT IF EXISTS "exam_attempts_current_interruption_fk";
      ALTER TABLE "exam_attempts" DROP CONSTRAINT IF EXISTS "exam_attempts_current_interruption_pair_check";
      ALTER TABLE "exam_attempts" DROP CONSTRAINT IF EXISTS "exam_attempts_status_pointer_check";
      ALTER TABLE "attempt_interruption_events" DROP CONSTRAINT IF EXISTS "attempt_interruption_events_org_interruption_fk";
      DROP INDEX IF EXISTS "attempt_interruption_events_detected_unique";
    `);
    await conn.sql.unsafe(setupSql);
    await expect(
      executeMigrationFile(conn.sql, "0022_engine_policy_seam"),
    ).rejects.toThrow(errorPattern);
    const constraint = await conn.sql.unsafe(`
      SELECT conname FROM pg_constraint
      WHERE conname = 'exam_attempts_status_pointer_check'
        AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
    `);
    expect(constraint.length).toBe(0);
    await conn.sql.unsafe(`
      DELETE FROM "attempt_interruption_events" WHERE "organization_id" = ${s(ORG_ID)};
      DELETE FROM "attempt_interruptions" WHERE "organization_id" = ${s(ORG_ID)};
      DELETE FROM "exam_attempts" WHERE "organization_id" = ${s(ORG_ID)};
    `);
    await conn.sql.unsafe(`
      ALTER TABLE "exam_attempts"
      ADD CONSTRAINT "exam_attempts_current_interruption_fk"
        FOREIGN KEY ("organization_id", "id", "current_interruption_id")
        REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");
      ALTER TABLE "exam_attempts"
      ADD CONSTRAINT "exam_attempts_current_interruption_pair_check" CHECK (
        ("current_interruption_id" IS NULL AND "interrupted_at" IS NULL)
        OR
        ("current_interruption_id" IS NOT NULL AND "interrupted_at" IS NOT NULL)
      );
      ALTER TABLE "attempt_interruption_events"
      ADD CONSTRAINT "attempt_interruption_events_org_interruption_fk"
        FOREIGN KEY ("organization_id", "attempt_id", "interruption_id")
        REFERENCES "attempt_interruptions"("organization_id", "attempt_id", "id");
      CREATE UNIQUE INDEX "attempt_interruption_events_detected_unique"
        ON "attempt_interruption_events" ("interruption_id")
        WHERE "event_type" = 'detected';
    `);
  }

  it("P1a: not_started + pointer → throws", async () => {
    const attemptId = "aa000000-0022-4000-8000-000000000001";
    const epId = "ae000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId, 1, "not_started", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: detAt })};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId, detAt)};
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql("ae-ev000-0022-0001", attemptId, epId, detAt)};
      `,
      /P1a/,
    );
  });

  it("P1b: disrupted + pointer + outcome → throws", async () => {
    const attemptId = "bb000000-0022-4000-8000-000000000001";
    const epId = "be000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    const outAt = new Date("2026-01-10T09:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId, 1, "disrupted", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: detAt })};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId, detAt)};
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql("be-ev000-0022-0001", attemptId, epId, detAt)},
        ${insertOutcomeEventSql("be-ev000-0022-0002", attemptId, epId, "restored", outAt, "test_outcome")};
      `,
      /P1b/,
    );
  });

  it("P1c: pointer has no parent → throws", async () => {
    const attemptId = "cc000000-0022-4000-8000-000000000001";
    const fakePtr = "ce000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId, 1, "in_progress", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: fakePtr, interruptedAt: detAt })};
      `,
      /P1c/,
    );
  });

  it("P1d: parent.attempt_id mismatch → throws", async () => {
    const attemptId1 = "dd000000-0022-4000-8000-000000000001";
    const attemptId2 = "dd000000-0022-4000-8000-000000000002";
    const epId = "de000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId1, 1, "in_progress", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: detAt })},
        ${insertAttemptSql(attemptId2, 2, "in_progress", new Date("2026-02-01T00:00:00.000Z"))};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId2, detAt)};
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql("de-ev000-0022-0001", attemptId2, epId, detAt)};
      `,
      /P1d/,
    );
  });

  it("P1e: pointer has no detected event → throws", async () => {
    const attemptId = "ee000000-0022-4000-8000-000000000001";
    const epId = "ee000000-0022-4000-8000-000000000002";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId, 1, "in_progress", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: detAt })};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId, detAt)};
      `,
      /P1e/,
    );
  });

  it("P1f: detected.attempt_id mismatch → throws", async () => {
    const attemptId1 = "ff000000-0022-4000-8000-000000000001";
    const attemptId2 = "ff000000-0022-4000-8000-000000000002";
    const epId = "fe000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId1, 1, "in_progress", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: detAt })},
        ${insertAttemptSql(attemptId2, 2, "in_progress", new Date("2026-02-01T00:00:00.000Z"))};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId1, detAt)};
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql("fe-ev000-0022-0001", attemptId2, epId, detAt)};
      `,
      /P1f/,
    );
  });

  it("P1h: interruptedAt mismatch → throws", async () => {
    const attemptId = "a1000000-0022-4000-8000-000000000001";
    const epId = "a2000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    const wrongInterruptedAt = new Date("2026-01-10T09:59:59.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId, 1, "in_progress", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: wrongInterruptedAt })};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId, detAt)};
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql("a2-ev000-0022-0001", attemptId, epId, detAt)};
      `,
      /P1h/,
    );
  });

  it("P1i: duplicate detected within same interruption → throws", async () => {
    const attemptId = "b1000000-0022-4000-8000-000000000001";
    const epId = "b2000000-0022-4000-8000-000000000001";
    const detAt = new Date("2026-01-10T08:00:00.000Z");
    await expectMigrationThrows(
      `
      INSERT INTO "exam_attempts" (${ATTEMPT_COLS}) VALUES
        ${insertAttemptSql(attemptId, 1, "in_progress", new Date("2026-02-01T00:00:00.000Z"), { currentInterruptionId: epId, interruptedAt: detAt })};
      INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at") VALUES
        ${insertEpisodeSql(epId, attemptId, detAt)};
      INSERT INTO "attempt_interruption_events" (${EVENT_COLS}) VALUES
        ${insertDetectedEventSql("b2-ev000-0022-0001", attemptId, epId, detAt)},
        ${insertDetectedEventSql("b2-ev000-0022-0002", attemptId, epId, detAt)};
      `,
      /P1i/,
    );
  });
});
