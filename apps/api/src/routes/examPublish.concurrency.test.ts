import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import { createPostgresDatabase, migratePostgres } from "@exam/db/postgres";
import { setupIsolatedTestDb } from "@exam/db/testIsolation";
import { schema } from "@exam/db/schema/pg";
import { createUserRepo } from "@exam/db/repository/userRepo";
import { createUserRoleAssignmentRepo } from "@exam/db/repository/userRoleAssignmentRepo";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { eq } from "drizzle-orm";
import type { Database, TenantContext } from "@exam/db/types";
import {
  getRuntimeConfig,
  resetRuntimeConfigForTest,
} from "../config/runtimeConfig.js";
import setupSecurity from "../plugins/security.js";
import { setupErrorHandler } from "../plugins/errors.js";
import zodProviderPlugin from "../plugins/zodProvider.js";
import auditLifecyclePlugin from "../plugins/auditLifecycle.js";
import nowPlugin from "../plugins/now.js";
import authPlugin from "../plugins/auth.js";
import authzScopedPlugin from "../plugins/authz.js";
import emailPlugin from "../plugins/email.js";
import examRoutes from "./exam.js";

/**
 * WP-03 R-T2-2 (#1065): publish must decide against the exam truth that is
 * committed under its lock (ADR-005 construction hard rule — publish is a
 * named member of the lock-reconcile-assert-mutate admin-op family).
 *
 * Deterministic schedule (real PostgreSQL row-lock parking, no inter-flow
 * sleeps; barrier observed via pg_locks/pg_blocking_pids):
 *
 *   Observer tx — parks the exam row FOR UPDATE and applies the draft-PATCH
 *     questionIds/totalScore write UNCOMMITTED (the exact persistence effect
 *     of the exam.ts PATCH route running inside its own findByIdForUpdate).
 *   Publish — the real POST /publish route. Its out-of-transaction pre-read
 *     can only see the last committed state (questionIds=[q1]); the patch is
 *     uncommitted. Its transaction then blocks writing the exam row.
 *   Barrier — publish's transaction is provably parked on the observer row
 *     lock before release.
 *   Observer COMMIT — the committed patch lands while publish is parked
 *     mid-transaction. Whatever publish does next must observe [q1,q2].
 *
 * Contract under test: the parked publisher must complete as 200 with a
 * frozen snapshot covering the committed question set exactly once. The
 * as-built route freezes the stale pre-read question list instead: on
 * release its transaction retries on the committed patch, then fails 400
 * "Question <q2> not found" with no snapshot and no audit — the assertion
 * below fails on that shape (RED witness).
 *
 * Isolation: per-file schema via setupIsolatedTestDb (testing.md §2.8);
 * schema lifecycle is released by cleanup in afterAll.
 */

type PostgresConnection = Awaited<ReturnType<typeof createPostgresDatabase>>;
type TestApp = ReturnType<typeof Fastify>;

describe("POST /api/exams/:id/publish — decides on the exam truth committed under its lock", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbMain: Database;
  let connMain: PostgresConnection;
  let connPublish: PostgresConnection;
  let observer: postgres.Sql;
  let observerPid: number;
  let app: TestApp;
  let cleanupAll: () => Promise<void>;
  let token: string;
  let orgId: string;
  let courseId: string;
  let examId: string;
  let q1Id: string;
  let q2Id: string;

  /**
   * Resolves once SOME backend is blocked on the observer's open transaction
   * (the row-lock parking gate) — proof the publish transaction is parked
   * mid-flight on the uncommitted patch.
   */
  async function waitForPublishParked(timeoutMs = 8_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = (await observer.unsafe(
        `SELECT l.pid FROM pg_locks l
         WHERE l.granted = false
           AND $1 = ANY(pg_blocking_pids(l.pid))
         LIMIT 1`,
        [observerPid],
      )) as Array<{ pid: number }>;
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `No backend blocked on the observer row lock within ${timeoutMs}ms — the parking schedule did not engage`,
    );
  }

  async function examRow() {
    const rows = await dbMain
      .select({
        status: schema.exams.status,
        questionIds: schema.exams.questionIds,
        questionSnapshot: schema.exams.questionSnapshot,
        totalScore: schema.exams.totalScore,
      })
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    return rows[0]!;
  }

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "exam_publish_lock" });
    // OWNERSHIP: the schema must be dropped even if a later setup step
    // throws — register the floor cleanup immediately.
    cleanupAll = async () => {
      await iso.cleanup();
    };
    const mk = async () =>
      await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    connMain = await mk();
    connPublish = await mk();
    dbMain = connMain.db;
    observer = postgres(iso.databaseUrl, { max: 1 });
    await observer.unsafe(`SET search_path TO "${iso.schemaName}"`);
    const pidRows = (await observer.unsafe(
      `SELECT pg_backend_pid() AS pid`,
    )) as Array<{ pid: number }>;
    observerPid = pidRows[0]!.pid;

    // Only the FIRST connection migrates; the others share the schema.
    await migratePostgres(dbMain, { migrationsSchema: iso.schemaName });

    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();

    const now = new Date();
    orgId = randomUUID();
    courseId = randomUUID();
    q1Id = randomUUID();
    q2Id = randomUUID();
    examId = randomUUID();

    await dbMain.insert(schema.organizations).values({
      id: orgId,
      name: "exam-publish-lock",
      displayName: "exam-publish-lock",
      slug: `exam-publish-lock-${orgId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    const ctx: TenantContext = {
      organizationId: orgId,
      actorId: "setup",
      role: "Admin",
      permissions: [],
    };
    const admin = await createUserRepo(dbMain).create(ctx, {
      username: `admin-${randomUUID().slice(0, 8)}`,
      passwordHash: await hashPassword("password123"),
      name: "Admin",
      role: "Admin",
      isActive: true,
    });
    await createUserRoleAssignmentRepo(dbMain).assign(ctx, {
      userId: admin.id,
      role: "Admin",
      isPrimary: true,
      isActive: true,
    });
    token = signJWT(
      {
        actorId: admin.id,
        role: "Admin",
        organizationId: orgId,
        authEpoch: admin.authEpoch,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );

    await dbMain.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: "Course",
      code: `C-${randomUUID().slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    const mkQuestion = async (qid: string) => {
      await dbMain.insert(schema.questions).values({
        id: qid,
        organizationId: orgId,
        courseId,
        type: "single_choice",
        content: "v1 content",
        options: [
          { id: randomUUID(), content: "opt A", isCorrect: true },
          { id: randomUUID(), content: "opt B", isCorrect: false },
        ],
        standardAnswer: "opt A",
        attachments: [],
        score: 10,
        difficulty: 1,
        tags: [],
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        createdAt: now,
        updatedAt: now,
      });
    };
    await mkQuestion(q1Id);
    await mkQuestion(q2Id);
    await dbMain.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "Publish Lock Exam",
      description: "",
      courseId,
      status: "draft",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86_400_000),
      passingScore: 6,
      totalScore: 10,
      questionSelectionMode: "manual",
      questionIds: [q1Id],
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
        showResultImmediately: false,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(
      fp(async (fastify: FastifyInstance) => {
        fastify.decorate("db", connPublish.db);
      }),
    );
    await app.register(auditLifecyclePlugin);
    await app.register(nowPlugin);
    await app.register(authPlugin);
    await app.register(authzScopedPlugin);
    await app.register(emailPlugin);
    await app.register(examRoutes, { prefix: "/api" });
    await app.ready();

    const floorCleanup = cleanupAll;
    cleanupAll = async () => {
      await Promise.allSettled([
        app.close(),
        connMain.sql.end(),
        connPublish.sql.end(),
        observer.end(),
      ]);
      await floorCleanup();
    };
  }, 60_000);

  afterAll(async () => {
    if (cleanupAll) await cleanupAll();
  }, 30_000);

  it("a concurrent draft questionIds-add committed while publish is parked must land inside the frozen snapshot; publish never fails on its own stale pre-read", async () => {
    // 1. Park the exam row under the observer transaction with the
    //    draft-PATCH effect applied but uncommitted (exam.ts PATCH persists
    //    questionIds + the matching totalScore inside findByIdForUpdate).
    await observer.unsafe("BEGIN");
    await observer.unsafe(`SELECT id FROM exams WHERE id = $1 FOR UPDATE`, [
      examId,
    ]);
    await observer.unsafe(
      `UPDATE exams SET question_ids = $1::jsonb, total_score = 20, updated_at = now() WHERE id = $2`,
      [JSON.stringify([q1Id, q2Id]), examId],
    );

    let publishPromise: ReturnType<TestApp["inject"]> | undefined;
    let publishRes: Awaited<ReturnType<TestApp["inject"]>> | undefined;
    try {
      // 2. Fire the real publish route; only the committed state ([q1]) is
      //    visible to anything it reads before parking.
      publishPromise = app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": token },
      });

      // 3. Deterministic gate: publish's transaction is parked on the row
      //    lock before release.
      await waitForPublishParked();

      // 4. Release — the patch commits while publish is parked mid-flight.
      await observer.unsafe("COMMIT");
      publishRes = await publishPromise;
    } finally {
      await observer.unsafe("ROLLBACK").catch(() => undefined);
      // Settle the route promise even on a barrier failure so the vitest
      // worker never inherits an unhandled rejection from a parked flow.
      if (publishPromise) await publishPromise.catch(() => undefined);
    }

    const row = await examRow();
    // Schedule engagement (precondition, not the contract): the patch really
    // committed first, so the parked publisher faced [q1,q2].
    expect(row.questionIds).toEqual([q1Id, q2Id]);

    // Contract: publish succeeds against the committed truth.
    expect(publishRes!.statusCode).toBe(200);
    expect(publishRes!.json().status).toBe("published");
    expect(row.status).toBe("published");

    // The frozen snapshot covers the committed question set — no divergence
    // between exam.questionIds and the persisted snapshot.
    expect(row.questionSnapshot.map((s) => s.originalQuestionId)).toEqual([
      q1Id,
      q2Id,
    ]);
    expect(row.totalScore).toBe(20);

    // Exactly one publish audit for the single winner.
    const audits = await dbMain
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, examId));
    expect(audits.filter((a) => a.action === "exam.publish")).toHaveLength(1);
  }, 30_000);
});
