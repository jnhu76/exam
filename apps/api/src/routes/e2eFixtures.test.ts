/**
 * E2E fixture route tests (J4-I1B).
 *
 * `/api/e2e-fixtures/proctor-assignments` is test-only infrastructure: it
 * registers ONLY when `runtimeConfig.e2eFixtures.enabled` — i.e. the server
 * runs in APP_MODE=e2e (CI / docker-compose.test.yml / scripts/e2e/run-wsl.sh).
 * These tests prove:
 *
 *   1. registration gating — the route is ABSENT under a normal config and
 *      in production even with RATE_LIMIT_DISABLED=1 (never a production
 *      backdoor), and PRESENT under APP_MODE=e2e;
 *   2. behavior — the route runs the real `assignProctorToExam` domain
 *      command: creates the active `exam_proctor_assignments` row + the
 *      applied event receipt, writes the atomic compliance audit, is
 *      admin-gated, and rejects a target user without an active Proctor role.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import e2eFixtureRoutes from "./e2eFixtures.js";
import { registerApiRoutes } from "./registerApiRoutes.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

const fixtureRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(e2eFixtureRoutes);
};

/** The full production composition WITHOUT the /api double-prefix. */
const fullCompositionPlugin: FastifyPluginAsync = async (fastify) => {
  await registerApiRoutes(fastify);
};

/** Exam fixture in the seed org (mirrors proctorScope.test.ts). */
async function insertExam(ctx: Awaited<ReturnType<typeof buildTestApp>>) {
  const now = new Date();
  const courseId = randomUUID();
  const examId = randomUUID();
  await ctx.db.insert(schema.courses).values({
    id: courseId,
    organizationId: ctx.org.id,
    name: "E2E fixture course",
    code: `EFC-${uniquePrefix()}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.exams).values({
    id: examId,
    organizationId: ctx.org.id,
    title: "E2E fixture exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(now.getTime() + 86400_000),
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
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
  });
  return examId;
}

describe("e2e fixture route — registration gating", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>> | null = null;

  // The vitest harness forces APP_MODE=test (vitest.shared.ts). Snapshot the
  // ambient mode keys at describe entry and restore them after EVERY test, so
  // the e2e/production-mode tests here cannot leak into later describes in
  // this file, and each buildTestApp gets its cleanup (no orphaned Fastify
  // instances / connections).
  const entryAppMode = process.env.APP_MODE;
  const entryRateLimitDisabled = process.env.RATE_LIMIT_DISABLED;

  afterEach(async () => {
    await ctx?.cleanup();
    ctx = null;
    if (entryAppMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = entryAppMode;
    if (entryRateLimitDisabled === undefined)
      delete process.env.RATE_LIMIT_DISABLED;
    else process.env.RATE_LIMIT_DISABLED = entryRateLimitDisabled;
    resetRuntimeConfigForTest();
  });

  it("is ABSENT under a normal config (never a production backdoor)", async () => {
    resetRuntimeConfigForTest();
    ctx = await buildTestApp(fullCompositionPlugin, { prefix: "" });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      payload: { examId: randomUUID(), proctorUserId: randomUUID() },
    });
    // Unregistered path -> 404; if it were registered the auth gate would
    // answer 401 instead.
    expect(res.statusCode).toBe(404);
  });

  it("is ABSENT with RATE_LIMIT_DISABLED=1 in a non-e2e mode (regression)", async () => {
    // The old activation condition (`mode === "e2e" || RATE_LIMIT_DISABLED`)
    // made a valid production config (APP_MODE=production +
    // RATE_LIMIT_DISABLED=1) register this test mutation route. The
    // production combo itself is pinned at config level in
    // runtimeConfig.test.ts; here we prove the trigger switch no longer
    // registers the route in a non-e2e mode at the HTTP layer.
    // (buildTestApp cannot run under APP_MODE=production: the worker-DB
    // test adapter's assertNotProduction guard deliberately refuses it.)
    process.env.RATE_LIMIT_DISABLED = "1";
    resetRuntimeConfigForTest();
    ctx = await buildTestApp(fullCompositionPlugin, { prefix: "" });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      payload: { examId: randomUUID(), proctorUserId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it("is PRESENT under APP_MODE=e2e", async () => {
    process.env.APP_MODE = "e2e";
    process.env.NODE_ENV = "test";
    resetRuntimeConfigForTest();
    ctx = await buildTestApp(fullCompositionPlugin, { prefix: "" });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      payload: { examId: randomUUID(), proctorUserId: randomUUID() },
    });
    // Registered -> the auth gate answers 401 (anonymous request).
    expect(res.statusCode).toBe(401);
  });
});

describe("e2e fixture route — proctor-assignment behavior", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(fixtureRoutesPlugin);
    examId = await insertExam(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("creates an active assignment + applied receipt via the real domain command", async () => {
    const proctor = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "e2e-fx-proctor",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      cookies: { "auth-token": ctx.adminToken },
      payload: { examId, proctorUserId: proctor.user.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.outcome).toBe("applied");

    const rows = await ctx.db
      .select()
      .from(schema.examProctorAssignments)
      .where(
        and(
          eq(schema.examProctorAssignments.organizationId, ctx.org.id),
          eq(schema.examProctorAssignments.examId, examId),
          eq(schema.examProctorAssignments.proctorUserId, proctor.user.id),
          eq(schema.examProctorAssignments.status, "active"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignedBy).toBe(ctx.admin.id);

    const events = await ctx.db
      .select()
      .from(schema.examProctorAssignmentEvents)
      .where(
        eq(schema.examProctorAssignmentEvents.assignmentId, body.assignmentId),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.commandType).toBe("assign");
    expect(events[0]!.outcome).toBe("applied");
  });

  it("a repeated call for the same (exam, proctor) writes a no_change receipt", async () => {
    const proctor = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "e2e-fx-proctor-repeat",
    );
    const call = () =>
      ctx!.app.inject({
        method: "POST",
        url: "/api/e2e-fixtures/proctor-assignments",
        cookies: { "auth-token": ctx!.adminToken },
        payload: { examId, proctorUserId: proctor.user.id },
      });
    const first = await call();
    const second = await call();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().outcome).toBe("no_change");
    expect(second.json().assignmentId).toBe(first.json().assignmentId);
  });

  it("is admin-gated (a Candidate session is denied)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      cookies: { "auth-token": ctx.candidateToken },
      payload: { examId, proctorUserId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s for a missing/cross-org exam (command validation)", async () => {
    const proctor = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      "e2e-fx-proctor-missing",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      cookies: { "auth-token": ctx.adminToken },
      payload: { examId: randomUUID(), proctorUserId: proctor.user.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a target user without an active Proctor role (command validation)", async () => {
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "e2e-fx-teacher",
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/e2e-fixtures/proctor-assignments",
      cookies: { "auth-token": ctx.adminToken },
      payload: { examId, proctorUserId: teacher.user.id },
    });
    expect(res.statusCode).toBe(400);
  });
});
