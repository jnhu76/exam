import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import {
  buildTestApp,
  createCandidateViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import { disruptAttempt } from "./attempts/attempts.testHelpers.js";
import { registerAdminIncidentRoutes } from "./incidents.admin.js";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";

const plugin: FastifyPluginAsync = async (fastify, opts) => {
  await fastify.register(candidateRoutes, { prefix: "" });
  await fastify.register(examRoutes, { prefix: "" });
  await fastify.register(attemptRoutes, { prefix: "" });
  await registerAdminIncidentRoutes(fastify);
};

describe("admin incident routes — integration", () => {
  const ctx = {} as Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let orgId: string;
  let adminToken: string;
  let candidateToken: string;
  let cleanupOrgId: string | null = null;

  beforeAll(async () => {
    Object.assign(ctx, await buildTestApp(plugin, { prefix: "/api" }));
    orgId = ctx.org.id;
    adminToken = ctx.adminToken;
    candidateToken = ctx.candidateToken;

    // Create an exam in the default org for incident creation
    const prefix = uniquePrefix();
    const courseId = randomUUID();
    examId = randomUUID();
    const now = new Date();

    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: "Incident Test Course",
      code: `ITC-${prefix}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "Incident Test Exam",
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
      interruptionTimePolicy: "operator_incident",
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (cleanupOrgId) {
      await cleanupOrganizationTestData(ctx.db, cleanupOrgId);
    }
    await ctx.cleanup();
  });

  it("Admin creates an incident", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "network_interruption",
        description: "Network went down for 5 minutes",
        severity: "major",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("applied");
    expect(body.incident.type).toBe("network_interruption");
    expect(body.incident.severity).toBe("major");
    expect(body.incident.status).toBe("open");
    expect(body.incident.version).toBe(1);
  });

  it("Admin lists incidents by exam", async () => {
    // Create one first
    await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "list test",
      },
      cookies: { "auth-token": adminToken },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/incidents`,
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.incidents.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid incident type with 400", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "invalid_type",
        description: "test",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("Candidate is denied (403) on incident creation", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "candidate attempt",
      },
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("unauthenticated request is denied (401)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "no auth",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("Admin creates + investigates + resolves lifecycle", async () => {
    // Create
    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "device_failure",
        description: "lifecycle test",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(createRes.statusCode).toBe(200);
    const incident = createRes.json().incident;

    // Investigate
    const investigateRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incident.id}/investigate`,
      payload: {
        operationId: randomUUID(),
        expectedVersion: 1,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(investigateRes.statusCode).toBe(200);
    expect(investigateRes.json().incident.status).toBe("investigating");
    expect(investigateRes.json().incident.version).toBe(2);

    // Resolve
    const resolveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incident.id}/resolve`,
      payload: {
        operationId: randomUUID(),
        expectedVersion: 2,
        resolutionSummary: "Resolved by replacing device",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().incident.status).toBe("resolved");
    expect(resolveRes.json().incident.version).toBe(3);
  });

  it("rejects investigate with stale expectedVersion (409)", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "version conflict test",
      },
      cookies: { "auth-token": adminToken },
    });
    const incident = createRes.json().incident;

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incident.id}/investigate`,
      payload: {
        operationId: randomUUID(),
        expectedVersion: 99, // stale
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(409);
  });

  it("idempotent replay returns same incident", async () => {
    const opId = randomUUID();
    const create1 = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: opId,
        type: "other",
        description: "idempotent test",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(create1.statusCode).toBe(200);
    expect(create1.json().outcome).toBe("applied");

    const create2 = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: opId,
        type: "other",
        description: "idempotent test",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(create2.statusCode).toBe(200);
    expect(create2.json().outcome).toBe("idempotent_replayed");
    expect(create2.json().incident.id).toBe(create1.json().incident.id);
  });

  it("adds a note to an incident", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "note test",
      },
      cookies: { "auth-token": adminToken },
    });
    const incident = createRes.json().incident;

    const noteRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incident.id}/notes`,
      payload: {
        operationId: randomUUID(),
        body: "Investigating the network logs",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(noteRes.statusCode).toBe(200);
    expect(noteRes.json().outcome).toBe("applied");
    // Note does NOT bump version
    expect(noteRes.json().incident.version).toBe(1);
  });

  it("GET non-existent incident returns 404", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/incidents/${randomUUID()}`,
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("concurrent create with the same operationId yields one incident (23505 race recovery)", async () => {
    const opId = randomUUID();
    const payload = {
      operationId: opId,
      type: "other",
      description: "concurrent create",
    };
    const [res1, res2] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examId}/incidents`,
        payload,
        cookies: { "auth-token": adminToken },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examId}/incidents`,
        payload,
        cookies: { "auth-token": adminToken },
      }),
    ]);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const b1 = res1.json();
    const b2 = res2.json();
    expect(b1.incident.id).toBe(b2.incident.id);
    expect([b1.outcome, b2.outcome].sort()).toEqual([
      "applied",
      "idempotent_replayed",
    ]);
  });

  it("concurrent note with the same operationId yields one event", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "concurrent note base",
      },
      cookies: { "auth-token": adminToken },
    });
    const incidentId = createRes.json().incident.id;
    const opId = randomUUID();
    const payload = { operationId: opId, body: "concurrent note" };
    const [r1, r2] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/incidents/${incidentId}/notes`,
        payload,
        cookies: { "auth-token": adminToken },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/incidents/${incidentId}/notes`,
        payload,
        cookies: { "auth-token": adminToken },
      }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json().incident.id).toBe(r2.json().incident.id);
    expect([r1.json().outcome, r2.json().outcome].sort()).toEqual([
      "applied",
      "idempotent_replayed",
    ]);
  });

  it("links a time-grant to an incident atomically and rejects duplicate links (409)", async () => {
    // Candidate + enrollment + started attempt on the same exam
    const candidate = await createCandidateViaApi(
      ctx.app,
      adminToken,
      `inc-cand-${uniquePrefix()}`,
      orgId,
    );
    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": adminToken },
    });
    expect(enrollRes.statusCode).toBe(200);
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode).toBe(201);
    const attemptId = startRes.json().id;

    // Exam-wide incident (no attempt anchor)
    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "grant link test",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(createRes.statusCode).toBe(200);
    const incidentId = createRes.json().incident.id;

    // Freeze the attempt under operator_incident (grant precondition)
    await disruptAttempt(ctx.db, orgId, attemptId, {
      policy: "operator_incident",
    });

    // Grant time with incidentId — grant + action link in ONE transaction
    const grantRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/time-grants`,
      payload: {
        operationId: randomUUID(),
        addedSeconds: 120,
        reasonCode: "network_issue",
        reasonText: "grant link test",
        incidentId,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(grantRes.statusCode).toBe(200);
    expect(grantRes.json().outcome).toBe("granted");

    // The link was committed atomically with the grant
    const links = await ctx.db
      .select()
      .from(schema.examIncidentActions)
      .where(eq(schema.examIncidentActions.incidentId, incidentId));
    expect(links).toHaveLength(1);
    expect(links[0]!.actionType).toBe("time_grant");
    expect(links[0]!.attemptId).toBe(attemptId);

    // Re-linking the same adjustment under a NEW operationId → 409
    const relinkRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incidentId}/actions`,
      payload: {
        operationId: randomUUID(),
        actionType: "time_grant",
        actionId: links[0]!.actionId,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(relinkRes.statusCode).toBe(409);
    expect(relinkRes.json().error.code).toBe("INCIDENT_ACTION_ALREADY_LINKED");
  });
});

describe("admin incident routes — creation authority + error contract", () => {
  const ctx = {} as Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;
  let orgId: string;
  let adminToken: string;

  beforeAll(async () => {
    Object.assign(ctx, await buildTestApp(plugin, { prefix: "/api" }));
    orgId = ctx.org.id;
    adminToken = ctx.adminToken;

    const prefix = uniquePrefix();
    const courseId = randomUUID();
    examId = randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: "Incident Auth Course",
      code: `IAC-${prefix}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: "Incident Auth Exam",
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
      interruptionTimePolicy: "operator_incident",
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await cleanupOrganizationTestData(ctx.db, orgId);
    await ctx.cleanup();
  });

  it("missing exam returns 404 RESOURCE_NOT_FOUND (not 400/500)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${randomUUID()}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "no such exam",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("whitespace-only description returns 400 VALIDATION_ERROR", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "   ",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("candidate not enrolled returns 400 VALIDATION_ERROR", async () => {
    // A candidate profile id that has no enrollment in this exam.
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "candidate focus",
        candidateId: "no-such-candidate",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("anchored incident derives candidateId from the attempt", async () => {
    // Create a candidate, enroll, start an attempt, then anchor an incident
    // with attemptId set + candidateId null. The persisted incident must
    // carry the attempt's candidateId.
    const candidate = await createCandidateViaApi(
      ctx.app,
      adminToken,
      `auth-cand-${uniquePrefix()}`,
      orgId,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode).toBe(201);
    const attemptId = startRes.json().id;

    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "anchored derive",
        attemptId,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(createRes.statusCode).toBe(200);
    // The persisted candidateId is server-derived from the attempt.
    expect(createRes.json().incident.candidateId).toBe(
      candidate.candidateProfileId,
    );
  });

  it("missing time-grant action returns 404 RESOURCE_NOT_FOUND", async () => {
    // Create an exam-wide incident, then try to link a nonexistent adjustment.
    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "missing action test",
      },
      cookies: { "auth-token": adminToken },
    });
    const incidentId = createRes.json().incident.id;

    const linkRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incidentId}/actions`,
      payload: {
        operationId: randomUUID(),
        actionType: "time_grant",
        actionId: "nonexistent-adjustment-id",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(linkRes.statusCode).toBe(404);
    expect(linkRes.json().error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("self-submit attempt as force_submit returns 400 (not force-submitted)", async () => {
    // An attempt that was candidate-submitted (not force-submitted) cannot be
    // linked as force_submit.
    const candidate = await createCandidateViaApi(
      ctx.app,
      adminToken,
      `fs-cand-${uniquePrefix()}`,
      orgId,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    const attemptId = startRes.json().id;

    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "force submit test",
      },
      cookies: { "auth-token": adminToken },
    });
    const incidentId = createRes.json().incident.id;

    const linkRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incidentId}/actions`,
      payload: {
        operationId: randomUUID(),
        actionType: "force_submit",
        actionId: attemptId,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(linkRes.statusCode).toBe(400);
    expect(linkRes.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("same opId + different payload returns 409 IDEMPOTENCY_CONFLICT", async () => {
    const opId = randomUUID();
    // First create succeeds.
    const r1 = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: opId,
        type: "other",
        description: "first",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(r1.statusCode).toBe(200);
    // Same opId, different description (different canonical payload).
    const r2 = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: opId,
        type: "other",
        description: "second — different payload",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("grant replay with incidentId does not duplicate the action link", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      adminToken,
      `replay-cand-${uniquePrefix()}`,
      orgId,
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    const attemptId = startRes.json().id;

    const createRes = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/exams/${examId}/incidents`,
      payload: {
        operationId: randomUUID(),
        type: "other",
        description: "replay test",
      },
      cookies: { "auth-token": adminToken },
    });
    const incidentId = createRes.json().incident.id;

    await disruptAttempt(ctx.db, orgId, attemptId, {
      policy: "operator_incident",
    });

    const opId = randomUUID();
    const g1 = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/time-grants`,
      payload: {
        operationId: opId,
        addedSeconds: 120,
        reasonCode: "network_issue",
        reasonText: "replay test",
        incidentId,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(g1.statusCode).toBe(200);
    // Replay with the SAME opId → idempotent_replay, no duplicate link.
    const g2 = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/time-grants`,
      payload: {
        operationId: opId,
        addedSeconds: 120,
        reasonCode: "network_issue",
        reasonText: "replay test",
        incidentId,
      },
      cookies: { "auth-token": adminToken },
    });
    expect(g2.statusCode).toBe(200);
    expect(g2.json().outcome).toBe("idempotent_replay");

    const links = await ctx.db
      .select()
      .from(schema.examIncidentActions)
      .where(eq(schema.examIncidentActions.incidentId, incidentId));
    expect(links).toHaveLength(1);
  });
});
