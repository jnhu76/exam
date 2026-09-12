/**
 * Proctor Recovery Center (J6, #303) — narrow Proctor-scoped read projections.
 *
 * EXAM-303 authority freeze (F3, human-gate corrective 2026-09-12):
 *   - worklist / detail expose ONLY incident-domain truth an assigned Proctor
 *     already holds read authority over;
 *   - the wire shape must NOT carry Admin recovery-only fields (the F3 list:
 *     time-adjustment ledger, auditReferences, activeProctors, execution
 *     details) — asserted here by exact key sets, so a field added to the
 *     shared repo projection cannot silently leak onto the Proctor wire;
 *   - unassigned / foreign / nonexistent incidents fold into the canonical
 *     404 RESOURCE_NOT_FOUND (ADR-015 §9);
 *   - allowedActions is capability-intersected: a Proctor never sees
 *     resolve/dismiss; an Admin on the same endpoint does.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { registerAdminIncidentRoutes } from "./incidents.admin.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  await registerAdminIncidentRoutes(fastify);
};

describe("Proctor Recovery Center — narrow projections (J6, #303)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgAId: string;
  let orgBId: string;
  let examAId: string;
  let examUId: string;
  let examBId: string;
  let attemptAId: string;
  let linkedAttemptId: string;
  let incidentAId: string;
  let incidentA2Id: string;
  let incidentUId: string;
  let incidentBId: string;
  let p1Token: string;
  let p2Token: string;
  let cleanupIds: string[] = [];

  async function insertExam(examId: string, orgId: string, title: string) {
    const now = new Date();
    const courseId = randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgId,
      name: `${title} course`,
      code: `PRC-${uniquePrefix()}`,
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
  }

  beforeAll(async () => {
    ctx = await buildTestApp(plugin, { prefix: "/api" });
    orgAId = ctx.org.id;
    cleanupIds = [orgAId];

    examAId = randomUUID();
    examUId = randomUUID();
    await insertExam(examAId, orgAId, "PRC assigned exam");
    await insertExam(examUId, orgAId, "PRC unassigned exam");

    const now = new Date();
    const enrollmentId = randomUUID();
    const candidateProfileId = randomUUID();
    await ctx.db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId: orgAId,
      userId: ctx.candidate.id,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId: orgAId,
      examId: examAId,
      candidateId: candidateProfileId,
      status: "active",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    attemptAId = randomUUID();
    await ctx.db.insert(schema.examAttempts).values({
      id: attemptAId,
      organizationId: orgAId,
      examId: examAId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: new Date(now.getTime() + 3600_000),
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    orgBId = randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: orgBId,
      name: "PRC Org B",
      displayName: "PRC Organization B",
      slug: `prc-orgb-${randomUUID().slice(0, 8)}`,
    });
    cleanupIds.push(orgBId);
    examBId = randomUUID();
    await insertExam(examBId, orgBId, "PRC orgB exam");

    const createIncident = async (
      examId: string,
      description: string,
      attemptId?: string,
    ) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examId}/incidents`,
        payload: {
          operationId: randomUUID(),
          type: "network_interruption",
          description,
          ...(attemptId ? { attemptId } : {}),
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      return res.json().incident.id as string;
    };

    incidentAId = await createIncident(
      examAId,
      "PRC assigned-exam incident",
      attemptAId,
    );
    incidentUId = await createIncident(examUId, "PRC unassigned-exam incident");
    // Candidate-anchored sibling on the assigned exam: ADR-014 §2 makes
    // anchor and membership mutually exclusive, so membership links can only
    // be exercised on a NON-anchored incident.
    {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/exams/${examAId}/incidents`,
        payload: {
          operationId: randomUUID(),
          type: "suspected_misconduct",
          description: "PRC candidate-anchored incident",
          candidateId: candidateProfileId,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      incidentA2Id = res.json().incident.id as string;
    }
    // Foreign-org incident: the org-A admin cannot reach org B through the
    // API (assignment-scoped 404), so this fixture row is inserted directly.
    incidentBId = randomUUID();
    {
      const nowB = new Date();
      await ctx.db.insert(schema.examIncidents).values({
        id: incidentBId,
        organizationId: orgBId,
        examId: examBId,
        type: "network_interruption",
        severity: "minor",
        status: "open",
        description: "PRC foreign-org incident",
        reportedBy: ctx.admin.id,
        version: 1,
        createdAt: nowB,
        updatedAt: nowB,
      });
    }

    // Documentation history on the assigned incident: one note + one attempt
    // membership link, both via the canonical Admin commands. The membership
    // must be a NON-anchor attempt (ADR-014 §2: anchor and membership are
    // mutually exclusive → linking the anchor attempt would 409).
    const note = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incidentAId}/notes`,
      payload: { operationId: randomUUID(), body: "PRC probe note" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(note.statusCode).toBe(200);

    // Second attempt on the SAME enrollment (attemptNo 2) — the membership
    // link target. (candidate_profiles is unique per (org, user), so the
    // linked attempt reuses the anchor's candidate rather than a new profile.)
    const now2 = new Date();
    linkedAttemptId = randomUUID();
    await ctx.db.insert(schema.examAttempts).values({
      id: linkedAttemptId,
      organizationId: orgAId,
      examId: examAId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 2,
      status: "submitted",
      questionSnapshot: [],
      answers: [],
      startedAt: now2,
      deadlineAt: new Date(now2.getTime() + 3600_000),
      lastActivityAt: now2,
      createdAt: now2,
      updatedAt: now2,
    });
    const linked = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/incidents/${incidentA2Id}/attempts`,
      payload: {
        operationId: randomUUID(),
        attemptId: linkedAttemptId,
        relationshipType: "affected",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(linked.statusCode).toBe(200);

    const p1 = await createAssignedUserForTest(
      ctx.db,
      orgAId,
      "Proctor",
      "prc-assigned",
    );
    p1Token = p1.token;
    await ctx.db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: orgAId,
      examId: examAId,
      proctorUserId: p1.user.id,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const p2 = await createAssignedUserForTest(
      ctx.db,
      orgAId,
      "Proctor",
      "prc-unassigned",
    );
    p2Token = p2.token;
  });

  afterAll(async () => {
    for (const orgId of cleanupIds) {
      await cleanupOrganizationTestData(ctx.db, orgId);
    }
    await ctx.cleanup();
  });

  const inject = (token: string, method: "GET", url: string) =>
    ctx.app.inject({ method, url, cookies: { "auth-token": token } });

  it("worklist: assigned Proctor sees exactly the assigned exam's incident, in the narrow F3 shape", async () => {
    const res = await inject(p1Token, "GET", "/api/admin/proctor/incidents");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    const item = body.items.find(
      (i: { incident: { id: string } }) => i.incident.id === incidentAId,
    );
    expect(item).toBeDefined();
    expect(Object.keys(item).sort()).toEqual([
      "examSummary",
      "incident",
      "primaryAttempt",
    ]);
    expect(item.examSummary.id).toBe(examAId);
    expect(item.primaryAttempt).toMatchObject({
      id: attemptAId,
      status: "in_progress",
    });
    // F3 corrective: Admin recovery-only fields must not appear anywhere.
    expect(res.body).not.toContain("activeProctors");
    expect(res.body).not.toContain("timeAdjustment");
    expect(res.body).not.toContain("auditReferences");
  });

  it("worklist: unassigned Proctor gets an empty collection", async () => {
    const res = await inject(p2Token, "GET", "/api/admin/proctor/incidents");
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it("worklist: Admin short-circuits to org-wide", async () => {
    const res = await inject(
      ctx.adminToken,
      "GET",
      "/api/admin/proctor/incidents",
    );
    expect(res.statusCode).toBe(200);
    const ids = res
      .json()
      .items.map((i: { incident: { id: string } }) => i.incident.id);
    expect(ids).toContain(incidentAId);
    expect(ids).toContain(incidentA2Id);
    expect(ids).toContain(incidentUId);
  });

  it("detail: assigned Proctor reads events/notes/links + Proctor-scoped allowedActions, no Admin-only fields", async () => {
    const res = await inject(
      p1Token,
      "GET",
      `/api/admin/incidents/${incidentAId}/detail`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      "actionLinks",
      "allowedActions",
      "attemptLinks",
      "events",
      "examSummary",
      "incident",
      "interruptionLinks",
      "notes",
      "primaryAttempt",
    ]);
    expect(body.incident.id).toBe(incidentAId);
    expect(body.examSummary).toMatchObject({ id: examAId });
    expect(body.primaryAttempt).toMatchObject({ id: attemptAId });
    expect(body.events.map((e: { eventType: string }) => e.eventType)).toEqual(
      expect.arrayContaining(["incident_created", "note_added"]),
    );
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].body).toBe("PRC probe note");
    // Anchored incident → membership is structurally impossible (ADR-014 §2).
    expect(body.attemptLinks).toEqual([]);

    // Capability intersection: an anchored open incident offers the
    // investigate family; resolve/dismiss (Admin terminal judgment) must
    // never appear for a Proctor, and link_attempt is structurally impossible
    // on an anchored incident.
    expect(body.allowedActions).toContain("add_note");
    expect(body.allowedActions).toContain("change_severity");
    expect(body.allowedActions).not.toContain("resolve");
    expect(body.allowedActions).not.toContain("dismiss");
    expect(body.allowedActions).not.toContain("link_attempt");
  });

  it("detail: non-anchored incident carries membership link metadata + link_attempt action for the Proctor", async () => {
    const res = await inject(
      p1Token,
      "GET",
      `/api/admin/incidents/${incidentA2Id}/detail`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.primaryAttempt).toBeNull();
    expect(body.attemptLinks).toHaveLength(1);
    expect(body.attemptLinks[0]).toMatchObject({
      attemptId: linkedAttemptId,
      relationshipType: "affected",
    });
    expect(
      body.events.map((e: { eventType: string }) => e.eventType),
    ).toContain("attempt_linked");
    expect(body.allowedActions).toContain("link_attempt");
    expect(body.allowedActions).not.toContain("resolve");
  });

  it("detail: Admin on the same endpoint sees resolve/dismiss in allowedActions", async () => {
    const res = await inject(
      ctx.adminToken,
      "GET",
      `/api/admin/incidents/${incidentAId}/detail`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().allowedActions).toEqual(
      expect.arrayContaining(["resolve", "dismiss"]),
    );
  });

  it("detail: unassigned / unassigned-exam / foreign / nonexistent all fold into 404 RESOURCE_NOT_FOUND", async () => {
    const cases = [
      { token: p2Token, id: incidentAId, why: "unassigned proctor" },
      { token: p1Token, id: incidentUId, why: "unassigned exam" },
      { token: p1Token, id: incidentBId, why: "foreign org" },
      { token: p1Token, id: randomUUID(), why: "nonexistent" },
    ];
    for (const { token, id, why } of cases) {
      const res = await inject(
        token,
        "GET",
        `/api/admin/incidents/${id}/detail`,
      );
      expect(res.statusCode, why).toBe(404);
      expect(res.json().error.code, why).toBe("RESOURCE_NOT_FOUND");
    }
  });
});
