import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import type { IncidentSeverity, IncidentType } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createIncidentRepo } from "./incidentRepo.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface Fixture {
  organizationId: string;
  actorId: string;
  examId: string;
  attemptId: string;
  candidateId: string;
  ctx: RequestContext;
}

async function createFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const actorId = randomUUID();
  const candidateUserId = randomUUID();
  const candidateId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `Org ${suffix}`,
    displayName: `Org ${suffix}`,
    slug: `org-${suffix}-${organizationId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: "Course",
    code: `C-${suffix}-${courseId}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values([
    {
      id: actorId,
      organizationId,
      username: `actor-${suffix}-${actorId}`,
      passwordHash: "hash",
      name: "Actor",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: candidateUserId,
      organizationId,
      username: `candidate-${suffix}-${candidateUserId}`,
      passwordHash: "hash",
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.candidateProfiles).values({
    id: candidateId,
    organizationId,
    userId: candidateUserId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.exams).values({
    id: examId,
    organizationId,
    title: "Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date("2026-01-02T00:00:00.000Z"),
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
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId,
    examId,
    candidateId,
    status: "started",
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.examAttempts).values({
    id: attemptId,
    organizationId,
    examId,
    enrollmentId,
    candidateId,
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: now,
    deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return {
    organizationId,
    actorId,
    examId,
    attemptId,
    candidateId,
    ctx: context(organizationId, actorId),
  };
}

describe("incident persistence foundation", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: Fixture;
  let beta: Fixture;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("incident-persistence");
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("creates an incident with defaults and reads it back", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date("2026-01-01T12:00:00.000Z");
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "network_interruption",
      severity: "info",
      occurredAt: null,
      description: "Network dropped for 5 minutes",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });

    expect(incident).toMatchObject({
      organizationId: alpha.organizationId,
      examId: alpha.examId,
      type: "network_interruption",
      severity: "info",
      status: "open",
      version: 1,
      description: "Network dropped for 5 minutes",
      reportedBy: alpha.actorId,
      resolvedAt: null,
      resolvedBy: null,
      resolutionSummary: null,
    });

    const found = await repo.findById(alpha.ctx, incident.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(incident.id);
  });

  it("rejects an invalid incident type via DB CHECK", async () => {
    const repo = createIncidentRepo(db);
    await expect(
      repo.insert(alpha.ctx, {
        examId: alpha.examId,
        attemptId: null,
        candidateId: null,
        type: "invalid_type" as IncidentType,
        severity: "info",
        occurredAt: null,
        description: "test",
        reportedBy: alpha.actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid severity via DB CHECK", async () => {
    const repo = createIncidentRepo(db);
    await expect(
      repo.insert(alpha.ctx, {
        examId: alpha.examId,
        attemptId: null,
        candidateId: null,
        type: "other",
        severity: "catastrophic" as IncidentSeverity,
        occurredAt: null,
        description: "test",
        reportedBy: alpha.actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("enforces tenant isolation — cross-org incident invisible", async () => {
    const repo = createIncidentRepo(db);
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "alpha-only",
      reportedBy: alpha.actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const cross = await repo.findById(beta.ctx, incident.id);
    expect(cross).toBeNull();
  });

  it("appends an event and lists events ordered by event_sequence", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "event test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });

    const op1 = randomUUID();
    const op2 = randomUUID();
    await repo.appendEvent(alpha.ctx, {
      incidentId: incident.id,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: op1,
      actorId: alpha.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: now,
    });
    await repo.appendEvent(alpha.ctx, {
      incidentId: incident.id,
      eventType: "note_added",
      commandType: "addIncidentNote",
      operationId: op2,
      actorId: alpha.actorId,
      beforeVersion: 1,
      afterVersion: 1,
      payload: { body: "a note" },
      createdAt: now,
    });

    const events = await repo.listEventsByIncident(alpha.ctx, incident.id);
    expect(events).toHaveLength(2);
    // event_sequence is IDENTITY — monotonically increasing
    expect(events[0]!.eventSequence).toBeLessThan(events[1]!.eventSequence);
  });

  it("enforces operation unique on events (UNIQUE org+operation_id)", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "op-unique test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const opId = randomUUID();
    await repo.appendEvent(alpha.ctx, {
      incidentId: incident.id,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: opId,
      actorId: alpha.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: now,
    });
    // Same operationId on a different incident → must violate unique
    const incident2 = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "second",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      repo.appendEvent(alpha.ctx, {
        incidentId: incident2.id,
        eventType: "incident_created",
        commandType: "createExamIncident",
        operationId: opId,
        actorId: alpha.actorId,
        beforeVersion: 0,
        afterVersion: 1,
        payload: {},
        createdAt: now,
      }),
    ).rejects.toThrow();
  });

  it("finds an event by operationId", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "lookup test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const opId = randomUUID();
    await repo.appendEvent(alpha.ctx, {
      incidentId: incident.id,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: opId,
      actorId: alpha.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: { foo: "bar" },
      createdAt: now,
    });
    const found = await repo.findEventByOperationId(alpha.ctx, opId);
    expect(found).not.toBeNull();
    expect(found?.commandType).toBe("createExamIncident");
    expect(found?.payload).toEqual({ foo: "bar" });
  });

  it("inserts an action link and lists by incident", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: alpha.attemptId,
      candidateId: alpha.candidateId,
      type: "device_failure",
      severity: "major",
      occurredAt: null,
      description: "device link test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const opId = randomUUID();
    const actionId = randomUUID();
    await repo.insertActionLink(alpha.ctx, {
      incidentId: incident.id,
      actionType: "force_submit",
      actionId,
      attemptId: alpha.attemptId,
      actorId: alpha.actorId,
      operationId: opId,
      linkedAt: now,
    });
    const links = await repo.listActionsByIncident(alpha.ctx, incident.id);
    expect(links).toHaveLength(1);
    expect(links[0]!.actionType).toBe("force_submit");
    expect(links[0]!.actionId).toBe(actionId);
  });

  it("enforces action link unique (UNIQUE org+action_type+action_id)", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident1 = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: alpha.attemptId,
      candidateId: alpha.candidateId,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "link-unique 1",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const incident2 = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: alpha.attemptId,
      candidateId: alpha.candidateId,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "link-unique 2",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const actionId = randomUUID();
    await repo.insertActionLink(alpha.ctx, {
      incidentId: incident1.id,
      actionType: "force_submit",
      actionId,
      attemptId: alpha.attemptId,
      actorId: alpha.actorId,
      operationId: randomUUID(),
      linkedAt: now,
    });
    // Same action linked to a different incident → must violate
    await expect(
      repo.insertActionLink(alpha.ctx, {
        incidentId: incident2.id,
        actionType: "force_submit",
        actionId,
        attemptId: alpha.attemptId,
        actorId: alpha.actorId,
        operationId: randomUUID(),
        linkedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("inserts attempt membership and lists by incident", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null, // exam-wide
      candidateId: null,
      type: "system_outage",
      severity: "critical",
      occurredAt: null,
      description: "membership test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    await repo.insertAttemptMembership(alpha.ctx, {
      incidentId: incident.id,
      attemptId: alpha.attemptId,
      relationshipType: "affected",
      linkedBy: alpha.actorId,
      operationId: randomUUID(),
      linkedAt: now,
    });
    const members = await repo.listAttemptsByIncident(alpha.ctx, incident.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.relationshipType).toBe("affected");
  });

  it("enforces attempt membership unique (UNIQUE incident+attempt)", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "membership-unique",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    await repo.insertAttemptMembership(alpha.ctx, {
      incidentId: incident.id,
      attemptId: alpha.attemptId,
      relationshipType: "affected",
      linkedBy: alpha.actorId,
      operationId: randomUUID(),
      linkedAt: now,
    });
    await expect(
      repo.insertAttemptMembership(alpha.ctx, {
        incidentId: incident.id,
        attemptId: alpha.attemptId,
        relationshipType: "referenced",
        linkedBy: alpha.actorId,
        operationId: randomUUID(),
        linkedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("lists incidents by exam with optional status filter", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const examId = alpha.examId;
    await repo.insert(alpha.ctx, {
      examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "list-1",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    await repo.insert(alpha.ctx, {
      examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "list-2",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });

    const all = await repo.listByExam(alpha.ctx, examId);
    expect(all.length).toBeGreaterThanOrEqual(2);

    const none = await repo.listByExam(alpha.ctx, examId, ["resolved"]);
    expect(none).toHaveLength(0);
  });

  it("updates incident state and version atomically", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "update test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const updated = await repo.update(alpha.ctx, incident.id, {
      status: "investigating",
      version: 2,
      updatedAt: now,
    });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe("investigating");
    expect(updated?.version).toBe(2);
  });

  it("locks incident row FOR UPDATE (findByIdForUpdate)", async () => {
    const repo = createIncidentRepo(db);
    const now = new Date();
    const incident = await repo.insert(alpha.ctx, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "lock test",
      reportedBy: alpha.actorId,
      createdAt: now,
      updatedAt: now,
    });
    const locked = await repo.findByIdForUpdate(alpha.ctx, incident.id);
    expect(locked).not.toBeNull();
    expect(locked?.id).toBe(incident.id);
  });
});
