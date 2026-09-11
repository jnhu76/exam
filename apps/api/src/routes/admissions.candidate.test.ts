/**
 * #292 — durable admission runtime: candidate API contract + concurrency.
 *
 * Wire vocabulary is unchanged from the legacy gate (waiting/ready +
 * position); the AUTHORITY behind it is the durable exam_admissions row.
 * Concurrency cases use real PostgreSQL (no mocked repositories):
 *   C1 duplicate join → one durable membership
 *   C2 duplicate admission → one admitted fact
 *   C3 duplicate start → one attempt, one consumption
 *   C4 admit-vs-start race → deterministic legal convergence
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

type Json = Record<string, unknown>;

function asRecord(json: unknown): Json {
  if (json !== null && typeof json === "object") return json as Json;
  throw new Error(`expected JSON object: ${JSON.stringify(json)}`);
}

describe("durable admission candidate API (#292)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let adminToken = "";
  const candidates: { profileId: string; token: string }[] = [];

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(courseRoutes, { prefix: "" });
      await fastify.register(questionRoutes, { prefix: "" });
    });
    adminToken = ctx.adminToken;
    const slug = uniquePrefix();

    // batchSize=1, interval=1h → only the queue head is ever eligible.
    const course = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: `QA course ${slug}`,
        code: `QA-${slug}`,
        description: "",
      },
      cookies: { "auth-token": adminToken },
    });
    if (course.statusCode !== 201) {
      throw new Error(
        `course setup failed ${course.statusCode}: ${course.body}`,
      );
    }
    const courseId = asRecord(course.json()).id as string;
    const question = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: `QA question ${slug}: 2+2=4`,
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": adminToken },
    });
    const nowMs = Date.now();
    const exam = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `QA exam ${slug}`,
        courseId,
        durationMinutes: 60,
        openAt: new Date(nowMs - 5_000).toISOString(),
        closeAt: new Date(nowMs + 3_600_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [asRecord(question.json()).id as string],
        controlFlags: { requireQueue: true, batchSize: 1, batchInterval: 3600 },
      },
      cookies: { "auth-token": adminToken },
    });
    examId = asRecord(exam.json()).id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": adminToken },
    });

    for (let i = 1; i <= 3; i += 1) {
      const now = new Date();
      const userId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: userId,
        organizationId: ctx.org.id,
        username: `qa${i}-${slug}`,
        passwordHash: await hashPassword("password123"),
        name: `QA Candidate ${i}`,
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const profileId = crypto.randomUUID();
      await ctx.db.insert(schema.candidateProfiles).values({
        id: profileId,
        organizationId: ctx.org.id,
        userId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      });
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      candidates.push({
        profileId,
        token: signJWT(
          {
            actorId: userId,
            role: rows[0]!.role as never,
            organizationId: ctx.org.id,
            authEpoch: rows[0]!.authEpoch,
          },
          getRuntimeConfig().authSecret.jwtSecret,
        ),
      });
    }

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: candidates.map((c) => c.profileId) },
      cookies: { "auth-token": adminToken },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  const queue = (token: string) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/queue`,
      cookies: { "auth-token": token },
    });
  const start = (token: string) =>
    ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": token },
    });

  it("Q2: a candidate without durable membership cannot start (no lazy join)", async () => {
    const res = await start(candidates[2]!.token);
    expect(res.statusCode).toBe(409);
    expect(asRecord(res.json())).toBeDefined();
    const memberships = await ctx.db
      .select()
      .from(schema.examAdmissions)
      .where(eq(schema.examAdmissions.examId, examId));
    expect(memberships).toHaveLength(0);
  });

  it("Q4/C1: retried AND concurrent joins converge on ONE durable membership", async () => {
    const [first, second] = candidates;
    const r1 = await queue(first!.token);
    expect(r1.json()).toMatchObject({ status: "ready", position: 1 });
    const retry = await queue(first!.token);
    expect(retry.json()).toMatchObject({ position: 1 });

    const [a, b] = await Promise.all([
      queue(second!.token),
      queue(second!.token),
    ]);
    expect(a.json()).toMatchObject({ status: "waiting", position: 2 });
    expect(b.json()).toMatchObject({ status: "waiting", position: 2 });

    const rows = await ctx.db
      .select()
      .from(schema.examAdmissions)
      .where(
        and(
          eq(schema.examAdmissions.examId, examId),
          eq(schema.examAdmissions.candidateId, second!.profileId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("Q2/Q3: the batch cap binds while the head holds its slot", async () => {
    const tail = await start(candidates[1]!.token);
    expect(tail.statusCode).toBe(409);
    const attempts = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.examId, examId));
    expect(attempts).toHaveLength(0);
  });

  it("Q6/C3: duplicate start converges on ONE attempt and ONE consumption", async () => {
    const [first] = candidates;

    const [r1, r2] = await Promise.all([
      start(first!.token),
      start(first!.token),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 201]);
    expect(r1.json().id).toBe(r2.json().id);

    const admissions = await ctx.db
      .select()
      .from(schema.examAdmissions)
      .where(
        and(
          eq(schema.examAdmissions.examId, examId),
          eq(schema.examAdmissions.candidateId, first!.profileId),
        ),
      );
    expect(admissions).toHaveLength(1);
    expect(admissions[0]!.consumedAttemptId).toBe(r1.json().id);
    expect(admissions[0]!.admittedAt).not.toBeNull();
    expect(admissions[0]!.consumedAt).not.toBeNull();
  });

  it("re-entry of an in-progress candidate reports ready and does NOT re-queue (legacy lockout fixed)", async () => {
    const [first] = candidates;
    const status = await queue(first!.token);
    expect(status.json()).toMatchObject({ status: "ready" });
    const resume = await start(first!.token);
    expect(resume.statusCode).toBe(200);
    expect(resume.json().id).toBe(
      (
        await ctx.db
          .select()
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.examId, examId))
      )[0]!.id,
    );
  });

  it("C2/C4: admission progression across candidates keeps one admitted fact per join", async () => {
    // c1 consumed its slot; the tail candidate reconciles + starts.
    const tail = candidates[1]!;
    const status = await queue(tail.token);
    expect(status.json()).toMatchObject({ status: "ready", position: 1 });
    const rows = await ctx.db
      .select()
      .from(schema.examAdmissions)
      .where(
        and(
          eq(schema.examAdmissions.examId, examId),
          eq(schema.examAdmissions.candidateId, tail.profileId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.admittedAt).not.toBeNull();

    const started = await start(tail.token);
    expect(started.statusCode).toBe(201);

    const attempts = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.examId, examId));
    expect(attempts).toHaveLength(2);
  });

  it("admin visibility endpoint exposes durable truth, scoped and read-only", async () => {
    const adminRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/admissions`,
      cookies: { "auth-token": adminToken },
    });
    expect(adminRes.statusCode).toBe(200);
    const body = adminRes.json();
    expect(body.examId).toBe(examId);
    expect(body.batchSize).toBe(1);
    expect(body.batchIntervalSeconds).toBe(3600);
    const statuses = body.items.map((item: { status: string }) => item.status);
    expect(statuses).toContain("consumed");
    // Candidate token must NOT read the admin surface.
    const denied = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/admissions`,
      cookies: { "auth-token": candidates[0]!.token },
    });
    expect([403, 404]).toContain(denied.statusCode);
  });

  it("Q9: admission timestamps never touch attempt time authority", async () => {
    const attempts = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.examId, examId));
    for (const attempt of attempts) {
      const startedAt = attempt.startedAt!.getTime();
      const admitted = (
        await ctx.db
          .select()
          .from(schema.examAdmissions)
          .where(eq(schema.examAdmissions.consumedAttemptId, attempt.id))
      )[0]!;
      // deadline = startedAt + 60min (timed_window authority), unaffected by
      // joinedAt/admittedAt queue history.
      expect(attempt.deadlineAt!.getTime() - startedAt).toBe(60 * 60_000);
      expect(admitted.admittedAt!.getTime()).toBeLessThanOrEqual(startedAt);
      void admitted;
    }
  });
});
