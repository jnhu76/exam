import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";
import { createDatabase } from "../database.js";
import { migratePostgres } from "../postgres.js";
import { schema } from "../schema/pg.js";

describe("heartbeat/scanner commit-order serialization — real PostgreSQL", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let adminSql: postgres.Sql;

  const orgId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const userId = randomUUID();
  const candidateId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptId = randomUUID();

  const staleLastActivity = new Date("2026-01-01T00:00:00.000Z");
  const scannerTick = new Date("2026-01-01T00:05:00.000Z");
  const heartbeatRefresh = new Date("2026-01-01T00:04:59.000Z");
  const deadline = new Date("2026-01-01T01:00:00.000Z");

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "heartbeatorder" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });

    adminSql = postgres(iso.databaseUrl, { max: 5 });
    await adminSql.unsafe(`SET search_path TO "${iso.schemaName}"`);

    const now = new Date("2025-12-31T00:00:00.000Z");
    await conn.db.insert(schema.organizations).values({
      id: orgId,
      name: "HB Order Org",
      displayName: "HB Order Org",
      slug: `hb-order-${orgId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: "HB Course",
      code: `HB-${courseId.slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.users).values({
      id: userId,
      organizationId: orgId,
      username: `hb-${userId.slice(0, 8)}`,
      passwordHash: "hash",
      name: "HB User",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId: orgId,
      userId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await conn.db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "HB Exam",
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
      organizationId: orgId,
      examId,
      candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  }, 30_000);

  afterAll(async () => {
    if (adminSql) await adminSql.end();
    if (conn) await conn.sql.end();
    if (iso) await iso.cleanup();
  }, 30_000);

  async function seedAttempt(): Promise<void> {
    await conn.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: orgId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: new Date("2025-12-31T01:00:00.000Z"),
      deadlineAt: deadline,
      lastActivityAt: staleLastActivity,
      createdAt: new Date("2025-12-31T00:00:00.000Z"),
      updatedAt: new Date("2025-12-31T00:00:00.000Z"),
    });
  }

  async function cleanupAttempt(): Promise<void> {
    await conn.sql.unsafe(
      `UPDATE "exam_attempts" SET "current_interruption_id" = NULL, "interrupted_at" = NULL, "status" = 'in_progress' WHERE "id" = '${attemptId}' AND "status" = 'disrupted'`,
    );
    await conn.sql.unsafe(
      `DELETE FROM "attempt_interruption_events" WHERE "attempt_id" = '${attemptId}'`,
    );
    await conn.sql.unsafe(
      `DELETE FROM "attempt_interruptions" WHERE "attempt_id" = '${attemptId}'`,
    );
    await conn.sql.unsafe(
      `DELETE FROM "exam_attempts" WHERE "id" = '${attemptId}'`,
    );
  }

  it("heartbeat commits first → scanner sees fresh lastActivityAt → fresh_under_lock", async () => {
    await seedAttempt();

    const hbSql = postgres(iso.databaseUrl, { max: 1 });
    await hbSql.unsafe(`SET search_path TO "${iso.schemaName}"`);
    const scSql = postgres(iso.databaseUrl, { max: 1 });
    await scSql.unsafe(`SET search_path TO "${iso.schemaName}"`);

    try {
      await hbSql.begin(async (hbTx) => {
        const updated = await hbTx.unsafe(
          `UPDATE "exam_attempts"
           SET "last_activity_at" = '${heartbeatRefresh.toISOString()}', "updated_at" = now()
           WHERE "id" = '${attemptId}' AND "status" = 'in_progress'
           RETURNING "id"`,
        );
        expect(updated.length).toBe(1);
      });

      const result = await scSql.begin(async (scTx) => {
        const locked = await scTx.unsafe(
          `SELECT "status", "last_activity_at" FROM "exam_attempts"
           WHERE "id" = '${attemptId}' FOR UPDATE`,
        );
        expect(locked.length).toBe(1);
        const row = locked[0] as unknown as {
          status: string;
          last_activity_at: Date;
        };
        expect(row.status).toBe("in_progress");
        const lastActivity = new Date(row.last_activity_at);
        const elapsed = scannerTick.getTime() - lastActivity.getTime();
        const timeoutMs = 60 * 1000;
        return elapsed < timeoutMs ? "fresh_under_lock" : "stale";
      });

      expect(result).toBe("fresh_under_lock");

      const final = await conn.sql.unsafe(
        `SELECT "status", "current_interruption_id" FROM "exam_attempts" WHERE "id" = '${attemptId}'`,
      );
      expect((final[0] as unknown as { status: string }).status).toBe(
        "in_progress",
      );
      expect(
        (final[0] as unknown as { current_interruption_id: string | null })
          .current_interruption_id,
      ).toBeNull();

      const episodes = await conn.sql.unsafe(
        `SELECT count(*) as cnt FROM "attempt_interruptions" WHERE "attempt_id" = '${attemptId}'`,
      );
      expect(Number((episodes[0] as unknown as { cnt: string }).cnt)).toBe(0);

      const events = await conn.sql.unsafe(
        `SELECT count(*) as cnt FROM "attempt_interruption_events" WHERE "attempt_id" = '${attemptId}'`,
      );
      expect(Number((events[0] as unknown as { cnt: string }).cnt)).toBe(0);
    } finally {
      await hbSql.end();
      await scSql.end();
      await cleanupAttempt();
    }
  });

  it("scanner commits first → heartbeat conditional update returns null", async () => {
    await seedAttempt();

    const hbSql = postgres(iso.databaseUrl, { max: 1 });
    await hbSql.unsafe(`SET search_path TO "${iso.schemaName}"`);
    const scSql = postgres(iso.databaseUrl, { max: 1 });
    await scSql.unsafe(`SET search_path TO "${iso.schemaName}"`);

    try {
      const hbPreRead = await hbSql.unsafe(
        `SELECT "status" FROM "exam_attempts" WHERE "id" = '${attemptId}'`,
      );
      expect((hbPreRead[0] as unknown as { status: string }).status).toBe(
        "in_progress",
      );

      const episodeId = randomUUID();
      const eventId = randomUUID();
      await scSql.begin(async (scTx) => {
        const locked = await scTx.unsafe(
          `SELECT "status", "last_activity_at", "interruption_time_policy_snapshot"
           FROM "exam_attempts" WHERE "id" = '${attemptId}' FOR UPDATE`,
        );
        expect(locked.length).toBe(1);
        const row = locked[0] as unknown as {
          status: string;
          last_activity_at: Date;
          interruption_time_policy_snapshot: string;
        };
        expect(row.status).toBe("in_progress");
        const elapsed =
          scannerTick.getTime() - new Date(row.last_activity_at).getTime();
        expect(elapsed).toBeGreaterThanOrEqual(60_000);

        await scTx.unsafe(
          `INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at")
           VALUES ('${episodeId}', '${orgId}', '${attemptId}', '${scannerTick.toISOString()}')`,
        );
        await scTx.unsafe(
          `INSERT INTO "attempt_interruption_events" (
             "id", "organization_id", "attempt_id", "interruption_id",
             "event_type", "occurred_at", "observed_last_activity_at",
             "detection_source", "timeout_seconds", "policy",
             "eligible_seconds", "time_adjustment_id", "actor_id",
             "reason_code", "created_at"
           ) VALUES (
             '${eventId}', '${orgId}', '${attemptId}', '${episodeId}',
             'detected', '${scannerTick.toISOString()}', '${staleLastActivity.toISOString()}',
             'heartbeat_timeout', 60, '${row.interruption_time_policy_snapshot}',
             NULL, NULL, NULL, 'heartbeat_timeout', '${scannerTick.toISOString()}'
           )`,
        );
        await scTx.unsafe(
          `UPDATE "exam_attempts"
           SET "status" = 'disrupted',
               "current_interruption_id" = '${episodeId}',
               "interrupted_at" = '${scannerTick.toISOString()}',
               "updated_at" = now()
           WHERE "id" = '${attemptId}'`,
        );
      });

      const hbResult = await hbSql.unsafe(
        `UPDATE "exam_attempts"
         SET "last_activity_at" = '${heartbeatRefresh.toISOString()}', "updated_at" = now()
         WHERE "id" = '${attemptId}' AND "status" = 'in_progress'
         RETURNING "id"`,
      );
      expect(hbResult.length).toBe(0);

      const final = await conn.sql.unsafe(
        `SELECT "status", "last_activity_at", "current_interruption_id"
         FROM "exam_attempts" WHERE "id" = '${attemptId}'`,
      );
      const finalRow = final[0] as unknown as {
        status: string;
        last_activity_at: Date;
        current_interruption_id: string;
      };
      expect(finalRow.status).toBe("disrupted");
      expect(new Date(finalRow.last_activity_at)).toEqual(staleLastActivity);
      expect(finalRow.current_interruption_id).toBe(episodeId);
    } finally {
      await hbSql.end();
      await scSql.end();
      await cleanupAttempt();
    }
  });
});
