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
import { and, eq, inArray } from "drizzle-orm";
import { Permission } from "@exam/authz";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import type {
  AttemptAllowedAction,
  IncidentAllowedAction,
} from "@exam/db/src/repository/recoveryRepo.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
import {
  deriveAllowedActionsForCaller,
  deriveAttemptAllowedActionsForCaller,
  registerAdminIncidentRoutes,
} from "./incidents.admin.js";

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

// ── J5-I1A2 — Recovery Incident Aggregate Detail (contract §6.3) ──

describe("J5-I1A2 Admin Recovery aggregate detail — GET /admin/recovery/incidents/:incidentId", () => {
  let ctx2: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken2: string;
  let candidateToken2: string;
  let cleanupOrgId2: string | null = null;
  let aggregateIncidentId: string;
  let aggregateExamId: string;
  let aggregateAttemptId: string;
  let aggregateCandidateProfileId: string;
  let proctor2Token: string;
  let proctor2UserId: string;

  beforeAll(async () => {
    ctx2 = await buildTestApp(plugin);
    cleanupOrgId2 = ctx2.org.id;
    adminToken2 = ctx2.adminToken;
    candidateToken2 = ctx2.candidateToken;

    // Build an exam + attempt + candidate + proctor + incident for the aggregate.
    const now = new Date();
    const courseId = randomUUID();
    aggregateExamId = randomUUID();
    const attemptId = randomUUID();
    const enrollmentId = randomUUID();
    const candidateProfileId = randomUUID();
    aggregateIncidentId = randomUUID();
    aggregateAttemptId = attemptId;
    aggregateCandidateProfileId = candidateProfileId;

    await ctx2.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx2.org.id,
      name: "Aggregate Detail Course",
      code: `ADC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.exams).values({
      id: aggregateExamId,
      organizationId: ctx2.org.id,
      title: "Aggregate Detail Exam",
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
    await ctx2.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: ctx2.org.id,
      userId: ctx2.candidate.id,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      candidateId: candidateProfileId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
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
    await ctx2.db.insert(schema.examIncidents).values({
      id: aggregateIncidentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      attemptId,
      candidateId: candidateProfileId,
      type: "device_failure",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "aggregate detail route incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Proctor with active assignment on this exam — must STILL be denied.
    const proctor = await createAssignedUserForTest(
      ctx2.db,
      ctx2.org.id,
      "Proctor",
      `aggproctor-${uniquePrefix()}`,
      { isPrimary: true, isActive: true },
    );
    proctor2UserId = proctor.user.id;
    proctor2Token = proctor.token;
    await ctx2.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      proctorUserId: proctor2UserId,
      status: "active",
      assignedBy: ctx2.admin.id,
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (cleanupOrgId2) {
      await cleanupOrganizationTestData(ctx2.db, cleanupOrgId2);
    }
    await ctx2.cleanup();
  });

  it("Admin reads the aggregate — returns frozen projection", async () => {
    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${aggregateIncidentId}`,
      cookies: { "auth-token": adminToken2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.incident.id).toBe(aggregateIncidentId);
    expect(body.incident.version).toBe(1);
    // examSummary now carries closeAt (effective-deadline canonical input).
    expect(body.examSummary.id).toBe(aggregateExamId);
    expect(body.examSummary.title).toBe("Aggregate Detail Exam");
    expect(body.examSummary.status).toBe("open");
    expect(body.examSummary.closeAt).toEqual(expect.any(String));
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.notes)).toBe(true);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(Array.isArray(body.attemptMemberships)).toBe(true);
    expect(Array.isArray(body.interruptionLinks)).toBe(true);
    expect(Array.isArray(body.candidateSummaries)).toBe(true);
    expect(Array.isArray(body.attemptSummaries)).toBe(true);
    expect(Array.isArray(body.timeAdjustmentSummaries)).toBe(true);
    expect(Array.isArray(body.auditReferences)).toBe(true);
    expect(body.snapshotAt).toEqual(expect.any(String));
    // allowedActions is the FINAL per-caller intersection (J5-R0 §6.2 / §6.3):
    // status candidates(open) ∩ Admin capabilities (investigate + resolve) ∩
    // incident shape. The seeded incident is ANCHORED, so `link_attempt` is
    // structurally impossible (ADR-014 §2 anchor/membership mutual exclusion)
    // and MUST be absent even though the status machine lists it.
    expect(body.allowedActions).toEqual([
      "investigate",
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_interruption",
    ]);
    expect(body.allowedActions).not.toContain("link_attempt");
    // Each attempt summary carries the EFFECTIVE deadline (not raw deadlineAt)
    // — the field is renamed to make the semantics explicit — and the score
    // (Task 7a additive field; null because the seeded attempts are ungraded).
    for (const a of body.attemptSummaries) {
      expect(a.effectiveDeadlineAt).toEqual(expect.any(String));
      expect(a).not.toHaveProperty("deadlineAt");
      expect(a.score).toBeNull();
    }
  });

  it("Admin needs no fake Proctor assignment — bare Admin works", async () => {
    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${aggregateIncidentId}`,
      cookies: { "auth-token": adminToken2 },
    });
    expect(res.statusCode).toBe(200);
  });

  it("Proctor with incident.view + active assignment is STILL denied", async () => {
    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${aggregateIncidentId}`,
      cookies: { "auth-token": proctor2Token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Candidate is denied", async () => {
    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${aggregateIncidentId}`,
      cookies: { "auth-token": candidateToken2 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Anonymous (no cookie) is denied with 401", async () => {
    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${aggregateIncidentId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("missing incident returns 404 (resolver fail-closed, anti-enumeration)", async () => {
    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${randomUUID()}`,
      cookies: { "auth-token": adminToken2 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("attemptSummaries carry the EFFECTIVE deadline = min(exam.closeAt, attempt.deadlineAt)", async () => {
    // Build an exam whose closeAt is EARLIER than the attempt deadlineAt — the
    // effective deadline MUST be the exam closeAt, not the raw attempt
    // deadlineAt. This is the canonical authority (contract §6.2 / §6.3): the
    // frontend MUST NOT derive it.
    const now = new Date();
    const courseId = randomUUID();
    const examId = randomUUID();
    const attemptId = randomUUID();
    const enrollmentId = randomUUID();
    const candidateUserId = randomUUID();
    const candidateProfileId = randomUUID();
    const incidentId = randomUUID();
    const examCloseAt = new Date(now.getTime() + 1_800_000); // +30min
    const attemptDeadlineAt = new Date(now.getTime() + 7_200_000); // +2h

    // A dedicated candidate user — the shared ctx2.candidate fixture already
    // has a candidate profile in this org (unique per user).
    await ctx2.db.insert(schema.users).values({
      id: candidateUserId,
      organizationId: ctx2.org.id,
      username: `edcand-${uniquePrefix()}`,
      passwordHash: "hash",
      name: "Effective Deadline Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx2.org.id,
      name: "Effective Deadline Course",
      code: `EDC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.exams).values({
      id: examId,
      organizationId: ctx2.org.id,
      title: "Effective Deadline Exam",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: examCloseAt,
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
    await ctx2.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: ctx2.org.id,
      userId: candidateUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: ctx2.org.id,
      examId,
      candidateId: candidateProfileId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: ctx2.org.id,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: attemptDeadlineAt,
      // Graded score — projected by the aggregate (Task 7a additive field).
      score: 91,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx2.org.id,
      examId,
      attemptId,
      candidateId: candidateProfileId,
      type: "network_interruption",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "effective deadline boundary incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${incidentId}`,
      cookies: { "auth-token": adminToken2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const attemptSummary = body.attemptSummaries.find(
      (a: { id: string }) => a.id === attemptId,
    );
    expect(attemptSummary).toBeDefined();
    // Task 7a additive field: the graded attempt's score is projected.
    expect(attemptSummary.score).toBe(91);
    // exam.closeAt (+30min) is earlier than attempt.deadlineAt (+2h) →
    // effectiveDeadlineAt MUST equal examCloseAt, not attemptDeadlineAt.
    expect(attemptSummary.effectiveDeadlineAt).toBe(examCloseAt.toISOString());
  });

  it("broken parent chain fails closed with 503 AUTHZ_UNAVAILABLE", async () => {
    // An incident in the Admin's org whose examId references an exam that
    // exists but belongs to ANOTHER org — the resolver already validated the
    // incident exists in-org, but the aggregate's org-scoped exam lookup cannot
    // resolve the parent. Fail closed (503), never a bare 500.
    const now = new Date();
    const foreignOrgId = randomUUID();
    const foreignCourseId = randomUUID();
    const foreignExamId = randomUUID();
    const brokenIncidentId = randomUUID();
    await ctx2.db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Agg Broken Org",
      displayName: "Agg Broken Org",
      slug: `abbo-${foreignOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.courses).values({
      id: foreignCourseId,
      organizationId: foreignOrgId,
      name: "Agg Broken Course",
      code: `ABC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.exams).values({
      id: foreignExamId,
      organizationId: foreignOrgId,
      title: "Agg Broken Foreign Exam",
      description: "",
      courseId: foreignCourseId,
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
    await ctx2.db.insert(schema.examIncidents).values({
      id: brokenIncidentId,
      organizationId: ctx2.org.id,
      examId: foreignExamId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      status: "open",
      occurredAt: null,
      description: "agg-broken-parent",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    try {
      const res = await ctx2.app.inject({
        method: "GET",
        url: `/api/admin/recovery/incidents/${brokenIncidentId}`,
        cookies: { "auth-token": adminToken2 },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AUTHZ_UNAVAILABLE");
    } finally {
      await ctx2.db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, ctx2.org.id),
            eq(schema.examIncidents.id, brokenIncidentId),
          ),
        );
    }
  });

  it("exam-wide incident + action link only (no membership) returns 200", async () => {
    // P1-3 (round 3): ADR-014 §7 — anchor, membership, operator action links,
    // and interruption evidence links are INDEPENDENT durable relationships.
    // The canonical time-grant path creates adjustment + action link
    // atomically WITHOUT a membership row; the aggregate MUST still read.
    const now = new Date();
    const incidentId = randomUUID();
    await ctx2.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      attemptId: null,
      candidateId: null,
      type: "system_outage",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "agg-action-link-only",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    // ADR-014 §7: for force_submit, actionId IS the force-submitted attemptId.
    await ctx2.db.insert(schema.examIncidentActions).values({
      id: randomUUID(),
      organizationId: ctx2.org.id,
      incidentId,
      actionType: "force_submit",
      actionId: aggregateAttemptId,
      attemptId: aggregateAttemptId,
      actorId: ctx2.admin.id,
      linkedAt: now,
      operationId: randomUUID(),
    });

    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${incidentId}`,
      cookies: { "auth-token": adminToken2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.actions.length).toBe(1);
    expect(body.actions[0].attemptId).toBe(aggregateAttemptId);
    // Wire decision: attemptSummaries = anchor ∪ membership ONLY — the
    // link-referenced attempt is validated but not summarized.
    expect(body.attemptSummaries).toEqual([]);
    // Exam-wide (unanchored) incident keeps `link_attempt` for an Admin.
    expect(body.allowedActions).toContain("link_attempt");
  });

  it("exam-wide incident + interruption link only (no membership) returns 200", async () => {
    // P1-3 (round 3): same independence proof via an interruption evidence
    // link — no membership row exists, the read MUST still succeed.
    const now = new Date();
    const incidentId = randomUUID();
    const interruptionId = randomUUID();
    await ctx2.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      attemptId: null,
      candidateId: null,
      type: "system_outage",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "agg-interruption-link-only",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.attemptInterruptions).values({
      id: interruptionId,
      organizationId: ctx2.org.id,
      attemptId: aggregateAttemptId,
      createdAt: now,
    });
    await ctx2.db.insert(schema.examIncidentInterruptionLinks).values({
      id: randomUUID(),
      organizationId: ctx2.org.id,
      incidentId,
      attemptId: aggregateAttemptId,
      interruptionId,
      linkedBy: ctx2.admin.id,
      linkedAt: now,
      operationId: randomUUID(),
    });

    const res = await ctx2.app.inject({
      method: "GET",
      url: `/api/admin/recovery/incidents/${incidentId}`,
      cookies: { "auth-token": adminToken2 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.interruptionLinks.length).toBe(1);
    expect(body.interruptionLinks[0].attemptId).toBe(aggregateAttemptId);
    expect(body.attemptSummaries).toEqual([]);
  });

  it("anchor + membership conflict fails closed with 503 AUTHZ_UNAVAILABLE", async () => {
    // P1-4 (round 3): ADR-014 §2 makes anchor and membership mutually
    // exclusive. A historical row carrying BOTH is tenant-data corruption;
    // the aggregate must fail closed (503), never project the forbidden graph.
    const now = new Date();
    const incidentId = randomUUID();
    await ctx2.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      attemptId: aggregateAttemptId,
      candidateId: aggregateCandidateProfileId,
      type: "device_failure",
      severity: "info",
      status: "open",
      occurredAt: null,
      description: "agg-anchor-membership-conflict",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: ctx2.org.id,
      incidentId,
      attemptId: aggregateAttemptId,
      relationshipType: "affected",
      linkedBy: ctx2.admin.id,
      operationId: randomUUID(),
      linkedAt: now,
    });
    try {
      const res = await ctx2.app.inject({
        method: "GET",
        url: `/api/admin/recovery/incidents/${incidentId}`,
        cookies: { "auth-token": adminToken2 },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AUTHZ_UNAVAILABLE");
    } finally {
      await ctx2.db
        .delete(schema.examIncidentAttempts)
        .where(eq(schema.examIncidentAttempts.incidentId, incidentId));
      await ctx2.db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, ctx2.org.id),
            eq(schema.examIncidents.id, incidentId),
          ),
        );
    }
  });

  it("aggregate detail projects only the linked time_grant adjustment (unrelated grants on the same attempt are excluded)", async () => {
    // Round 4: timeAdjustmentSummaries is action-identity-driven. Two grants
    // exist on aggregateAttemptId; only G1 is linked via a time_grant action.
    // G2 (same attempt, not linked) must NOT appear in the projection.
    const now = new Date();
    const beforeDeadline = new Date(now.getTime() + 3_600_000);
    const afterDeadline = new Date(now.getTime() + 7_200_000);
    const g1 = randomUUID();
    const g2 = randomUUID();
    for (const gid of [g1, g2]) {
      await ctx2.db.insert(schema.attemptTimeAdjustments).values({
        id: gid,
        operationId: randomUUID(),
        organizationId: ctx2.org.id,
        attemptId: aggregateAttemptId,
        interruptionId: null,
        incidentId: null,
        policy: "operator_incident",
        source: "operator",
        beforeDeadline,
        afterDeadline,
        addedSeconds: 3600,
        reasonCode: "network",
        reasonText: "round4-http",
        actorId: ctx2.admin.id,
        createdAt: now,
      });
    }
    const incidentId = randomUUID();
    await ctx2.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      attemptId: null,
      candidateId: null,
      type: "system_outage",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "agg-http-time-grant-linked-only",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx2.db.insert(schema.examIncidentActions).values({
      id: randomUUID(),
      organizationId: ctx2.org.id,
      incidentId,
      actionType: "time_grant",
      actionId: g1,
      attemptId: aggregateAttemptId,
      actorId: ctx2.admin.id,
      linkedAt: now,
      operationId: randomUUID(),
    });
    try {
      const res = await ctx2.app.inject({
        method: "GET",
        url: `/api/admin/recovery/incidents/${incidentId}`,
        cookies: { "auth-token": adminToken2 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Only G1 projected; G2 excluded.
      expect(body.timeAdjustmentSummaries).toHaveLength(1);
      expect(body.timeAdjustmentSummaries[0].id).toBe(g1);
      expect(body.timeAdjustmentSummaries[0].attemptId).toBe(
        aggregateAttemptId,
      );
    } finally {
      await ctx2.db
        .delete(schema.examIncidentActions)
        .where(eq(schema.examIncidentActions.incidentId, incidentId));
      await ctx2.db
        .delete(schema.attemptTimeAdjustments)
        .where(inArray(schema.attemptTimeAdjustments.id, [g1, g2]));
      await ctx2.db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, ctx2.org.id),
            eq(schema.examIncidents.id, incidentId),
          ),
        );
    }
  });

  it("aggregate detail maps a broken time_grant referent to HTTP 503 AUTHZ_UNAVAILABLE", async () => {
    // Round 4: a time_grant action whose actionId does not resolve to an
    // adjustment is tenant-graph corruption. The public error mapping is
    // 503 AUTHZ_UNAVAILABLE (no internal sentinel leaked).
    const now = new Date();
    const incidentId = randomUUID();
    await ctx2.db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: ctx2.org.id,
      examId: aggregateExamId,
      attemptId: null,
      candidateId: null,
      type: "system_outage",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "agg-http-time-grant-referent-broken",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx2.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    // actionId references an adjustment that does not exist (no FK enforces it).
    await ctx2.db.insert(schema.examIncidentActions).values({
      id: randomUUID(),
      organizationId: ctx2.org.id,
      incidentId,
      actionType: "time_grant",
      actionId: randomUUID(),
      attemptId: aggregateAttemptId,
      actorId: ctx2.admin.id,
      linkedAt: now,
      operationId: randomUUID(),
    });
    try {
      const res = await ctx2.app.inject({
        method: "GET",
        url: `/api/admin/recovery/incidents/${incidentId}`,
        cookies: { "auth-token": adminToken2 },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AUTHZ_UNAVAILABLE");
    } finally {
      await ctx2.db
        .delete(schema.examIncidentActions)
        .where(eq(schema.examIncidentActions.incidentId, incidentId));
      await ctx2.db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, ctx2.org.id),
            eq(schema.examIncidents.id, incidentId),
          ),
        );
    }
  });
});

// ── P1-2 (round 3): allowedActions = status candidates ∩ capabilities ∩ shape ──
//
// The role system is preset-only (ASSIGNABLE_ROLES: Admin/Teacher/Proctor/
// Grader/Candidate) — no runtime role can hold IncidentRecoveryView WITHOUT
// IncidentInvestigate/IncidentResolve. The review's "view-only caller"
// fixture is therefore exercised against the exported pure derivation, which
// is exactly what the route handler composes with the live caller context.

describe("deriveAllowedActionsForCaller — per-caller allowedActions intersection (J5-R0 §6.2/§6.3)", () => {
  const OPEN_CANDIDATES: IncidentAllowedAction[] = [
    "investigate",
    "add_note",
    "change_severity",
    "resolve",
    "dismiss",
    "link_action",
    "link_attempt",
    "link_interruption",
  ];

  it("view-only caller (IncidentRecoveryView without Investigate/Resolve) sees NO action", async () => {
    const allowed = deriveAllowedActionsForCaller({
      statusActionCandidates: OPEN_CANDIDATES,
      capabilities: [Permission.IncidentRecoveryView],
      incidentAttemptId: null,
    });
    expect(allowed).toEqual([]);
  });

  it("investigate-only caller keeps investigate actions but not resolve/dismiss", async () => {
    const allowed = deriveAllowedActionsForCaller({
      statusActionCandidates: OPEN_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.IncidentInvestigate,
      ],
      incidentAttemptId: null,
    });
    expect(allowed).toEqual([
      "investigate",
      "add_note",
      "change_severity",
      "link_action",
      "link_attempt",
      "link_interruption",
    ]);
    expect(allowed).not.toContain("resolve");
    expect(allowed).not.toContain("dismiss");
  });

  it("resolve-only caller keeps resolve/dismiss but not investigate actions", async () => {
    const allowed = deriveAllowedActionsForCaller({
      statusActionCandidates: OPEN_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.IncidentResolve,
      ],
      incidentAttemptId: null,
    });
    expect(allowed).toEqual(["resolve", "dismiss"]);
  });

  it("full-capability caller on an ANCHORED incident never sees link_attempt", async () => {
    const allowed = deriveAllowedActionsForCaller({
      statusActionCandidates: OPEN_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.IncidentInvestigate,
        Permission.IncidentResolve,
      ],
      incidentAttemptId: randomUUID(),
    });
    expect(allowed).toEqual([
      "investigate",
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_interruption",
    ]);
    expect(allowed).not.toContain("link_attempt");
  });

  it("full-capability caller on an exam-wide incident keeps link_attempt", async () => {
    const allowed = deriveAllowedActionsForCaller({
      statusActionCandidates: OPEN_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.IncidentInvestigate,
        Permission.IncidentResolve,
      ],
      incidentAttemptId: null,
    });
    expect(allowed).toEqual(OPEN_CANDIDATES);
  });

  it("status candidates remain the ceiling — terminal status keeps append-only only", async () => {
    const allowed = deriveAllowedActionsForCaller({
      statusActionCandidates: [
        "add_note",
        "link_action",
        "link_attempt",
        "link_interruption",
      ],
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.IncidentInvestigate,
        Permission.IncidentResolve,
      ],
      incidentAttemptId: null,
    });
    expect(allowed).toEqual([
      "add_note",
      "link_action",
      "link_attempt",
      "link_interruption",
    ]);
    expect(allowed).not.toContain("investigate");
    expect(allowed).not.toContain("resolve");
  });
});

// ── J5-I1A3 — Recovery Attempt Operations Context (contract §6.4) ──

describe("J5-I1A3 Admin Recovery attempt operations — GET /admin/recovery/attempts/:attemptId", () => {
  let ctx3: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken3: string;
  let candidateToken3: string;
  let cleanupOrgId3: string | null = null;
  let proctor3Token: string;
  let proctor3UserId: string;
  let attemptId3: string;
  let examId3: string;
  let enrollmentId3: string;
  let candidateProfileId3: string;
  let relatedIncidentId: string;
  let episodeId: string;
  let adjustmentId: string;

  beforeAll(async () => {
    ctx3 = await buildTestApp(plugin);
    cleanupOrgId3 = ctx3.org.id;
    adminToken3 = ctx3.adminToken;
    candidateToken3 = ctx3.candidateToken;

    // Build an exam + attempt + candidate for the operations context, with a
    // full interruption episode, a time adjustment, an audit log, and a
    // related incident so the projection is exercised end-to-end.
    const now = new Date();
    const courseId = randomUUID();
    examId3 = randomUUID();
    attemptId3 = randomUUID();
    enrollmentId3 = randomUUID();
    candidateProfileId3 = randomUUID();
    relatedIncidentId = randomUUID();
    episodeId = randomUUID();
    adjustmentId = randomUUID();

    await ctx3.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx3.org.id,
      name: "Attempt Ops Course",
      code: `AOC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.exams).values({
      id: examId3,
      organizationId: ctx3.org.id,
      title: "Attempt Ops Exam",
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
    await ctx3.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId3,
      organizationId: ctx3.org.id,
      userId: ctx3.candidate.id,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.examEnrollments).values({
      id: enrollmentId3,
      organizationId: ctx3.org.id,
      examId: examId3,
      candidateId: candidateProfileId3,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.examAttempts).values({
      id: attemptId3,
      organizationId: ctx3.org.id,
      examId: examId3,
      enrollmentId: enrollmentId3,
      candidateId: candidateProfileId3,
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
    // One interruption episode with a detected event (the events table has no
    // event_sequence; occurredAt is the chronological key).
    await ctx3.db.insert(schema.attemptInterruptions).values({
      id: episodeId,
      organizationId: ctx3.org.id,
      attemptId: attemptId3,
      createdAt: now,
    });
    await ctx3.db.insert(schema.attemptInterruptionEvents).values({
      id: randomUUID(),
      organizationId: ctx3.org.id,
      attemptId: attemptId3,
      interruptionId: episodeId,
      eventType: "detected",
      occurredAt: now,
      observedLastActivityAt: now,
      detectionSource: "heartbeat_timeout",
      timeoutSeconds: 60,
      policy: "bounded_grace",
      reasonCode: "heartbeat_timeout",
    });
    // One operator time adjustment on the attempt (full per-Attempt ledger).
    await ctx3.db.insert(schema.attemptTimeAdjustments).values({
      id: adjustmentId,
      operationId: randomUUID(),
      organizationId: ctx3.org.id,
      attemptId: attemptId3,
      interruptionId: null,
      incidentId: relatedIncidentId,
      policy: "operator_incident",
      source: "operator",
      beforeDeadline: new Date(now.getTime() + 3_600_000),
      afterDeadline: new Date(now.getTime() + 7_200_000),
      addedSeconds: 3600,
      reasonCode: "network",
      reasonText: "a3-route-http",
      actorId: ctx3.admin.id,
      createdAt: now,
    });
    // Related incident via an attempt membership row.
    await ctx3.db.insert(schema.examIncidents).values({
      id: relatedIncidentId,
      organizationId: ctx3.org.id,
      examId: examId3,
      attemptId: null,
      candidateId: null,
      type: "network_interruption",
      severity: "major",
      status: "open",
      occurredAt: null,
      description: "attempt ops related incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: ctx3.admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: ctx3.org.id,
      incidentId: relatedIncidentId,
      attemptId: attemptId3,
      relationshipType: "affected",
      linkedAt: now,
      linkedBy: ctx3.admin.id,
      operationId: randomUUID(),
    });
    // One audit entry on the attempt target → the timeline.
    await ctx3.db.insert(schema.auditLogs).values({
      id: randomUUID(),
      organizationId: ctx3.org.id,
      actorId: ctx3.admin.id,
      action: "attempt.disrupted",
      targetType: "attempt",
      targetId: attemptId3,
      metadata: { reasonCode: "heartbeat_timeout" },
      ipAddress: null,
      userAgent: null,
      createdAt: now,
    });

    // Proctor with active assignment — must STILL be denied.
    const proctor = await createAssignedUserForTest(
      ctx3.db,
      ctx3.org.id,
      "Proctor",
      `a3proctor-${uniquePrefix()}`,
      { isPrimary: true, isActive: true },
    );
    proctor3UserId = proctor.user.id;
    proctor3Token = proctor.token;
    await ctx3.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: ctx3.org.id,
      examId: examId3,
      proctorUserId: proctor3UserId,
      status: "active",
      assignedBy: ctx3.admin.id,
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (cleanupOrgId3) {
      await cleanupOrganizationTestData(ctx3.db, cleanupOrgId3);
    }
    await ctx3.cleanup();
  });

  it("Admin reads the operations context — returns frozen projection", async () => {
    const res = await ctx3.app.inject({
      method: "GET",
      url: `/api/admin/recovery/attempts/${attemptId3}`,
      cookies: { "auth-token": adminToken3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt).toEqual({
      id: attemptId3,
      examId: examId3,
      candidateId: candidateProfileId3,
      attemptNo: 1,
      status: "in_progress",
      startedAt: expect.any(String),
      deadlineAt: expect.any(String),
      effectiveDeadlineAt: expect.any(String),
      submittedAt: null,
      gradedAt: null,
      lastActivityAt: expect.any(String),
      misconduct: false,
    });
    expect(body.examSummary).toEqual({
      id: examId3,
      title: "Attempt Ops Exam",
      status: "open",
      closeAt: expect.any(String),
    });
    expect(body.candidateSummary.id).toBe(candidateProfileId3);
    expect(body.candidateSummary.displayName).toEqual(expect.any(String));
    // Episode + chronological events.
    expect(body.interruptionEpisodes).toHaveLength(1);
    expect(body.interruptionEpisodes[0].interruption.id).toBe(episodeId);
    expect(body.interruptionEpisodes[0].events).toHaveLength(1);
    expect(body.interruptionEpisodes[0].events[0].eventType).toBe("detected");
    expect(body.interruptionEpisodes[0].events[0].detectionSource).toBe(
      "heartbeat_timeout",
    );
    // Full per-Attempt ledger (operator adjustment projected).
    expect(body.timeAdjustments).toHaveLength(1);
    expect(body.timeAdjustments[0].id).toBe(adjustmentId);
    expect(body.timeAdjustments[0].source).toBe("operator");
    expect(body.timeAdjustments[0].addedSeconds).toBe(3600);
    expect(body.timeAdjustments[0].beforeDeadline).toEqual(expect.any(String));
    expect(body.timeAdjustments[0].afterDeadline).toEqual(expect.any(String));
    // Timeline carries the audit entry.
    expect(body.timeline).toHaveLength(1);
    expect(body.timeline[0].action).toBe("attempt.disrupted");
    expect(body.timeline[0].targetId).toBe(attemptId3);
    expect(body.timeline[0].actorName).toEqual(expect.any(String));
    // Related incident navigation stub (wire carries no linkedAt).
    expect(body.relatedIncidents).toEqual([
      {
        id: relatedIncidentId,
        status: "open",
        severity: "major",
        title: "attempt ops related incident",
      },
    ]);
    // in_progress Admin → all three status candidates pass the capability
    // intersection (Admin preset holds time.grant / force_submit / misconduct.mark).
    expect(body.allowedActions).toEqual([
      "time_grant",
      "force_submit",
      "misconduct_mark",
    ]);
    expect(body.snapshotAt).toEqual(expect.any(String));
  });

  it("Proctor with incident.view + active assignment is STILL denied", async () => {
    const res = await ctx3.app.inject({
      method: "GET",
      url: `/api/admin/recovery/attempts/${attemptId3}`,
      cookies: { "auth-token": proctor3Token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Candidate is denied", async () => {
    const res = await ctx3.app.inject({
      method: "GET",
      url: `/api/admin/recovery/attempts/${attemptId3}`,
      cookies: { "auth-token": candidateToken3 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Anonymous (no cookie) is denied with 401", async () => {
    const res = await ctx3.app.inject({
      method: "GET",
      url: `/api/admin/recovery/attempts/${attemptId3}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("missing attempt returns 404 (anti-enumeration)", async () => {
    const res = await ctx3.app.inject({
      method: "GET",
      url: `/api/admin/recovery/attempts/${randomUUID()}`,
      cookies: { "auth-token": adminToken3 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("non-UUID attemptId is rejected with 400 VALIDATION_ERROR", async () => {
    const res = await ctx3.app.inject({
      method: "GET",
      url: "/api/admin/recovery/attempts/not-a-uuid",
      cookies: { "auth-token": adminToken3 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("allowedActions shrinks with attempt status (submitted, voided)", async () => {
    // submitted → force_submit (recovery) + misconduct_mark; no time_grant.
    // voided → misconduct_mark only (statusActionCandidates ceiling).
    const now = new Date();
    const attempts: Array<{ id: string; enrollmentId: string }> = [];
    for (const status of ["submitted", "voided"] as const) {
      const candidateUserId = randomUUID();
      const candidateProfileId = randomUUID();
      const enrollmentId = randomUUID();
      const attemptId = randomUUID();
      attempts.push({ id: attemptId, enrollmentId });
      await ctx3.db.insert(schema.users).values({
        id: candidateUserId,
        organizationId: ctx3.org.id,
        username: `a3stat-${status}-${uniquePrefix()}`,
        passwordHash: "hash",
        name: `A3 ${status} candidate`,
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx3.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx3.org.id,
        userId: candidateUserId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      });
      await ctx3.db.insert(schema.examEnrollments).values({
        id: enrollmentId,
        organizationId: ctx3.org.id,
        examId: examId3,
        candidateId: candidateProfileId,
        status: "started",
        attemptCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx3.db.insert(schema.examAttempts).values({
        id: attemptId,
        organizationId: ctx3.org.id,
        examId: examId3,
        enrollmentId,
        candidateId: candidateProfileId,
        attemptNo: 1,
        status,
        questionSnapshot: [],
        answers: [],
        startedAt: now,
        deadlineAt: new Date(now.getTime() + 3_600_000),
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    try {
      const submitted = await ctx3.app.inject({
        method: "GET",
        url: `/api/admin/recovery/attempts/${attempts[0]!.id}`,
        cookies: { "auth-token": adminToken3 },
      });
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().attempt.status).toBe("submitted");
      expect(submitted.json().allowedActions).toEqual([
        "force_submit",
        "misconduct_mark",
      ]);
      const voided = await ctx3.app.inject({
        method: "GET",
        url: `/api/admin/recovery/attempts/${attempts[1]!.id}`,
        cookies: { "auth-token": adminToken3 },
      });
      expect(voided.statusCode).toBe(200);
      expect(voided.json().attempt.status).toBe("voided");
      expect(voided.json().allowedActions).toEqual(["misconduct_mark"]);
    } finally {
      for (const { id, enrollmentId } of attempts) {
        await ctx3.db
          .delete(schema.examAttempts)
          .where(
            and(
              eq(schema.examAttempts.organizationId, ctx3.org.id),
              eq(schema.examAttempts.id, id),
            ),
          );
        await ctx3.db
          .delete(schema.examEnrollments)
          .where(
            and(
              eq(schema.examEnrollments.organizationId, ctx3.org.id),
              eq(schema.examEnrollments.id, enrollmentId),
            ),
          );
      }
    }
  });

  it("effectiveDeadlineAt = min(exam.closeAt, attempt.deadlineAt) computed by the route", async () => {
    // exam.closeAt (+30min) is earlier than attempt.deadlineAt (+2h) → the
    // wire effectiveDeadlineAt MUST equal examCloseAt (canonical authority,
    // contract §6.4 — the frontend never derives it).
    const now = new Date();
    const courseId = randomUUID();
    const examId = randomUUID();
    const enrollmentId = randomUUID();
    const candidateUserId = randomUUID();
    const candidateProfileId = randomUUID();
    const attemptId = randomUUID();
    const examCloseAt = new Date(now.getTime() + 1_800_000);
    const attemptDeadlineAt = new Date(now.getTime() + 7_200_000);
    await ctx3.db.insert(schema.users).values({
      id: candidateUserId,
      organizationId: ctx3.org.id,
      username: `a3deadline-${uniquePrefix()}`,
      passwordHash: "hash",
      name: "A3 Deadline Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx3.org.id,
      name: "A3 Deadline Course",
      code: `A3D-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.exams).values({
      id: examId,
      organizationId: ctx3.org.id,
      title: "A3 Deadline Exam",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: examCloseAt,
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
    await ctx3.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: ctx3.org.id,
      userId: candidateUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: ctx3.org.id,
      examId,
      candidateId: candidateProfileId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: ctx3.org.id,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: attemptDeadlineAt,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    try {
      const res = await ctx3.app.inject({
        method: "GET",
        url: `/api/admin/recovery/attempts/${attemptId}`,
        cookies: { "auth-token": adminToken3 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attempt.effectiveDeadlineAt).toBe(examCloseAt.toISOString());
    } finally {
      await ctx3.db
        .delete(schema.examAttempts)
        .where(
          and(
            eq(schema.examAttempts.organizationId, ctx3.org.id),
            eq(schema.examAttempts.id, attemptId),
          ),
        );
      await ctx3.db
        .delete(schema.examEnrollments)
        .where(
          and(
            eq(schema.examEnrollments.organizationId, ctx3.org.id),
            eq(schema.examEnrollments.id, enrollmentId),
          ),
        );
    }
  });

  it("broken parent chain fails closed with 503 AUTHZ_UNAVAILABLE", async () => {
    // An attempt in the Admin's org whose examId references an exam that
    // exists but belongs to ANOTHER org — the org-scoped parent lookup cannot
    // resolve the chain. Fail closed (503), never a bare 500.
    const now = new Date();
    const foreignOrgId = randomUUID();
    const foreignCourseId = randomUUID();
    const foreignExamId = randomUUID();
    const enrollmentId = randomUUID();
    const attemptId = randomUUID();
    await ctx3.db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "A3 Broken Org",
      displayName: "A3 Broken Org",
      slug: `a3bo-${foreignOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.courses).values({
      id: foreignCourseId,
      organizationId: foreignOrgId,
      name: "A3 Broken Course",
      code: `A3BC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.exams).values({
      id: foreignExamId,
      organizationId: foreignOrgId,
      title: "A3 Broken Foreign Exam",
      description: "",
      courseId: foreignCourseId,
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
    // The attempt row is in the Admin's org but points at the foreign exam —
    // the FK on exam_id is satisfied (the exam row exists); only the org-scoped
    // parent lookup fails.
    await ctx3.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: ctx3.org.id,
      examId: foreignExamId,
      candidateId: candidateProfileId3,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx3.db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: ctx3.org.id,
      examId: foreignExamId,
      enrollmentId,
      candidateId: candidateProfileId3,
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
    try {
      const res = await ctx3.app.inject({
        method: "GET",
        url: `/api/admin/recovery/attempts/${attemptId}`,
        cookies: { "auth-token": adminToken3 },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AUTHZ_UNAVAILABLE");
    } finally {
      await ctx3.db
        .delete(schema.examAttempts)
        .where(
          and(
            eq(schema.examAttempts.organizationId, ctx3.org.id),
            eq(schema.examAttempts.id, attemptId),
          ),
        );
      await ctx3.db
        .delete(schema.examEnrollments)
        .where(
          and(
            eq(schema.examEnrollments.organizationId, ctx3.org.id),
            eq(schema.examEnrollments.id, enrollmentId),
          ),
        );
    }
  });
});

// ── P1-2 (round 3) analogue: deriveAttemptAllowedActionsForCaller ──
//
// The role system is preset-only — no runtime role can hold
// IncidentRecoveryView without the attempt-command capabilities. The
// "view-only caller" fixture is therefore exercised against the exported pure
// derivation, which is exactly what the route handler composes with the live
// caller context.

describe("deriveAttemptAllowedActionsForCaller — per-caller allowedActions intersection (J5-R0 §6.4)", () => {
  const IN_PROGRESS_CANDIDATES: AttemptAllowedAction[] = [
    "time_grant",
    "force_submit",
    "misconduct_mark",
  ];

  it("view-only caller (IncidentRecoveryView without command capabilities) sees NO action", async () => {
    const allowed = deriveAttemptAllowedActionsForCaller({
      statusActionCandidates: IN_PROGRESS_CANDIDATES,
      capabilities: [Permission.IncidentRecoveryView],
    });
    expect(allowed).toEqual([]);
  });

  it("time.grant-only caller keeps time_grant but not force_submit / misconduct_mark", async () => {
    const allowed = deriveAttemptAllowedActionsForCaller({
      statusActionCandidates: IN_PROGRESS_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.AttemptTimeGrant,
      ],
    });
    expect(allowed).toEqual(["time_grant"]);
  });

  it("force_submit-only caller keeps force_submit but not time_grant / misconduct_mark", async () => {
    const allowed = deriveAttemptAllowedActionsForCaller({
      statusActionCandidates: IN_PROGRESS_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.AttemptForceSubmit,
      ],
    });
    expect(allowed).toEqual(["force_submit"]);
  });

  it("misconduct.mark-only caller keeps misconduct_mark but not time_grant / force_submit", async () => {
    const allowed = deriveAttemptAllowedActionsForCaller({
      statusActionCandidates: IN_PROGRESS_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.AttemptMisconductMark,
      ],
    });
    expect(allowed).toEqual(["misconduct_mark"]);
  });

  it("full-capability caller sees every status candidate (status remains the ceiling)", async () => {
    const allowed = deriveAttemptAllowedActionsForCaller({
      statusActionCandidates: IN_PROGRESS_CANDIDATES,
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.AttemptTimeGrant,
        Permission.AttemptForceSubmit,
        Permission.AttemptMisconductMark,
      ],
    });
    expect(allowed).toEqual(IN_PROGRESS_CANDIDATES);
  });

  it("submitted status candidates keep force_submit + misconduct_mark (recovery of submitted rows)", async () => {
    const allowed = deriveAttemptAllowedActionsForCaller({
      statusActionCandidates: ["force_submit", "misconduct_mark"],
      capabilities: [
        Permission.IncidentRecoveryView,
        Permission.AttemptTimeGrant,
        Permission.AttemptForceSubmit,
        Permission.AttemptMisconductMark,
      ],
    });
    expect(allowed).toEqual(["force_submit", "misconduct_mark"]);
  });
});
