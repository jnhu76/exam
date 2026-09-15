import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import proctorMonitoringRoutes from "./proctorMonitoring.js";
import clientEventRoutes from "./clientEvents.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  createCandidateViaApi,
  createExamViaApi,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

/**
 * Client-event reference trust boundary (#544).
 *
 * Proves the POST /client-events normalization contract: events are always
 * accepted (batch size == accepted count — no existence oracle), while
 * client-asserted attempt/exam/question references are persisted only when
 * server-provable for the actor, and NULLed otherwise. Also proves the
 * cross-candidate pollution fix end-to-end: forged events claiming another
 * candidate's attempt can never reach that attempt's telemetry context.
 */
const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(proctorMonitoringRoutes);
  await fastify.register(clientEventRoutes);
};

describe("POST /api/client-events — reference trust boundary (#544)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;

  let attackerToken: string; // Candidate A
  let attackerUserId: string;
  let attackerAttemptId: string;

  let victimToken: string; // Candidate B
  let victimUserId: string;
  let victimAttemptId: string;

  let examId: string;

  let orgBId: string;
  let orgBAttemptId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
    orgId = ctx.org.id;

    // Exam with one question, published so candidates can start attempts.
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: `TrustExam-${randomUUID().slice(0, 8)}`,
      courseCode: `trust-${randomUUID().slice(0, 8)}`,
      courseName: "Trust Boundary Course",
      questionContent: "Trust question",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    // Publish via raw DB update (avoids publish route schema validation).
    // The exam's questionSnapshot remains empty — the normalizer correctly
    // NULLs questionId for any event when the frozen snapshot set is empty.
    await ctx.db
      .update(schema.exams)
      .set({ status: "published" })
      .where(eq(schema.exams.id, examId));

    async function enrollAndStart(
      username: string,
    ): Promise<{ userId: string; token: string; attemptId: string }> {
      const cand = await createCandidateViaApi(
        ctx.app,
        ctx.adminToken,
        username,
        orgId,
      );
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [cand.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
      const start = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": cand.token },
      });
      expect(start.statusCode).toBe(201);
      return {
        userId: cand.userId,
        token: cand.token,
        attemptId: start.json().id as string,
      };
    }

    const attacker = await enrollAndStart(`trust-attacker-${Date.now()}`);
    attackerToken = attacker.token;
    attackerUserId = attacker.userId;
    attackerAttemptId = attacker.attemptId;

    const victim = await enrollAndStart(`trust-victim-${Date.now()}`);
    victimToken = victim.token;
    victimUserId = victim.userId;
    victimAttemptId = victim.attemptId;

    // Cross-org victim: org B with its own admin, exam, candidate, attempt.
    orgBId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: orgBId,
      name: "Trust Org B",
      displayName: "Trust Organization B",
      slug: `trust-orgb-${randomUUID().slice(0, 8)}`,
    });
    const orgBAdmin = await createAssignedUserForTest(
      ctx.db,
      orgBId,
      "Admin",
      "trust-orgb-admin",
    );
    const orgBExamId = await createExamViaApi(ctx.app, orgBAdmin.token, {
      examTitle: "Org B Trust Exam",
      courseCode: `orgb-trust-${randomUUID().slice(0, 8)}`,
      courseName: "Org B Trust Course",
      questionContent: "Org B trust question",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    // Publish via raw DB update (org B exam needs no questionSnapshot for trust tests).
    await ctx.db
      .update(schema.exams)
      .set({ status: "published" })
      .where(eq(schema.exams.id, orgBExamId));
    const orgBCand = await createCandidateViaApi(
      ctx.app,
      orgBAdmin.token,
      `orgb-trust-cand-${randomUUID().slice(0, 8)}`,
      orgBId,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${orgBExamId}/enrollments`,
      payload: { candidateIds: [orgBCand.candidateProfileId] },
      cookies: { "auth-token": orgBAdmin.token },
    });
    const orgBStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${orgBExamId}/start`,
      cookies: { "auth-token": orgBCand.token },
    });
    expect(orgBStart.statusCode).toBe(201);
    orgBAttemptId = orgBStart.json().id as string;
  });

  afterAll(async () => {
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgId));
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgBId));
    await ctx.cleanup();
  });

  function trustEvent(
    overrides: Record<string, unknown> = {},
    refs: {
      attemptId?: string;
      examId?: string;
      questionId?: string;
    } = {},
  ) {
    return {
      kind: "exam_telemetry",
      level: "warn",
      name: `trust_probe_${randomUUID().slice(0, 8)}`,
      occurredAt: new Date().toISOString(),
      ...overrides,
      ...refs,
    };
  }

  async function postEvents(
    token: string,
    events: unknown[],
  ): Promise<{ status: number; body: { accepted?: number } }> {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": token },
      payload: { events },
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function storedEventsByName(name: string) {
    return ctx.db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.name, name));
  }

  async function cleanupEvents(names: string[]): Promise<void> {
    for (const name of names) {
      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, name));
    }
  }

  it("T2: keeps the actor's OWN attemptId and derives the canonical examId server-side", async () => {
    const name = `trust_t2_${randomUUID().slice(0, 8)}`;
    // Client claims a WRONG examId next to its own valid attemptId — the
    // server-derived attempt→exam relationship must win.
    const { status, body } = await postEvents(attackerToken, [
      trustEvent(
        { name },
        { attemptId: attackerAttemptId, examId: randomUUID() },
      ),
    ]);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);

    const rows = await storedEventsByName(name);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attemptId).toBe(attackerAttemptId);
    expect(rows[0]!.examId).toBe(examId);
    expect(rows[0]!.userId).toBe(attackerUserId);
    await cleanupEvents([name]);
  });

  it("T2b: questionId is NULL when the exam's frozen snapshot is empty (non-matching case)", async () => {
    const name = `trust_t2b_${randomUUID().slice(0, 8)}`;
    const { status } = await postEvents(attackerToken, [
      trustEvent(
        { name },
        { attemptId: attackerAttemptId, questionId: randomUUID() },
      ),
    ]);
    expect(status).toBe(200);

    const rows = await storedEventsByName(name);
    expect(rows[0]!.attemptId).toBe(attackerAttemptId);
    expect(rows[0]!.examId).toBe(examId);
    expect(rows[0]!.questionId).toBeNull();
    await cleanupEvents([name]);
  });

  it("T2c: keeps an exam-only reference when the enrollment chain proves it (exam_start_failed producer)", async () => {
    const name = `trust_t2c_${randomUUID().slice(0, 8)}`;
    const { status, body } = await postEvents(attackerToken, [
      trustEvent({ name }, { examId, questionId: randomUUID() }),
    ]);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);

    const rows = await storedEventsByName(name);
    expect(rows[0]!.attemptId).toBeNull();
    expect(rows[0]!.examId).toBe(examId);
    // Snapshot is empty → questionId drops to NULL.
    expect(rows[0]!.questionId).toBeNull();
    await cleanupEvents([name]);
  });

  it("T2d: drops an exam-only reference without a provable enrollment chain", async () => {
    const name = `trust_t2d_${randomUUID().slice(0, 8)}`;
    const foreignExamId = randomUUID();
    const { status, body } = await postEvents(attackerToken, [
      trustEvent({ name }, { examId: foreignExamId }),
    ]);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);

    const rows = await storedEventsByName(name);
    expect(rows[0]!.attemptId).toBeNull();
    expect(rows[0]!.examId).toBeNull();
    expect(rows[0]!.questionId).toBeNull();
    await cleanupEvents([name]);
  });

  it("T3: NULLs a same-org victim attemptId but accepts the event (victim timeline unpolluted)", async () => {
    const name = `trust_t3_${randomUUID().slice(0, 8)}`;
    const before = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${victimAttemptId}/proctor-events`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const beforeItems = before.json().items as unknown[];

    const { status, body } = await postEvents(attackerToken, [
      trustEvent({ name }, { attemptId: victimAttemptId }),
    ]);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);

    const rows = await storedEventsByName(name);
    expect(rows).toHaveLength(1); // event stored...
    expect(rows[0]!.userId).toBe(attackerUserId); // ...under the attacker
    expect(rows[0]!.attemptId).toBeNull(); // ...with NO attempt reference
    expect(rows[0]!.examId).toBeNull();

    const after = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${victimAttemptId}/proctor-events`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(after.json().items).toHaveLength(beforeItems.length); // unpolluted
    await cleanupEvents([name]);
  });

  it("T4: handles a cross-org victim attempt with the SAME public response and NULL reference", async () => {
    const name = `trust_t4_${randomUUID().slice(0, 8)}`;
    const { status, body } = await postEvents(attackerToken, [
      trustEvent({ name }, { attemptId: orgBAttemptId }),
    ]);
    // Identical public shape to the same-org victim case (T3): 200/accepted:1.
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);

    const rows = await storedEventsByName(name);
    expect(rows[0]!.attemptId).toBeNull();
    expect(rows[0]!.examId).toBeNull();
    expect(rows[0]!.organizationId).toBe(orgId); // stored under the SENDER's org
    await cleanupEvents([name]);
  });

  it("T5: treats a nonexistent attemptId exactly like a victim attempt (no existence oracle)", async () => {
    const victimLike = `trust_t5_v_${randomUUID().slice(0, 8)}`;
    const nonexistent = `trust_t5_n_${randomUUID().slice(0, 8)}`;

    const victimRes = await postEvents(attackerToken, [
      trustEvent({ name: victimLike }, { attemptId: victimAttemptId }),
    ]);
    const nonexistentRes = await postEvents(attackerToken, [
      trustEvent({ name: nonexistent }, { attemptId: randomUUID() }),
    ]);

    expect(nonexistentRes.status).toBe(victimRes.status);
    expect(nonexistentRes.body).toEqual(victimRes.body);

    const rows = await storedEventsByName(nonexistent);
    expect(rows[0]!.attemptId).toBeNull();
    await cleanupEvents([victimLike, nonexistent]);
  });

  it("T6: normalizes atomically — no mixed invalid association survives", async () => {
    const name = `trust_t6_${randomUUID().slice(0, 8)}`;
    // Own attempt + unrelated exam + unrelated question: the canonical exam
    // wins, unprovable references drop together.
    const { status } = await postEvents(attackerToken, [
      trustEvent(
        { name },
        {
          attemptId: attackerAttemptId,
          examId: randomUUID(),
          questionId: randomUUID(),
        },
      ),
    ]);
    expect(status).toBe(200);

    const rows = await storedEventsByName(name);
    expect(rows[0]!.attemptId).toBe(attackerAttemptId);
    expect(rows[0]!.examId).toBe(examId); // canonical, not client-claimed
    // Empty snapshot → questionId drops to NULL.
    expect(rows[0]!.questionId).toBeNull();
    await cleanupEvents([name]);
  });

  it("T7: a mixed batch always answers accepted == input count (anti-enumeration)", async () => {
    const batchName = `trust_t7_${randomUUID().slice(0, 8)}`;
    const events = [
      // valid own attempt
      trustEvent(
        { name: `${batchName}_valid` },
        { attemptId: attackerAttemptId },
      ),
      // same-org victim attempt
      trustEvent(
        { name: `${batchName}_victim` },
        { attemptId: victimAttemptId },
      ),
      // nonexistent attempt
      trustEvent({ name: `${batchName}_missing` }, { attemptId: randomUUID() }),
      // cross-org attempt
      trustEvent(
        { name: `${batchName}_crossorg` },
        { attemptId: orgBAttemptId },
      ),
    ];
    const { status, body } = await postEvents(attackerToken, events);
    expect(status).toBe(200);
    expect(body.accepted).toBe(events.length);

    for (const suffix of ["valid", "victim", "missing", "crossorg"]) {
      const rows = await storedEventsByName(`${batchName}_${suffix}`);
      expect(rows).toHaveLength(1);
    }
    const valid = await storedEventsByName(`${batchName}_valid`);
    expect(valid[0]!.attemptId).toBe(attackerAttemptId);
    for (const suffix of ["victim", "missing", "crossorg"]) {
      const rows = await storedEventsByName(`${batchName}_${suffix}`);
      expect(rows[0]!.attemptId).toBeNull();
      expect(rows[0]!.examId).toBeNull();
    }
    await cleanupEvents([
      `${batchName}_valid`,
      `${batchName}_victim`,
      `${batchName}_missing`,
      `${batchName}_crossorg`,
    ]);
  });

  it("T8: server owns organizationId, userId, and receivedAt — payload claims are ignored", async () => {
    const name = `trust_t8_${randomUUID().slice(0, 8)}`;
    const forgedOrg = randomUUID();
    const forgedUser = randomUUID();
    const forgedReceived = "1970-01-01T00:00:00.000Z";
    const before = new Date(Date.now() - 1000);

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": attackerToken },
      payload: {
        events: [
          {
            ...trustEvent({ name }),
            organizationId: forgedOrg,
            userId: forgedUser,
            receivedAt: forgedReceived,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);

    const rows = await storedEventsByName(name);
    expect(rows[0]!.organizationId).toBe(orgId);
    expect(rows[0]!.userId).toBe(attackerUserId);
    const received = rows[0]!.receivedAt;
    expect(received.getTime()).toBeGreaterThanOrEqual(before.getTime());
    await cleanupEvents([name]);
  });

  it("T10: forged warning floods claiming the victim's attempt cannot pollute the victim's warningLevel or timeline", async () => {
    // Attacker forges 3 save failures + 1 submit failure against B's attempt.
    // Pre-normalization these counts would have driven B's warningLevel to
    // critical; normalization NULLs the attemptId, so B stays clean.
    const flood = ["a", "b", "c"].map((s) =>
      trustEvent(
        { name: `answer_autosave_failed_${s}`, level: "error" },
        { attemptId: victimAttemptId, examId: examId },
      ),
    );
    flood.push(
      trustEvent(
        { name: "submit_failed_forged", level: "error" },
        { attemptId: victimAttemptId, examId: examId },
      ),
    );
    const { status, body } = await postEvents(attackerToken, flood);
    expect(status).toBe(200);
    expect(body.accepted).toBe(flood.length);

    const statusRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/proctor/attempts`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(statusRes.statusCode).toBe(200);
    const rows = statusRes.json().items as Array<{
      attemptId: string;
      warningLevel: string;
      saveFailedCount: number;
      submitFailedCount: number;
    }>;
    const victimRow = rows.find((r) => r.attemptId === victimAttemptId);
    expect(victimRow).toBeDefined();
    expect(victimRow!.warningLevel).toBe("normal");
    expect(victimRow!.saveFailedCount).toBe(0);
    expect(victimRow!.submitFailedCount).toBe(0);

    const timeline = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${victimAttemptId}/proctor-events`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const items = timeline.json().items as Array<{ id: string }>;
    for (const item of items) {
      const row = await ctx.db
        .select({ userId: schema.clientEvents.userId })
        .from(schema.clientEvents)
        .where(eq(schema.clientEvents.id, item.id));
      if (row[0]) expect(row[0].userId).toBe(victimUserId);
    }
  });

  it("T18: ingest alone creates no incidents, no scoring or attempt-state mutation", async () => {
    const beforeAttempt = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, victimAttemptId));

    const { status } = await postEvents(attackerToken, [
      trustEvent(
        { name: "critical_security_incident", level: "error", kind: "proctor" },
        { attemptId: victimAttemptId },
      ),
    ]);
    expect(status).toBe(200);

    const afterAttempt = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, victimAttemptId));
    // Full-row equality: no state, scoring, or activity mutation from ingest.
    expect(afterAttempt).toEqual(beforeAttempt);

    const incidents = await ctx.db
      .select({ id: schema.examIncidents.id })
      .from(schema.examIncidents)
      .where(eq(schema.examIncidents.organizationId, orgId));
    expect(incidents).toHaveLength(0);
  });

  it("T1b: authenticate-only semantics unchanged — an assigned non-Candidate role may also report", async () => {
    const teacher = await createAssignedUserForTest(
      ctx.db,
      orgId,
      "Teacher",
      "trust-teacher",
    );
    const name = `trust_t1b_${randomUUID().slice(0, 8)}`;
    const { status, body } = await postEvents(teacher.token, [
      trustEvent({ name, kind: "log", level: "info" }),
    ]);
    expect(status).toBe(200);
    expect(body.accepted).toBe(1);
    const rows = await storedEventsByName(name);
    expect(rows[0]!.attemptId).toBeNull();
    await cleanupEvents([name]);
  });
});
