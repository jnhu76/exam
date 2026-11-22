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
 * named member of the lock-reconcile-assert-mutate admin-op family). Three
 * concurrent-interleaving groups, each on its own draft exam, driven by real
 * PostgreSQL row-lock parking (no inter-flow sleeps; barrier observed via
 * pg_locks/pg_blocking_pids):
 *
 * 1. publish vs draft-PATCH questionIds-add — the observer tx parks the exam
 *    row FOR UPDATE with the PATCH persistence effect (questionIds +
 *    totalScore) applied UNCOMMITTED (the exam.ts PATCH route's own
 *    findByIdForUpdate effect); publish parks on that lock with its
 *    out-of-transaction pre-read already stale, then the patch commits. The
 *    parked publisher must complete 200 with a frozen snapshot covering the
 *    committed question set exactly once — the as-built route instead failed
 *    400 "Question <q2> not found" (the misleading-validation RED witness).
 *
 * 2. publish x publish — both publishers park on the observer row lock
 *    before release. Exactly one may win: one 200, the loser a stable
 *    ExamAlreadyPublishedError 409 (never a serialization artifact), and
 *    exactly one exam.publish audit (single-winner, no duplicate audit).
 *
 * 3. publish vs question content edit — the bank edit commits while the
 *    publisher is provably parked, i.e. after any out-of-transaction
 *    pre-read could have run and before the locked transaction's
 *    question read. The frozen snapshot must equal the content read inside
 *    the locked transaction (v2), freezing the pre-read-window divergence.
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
  let connPublishB: PostgresConnection;
  let observer: postgres.Sql;
  let observerPid: number;
  let app: TestApp;
  let appB: TestApp;
  let cleanupAll: () => Promise<void>;
  let token: string;
  let orgId: string;
  let courseId: string;
  let q1Id: string;
  let q2Id: string;

  /**
   * Resolves once at least `minCount` backends are parked in the transitive
   * lock wait chain rooted at the observer's open transaction (the row-lock
   * parking gate) — proof that minCount publish transactions are parked
   * mid-flight. The chain matters because a second publisher queues behind
   * the first: its reported blocker is the first publisher, not the
   * observer.
   */
  async function waitForPublishParked(
    minCount = 1,
    timeoutMs = 8_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Transitive wait chain rooted at the observer's lock: the SECOND
      // publisher queues behind the first, so pg_blocking_pids reports p1 —
      // not the observer — as its blocker. A publisher counts as parked when
      // its wait chain reaches the observer.
      const rows = (await observer.unsafe(
        `WITH RECURSIVE park AS (
           SELECT a.pid FROM pg_stat_activity a
           WHERE $1 = ANY(pg_blocking_pids(a.pid))
             AND a.wait_event_type = 'Lock'
           UNION
           SELECT a.pid FROM pg_stat_activity a
           JOIN park ON park.pid = ANY(pg_blocking_pids(a.pid))
           WHERE a.wait_event_type = 'Lock'
         )
         SELECT count(*)::int AS n FROM park`,
        [observerPid],
      )) as Array<{ n: number }>;
      if ((rows[0]?.n ?? 0) >= minCount) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Only fewer than ${minCount} backends parked in the observer's lock wait chain within ${timeoutMs}ms — the parking schedule did not engage`,
    );
  }

  /** Inserts a fresh draft exam (questionIds=[q1], totalScore 10). */
  async function insertDraftExam(title: string): Promise<string> {
    const now = new Date();
    const id = randomUUID();
    await dbMain.insert(schema.exams).values({
      id,
      organizationId: orgId,
      title,
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
    return id;
  }

  async function examRow(id: string) {
    const rows = await dbMain
      .select({
        status: schema.exams.status,
        questionIds: schema.exams.questionIds,
        questionSnapshot: schema.exams.questionSnapshot,
        totalScore: schema.exams.totalScore,
      })
      .from(schema.exams)
      .where(eq(schema.exams.id, id));
    return rows[0]!;
  }

  async function publishAuditCount(id: string): Promise<number> {
    const rows = await dbMain
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, id));
    return rows.filter((a) => a.action === "exam.publish").length;
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
    connPublishB = await mk();
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

    const buildApp = async (db: Database): Promise<TestApp> => {
      const instance = Fastify();
      setupSecurity(instance);
      setupErrorHandler(instance);
      await instance.register(zodProviderPlugin);
      await instance.register(fastifyCookie);
      await instance.register(
        fp(async (fastify: FastifyInstance) => {
          fastify.decorate("db", db);
        }),
      );
      await instance.register(auditLifecyclePlugin);
      await instance.register(nowPlugin);
      await instance.register(authPlugin);
      await instance.register(authzScopedPlugin);
      await instance.register(emailPlugin);
      await instance.register(examRoutes, { prefix: "/api" });
      await instance.ready();
      return instance;
    };
    app = await buildApp(connPublish.db);
    appB = await buildApp(connPublishB.db);

    const floorCleanup = cleanupAll;
    cleanupAll = async () => {
      await Promise.allSettled([
        app.close(),
        appB.close(),
        connMain.sql.end(),
        connPublish.sql.end(),
        connPublishB.sql.end(),
        observer.end(),
      ]);
      await floorCleanup();
    };
  }, 60_000);

  afterAll(async () => {
    if (cleanupAll) await cleanupAll();
  }, 30_000);

  it("group 1 — a concurrent draft questionIds-add committed while publish is parked must land inside the frozen snapshot; publish never fails on its own stale pre-read", async () => {
    const examId = await insertDraftExam("Patch Race Exam");
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

    const row = await examRow(examId);
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
    expect(await publishAuditCount(examId)).toBe(1);
  }, 30_000);

  it("group 2 — publish x publish: exactly one 200, the loser a stable ExamAlreadyPublishedError 409, exactly one exam.publish audit", async () => {
    const examId = await insertDraftExam("Publish Race Exam");
    // Park BOTH publishers on the observer row lock before release: each
    // request is emitted only after the previous one is proven parked, so
    // both transactions are mid-flight when the row unlocks. The lock then
    // serializes them; whichever transaction is granted second re-reads the
    // committed published status under the winner's lock and must fail with
    // the stable conflict code — never a serialization artifact.
    await observer.unsafe("BEGIN");
    await observer.unsafe(`SELECT id FROM exams WHERE id = $1 FOR UPDATE`, [
      examId,
    ]);

    let p1: ReturnType<TestApp["inject"]> | undefined;
    let p2: ReturnType<TestApp["inject"]> | undefined;
    let res1: Awaited<ReturnType<TestApp["inject"]>> | undefined;
    let res2: Awaited<ReturnType<TestApp["inject"]>> | undefined;
    try {
      p1 = app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": token },
      });
      await waitForPublishParked(1);
      p2 = appB.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": token },
      });
      await waitForPublishParked(2);
      await observer.unsafe("COMMIT");
      [res1, res2] = await Promise.all([p1, p2]);
    } finally {
      await observer.unsafe("ROLLBACK").catch(() => undefined);
      // Settle both route promises even on a barrier failure.
      if (p1) await p1.catch(() => undefined);
      if (p2) await p2.catch(() => undefined);
    }

    // Single-winner invariant, independent of grant order.
    const statuses = [res1!.statusCode, res2!.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const winner = res1!.statusCode === 200 ? res1! : res2!;
    const loser = res1!.statusCode === 409 ? res1! : res2!;
    expect(winner.json().status).toBe("published");
    expect(loser.json().error.code).toBe("EXAM_ALREADY_PUBLISHED");

    // Exactly one published row state: snapshot [q1], one publish audit.
    const row = await examRow(examId);
    expect(row.status).toBe("published");
    expect(row.questionIds).toEqual([q1Id]);
    expect(row.questionSnapshot.map((s) => s.originalQuestionId)).toEqual([
      q1Id,
    ]);
    expect(await publishAuditCount(examId)).toBe(1);
  }, 30_000);

  it("group 3 — publish vs question content edit committed while publish is parked: the frozen snapshot equals the locked transaction's read, no pre-read window divergence", async () => {
    const examId = await insertDraftExam("Content Edit Race Exam");
    // Park the publisher first, THEN commit the bank edit: any
    // out-of-transaction pre-read ran before parking and captured v1, while
    // the locked transaction's question read happens after release and must
    // observe the committed v2. The frozen snapshot must therefore be v2 —
    // the pre-fix route froze the stale pre-read v1 here.
    await observer.unsafe("BEGIN");
    await observer.unsafe(`SELECT id FROM exams WHERE id = $1 FOR UPDATE`, [
      examId,
    ]);

    let publishPromise: ReturnType<TestApp["inject"]> | undefined;
    let publishRes: Awaited<ReturnType<TestApp["inject"]>> | undefined;
    try {
      publishPromise = app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": token },
      });
      await waitForPublishParked();

      // The bank edit touches NO exam row — it commits freely while the
      // publisher is parked mid-transaction.
      await dbMain
        .update(schema.questions)
        .set({ content: "v2 EDITED", updatedAt: new Date() })
        .where(eq(schema.questions.id, q1Id));

      await observer.unsafe("COMMIT");
      publishRes = await publishPromise;
    } finally {
      await observer.unsafe("ROLLBACK").catch(() => undefined);
      if (publishPromise) await publishPromise.catch(() => undefined);
    }

    expect(publishRes!.statusCode).toBe(200);
    expect(publishRes!.json().status).toBe("published");

    const row = await examRow(examId);
    expect(row.status).toBe("published");
    expect(row.questionIds).toEqual([q1Id]);
    // The frozen content is what the locked transaction read: the committed
    // bank truth at lock time, not a stale pre-read capture.
    expect(row.questionSnapshot[0]!.content).toBe("v2 EDITED");
    expect(row.questionSnapshot.map((s) => s.originalQuestionId)).toEqual([
      q1Id,
    ]);
    expect(await publishAuditCount(examId)).toBe(1);
  }, 30_000);
});
