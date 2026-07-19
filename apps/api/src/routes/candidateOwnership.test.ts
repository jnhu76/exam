import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import attemptRoutes from "./attempts.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import scoreRoutes from "./scores.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";

/**
 * P4-3 — Candidate ownership boundary proof (task 9.2 cross-candidate matrix).
 *
 * The candidate runtime is requireRole(["Candidate"]) + an own-attempt /
 * own-enrollment / own-score ownership predicate (getOwnedAttempt /
 * findByIdAndCandidate / findByExamAndCandidate). This test proves that
 * predicate holds: Candidate A, holding a real attempt, cannot read/answer/
 * submit/restore/heartbeat/score Candidate B's attempt, and cannot see an exam
 * B is enrolled in that A is not. Per the anti-enumeration norm, direct
 * cross-candidate access returns 404 — never leaking B's existence,
 * answers, status, score, or enrollment.
 *
 * The ownership predicate is the security boundary and must not be replaced
 * by a bare capability check (R4).
 */
describe("P4-3 candidate ownership boundary (cross-candidate attack matrix)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let candidateBOnlyExamId: string;
  let candidateA: { candidateProfileId: string; userId: string; token: string };
  let candidateB: { candidateProfileId: string; userId: string; token: string };
  let attemptBId: string;
  let sharedQuestionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(scoreRoutes);
    });

    // Seed a published exam with one true_false question; enroll both candidates.
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "P4-3 Exam",
      courseCode: "P43",
      courseName: "P4-3 Course",
      questionContent: "P4-3 question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);

    // Fetch the exam's question id (shared by both candidates' snapshots) so the
    // save-answer attack uses a valid questionId — isolating the ownership check
    // from the questionId validation that otherwise 400s first.
    const examDetail = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    sharedQuestionId = examDetail.json().questionIds[0] as string;

    candidateA = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `p43-a-${uniquePrefix()}`,
      ctx.org.id,
    );
    candidateB = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `p43-b-${uniquePrefix()}`,
      ctx.org.id,
    );

    // Enroll both candidates so the shared exam is visible to each, but only B
    // starts an attempt. A will try to attack B's attempt.
    for (const cand of [candidateA, candidateB]) {
      const enrollment = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [cand.candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(enrollment.statusCode).toBe(200);
    }

    candidateBOnlyExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "P4-3 Candidate B Only Exam",
      courseCode: `P43B-${uniquePrefix()}`,
      courseName: "P4-3 Candidate B Only Course",
      questionContent: "P4-3 candidate B only question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, candidateBOnlyExamId);
    const bOnlyEnrollment = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${candidateBOnlyExamId}/enrollments`,
      payload: { candidateIds: [candidateB.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(bOnlyEnrollment.statusCode).toBe(200);

    // B starts an attempt.
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateB.token },
    });
    expect(startRes.statusCode).toBe(201);
    attemptBId = startRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Helper: A attacks B's resource. Returns the status code.
  function attackA(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method: method as never,
      url,
      payload: payload as never,
      cookies: { "auth-token": candidateA.token },
    });
  }

  it("A cannot read B's attempt (GET /attempts/:id -> 404, not B's data)", async () => {
    const res = await attackA("GET", `/api/attempts/${attemptBId}`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot read B's take snapshot (GET /candidate/attempts/:id/take -> 404)", async () => {
    const res = await attackA(
      "GET",
      `/api/candidate/attempts/${attemptBId}/take`,
    );
    expect(res.statusCode).toBe(404);
    // Must never return B's questions/answers.
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain("questionSnapshot");
  });

  it("A cannot save an answer to B's attempt (POST .../answers/:qid -> deny)", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${attemptBId}/answers/${sharedQuestionId}`,
      {
        attemptId: attemptBId,
        questionId: sharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it("A cannot submit B's attempt (POST .../submit -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/submit`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot heartbeat B's attempt (POST .../heartbeat -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/heartbeat`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot restore B's attempt (POST .../restore -> deny)", async () => {
    const res = await attackA("POST", `/api/attempts/${attemptBId}/restore`);
    expect(res.statusCode).toBe(404);
  });

  it("A cannot read B's result (GET /scores/attempts/:id -> not B's full result)", async () => {
    const res = await attackA("GET", `/api/scores/attempts/${attemptBId}`);
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.showResultImmediately).not.toBe(true);
    expect(JSON.stringify(body)).not.toContain("questionResults");
  });

  it("A sees no detail for an exam enrolled only to B", async () => {
    const res = await attackA(
      "GET",
      `/api/candidate/exams/${candidateBOnlyExamId}`,
    );
    expect(res.statusCode).toBe(404);
  });

  it("A cannot join the queue for an exam enrolled only to B", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${candidateBOnlyExamId}/queue`,
    );
    expect(res.statusCode).toBe(404);
  });

  it("A's exam list excludes an exam enrolled only to B", async () => {
    const res = await attackA("GET", "/api/candidate/exams");
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ examId: candidateBOnlyExamId }),
      ]),
    );
  });

  it("A repeated start returns A's existing attempt instead of creating another", async () => {
    const ownStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(ownStart.statusCode).toBe(201);
    expect(ownStart.json().id).not.toBe(attemptBId);

    const repeatedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateA.token },
    });
    expect(repeatedStart.statusCode).toBe(200);
    expect(repeatedStart.json().id).toBe(ownStart.json().id);
  });

  // ── Other roles cannot use the candidate runtime (task 9.3) ──
  const candidateRuntimeRequests = [
    {
      name: "exam list",
      method: "GET",
      url: () => "/api/candidate/exams",
    },
    {
      name: "exam detail",
      method: "GET",
      url: () => `/api/candidate/exams/${candidateBOnlyExamId}`,
    },
    {
      name: "attempt detail",
      method: "GET",
      url: () => `/api/attempts/${attemptBId}`,
    },
    {
      name: "take snapshot",
      method: "GET",
      url: () => `/api/candidate/attempts/${attemptBId}/take`,
    },
    {
      name: "save answer",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/answers/${sharedQuestionId}`,
      payload: () => ({
        attemptId: attemptBId,
        questionId: sharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      }),
    },
    {
      name: "submit",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/submit`,
    },
    {
      name: "heartbeat",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/heartbeat`,
    },
    {
      name: "restore",
      method: "POST",
      url: () => `/api/attempts/${attemptBId}/restore`,
    },
    {
      name: "queue",
      method: "POST",
      url: () => `/api/attempts/${candidateBOnlyExamId}/queue`,
    },
    {
      name: "start",
      method: "POST",
      url: () => `/api/attempts/${examId}/start`,
    },
  ];

  it.each(candidateRuntimeRequests)(
    "Admin is denied on candidate-only $name",
    async ({ method, url, payload }) => {
      const res = await ctx.app.inject({
        method: method as never,
        url: url(),
        payload: payload?.() as never,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  it.each(candidateRuntimeRequests)(
    "unauthenticated requests receive 401 on candidate-only $name",
    async ({ method, url, payload }) => {
      const res = await ctx.app.inject({
        method: method as never,
        url: url(),
        payload: payload?.() as never,
      });
      expect(res.statusCode).toBe(401);
    },
  );
});

/**
 * RBAC-M10-A-CORRECTIVE-1 — Real cross-organization own-attempt denial (P1-1).
 *
 * Creates two separate organizations with independent data, proves that a
 * Candidate from Org A cannot access or mutate an Org B attempt, and proves
 * zero unauthorized persistent side effects.
 *
 * The test uses real database IDs and real HTTP requests — no fake UUIDs,
 * no mock stubs, no vi.mock.
 */
describe("RBAC-M10-A-CORRECTIVE-1 cross-organization own-attempt denial", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgBId: string;
  let orgBAdminToken: string;
  let orgBExamId: string;
  let orgBSharedQuestionId: string;
  let candidateB: { candidateProfileId: string; userId: string; token: string };
  let orgBAttemptBId: string;
  let candidateA: { candidateProfileId: string; userId: string; token: string };

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(scoreRoutes);
    });

    // ── Create Org B (second organization) ──
    const now = new Date();
    const orgBRows = await ctx.db
      .insert(schema.organizations)
      .values({
        id: randomUUID(),
        name: "Org B Cross-Org Test",
        displayName: "Organization B",
        slug: `org-b-${uniquePrefix()}`,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    orgBId = orgBRows[0]!.id;

    // ── Create Org B admin user ──
    const adminPasswordHash = await hashPassword("password123");
    const orgBAdminRows = await ctx.db
      .insert(schema.users)
      .values({
        id: randomUUID(),
        organizationId: orgBId,
        username: `orgb-admin-${uniquePrefix()}`,
        passwordHash: adminPasswordHash,
        name: "Org B Admin",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const orgBAdmin = orgBAdminRows[0]!;
    // RBAC-M10-E: Org B admin must authenticate (positive control + exam
    // creation/enrollment) — seed an active primary Admin assignment scoped to
    // orgBId so capability resolution produces Admin's preset rather than 401
    // AUTH_REQUIRED.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: orgBId,
      userId: orgBAdmin.id,
      role: "Admin" as never,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    orgBAdminToken = signJWT({
      actorId: orgBAdmin.id,
      organizationId: orgBId,
      role: "Admin",
    });

    // ── Create Org B candidate user ──
    const candPasswordHash = await hashPassword("password123");
    const orgBCandUserRows = await ctx.db
      .insert(schema.users)
      .values({
        id: randomUUID(),
        organizationId: orgBId,
        username: `orgb-cand-${uniquePrefix()}`,
        passwordHash: candPasswordHash,
        name: "Org B Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const orgBCandUser = orgBCandUserRows[0]!;

    // RBAC-M10-E: Org B candidate must authenticate (positive controls + the
    // attempt whose ownership the cross-org matrix attacks) — seed an active
    // primary Candidate assignment scoped to orgBId so capability resolution
    // produces Candidate's preset rather than 401 AUTH_REQUIRED.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: orgBId,
      userId: orgBCandUser.id,
      role: "Candidate" as never,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // ── Create Org B candidate profile ──
    const orgBCandProfileRows = await ctx.db
      .insert(schema.candidateProfiles)
      .values({
        id: randomUUID(),
        organizationId: orgBId,
        userId: orgBCandUser.id,
        fields: {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const orgBCandProfileId = orgBCandProfileRows[0]!.id;

    // Sign candidate B's JWT
    const orgBCandToken = signJWT({
      actorId: orgBCandUser.id,
      organizationId: orgBId,
      role: "Candidate",
    });

    candidateB = {
      candidateProfileId: orgBCandProfileId,
      userId: orgBCandUser.id,
      token: orgBCandToken,
    };

    // ── Create Org B exam via API using Org B admin token ──
    orgBExamId = await createExamViaApi(ctx.app, orgBAdminToken, {
      examTitle: "Org B Cross-Org Exam",
      courseCode: `ORGBC-${uniquePrefix()}`,
      courseName: "Org B Course",
      questionContent: "Org B cross-org question.",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 50,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, orgBAdminToken, orgBExamId);

    const orgBExamDetail = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${orgBExamId}`,
      cookies: { "auth-token": orgBAdminToken },
    });
    orgBSharedQuestionId = orgBExamDetail.json().questionIds[0] as string;

    // ── Enroll Org B candidate ──
    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${orgBExamId}/enrollments`,
      payload: { candidateIds: [candidateB.candidateProfileId] },
      cookies: { "auth-token": orgBAdminToken },
    });
    expect(enrollRes.statusCode).toBe(200);

    // ── Org B candidate starts an attempt ──
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${orgBExamId}/start`,
      cookies: { "auth-token": candidateB.token },
    });
    expect(startRes.statusCode).toBe(201);
    orgBAttemptBId = startRes.json().id;

    // ── Create Org A candidate (from the seed org) ──
    candidateA = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `cross-org-a-${uniquePrefix()}`,
      ctx.org.id,
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ─── Positive control: Org B candidate accesses own attempt ───
  it("positive control — Org B candidate accesses own attempt (GET /attempts/:id -> 200)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/attempts/${orgBAttemptBId}`,
      cookies: { "auth-token": candidateB.token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(orgBAttemptBId);
  });

  it("positive control — Org B candidate accesses own take (GET /candidate/attempts/:attemptId/take -> 200)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${orgBAttemptBId}/take`,
      cookies: { "auth-token": candidateB.token },
    });
    expect(res.statusCode).toBe(200);
  });

  // ─── Cross-org attack: Org A candidate targets Org B attempt ───
  function attackA(method: string, url: string, payload?: unknown) {
    return ctx.app.inject({
      method: method as never,
      url,
      payload: payload as never,
      cookies: { "auth-token": candidateA.token },
    });
  }

  it("Org A cannot read Org B's attempt (GET /attempts/:id -> 404, no foreign content)", async () => {
    const res = await attackA("GET", `/api/attempts/${orgBAttemptBId}`);
    expect(res.statusCode).toBe(404);
    const body = res.json();
    // Must not leak Org B's organization or candidate identity.
    expect(JSON.stringify(body)).not.toContain(orgBId);
    expect(JSON.stringify(body)).not.toContain(candidateB.userId);
    expect(JSON.stringify(body)).not.toContain(candidateB.candidateProfileId);
  });

  it("Org A cannot take Org B's attempt (GET /candidate/attempts/:attemptId/take -> 404)", async () => {
    const res = await attackA(
      "GET",
      `/api/candidate/attempts/${orgBAttemptBId}/take`,
    );
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain("questionSnapshot");
    expect(JSON.stringify(body)).not.toContain(orgBId);
    expect(JSON.stringify(body)).not.toContain(candidateB.userId);
  });

  it("Org A cannot save answer to Org B's attempt (POST .../answers/:questionId -> 404)", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${orgBAttemptBId}/answers/${orgBSharedQuestionId}`,
      {
        attemptId: orgBAttemptBId,
        questionId: orgBSharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it("Org A cannot submit Org B's attempt (POST .../submit -> 404)", async () => {
    const res = await attackA("POST", `/api/attempts/${orgBAttemptBId}/submit`);
    expect(res.statusCode).toBe(404);
  });

  it("Org A cannot heartbeat Org B's attempt (POST .../heartbeat -> 404)", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${orgBAttemptBId}/heartbeat`,
    );
    expect(res.statusCode).toBe(404);
  });

  it("Org A cannot restore Org B's attempt (POST .../restore -> 404)", async () => {
    const res = await attackA(
      "POST",
      `/api/attempts/${orgBAttemptBId}/restore`,
    );
    expect(res.statusCode).toBe(404);
  });

  // ─── Cross-org zero-write proof ───

  /**
   * Captures a snapshot of Org B attempt fields that could be mutated by each
   * route. Returns a flat object of relevant column values.
   */
  async function captureAttemptSnapshot() {
    const rows = await ctx.db
      .select({
        status: schema.examAttempts.status,
        deadline: schema.examAttempts.deadlineAt,
        lastActivityAt: schema.examAttempts.lastActivityAt,
        submittedAt: schema.examAttempts.submittedAt,
      })
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, orgBAttemptBId));
    const row = rows[0];
    return {
      status: row?.status ?? null,
      deadline: row?.deadline ?? null,
      lastActivityAt: String(row?.lastActivityAt ?? ""),
      submittedAt: row?.submittedAt ?? null,
    };
  }

  /** Count audit rows targeting the Org B attempt. */
  async function countAuditForAction(action: string): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, orgBId),
          eq(schema.auditLogs.targetId, orgBAttemptBId),
          eq(schema.auditLogs.action, action),
        ),
      );
    return rows.length;
  }

  /** Count grading entries for the Org B attempt. */
  async function countGradingEntries(): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, orgBAttemptBId));
    return rows.length;
  }

  /** Count client events for the Org B attempt. */
  async function countClientEvents(): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.clientEvents.id })
      .from(schema.clientEvents)
      .where(
        and(
          eq(schema.clientEvents.organizationId, orgBId),
          eq(schema.clientEvents.attemptId, orgBAttemptBId),
        ),
      );
    return rows.length;
  }

  /** Count email outbox rows for Org B. */
  async function countEmailOutbox(): Promise<number> {
    const rows = await ctx.db
      .select({ id: schema.emailOutbox.id })
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.organizationId, orgBId));
    return rows.length;
  }

  it("GET take — cross-org denial causes zero side effects on Org B attempt", async () => {
    const before = await captureAttemptSnapshot();
    const auditBefore = await countAuditForAction("attempt.take");
    const eventsBefore = await countClientEvents();
    const emailBefore = await countEmailOutbox();

    const res = await attackA(
      "GET",
      `/api/candidate/attempts/${orgBAttemptBId}/take`,
    );
    expect(res.statusCode).toBe(404);

    const after = await captureAttemptSnapshot();
    const auditAfter = await countAuditForAction("attempt.take");
    const eventsAfter = await countClientEvents();
    const emailAfter = await countEmailOutbox();

    // No change to attempt columns
    expect(after.status).toBe(before.status);
    expect(String(after.deadline)).toBe(String(before.deadline));
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(String(after.submittedAt)).toBe(String(before.submittedAt));
    // No audit, no events, no outbox
    expect(auditAfter).toBe(auditBefore);
    expect(eventsAfter).toBe(eventsBefore);
    expect(emailAfter).toBe(emailBefore);
  });

  it("save answer — cross-org denial causes zero side effects on Org B attempt", async () => {
    const before = await captureAttemptSnapshot();
    const auditBefore = await countAuditForAction("attempt.saveAnswer");
    const gradingBefore = await countGradingEntries();
    const eventsBefore = await countClientEvents();
    const emailBefore = await countEmailOutbox();

    const res = await attackA(
      "POST",
      `/api/attempts/${orgBAttemptBId}/answers/${orgBSharedQuestionId}`,
      {
        attemptId: orgBAttemptBId,
        questionId: orgBSharedQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
    );
    expect(res.statusCode).toBe(404);

    const after = await captureAttemptSnapshot();
    const auditAfter = await countAuditForAction("attempt.saveAnswer");
    const gradingAfter = await countGradingEntries();
    const eventsAfter = await countClientEvents();
    const emailAfter = await countEmailOutbox();

    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(auditAfter).toBe(auditBefore);
    expect(gradingAfter).toBe(gradingBefore);
    expect(eventsAfter).toBe(eventsBefore);
    expect(emailAfter).toBe(emailBefore);
  });

  it("submit — cross-org denial causes zero side effects on Org B attempt", async () => {
    const before = await captureAttemptSnapshot();
    const auditBefore = await countAuditForAction("attempt.submit");
    const gradingBefore = await countGradingEntries();
    const eventsBefore = await countClientEvents();
    const emailBefore = await countEmailOutbox();

    const res = await attackA("POST", `/api/attempts/${orgBAttemptBId}/submit`);
    expect(res.statusCode).toBe(404);

    const after = await captureAttemptSnapshot();
    const auditAfter = await countAuditForAction("attempt.submit");
    const gradingAfter = await countGradingEntries();
    const eventsAfter = await countClientEvents();
    const emailAfter = await countEmailOutbox();

    expect(after.status).toBe(before.status);
    expect(after.submittedAt).toBe(before.submittedAt);
    expect(auditAfter).toBe(auditBefore);
    expect(gradingAfter).toBe(gradingBefore);
    expect(eventsAfter).toBe(eventsBefore);
    expect(emailAfter).toBe(emailBefore);
  });

  it("heartbeat — cross-org denial causes zero side effects on Org B attempt", async () => {
    const before = await captureAttemptSnapshot();
    const auditBefore = await countAuditForAction("attempt.heartbeat");
    const eventsBefore = await countClientEvents();
    const emailBefore = await countEmailOutbox();

    const res = await attackA(
      "POST",
      `/api/attempts/${orgBAttemptBId}/heartbeat`,
    );
    expect(res.statusCode).toBe(404);

    const after = await captureAttemptSnapshot();
    const auditAfter = await countAuditForAction("attempt.heartbeat");
    const eventsAfter = await countClientEvents();
    const emailAfter = await countEmailOutbox();

    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(auditAfter).toBe(auditBefore);
    expect(eventsAfter).toBe(eventsBefore);
    expect(emailAfter).toBe(emailBefore);
  });

  it("restore — cross-org denial causes zero side effects on Org B attempt", async () => {
    const before = await captureAttemptSnapshot();
    const auditBefore = await countAuditForAction("attempt.restore");
    const eventsBefore = await countClientEvents();
    const emailBefore = await countEmailOutbox();

    const res = await attackA(
      "POST",
      `/api/attempts/${orgBAttemptBId}/restore`,
    );
    expect(res.statusCode).toBe(404);

    const after = await captureAttemptSnapshot();
    const auditAfter = await countAuditForAction("attempt.restore");
    const eventsAfter = await countClientEvents();
    const emailAfter = await countEmailOutbox();

    expect(after.status).toBe(before.status);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(auditAfter).toBe(auditBefore);
    expect(eventsAfter).toBe(eventsBefore);
    expect(emailAfter).toBe(emailBefore);
  });
});
