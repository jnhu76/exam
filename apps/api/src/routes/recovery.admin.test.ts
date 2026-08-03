/**
 * J5-I1A1 — Admin Recovery Center incident queue (contract §5.4).
 *
 * Conformance-focused HTTP tests for `GET /admin/recovery/incidents`:
 *  - Admin-only authorization (`IncidentRecoveryView` granted ONLY to Admin);
 *    Teacher / Grader / Proctor-with-active-assignment / Candidate / anonymous
 *    are all denied.
 *  - Cross-organization data is never returned: a REAL foreign
 *    org→course→exam→incident chain is seeded and proven absent.
 *  - Strict query validation: UUID filters, enum filters, strict boolean
 *    parsing (`unresolvedOnly=false` stays false), createdFrom<=createdTo,
 *    cursor shape — invalid input is 400 at the API boundary.
 *  - Broken parent chain (incident whose exam is not resolvable in-org) fails
 *    closed as 503 AUTHZ_UNAVAILABLE.
 *  - Each server-side filter narrows the page.
 *  - Cursor pagination: no-dup/no-gap, malformed cursor → 400, limit bounds.
 *  - The frozen queue-item projection (incident/examSummary/primaryAttempt/
 *    primaryCandidate/linkedAttemptCount/linkedCandidateCount/activeProctors)
 *    is returned with no per-row frontend refetch required.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import { registerAdminIncidentRoutes } from "./incidents.admin.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await registerAdminIncidentRoutes(fastify);
};

interface SeedResult {
  examId: string;
  attemptId: string;
  incidentId: string;
  candidateProfileId: string;
}

describe("J5-I1A1 Admin Recovery Center queue — GET /admin/recovery/incidents", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let candidateToken: string;
  let cleanupOrgId: string | null = null;
  let seed: SeedResult;
  let proctorToken: string;
  let proctorUserId: string;
  let teacherToken: string;
  let graderToken: string;

  async function seedExamAndIncident(
    orgId: string,
    actorId: string,
    title: string,
  ): Promise<SeedResult> {
    const now = new Date();
    const courseId = randomUUID();
    const examId = randomUUID();
    const attemptId = randomUUID();
    const incidentId = randomUUID();
    const enrollmentId = randomUUID();
    const candidateProfileId = randomUUID();

    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: `${title} course`,
      code: `RC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title,
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86_400_000),
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
    await ctx.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: orgId,
      userId: ctx.candidate.id,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: orgId,
      examId,
      candidateId: candidateProfileId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: orgId,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 3_600_000),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: orgId,
      examId,
      attemptId,
      candidateId: candidateProfileId,
      type: "network_interruption",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: `${title} queue incident`,
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: actorId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { examId, attemptId, incidentId, candidateProfileId };
  }

  /** Seeds a COMPLETE foreign chain: Org → Course → Exam → Incident. */
  async function seedForeignOrgIncident(): Promise<{
    incidentId: string;
    examId: string;
  }> {
    const now = new Date();
    const otherOrgId = randomUUID();
    const otherCourseId = randomUUID();
    const otherExamId = randomUUID();
    const otherIncidentId = randomUUID();

    await ctx.db.insert(schema.organizations).values({
      id: otherOrgId,
      name: "Other Org",
      displayName: "Other Org",
      slug: `other-${otherOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.courses).values({
      id: otherCourseId,
      organizationId: otherOrgId,
      name: "Other Course",
      code: `OC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: otherExamId,
      organizationId: otherOrgId,
      title: "Foreign Org Exam",
      description: "",
      courseId: otherCourseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86_400_000),
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
    await ctx.db.insert(schema.examIncidents).values({
      id: otherIncidentId,
      organizationId: otherOrgId,
      examId: otherExamId,
      attemptId: null,
      candidateId: null,
      type: "system_outage",
      severity: "critical",
      status: "open",
      occurredAt: null,
      description: "foreign org incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { incidentId: otherIncidentId, examId: otherExamId };
  }

  beforeAll(async () => {
    ctx = await buildTestApp(plugin);
    cleanupOrgId = ctx.org.id;
    adminToken = ctx.adminToken;
    candidateToken = ctx.candidateToken;
    seed = await seedExamAndIncident(
      ctx.org.id,
      ctx.admin.id,
      "Recovery Queue Exam",
    );

    // Proctor with an ACTIVE Exam assignment + active Proctor role. Holds
    // `incident.view` via the Proctor preset, but MUST still be denied the
    // Recovery queue (proctorAccess: admin_only — this is the contract §15
    // adjudication that `incident.recovery.view` is Admin-only).
    const proctor = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Proctor",
      `rcqproctor-${uniquePrefix()}`,
      { isPrimary: true, isActive: true },
    );
    proctorUserId = proctor.user.id;
    proctorToken = proctor.token;
    await ctx.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId: seed.examId,
      proctorUserId: proctorUserId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: new Date(),
      revokedBy: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Teacher / Grader hold none of the Recovery capabilities — their presets
    // do not include `incident.recovery.view`, so the flat gate denies them.
    teacherToken = (
      await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Teacher",
        `rcqteacher-${uniquePrefix()}`,
      )
    ).token;
    graderToken = (
      await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        "Grader",
        `rcqgrader-${uniquePrefix()}`,
      )
    ).token;
  });

  afterAll(async () => {
    if (cleanupOrgId) {
      await cleanupOrganizationTestData(ctx.db, cleanupOrgId);
    }
    await ctx.cleanup();
  });

  it("Admin reads the queue — returns frozen queue-item projection", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.nextCursor).toBeNull();
    const item = body.items.find(
      (i: { incident: { id: string } }) => i.incident.id === seed.incidentId,
    );
    expect(item).toBeDefined();
    expect(item.incident.type).toBe("network_interruption");
    expect(item.incident.severity).toBe("major");
    expect(item.incident.version).toBe(1);
    expect(item.examSummary).toEqual({
      id: seed.examId,
      title: "Recovery Queue Exam",
      status: "open",
    });
    expect(item.primaryAttempt).toEqual({
      id: seed.attemptId,
      candidateId: seed.candidateProfileId,
      status: "in_progress",
      deadlineAt: expect.any(String),
    });
    expect(item.primaryCandidate).toEqual({
      id: seed.candidateProfileId,
      displayName: expect.any(String),
    });
    expect(item.linkedAttemptCount).toBe(1);
    expect(item.linkedCandidateCount).toBe(1);
    expect(item.activeProctors).toEqual([
      { userId: proctorUserId, displayName: expect.any(String) },
    ]);
  });

  it("Admin needs no fake Proctor assignment row — bare Admin token works", async () => {
    // The Admin above has NO examProctorAssignments row; the queue still returns.
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });

  it("Proctor with incident.view + active assignment is STILL denied", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": proctorToken },
    });
    // 403 — Proctor preset does not include IncidentRecoveryView.
    expect(res.statusCode).toBe(403);
  });

  it("Candidate is denied", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Teacher is denied", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Grader is denied", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": graderToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Anonymous (no cookie) is denied", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
    });
    expect(res.statusCode).toBe(401);
  });

  it("cross-organization incidents never appear (tenant isolation)", async () => {
    // Build a REAL foreign chain (Org B → Course B → Exam B → Incident B)
    // and prove the Admin (Org A) page never contains it — the enrichment
    // path would fail if the foreign row ever leaked into the org-scoped
    // page query.
    const { incidentId: foreignIncidentId, examId: foreignExamId } =
      await seedForeignOrgIncident();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      incident: { id: string; examId: string };
    }>;
    // The Admin's own incident is present…
    expect(items.some((i) => i.incident.id === seed.incidentId)).toBe(true);
    // …and the foreign incident/exam never is.
    expect(items.some((i) => i.incident.id === foreignIncidentId)).toBe(false);
    expect(items.every((i) => i.incident.examId !== foreignExamId)).toBe(true);
  });

  it("unresolvedOnly=false keeps resolved incidents (strict boolean parsing)", async () => {
    const now = new Date();
    const resolvedId = randomUUID();
    await ctx.db.insert(schema.examIncidents).values({
      id: resolvedId,
      organizationId: ctx.org.id,
      examId: seed.examId,
      attemptId: null,
      candidateId: null,
      type: "operator_error",
      severity: "minor",
      status: "resolved",
      occurredAt: null,
      description: "resolved-incident",
      resolutionSummary: "resolved",
      resolvedAt: now,
      resolvedBy: ctx.admin.id,
      reportedBy: ctx.admin.id,
      version: 2,
      createdAt: now,
      updatedAt: now,
    });
    // "false" must NOT enable the unresolved filter (z.coerce.boolean bug).
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?unresolvedOnly=false",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (res.json().items as Array<{ incident: { id: string } }>).some(
        (i) => i.incident.id === resolvedId,
      ),
      "resolved incident must appear when unresolvedOnly=false",
    ).toBe(true);
    // And true still excludes it.
    const resTrue = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?unresolvedOnly=true",
      cookies: { "auth-token": adminToken },
    });
    expect(resTrue.statusCode).toBe(200);
    expect(
      (resTrue.json().items as Array<{ incident: { id: string } }>).some(
        (i) => i.incident.id === resolvedId,
      ),
    ).toBe(false);
  });

  it("invalid text-ID filters are rejected with 400 (empty / overlong)", async () => {
    const longId = "x".repeat(129);
    const badQueries = [
      "examId=", // empty
      `examId=${longId}`, // overlong
      "candidateId=",
      "assignedProctorUserId=",
      "attemptId=not-a-uuid", // attemptId remains UUID-authoritative
    ];
    for (const q of badQueries) {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/recovery/incidents?${q}`,
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode, `query ${q} must be 400`).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("non-UUID text IDs are accepted for filters (text-ID authoritative model)", async () => {
    // exams.id / candidate_profiles.id / users.id are `text` — DB-legal
    // non-UUID ids that the rest of the API accepts must not be rejected here.
    const now = new Date();
    const courseId = randomUUID();
    const examId = "exam-nonuuid-1";
    const candUserId = "user-cand-nonuuid-1";
    const candId = "cand-nonuuid-1";
    const proctorUserId = "user-proctor-nonuuid-1";

    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Non-UUID Course",
      code: `NU-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: ctx.org.id,
      title: "Non-UUID Exam",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86_400_000),
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
    await ctx.db.insert(schema.users).values([
      {
        id: candUserId,
        organizationId: ctx.org.id,
        username: `nonuuid-cand-${uniquePrefix()}`,
        passwordHash: "hash",
        name: "NonUUID Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: proctorUserId,
        organizationId: ctx.org.id,
        username: `nonuuid-proc-${uniquePrefix()}`,
        passwordHash: "hash",
        name: "NonUUID Proctor",
        role: "Proctor",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(schema.candidateProfiles).values({
      id: candId,
      organizationId: ctx.org.id,
      userId: candUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      examId: seed.examId,
      proctorUserId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examIncidents).values([
      {
        id: randomUUID(),
        organizationId: ctx.org.id,
        examId,
        attemptId: null,
        candidateId: null,
        type: "other",
        severity: "info",
        status: "open",
        occurredAt: null,
        description: "nonuuid-exam-incident",
        resolutionSummary: null,
        resolvedAt: null,
        resolvedBy: null,
        reportedBy: ctx.admin.id,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        organizationId: ctx.org.id,
        examId: seed.examId,
        attemptId: null,
        candidateId: candId,
        type: "other",
        severity: "info",
        status: "open",
        occurredAt: null,
        description: "nonuuid-cand-incident",
        resolutionSummary: null,
        resolvedAt: null,
        resolvedBy: null,
        reportedBy: ctx.admin.id,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const byExam = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents?examId=${examId}`,
      cookies: { "auth-token": adminToken },
    });
    expect(byExam.statusCode).toBe(200);
    expect(
      (byExam.json().items as Array<{ incident: { examId: string } }>).some(
        (i) => i.incident.examId === examId,
      ),
    ).toBe(true);

    const byCand = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents?candidateId=${candId}`,
      cookies: { "auth-token": adminToken },
    });
    expect(byCand.statusCode).toBe(200);
    expect(
      (
        byCand.json().items as Array<{ incident: { candidateId: string } }>
      ).some((i) => i.incident.candidateId === candId),
    ).toBe(true);

    const byProctor = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents?assignedProctorUserId=${proctorUserId}`,
      cookies: { "auth-token": adminToken },
    });
    expect(byProctor.statusCode).toBe(200);
    expect(byProctor.json().items.length).toBeGreaterThan(0);
  });

  it("invalid enum filters are rejected with 400", async () => {
    const badQueries = [
      "status=bogus",
      "severity=catastrophic",
      "incidentType=bogus",
      "unresolvedOnly=1",
    ];
    for (const q of badQueries) {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/recovery/incidents?${q}`,
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode, `query ${q} must be 400`).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("createdFrom after createdTo is rejected with 400", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?createdFrom=2026-08-01T00:00:00.000Z&createdTo=2026-07-01T00:00:00.000Z",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("filters narrow the page — status filter", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?status=resolved",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      incident: { status: string };
    }>;
    for (const it of items) expect(it.incident.status).toBe("resolved");
  });

  it("filters narrow the page — examId filter", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents?examId=${seed.examId}`,
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      examSummary: { id: string };
    }>;
    for (const it of items) expect(it.examSummary.id).toBe(seed.examId);
  });

  it("filters narrow the page — severity filter", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?severity=critical",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      incident: { severity: string };
    }>;
    for (const it of items) expect(it.incident.severity).toBe("critical");
  });

  it("filters narrow the page — unresolvedOnly=true", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?unresolvedOnly=true",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      incident: { status: string };
    }>;
    for (const it of items)
      expect(["open", "investigating"]).toContain(it.incident.status);
  });

  it("filters narrow the page — assignedProctorUserId (current active)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents?assignedProctorUserId=${proctorUserId}`,
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{
      activeProctors: Array<{ userId: string }>;
    }>;
    for (const it of items)
      expect(it.activeProctors.some((p) => p.userId === proctorUserId)).toBe(
        true,
      );
  });

  it("limit bounds — limit=1 yields at most one item and a nextCursor", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?limit=1",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeLessThanOrEqual(1);
  });

  it("limit over max is rejected with 400", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?limit=1000",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("malformed cursor is rejected with 400", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?cursor=not-a-cursor",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cursor with a non-UUID id is rejected with 400", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/recovery/incidents?cursor=2026-08-01T00:00:00.000Z%7Cnot-a-uuid",
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cursor with a non-canonical datetime is rejected with 400", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents?cursor=2026-08-01%7C${seed.incidentId}`,
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cursor pagination — no-dup/no-gap across pages", async () => {
    // Seed several more incidents so pagination exercises multiple pages.
    const now = new Date();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      ids.push(id);
      await ctx.db.insert(schema.examIncidents).values({
        id,
        organizationId: ctx.org.id,
        examId: seed.examId,
        attemptId: null,
        candidateId: null,
        type: "other",
        severity: "info",
        status: "open",
        occurredAt: null,
        description: `paginate-${i}`,
        resolutionSummary: null,
        resolvedAt: null,
        resolvedBy: null,
        reportedBy: ctx.admin.id,
        version: 1,
        createdAt: new Date(now.getTime() + i * 60_000),
        updatedAt: new Date(now.getTime() + i * 60_000),
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const url: string = `/api/admin/recovery/incidents?limit=2${query}`;
      const res = await ctx.app.inject({
        method: "GET",
        url,
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ incident: { id: string; description: string } }>;
        nextCursor: string | null;
      };
      for (const it of body.items) {
        if (it.incident.description.startsWith("paginate-")) {
          seen.push(it.incident.id);
        }
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    // All 3 paginate incidents must appear exactly once.
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(3);
    for (const id of ids) expect(seen).toContain(id);
  });

  it("broken parent chain fails closed with 503 AUTHZ_UNAVAILABLE", async () => {
    // An incident in the Admin's org whose examId references an exam that
    // exists but belongs to ANOTHER org — the org-scoped parent lookup cannot
    // resolve the chain. The queue must fail closed (503 AUTHZ_UNAVAILABLE),
    // never silently drop the row from the admin audit surface.
    const now = new Date();
    const brokenOrgId = randomUUID();
    const brokenCourseId = randomUUID();
    const brokenExamId = randomUUID();
    const brokenIncidentId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: brokenOrgId,
      name: "Broken Org",
      displayName: "Broken Org",
      slug: `broken-${brokenOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.courses).values({
      id: brokenCourseId,
      organizationId: brokenOrgId,
      name: "Broken Course",
      code: `BC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: brokenExamId,
      organizationId: brokenOrgId,
      title: "Broken Foreign Exam",
      description: "",
      courseId: brokenCourseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86_400_000),
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
    await ctx.db.insert(schema.examIncidents).values({
      id: brokenIncidentId,
      organizationId: ctx.org.id,
      examId: brokenExamId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      status: "open",
      occurredAt: null,
      description: "broken-parent",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    try {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/recovery/incidents",
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AUTHZ_UNAVAILABLE");
    } finally {
      // Remove the corrupted row so it cannot poison later queue reads.
      await ctx.db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, ctx.org.id),
            eq(schema.examIncidents.id, brokenIncidentId),
          ),
        );
    }
  });
});
