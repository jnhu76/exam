import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createRecoveryRepo } from "./recoveryRepo.js";

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
  courseId: string;
  examId: string;
  candidateUserId: string;
  candidateId: string;
  attemptId: string;
  proctorUserId: string;
  ctx: RequestContext;
}

const EXAM_CLOSE_AT = new Date("2026-01-02T00:00:00.000Z");
const ATTEMPT_DEADLINE_AT = new Date("2026-01-01T01:00:00.000Z");

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
  const proctorUserId = randomUUID();

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
      name: `Candidate ${suffix}`,
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: proctorUserId,
      organizationId,
      username: `proctor-${suffix}-${proctorUserId}`,
      passwordHash: "hash",
      name: `Proctor ${suffix}`,
      role: "Proctor",
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
    title: `Recovery Exam ${suffix}`,
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: EXAM_CLOSE_AT,
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
    deadlineAt: ATTEMPT_DEADLINE_AT,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.examProctorAssignments).values({
    id: randomUUID(),
    organizationId,
    examId,
    proctorUserId,
    status: "active",
    assignedBy: actorId,
    assignedAt: now,
    revokedBy: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    organizationId,
    actorId,
    courseId,
    examId,
    candidateUserId,
    candidateId,
    attemptId,
    proctorUserId,
    ctx: context(organizationId, actorId),
  };
}

interface InsertIncidentOptions {
  examId: string;
  attemptId?: string | null;
  candidateId?: string | null;
  type?: string;
  severity?: string;
  status?: string;
  description?: string;
  createdAt: Date;
}

async function insertIncident(
  db: Database,
  fx: Fixture,
  opts: InsertIncidentOptions,
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.examIncidents).values({
    id,
    organizationId: fx.organizationId,
    examId: opts.examId,
    attemptId: opts.attemptId ?? null,
    candidateId: opts.candidateId ?? null,
    type: opts.type ?? "network_interruption",
    severity: opts.severity ?? "info",
    status: opts.status ?? "open",
    occurredAt: null,
    description: opts.description ?? "recovery queue test incident",
    resolutionSummary: null,
    resolvedAt: null,
    resolvedBy: null,
    reportedBy: fx.actorId,
    version: 1,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });
  return id;
}

describe("recovery incident queue repository", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let testDbUrl: string | undefined;
  let testSchemaName: string | undefined;
  let alpha: Fixture;
  let beta: Fixture;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("recovery-queue");
    db = result.db;
    cleanup = result.cleanup;
    testDbUrl = result.databaseUrl;
    testSchemaName = result.schemaName;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
  });

  afterAll(async () => {
    await cleanup();
  });

  it("projects a single anchored incident with exam/attempt/candidate summaries and active proctors", async () => {
    const repo = createRecoveryRepo(db);
    const createdAt = new Date("2026-01-01T12:00:00.000Z");
    const incidentId = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: alpha.attemptId,
      candidateId: alpha.candidateId,
      type: "network_interruption",
      severity: "major",
      status: "open",
      createdAt,
    });

    const { items, nextCursor } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 20,
    });

    expect(nextCursor).toBeNull();
    const item = items.find((i) => i.incident.id === incidentId);
    expect(item).toBeDefined();
    expect(item!.incident.type).toBe("network_interruption");
    expect(item!.incident.severity).toBe("major");
    expect(item!.incident.status).toBe("open");
    expect(item!.incident.version).toBe(1);

    expect(item!.examSummary).toEqual({
      id: alpha.examId,
      title: "Recovery Exam alpha",
      status: "open",
    });

    expect(item!.primaryAttempt).toEqual({
      id: alpha.attemptId,
      candidateId: alpha.candidateId,
      status: "in_progress",
      deadlineAt: ATTEMPT_DEADLINE_AT,
    });

    expect(item!.primaryCandidate).toEqual({
      id: alpha.candidateId,
      displayName: "Candidate alpha",
    });

    // Anchor attempt/candidate only, no explicit memberships → counts are 1.
    expect(item!.linkedAttemptCount).toBe(1);
    expect(item!.linkedCandidateCount).toBe(1);

    expect(item!.activeProctors).toEqual([
      { userId: alpha.proctorUserId, displayName: "Proctor alpha" },
    ]);
  });

  it("orders by (createdAt DESC, id DESC) — newest first, id tiebreak", async () => {
    const repo = createRecoveryRepo(db);
    const t1 = new Date("2026-02-01T00:00:00.000Z");
    const t2 = new Date("2026-02-02T00:00:00.000Z");
    const t3 = new Date("2026-02-03T00:00:00.000Z");
    const i1 = await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t1,
      description: "order-t1",
    });
    const i2 = await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t2,
      description: "order-t2",
    });
    const i3 = await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t3,
      description: "order-t3",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, { limit: 50 });
    const ids = items.map((i) => i.incident.id);
    const p1 = ids.indexOf(i3);
    const p2 = ids.indexOf(i2);
    const p3 = ids.indexOf(i1);
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p2).toBeGreaterThanOrEqual(0);
    expect(p3).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
  });

  it("paginates with no-dup/no-gap across pages using DESC keyset cursor", async () => {
    const repo = createRecoveryRepo(db);
    const base = new Date("2026-03-01T00:00:00.000Z");
    // 5 incidents at distinct timestamps + 2 sharing a timestamp (id tiebreak)
    const stamps = [
      new Date(base.getTime() + 1 * 60_000),
      new Date(base.getTime() + 2 * 60_000),
      new Date(base.getTime() + 3 * 60_000),
      new Date(base.getTime() + 4 * 60_000),
      new Date(base.getTime() + 5 * 60_000),
      new Date(base.getTime() + 6 * 60_000),
      new Date(base.getTime() + 6 * 60_000), // tie — id tiebreak
    ];
    const inserted: string[] = [];
    for (const s of stamps) {
      inserted.push(
        await insertIncident(db, alpha, {
          examId: alpha.examId,
          createdAt: s,
          description: "paginate",
        }),
      );
    }
    // Mark these so we can filter the page down to just them by description.
    const seen: string[] = [];
    let cursor: { createdAtExact: string; id: string } | null = null;
    for (let page = 0; page < 5; page++) {
      const res = await repo.listIncidentQueue(alpha.ctx, {
        limit: 2,
        cursor,
      });
      for (const it of res.items) {
        if (it.incident.description === "paginate") seen.push(it.incident.id);
      }
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    // All 7 must appear, exactly once, no dup, no gap.
    expect(seen.length).toBe(7);
    expect(new Set(seen).size).toBe(7);
    for (const id of inserted) expect(seen).toContain(id);
  });

  it("returns empty page when no incidents match", async () => {
    const repo = createRecoveryRepo(db);
    const { items, nextCursor } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 10,
      examId: "definitely-missing-exam-id",
    });
    expect(items).toEqual([]);
    expect(nextCursor).toBeNull();
  });

  it("filters by examId", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-04-01T00:00:00.000Z");
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      description: "filter-exam-alpha",
    });
    await insertIncident(db, beta, {
      examId: beta.examId,
      createdAt: t,
      description: "filter-exam-beta",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      examId: alpha.examId,
    });
    // Only alpha incidents that we created along the way; none from beta.
    for (const it of items) {
      expect(it.incident.examId).toBe(alpha.examId);
      expect(it.incident.organizationId).toBe(alpha.organizationId);
    }
    expect(
      items.some((i) => i.incident.description === "filter-exam-alpha"),
    ).toBe(true);
    expect(
      items.some((i) => i.incident.description === "filter-exam-beta"),
    ).toBe(false);
  });

  it("filters by status, severity, and incidentType", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-05-01T00:00:00.000Z");
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      status: "investigating",
      severity: "critical",
      type: "system_outage",
      description: "filter-triple",
    });
    const match = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      status: "investigating",
      severity: "critical",
      incidentType: "system_outage",
    });
    expect(
      match.items.some((i) => i.incident.description === "filter-triple"),
    ).toBe(true);
    const nope = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      status: "resolved",
      severity: "critical",
      incidentType: "system_outage",
    });
    expect(
      nope.items.some((i) => i.incident.description === "filter-triple"),
    ).toBe(false);
  });

  it("filters by createdFrom / createdTo (inclusive)", async () => {
    const repo = createRecoveryRepo(db);
    const tBefore = new Date("2026-06-10T00:00:00.000Z");
    const tIn = new Date("2026-06-15T00:00:00.000Z");
    const tAfter = new Date("2026-06-20T00:00:00.000Z");
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: tBefore,
      description: "range-before",
    });
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: tIn,
      description: "range-in",
    });
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: tAfter,
      description: "range-after",
    });
    const from = new Date("2026-06-12T00:00:00.000Z");
    const to = new Date("2026-06-17T00:00:00.000Z");
    const { items } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      createdFrom: from,
      createdTo: to,
    });
    expect(items.some((i) => i.incident.description === "range-in")).toBe(true);
    expect(items.some((i) => i.incident.description === "range-before")).toBe(
      false,
    );
    expect(items.some((i) => i.incident.description === "range-after")).toBe(
      false,
    );
  });

  it("unresolvedOnly excludes resolved/dismissed", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-07-01T00:00:00.000Z");
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      status: "open",
      description: "unres-open",
    });
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      status: "investigating",
      description: "unres-invest",
    });
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      status: "resolved",
      description: "unres-resolved",
    });
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      status: "dismissed",
      description: "unres-dismissed",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      unresolvedOnly: true,
    });
    const descs = items.map((i) => i.incident.description);
    expect(descs).toContain("unres-open");
    expect(descs).toContain("unres-invest");
    expect(descs).not.toContain("unres-resolved");
    expect(descs).not.toContain("unres-dismissed");
  });

  it("filters by candidateId and by attemptId", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-08-01T00:00:00.000Z");
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: alpha.attemptId,
      candidateId: alpha.candidateId,
      createdAt: t,
      description: "filter-anchor",
    });
    const byCand = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      candidateId: alpha.candidateId,
    });
    expect(
      byCand.items.some((i) => i.incident.description === "filter-anchor"),
    ).toBe(true);
    const byAtt = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      attemptId: alpha.attemptId,
    });
    expect(
      byAtt.items.some((i) => i.incident.description === "filter-anchor"),
    ).toBe(true);
  });

  it("attemptId filter also matches incidents linked via exam_incident_attempts membership", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-08-15T00:00:00.000Z");
    // Exam-wide incident (no anchor attempt) linked to alpha.attemptId via a
    // membership row — a search by attempt must still find it.
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "filter-membership-attempt",
    });
    await db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: alpha.organizationId,
      incidentId: id,
      attemptId: alpha.attemptId,
      relationshipType: "affected",
      linkedBy: alpha.actorId,
      operationId: randomUUID(),
      linkedAt: t,
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      attemptId: alpha.attemptId,
    });
    expect(
      items.some((i) => i.incident.id === id),
      "membership-linked incident must match attemptId filter",
    ).toBe(true);
  });

  it("candidateId filter also matches candidates of linked (membership) attempts", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-08-20T00:00:00.000Z");
    // Exam-wide incident (anchor candidateId = null) whose only link to
    // candidate alpha is the membership attempt alpha.attemptId.
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "filter-membership-candidate",
    });
    await db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: alpha.organizationId,
      incidentId: id,
      attemptId: alpha.attemptId,
      relationshipType: "affected",
      linkedBy: alpha.actorId,
      operationId: randomUUID(),
      linkedAt: t,
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      candidateId: alpha.candidateId,
    });
    expect(
      items.some((i) => i.incident.id === id),
      "incident linked to an attempt of this candidate must match candidateId filter",
    ).toBe(true);
  });

  it("fails closed with AuthzUnavailableError when an incident's exam parent is broken", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-05-01T00:00:00.000Z");
    // An incident in alpha whose examId references an exam that exists but
    // belongs to another org — the org-scoped parent lookup cannot resolve it.
    // (The FK on exam_incidents.exam_id is satisfied, so this is a realistic
    // tenant-integrity corruption, not a DB-constraint violation.)
    const id = await insertIncident(db, alpha, {
      examId: beta.examId,
      createdAt: t,
      description: "broken-parent",
    });
    try {
      await expect(
        repo.listIncidentQueue(alpha.ctx, { limit: 50 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
      });
    } finally {
      // Remove the corrupted row so it cannot poison later alpha queries.
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, alpha.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("assignedProctorUserId filters by current active assignment (not historical)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-09-01T00:00:00.000Z");
    // alpha fixture already has an active assignment for proctorUserId on alpha.examId.
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      description: "filter-proctor-active",
    });
    const hit = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      assignedProctorUserId: alpha.proctorUserId,
    });
    expect(
      hit.items.some((i) => i.incident.description === "filter-proctor-active"),
    ).toBe(true);
    // Proctor that has NO active assignment → no rows from this exam.
    const miss = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      assignedProctorUserId: randomUUID(),
    });
    expect(
      miss.items.some(
        (i) => i.incident.description === "filter-proctor-active",
      ),
    ).toBe(false);
  });

  it("nullable primary attempt/candidate when incident is exam-wide", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-10-01T00:00:00.000Z");
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "exam-wide",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, { limit: 50 });
    const item = items.find((i) => i.incident.id === id);
    expect(item).toBeDefined();
    expect(item!.primaryAttempt).toBeNull();
    expect(item!.primaryCandidate).toBeNull();
    // No anchor attempt, no memberships → counts are 0.
    expect(item!.linkedAttemptCount).toBe(0);
    expect(item!.linkedCandidateCount).toBe(0);
  });

  it("counts linked attempts/candidates across multiple membership rows", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-11-01T00:00:00.000Z");
    // Build 2 more attempts on alpha exam, distinct candidates.
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cand2 = randomUUID();
    const cand2User = randomUUID();
    const cand3 = randomUUID();
    const cand3User = randomUUID();
    const att2 = randomUUID();
    const att3 = randomUUID();
    await db.insert(schema.users).values([
      {
        id: cand2User,
        organizationId: alpha.organizationId,
        username: `cand2-${cand2User}`,
        passwordHash: "hash",
        name: "Cand Two",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cand3User,
        organizationId: alpha.organizationId,
        username: `cand3-${cand3User}`,
        passwordHash: "hash",
        name: "Cand Three",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.candidateProfiles).values([
      {
        id: cand2,
        organizationId: alpha.organizationId,
        userId: cand2User,
        fields: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cand3,
        organizationId: alpha.organizationId,
        userId: cand3User,
        fields: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.examEnrollments).values([
      {
        id: randomUUID(),
        organizationId: alpha.organizationId,
        examId: alpha.examId,
        candidateId: cand2,
        status: "started",
        attemptCount: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        organizationId: alpha.organizationId,
        examId: alpha.examId,
        candidateId: cand3,
        status: "started",
        attemptCount: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    // Look up the enrollments we just created so the FK on exam_attempts is satisfied.
    const enrolls = await db
      .select({
        id: schema.examEnrollments.id,
        candidateId: schema.examEnrollments.candidateId,
      })
      .from(schema.examEnrollments)
      .where(eq(schema.examEnrollments.examId, alpha.examId));
    const enr2 = enrolls.find((e) => e.candidateId === cand2)!;
    const enr3 = enrolls.find((e) => e.candidateId === cand3)!;
    await db.insert(schema.examAttempts).values([
      {
        id: att2,
        organizationId: alpha.organizationId,
        examId: alpha.examId,
        enrollmentId: enr2.id,
        candidateId: cand2,
        attemptNo: 2,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        startedAt: now,
        deadlineAt: ATTEMPT_DEADLINE_AT,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: att3,
        organizationId: alpha.organizationId,
        examId: alpha.examId,
        enrollmentId: enr3.id,
        candidateId: cand3,
        attemptNo: 3,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        startedAt: now,
        deadlineAt: ATTEMPT_DEADLINE_AT,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    // Exam-wide incident (no anchor attempt); link att2 + att3 as affected.
    const incidentId = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "multi-linked",
    });
    for (const attId of [att2, att3]) {
      await db.insert(schema.examIncidentAttempts).values({
        id: randomUUID(),
        organizationId: alpha.organizationId,
        incidentId,
        attemptId: attId,
        relationshipType: "affected",
        linkedBy: alpha.actorId,
        operationId: randomUUID(),
        linkedAt: t,
      });
    }
    const { items } = await repo.listIncidentQueue(alpha.ctx, { limit: 50 });
    const item = items.find((i) => i.incident.id === incidentId);
    expect(item).toBeDefined();
    expect(item!.linkedAttemptCount).toBe(2);
    expect(item!.linkedCandidateCount).toBe(2);
  });

  it("lists multiple active proctors for one exam incident", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const proctor2 = randomUUID();
    await db.insert(schema.users).values({
      id: proctor2,
      organizationId: alpha.organizationId,
      username: `p2-${proctor2}`,
      passwordHash: "hash",
      name: "Proctor Two alpha",
      role: "Proctor",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examProctorAssignments).values({
      id: randomUUID(),
      organizationId: alpha.organizationId,
      examId: alpha.examId,
      proctorUserId: proctor2,
      status: "active",
      assignedBy: alpha.actorId,
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const t = new Date("2026-12-01T00:00:00.000Z");
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      description: "multi-proctor",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, { limit: 50 });
    const item = items.find((i) => i.incident.id === id);
    expect(item).toBeDefined();
    const ids = item!.activeProctors.map((p) => p.userId).sort();
    expect(ids).toEqual([alpha.proctorUserId, proctor2].sort());
  });

  it("revoking an assignment removes it from activeProctors (current-active only)", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // Use a fresh exam so this test does not collide with the multi-proctor
    // test's residual active assignment on alpha.examId.
    const revokeExamId = randomUUID();
    const rp1 = randomUUID();
    const rp2 = randomUUID();
    await db.insert(schema.users).values([
      {
        id: rp1,
        organizationId: alpha.organizationId,
        username: `rp1-${rp1}`,
        passwordHash: "hash",
        name: "Revoke Proctor 1",
        role: "Proctor",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: rp2,
        organizationId: alpha.organizationId,
        username: `rp2-${rp2}`,
        passwordHash: "hash",
        name: "Revoke Proctor 2",
        role: "Proctor",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.exams).values({
      id: revokeExamId,
      organizationId: alpha.organizationId,
      title: "Revoke Test Exam",
      description: "",
      courseId: alpha.courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: EXAM_CLOSE_AT,
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
    await db.insert(schema.examProctorAssignments).values([
      {
        id: randomUUID(),
        organizationId: alpha.organizationId,
        examId: revokeExamId,
        proctorUserId: rp1,
        status: "active",
        assignedBy: alpha.actorId,
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        organizationId: alpha.organizationId,
        examId: revokeExamId,
        proctorUserId: rp2,
        status: "active",
        assignedBy: alpha.actorId,
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    // Revoke rp1; rp2 stays active.
    await db
      .update(schema.examProctorAssignments)
      .set({
        status: "revoked",
        revokedBy: alpha.actorId,
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            schema.examProctorAssignments.organizationId,
            alpha.organizationId,
          ),
          eq(schema.examProctorAssignments.examId, revokeExamId),
          eq(schema.examProctorAssignments.proctorUserId, rp1),
        ),
      );
    const t = new Date("2026-12-15T00:00:00.000Z");
    const id = await insertIncident(db, alpha, {
      examId: revokeExamId,
      createdAt: t,
      description: "after-revoke",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, { limit: 50 });
    const item = items.find((i) => i.incident.id === id);
    expect(item).toBeDefined();
    // Only the still-active rp2 remains; the revoked rp1 is gone.
    expect(item!.activeProctors.map((p) => p.userId).sort()).toEqual(
      [rp2].sort(),
    );
  });

  it("enforces tenant isolation — cross-org incident never appears", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2026-11-15T00:00:00.000Z");
    const id = await insertIncident(db, beta, {
      examId: beta.examId,
      createdAt: t,
      description: "beta-only-isolation",
    });
    const { items } = await repo.listIncidentQueue(alpha.ctx, { limit: 50 });
    expect(items.every((i) => i.incident.id !== id)).toBe(true);
    expect(
      items.every((i) => i.incident.organizationId === alpha.organizationId),
    ).toBe(true);
    // Beta ctx sees its own row, proving it exists.
    const betaRes = await repo.listIncidentQueue(beta.ctx, { limit: 50 });
    expect(betaRes.items.some((i) => i.incident.id === id)).toBe(true);
  });

  it("respects limit bounds (returns at most `limit` items, signals nextCursor)", async () => {
    const repo = createRecoveryRepo(db);
    const base = new Date("2027-01-01T00:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await insertIncident(db, alpha, {
        examId: alpha.examId,
        createdAt: new Date(base.getTime() + i * 60_000),
        description: "limit-bounds",
      });
    }
    const { items, nextCursor } = await repo.listIncidentQueue(alpha.ctx, {
      limit: 2,
    });
    const page = items.filter((i) => i.incident.description === "limit-bounds");
    expect(page.length).toBe(2);
    expect(nextCursor).not.toBeNull();
  });

  it("keyset cursor preserves microsecond precision — no gap within one millisecond", async () => {
    const repo = createRecoveryRepo(db);
    // Raw SQL inserts at same-millisecond, different-microsecond timestamps.
    // JS Date cannot express these values, which is exactly why the cursor
    // must carry the DB-exact timestamp text instead of a Date round-trip
    // (a truncated cursor would skip the .123400/.123456 rows).
    const stamps = [
      "2027-04-01T00:00:00.123400Z",
      "2027-04-01T00:00:00.123456Z",
      "2027-04-01T00:00:00.123700Z",
    ];
    for (const s of stamps) {
      await db.execute(sql`
        INSERT INTO exam_incidents (id, organization_id, exam_id, attempt_id, candidate_id, type, severity, status, occurred_at, description, resolution_summary, resolved_at, resolved_by, reported_by, version, created_at, updated_at)
        VALUES (${randomUUID()}, ${alpha.organizationId}, ${alpha.examId}, NULL, NULL, 'network_interruption', 'info', 'open', NULL, 'us-pagination', NULL, NULL, NULL, ${alpha.actorId}, 1, ${s}::timestamptz, ${s}::timestamptz)
      `);
    }
    const seen: string[] = [];
    let cursor: { createdAtExact: string; id: string } | null = null;
    let firstCursorExact: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await repo.listIncidentQueue(alpha.ctx, {
        limit: 1,
        cursor,
      });
      for (const it of res.items) {
        if (it.incident.description === "us-pagination") {
          seen.push(it.incident.id);
        }
      }
      if (page === 0) firstCursorExact = res.nextCursor?.createdAtExact ?? null;
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    // All 3 sub-millisecond rows must be visited, exactly once each.
    expect(seen.length, "all 3 sub-millisecond rows must be visited").toBe(3);
    expect(new Set(seen).size).toBe(3);
    // The emitted cursor is microsecond-exact (6 fractional digits), never a
    // truncated JS Date (which would emit ...123Z for all three rows).
    expect(firstCursorExact).toBe("2027-04-01T00:00:00.123700Z");
  });

  it("filter and activeProctors projection share one snapshot (read-only REPEATABLE READ)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-03-01T00:00:00.000Z");
    await insertIncident(db, alpha, {
      examId: alpha.examId,
      createdAt: t,
      description: "snapshot-proctor",
    });

    // One read-only REPEATABLE READ transaction: between two queue reads the
    // assignment is revoked on a SECOND connection. Both reads must still see
    // the pre-revocation snapshot — the page can never contradict its own
    // assignedProctorUserId filter.
    const result = await db.transaction(
      async (tx) => {
        const first = await createRecoveryRepo(tx).listIncidentQueue(
          alpha.ctx,
          { limit: 50, assignedProctorUserId: alpha.proctorUserId },
        );
        const conn2 = await createDatabase(testDbUrl, testSchemaName);
        try {
          await conn2.db
            .update(schema.examProctorAssignments)
            .set({
              status: "revoked",
              revokedBy: alpha.actorId,
              revokedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  schema.examProctorAssignments.organizationId,
                  alpha.organizationId,
                ),
                eq(
                  schema.examProctorAssignments.proctorUserId,
                  alpha.proctorUserId,
                ),
              ),
            );
        } finally {
          await conn2.sql.end();
        }
        const second = await createRecoveryRepo(tx).listIncidentQueue(
          alpha.ctx,
          { limit: 50, assignedProctorUserId: alpha.proctorUserId },
        );
        return { first, second };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );

    const f = result.first.items.find(
      (i) => i.incident.description === "snapshot-proctor",
    );
    const s = result.second.items.find(
      (i) => i.incident.description === "snapshot-proctor",
    );
    expect(f).toBeDefined();
    expect(s).toBeDefined();
    expect(
      f!.activeProctors.some((p) => p.userId === alpha.proctorUserId),
      "first read sees the active proctor",
    ).toBe(true);
    expect(
      s!.activeProctors.some((p) => p.userId === alpha.proctorUserId),
      "second read (same snapshot) still sees the active proctor",
    ).toBe(true);

    // A fresh call on a new snapshot no longer matches the revoked proctor.
    const fresh = await repo.listIncidentQueue(alpha.ctx, {
      limit: 50,
      assignedProctorUserId: alpha.proctorUserId,
    });
    expect(
      fresh.items.some((i) => i.incident.description === "snapshot-proctor"),
    ).toBe(false);

    // Restore the assignment so later tests are unaffected.
    await db
      .update(schema.examProctorAssignments)
      .set({
        status: "active",
        revokedBy: null,
        revokedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(
            schema.examProctorAssignments.organizationId,
            alpha.organizationId,
          ),
          eq(schema.examProctorAssignments.proctorUserId, alpha.proctorUserId),
        ),
      );
  });

  it("fails closed when an anchored incident's attempt belongs to a different exam", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // Second exam + enrollment + attempt in alpha org.
    const exam2 = randomUUID();
    await db.insert(schema.exams).values({
      id: exam2,
      organizationId: alpha.organizationId,
      title: "Alpha Exam Two",
      description: "",
      courseId: alpha.courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: EXAM_CLOSE_AT,
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
    const enr2 = randomUUID();
    await db.insert(schema.examEnrollments).values({
      id: enr2,
      organizationId: alpha.organizationId,
      examId: exam2,
      candidateId: alpha.candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const att2 = randomUUID();
    await db.insert(schema.examAttempts).values({
      id: att2,
      organizationId: alpha.organizationId,
      examId: exam2,
      enrollmentId: enr2,
      candidateId: alpha.candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: ATTEMPT_DEADLINE_AT,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    // Incident anchored to alpha.examId but pointing at an attempt of exam2 —
    // the composite FK (org, attempt_id) is satisfied, so this corruption is
    // reachable at the DB level and must fail closed on read.
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: att2,
      candidateId: alpha.candidateId,
      createdAt: new Date("2027-07-01T00:00:00.000Z"),
      description: "anchor-exam-mismatch",
    });
    try {
      await expect(
        repo.listIncidentQueue(alpha.ctx, { limit: 50 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
      });
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, alpha.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when an anchored incident's candidate contradicts its attempt", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // Second candidate profile in alpha org (single-column FK satisfied).
    const candXUser = randomUUID();
    const candX = randomUUID();
    await db.insert(schema.users).values({
      id: candXUser,
      organizationId: alpha.organizationId,
      username: `candx-${candXUser}`,
      passwordHash: "hash",
      name: "Candidate X",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candX,
      organizationId: alpha.organizationId,
      userId: candXUser,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    // Anchor attempt alpha.attemptId belongs to candidate alpha, but the
    // incident row claims candidate candX — corruption per the frozen matrix
    // (supplied candidate MUST equal attempt.candidateId).
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: alpha.attemptId,
      candidateId: candX,
      createdAt: new Date("2027-08-01T00:00:00.000Z"),
      description: "anchor-candidate-mismatch",
    });
    try {
      await expect(
        repo.listIncidentQueue(alpha.ctx, { limit: 50 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
      });
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, alpha.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when a non-null candidateId cannot be resolved in-org", async () => {
    const repo = createRecoveryRepo(db);
    // beta.candidateId exists (single-column FK satisfied) but belongs to
    // another org — the org-scoped candidate lookup cannot resolve it.
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: beta.candidateId,
      createdAt: new Date("2027-09-01T00:00:00.000Z"),
      description: "candidate-broken",
    });
    try {
      await expect(
        repo.listIncidentQueue(alpha.ctx, { limit: 50 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
      });
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, alpha.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when a membership attempt cannot be resolved (FK bypass)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-10-01T00:00:00.000Z");
    const id = await insertIncident(db, alpha, {
      examId: alpha.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "membership-broken",
    });
    // The composite (org, attempt_id) FK normally makes an unresolvable
    // membership impossible; bypass it to simulate tenant-data corruption and
    // prove the read path still fails closed.
    await db.execute(
      sql`ALTER TABLE exam_incident_attempts DROP CONSTRAINT exam_incident_attempts_attempt_fk`,
    );
    try {
      await db.insert(schema.examIncidentAttempts).values({
        id: randomUUID(),
        organizationId: alpha.organizationId,
        incidentId: id,
        attemptId: randomUUID(),
        relationshipType: "affected",
        linkedBy: alpha.actorId,
        operationId: randomUUID(),
        linkedAt: t,
      });
      await expect(
        repo.listIncidentQueue(alpha.ctx, { limit: 50 }),
      ).rejects.toMatchObject({
        name: "AuthzUnavailableError",
        code: "AUTHZ_UNAVAILABLE",
        statusCode: 503,
      });
    } finally {
      await db
        .delete(schema.examIncidentAttempts)
        .where(eq(schema.examIncidentAttempts.incidentId, id));
      await db.execute(
        sql`ALTER TABLE exam_incident_attempts ADD CONSTRAINT exam_incident_attempts_attempt_fk FOREIGN KEY ("organization_id","attempt_id") REFERENCES "exam_attempts"("organization_id","id")`,
      );
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, alpha.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });
});

// ── J5-I1A2 — Recovery Incident Aggregate Detail (contract §6.3) ──

describe("recovery incident aggregate detail repository", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let fx: Fixture;
  let incidentId: string;
  let attemptId2: string;
  let candidateId2: string;
  let candidateUserId2: string;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("recovery-aggregate");
    db = result.db;
    cleanup = result.cleanup;
    fx = await createFixture(db, "agg");

    const now = new Date("2026-01-01T00:00:00.000Z");
    // Build a second candidate + attempt on the same exam so we can exercise
    // multi-Attempt membership and candidate summaries.
    candidateId2 = randomUUID();
    candidateUserId2 = randomUUID();
    attemptId2 = randomUUID();
    await db.insert(schema.users).values({
      id: candidateUserId2,
      organizationId: fx.organizationId,
      username: `cand2-${candidateUserId2}`,
      passwordHash: "hash",
      name: "Agg Candidate Two",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candidateId2,
      organizationId: fx.organizationId,
      userId: candidateUserId2,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    const enrollmentId2 = randomUUID();
    await db.insert(schema.examEnrollments).values({
      id: enrollmentId2,
      organizationId: fx.organizationId,
      examId: fx.examId,
      candidateId: candidateId2,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.examAttempts).values({
      id: attemptId2,
      organizationId: fx.organizationId,
      examId: fx.examId,
      enrollmentId: enrollmentId2,
      candidateId: candidateId2,
      attemptNo: 2,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: ATTEMPT_DEADLINE_AT,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Create an exam-wide incident (no anchor attempt) and link both attempts
    // as members, plus one action link and one interruption link.
    incidentId = randomUUID();
    const incidentAt = new Date("2026-01-01T12:00:00.000Z");
    await db.insert(schema.examIncidents).values({
      id: incidentId,
      organizationId: fx.organizationId,
      examId: fx.examId,
      attemptId: null,
      candidateId: null,
      type: "system_outage",
      severity: "critical",
      status: "investigating",
      occurredAt: null,
      description: "aggregate detail test incident",
      resolutionSummary: null,
      resolvedAt: null,
      resolvedBy: null,
      reportedBy: fx.actorId,
      version: 2,
      createdAt: incidentAt,
      updatedAt: incidentAt,
    });
    // Event 1: incident_created
    await db.insert(schema.examIncidentEvents).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: randomUUID(),
      actorId: fx.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: incidentAt,
    });
    // Event 2: note_added (a note)
    const noteAt = new Date("2026-01-01T12:30:00.000Z");
    await db.insert(schema.examIncidentEvents).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId,
      eventType: "note_added",
      commandType: "addIncidentNote",
      operationId: randomUUID(),
      actorId: fx.actorId,
      beforeVersion: 1,
      afterVersion: 1,
      payload: { body: "first note" },
      createdAt: noteAt,
    });
    // Attempt memberships for both attempts
    for (const attId of [fx.attemptId, attemptId2]) {
      await db.insert(schema.examIncidentAttempts).values({
        id: randomUUID(),
        organizationId: fx.organizationId,
        incidentId,
        attemptId: attId,
        relationshipType: "affected",
        linkedBy: fx.actorId,
        operationId: randomUUID(),
        linkedAt: incidentAt,
      });
    }
  });

  afterAll(async () => {
    await cleanup();
  });

  it("projects the full aggregate from one consistent snapshot", async () => {
    const repo = createRecoveryRepo(db);
    const agg = await repo.getIncidentAggregate(fx.ctx, incidentId);

    expect(agg).not.toBeNull();
    expect(agg!.incident.id).toBe(incidentId);
    expect(agg!.incident.version).toBe(2);
    expect(agg!.incident.status).toBe("investigating");

    // Exam summary — carries the canonical closeAt (effective-deadline input)
    expect(agg!.examSummary).toEqual({
      id: fx.examId,
      title: "Recovery Exam agg",
      status: "open",
      closeAt: EXAM_CLOSE_AT,
    });

    // Events ordered by event_sequence ASC
    expect(agg!.events.length).toBeGreaterThanOrEqual(2);
    expect(agg!.events[0]!.eventType).toBe("incident_created");
    expect(agg!.events[1]!.eventType).toBe("note_added");
    expect(agg!.events[0]!.eventSequence < agg!.events[1]!.eventSequence).toBe(
      true,
    );

    // Notes derived from note_added events
    expect(agg!.notes.length).toBe(1);
    expect(agg!.notes[0]!.body).toBe("first note");

    // Attempt memberships (both attempts)
    expect(agg!.attemptMemberships.length).toBe(2);
    const memberAttemptIds = agg!.attemptMemberships
      .map((m) => m.attemptId)
      .sort();
    expect(memberAttemptIds).toEqual([fx.attemptId, attemptId2].sort());

    // Candidate summaries — both candidates appear
    const candIds = agg!.candidateSummaries.map((c) => c.id).sort();
    expect(candIds).toEqual([fx.candidateId, candidateId2].sort());

    // Attempt summaries — both attempts appear with their core fields +
    // the raw deadlineAt (the route maps it to the effective deadline).
    const attIds = agg!.attemptSummaries.map((a) => a.id).sort();
    expect(attIds).toEqual([fx.attemptId, attemptId2].sort());
    for (const a of agg!.attemptSummaries) {
      expect(a.deadlineAt).toEqual(ATTEMPT_DEADLINE_AT);
      expect(a.examId).toBe(fx.examId);
    }

    // Snapshot carried — it is a real DB transaction_timestamp() Date
    expect(agg!.snapshotAt).toBeInstanceOf(Date);
    expect(agg!.incident.version).toBe(2);
  });

  it("returns null for a missing incident (fail-closed, no 500)", async () => {
    const repo = createRecoveryRepo(db);
    const agg = await repo.getIncidentAggregate(
      fx.ctx,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(agg).toBeNull();
  });

  it("enforces tenant isolation — cross-org incident returns null", async () => {
    const repo = createRecoveryRepo(db);
    // fx.ctx is org alpha; build a second org ctx.
    const otherOrgCtx = context(randomUUID(), fx.actorId);
    const agg = await repo.getIncidentAggregate(otherOrgCtx, incidentId);
    expect(agg).toBeNull();
  });

  // ── P1-1: statusActionCandidates matches ADR-014 §3 exactly per status ──
  // The repo derives the STATUS candidates only; the route intersects them
  // with the caller's capabilities + incident shape to produce the wire
  // `allowedActions` (J5-R0 §6.2 / §6.3).

  it("statusActionCandidates[open] = investigate + non-terminal + append-only (exact)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-01-01T00:00:00.000Z");
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      status: "open",
      createdAt: t,
      description: "status-open",
    });
    const agg = await repo.getIncidentAggregate(fx.ctx, id);
    expect(agg).not.toBeNull();
    expect(agg!.statusActionCandidates).toEqual([
      "investigate",
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_attempt",
      "link_interruption",
    ]);
  });

  it("statusActionCandidates[investigating] excludes investigate (no self-transition)", async () => {
    const repo = createRecoveryRepo(db);
    // The shared fixture incident is in 'investigating' — assert on it directly.
    const agg = await repo.getIncidentAggregate(fx.ctx, incidentId);
    expect(agg).not.toBeNull();
    // investigating MUST NOT include investigate (open→investigating only).
    expect(agg!.statusActionCandidates).toEqual([
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_attempt",
      "link_interruption",
    ]);
    expect(agg!.statusActionCandidates).not.toContain("investigate");
  });

  it("statusActionCandidates[resolved] = append-only side writes (note + 3 links)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-02-01T00:00:00.000Z");
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      status: "resolved",
      createdAt: t,
      description: "status-resolved",
    });
    const agg = await repo.getIncidentAggregate(fx.ctx, id);
    expect(agg).not.toBeNull();
    expect(agg!.statusActionCandidates).toEqual([
      "add_note",
      "link_action",
      "link_attempt",
      "link_interruption",
    ]);
  });

  it("statusActionCandidates[dismissed] = append-only side writes (note + 3 links)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-03-01T00:00:00.000Z");
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      status: "dismissed",
      createdAt: t,
      description: "status-dismissed",
    });
    const agg = await repo.getIncidentAggregate(fx.ctx, id);
    expect(agg).not.toBeNull();
    expect(agg!.statusActionCandidates).toEqual([
      "add_note",
      "link_action",
      "link_attempt",
      "link_interruption",
    ]);
  });

  // ── P1-3: candidate-focused exam-wide incident (attemptId=null, candidateId=set) ──

  it("candidate-focused exam-wide incident projects its focus candidate even with zero memberships", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-04-01T00:00:00.000Z");
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: fx.candidateId,
      createdAt: t,
      description: "candidate-focused",
    });
    const agg = await repo.getIncidentAggregate(fx.ctx, id);
    expect(agg).not.toBeNull();
    // The focus candidate MUST appear — without the incident.candidateId seed
    // the aggregate would return an empty candidate list and contradict itself.
    expect(agg!.candidateSummaries.map((c) => c.id)).toEqual([fx.candidateId]);
    expect(agg!.candidateSummaries[0]!.displayName).toBe("Candidate agg");
  });

  // ── P2-1: parent corruption fails closed with AUTHZ_UNAVAILABLE ──

  it("fails closed with AUTHZ_UNAVAILABLE when the exam parent cannot be resolved in-org", async () => {
    const repo = createRecoveryRepo(db);
    // Build a foreign-org exam, then a fx-org incident that points at it. The
    // composite FK (organization_id, exam_id) is satisfied by the cross-org
    // exam row existing, but the org-scoped exam lookup cannot resolve it.
    const now = new Date("2026-01-01T00:00:00.000Z");
    const foreignOrgId = randomUUID();
    const foreignCourseId = randomUUID();
    const foreignExamId = randomUUID();
    await db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign Parent Org",
      displayName: "Foreign Parent Org",
      slug: `fpo-${foreignOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.courses).values({
      id: foreignCourseId,
      organizationId: foreignOrgId,
      name: "Foreign Course",
      code: `FC-${foreignCourseId}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.exams).values({
      id: foreignExamId,
      organizationId: foreignOrgId,
      title: "Foreign Exam",
      description: "",
      courseId: foreignCourseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: EXAM_CLOSE_AT,
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
    const id = await insertIncident(db, fx, {
      examId: foreignExamId,
      createdAt: new Date("2027-05-01T00:00:00.000Z"),
      description: "broken-parent-agg",
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
        },
      );
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  // ── P1-4: full relationship-graph scope validation (fail-closed 503) ──

  it("fails closed when a membership attempt belongs to a different exam", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // A second exam + attempt in fx org (so the membership FK is satisfied).
    const exam2 = randomUUID();
    await db.insert(schema.exams).values({
      id: exam2,
      organizationId: fx.organizationId,
      title: "Agg Exam Two",
      description: "",
      courseId: fx.courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: EXAM_CLOSE_AT,
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
    const enr2 = randomUUID();
    await db.insert(schema.examEnrollments).values({
      id: enr2,
      organizationId: fx.organizationId,
      examId: exam2,
      candidateId: fx.candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const att2 = randomUUID();
    await db.insert(schema.examAttempts).values({
      id: att2,
      organizationId: fx.organizationId,
      examId: exam2,
      enrollmentId: enr2,
      candidateId: fx.candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: ATTEMPT_DEADLINE_AT,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    // Exam-wide incident on fx.examId but with a membership pointing at att2
    // (which belongs to exam2) — the composite FK is satisfied, so this
    // corruption is reachable; the read MUST fail closed.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: null,
      createdAt: new Date("2027-06-01T00:00:00.000Z"),
      description: "agg-membership-exam-mismatch",
    });
    await db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      attemptId: att2,
      relationshipType: "affected",
      linkedBy: fx.actorId,
      operationId: randomUUID(),
      linkedAt: now,
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentAttempts)
        .where(eq(schema.examIncidentAttempts.incidentId, id));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when a linked membership attempt cannot be resolved (FK bypass)", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2027-07-01T00:00:00.000Z");
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "agg-membership-broken",
    });
    // Bypass the composite FK to simulate tenant-data corruption.
    await db.execute(
      sql`ALTER TABLE exam_incident_attempts DROP CONSTRAINT exam_incident_attempts_attempt_fk`,
    );
    try {
      await db.insert(schema.examIncidentAttempts).values({
        id: randomUUID(),
        organizationId: fx.organizationId,
        incidentId: id,
        attemptId: randomUUID(),
        relationshipType: "affected",
        linkedBy: fx.actorId,
        operationId: randomUUID(),
        linkedAt: t,
      });
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentAttempts)
        .where(eq(schema.examIncidentAttempts.incidentId, id));
      await db.execute(
        sql`ALTER TABLE exam_incident_attempts ADD CONSTRAINT exam_incident_attempts_attempt_fk FOREIGN KEY ("organization_id","attempt_id") REFERENCES "exam_attempts"("organization_id","id")`,
      );
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when an anchored incident's candidate contradicts its attempt", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // A second candidate profile in fx org (single-column FK satisfied).
    const candXUser = randomUUID();
    const candX = randomUUID();
    await db.insert(schema.users).values({
      id: candXUser,
      organizationId: fx.organizationId,
      username: `aggcandx-${candXUser}`,
      passwordHash: "hash",
      name: "Agg Candidate X",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candX,
      organizationId: fx.organizationId,
      userId: candXUser,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    // Anchor attempt fx.attemptId belongs to candidate fx.candidateId, but the
    // incident claims candidate candX — corruption per ADR-014 §7 matrix.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: fx.attemptId,
      candidateId: candX,
      createdAt: new Date("2027-08-01T00:00:00.000Z"),
      description: "agg-anchor-candidate-mismatch",
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
        },
      );
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when a candidate-focused incident's membership belongs to a different candidate", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // candidateId2 (from the shared fixture) is a different candidate than
    // fx.candidateId. A candidate-focused incident on fx.candidateId with a
    // membership pointing at attemptId2 (candidateId2's attempt) is corruption
    // per ADR-014 §7 candidate matrix.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: fx.candidateId,
      createdAt: new Date("2027-09-01T00:00:00.000Z"),
      description: "agg-membership-candidate-mismatch",
    });
    await db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      attemptId: attemptId2,
      relationshipType: "affected",
      linkedBy: fx.actorId,
      operationId: randomUUID(),
      linkedAt: now,
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentAttempts)
        .where(eq(schema.examIncidentAttempts.incidentId, id));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when the incident's candidate focus cannot be resolved in-org", async () => {
    const repo = createRecoveryRepo(db);
    // A candidate profile in a FOREIGN org satisfies the single-column FK,
    // but the org-scoped candidate lookup cannot resolve it in fx.org — the
    // read MUST fail closed (same pattern as the queue suite's in-org test).
    const now = new Date("2026-01-01T00:00:00.000Z");
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignCandidateId = randomUUID();
    await db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign Candidate Org",
      displayName: "Foreign Candidate Org",
      slug: `fco-${foreignOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.users).values({
      id: foreignUserId,
      organizationId: foreignOrgId,
      username: `foreigncand-${foreignUserId}`,
      passwordHash: "hash",
      name: "Foreign Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: foreignCandidateId,
      organizationId: foreignOrgId,
      userId: foreignUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: foreignCandidateId,
      createdAt: new Date("2027-10-01T00:00:00.000Z"),
      description: "agg-candidate-broken",
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
        },
      );
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, foreignCandidateId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  // ── P2-1: candidate profile resolved but its same-org User missing → 503 ──

  it("fails closed when a candidate's User belongs to a foreign org (never an empty displayName)", async () => {
    const repo = createRecoveryRepo(db);
    // Build a candidate profile in fx.org whose userId points at a User in a
    // FOREIGN org. The same-org User join cannot resolve it — that is
    // tenant-graph corruption (candidate_profiles.user_id is NOT NULL, so a
    // missing join row can never mean "user unset"). The projection MUST
    // fail closed with 503 instead of disguising the broken graph as an
    // empty displayName.
    const now = new Date("2026-01-01T00:00:00.000Z");
    const foreignOrgId = randomUUID();
    const foreignUserId = randomUUID();
    const candId = randomUUID();
    await db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign User Org",
      displayName: "Foreign User Org",
      slug: `fuo-${foreignOrgId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.users).values({
      id: foreignUserId,
      organizationId: foreignOrgId,
      username: `foreignuser-${foreignUserId}`,
      passwordHash: "hash",
      name: "Foreign User Name",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.candidateProfiles).values({
      id: candId,
      organizationId: fx.organizationId,
      userId: foreignUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: candId,
      createdAt: new Date("2027-11-01T00:00:00.000Z"),
      description: "agg-cross-org-candidate-user",
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
          message: expect.stringContaining(
            "RECOVERY_AGG_CANDIDATE_USER_BROKEN",
          ),
        },
      );
    } finally {
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
      await db
        .delete(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.id, candId));
      await db.delete(schema.users).where(eq(schema.users.id, foreignUserId));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, foreignOrgId));
    }
  });

  // ── Full-field projection: action link, interruption link, time adjustment, audit ──

  it("projects action links, interruption links, time adjustments, and audit references without any membership", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const t = new Date("2027-12-01T00:00:00.000Z");
    // Exam-wide incident (no anchor, no candidate focus) with action and
    // interruption links pointing at fx.attemptId — but NO membership row.
    // ADR-014 §7 treats anchor, membership, operator action links, and
    // interruption evidence links as INDEPENDENT durable relationships: the
    // links MUST NOT require membership (the canonical time-grant path
    // creates adjustment + action link atomically, with no membership), and
    // the aggregate MUST project successfully.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: null,
      status: "investigating",
      createdAt: t,
      description: "agg-full-projection",
    });

    // Action link (time_grant) pointing at fx.attemptId.
    const adjustmentId = randomUUID();
    await db.insert(schema.attemptTimeAdjustments).values({
      id: adjustmentId,
      operationId: randomUUID(),
      organizationId: fx.organizationId,
      attemptId: fx.attemptId,
      interruptionId: null,
      incidentId: null,
      policy: "operator_incident",
      source: "operator",
      beforeDeadline: ATTEMPT_DEADLINE_AT,
      afterDeadline: new Date("2026-01-01T02:00:00.000Z"),
      addedSeconds: 3600,
      reasonCode: "network",
      reasonText: "compensation",
      actorId: fx.actorId,
      createdAt: t,
    });
    await db.insert(schema.examIncidentActions).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      actionType: "time_grant",
      actionId: adjustmentId,
      attemptId: fx.attemptId,
      actorId: fx.actorId,
      linkedAt: t,
      operationId: randomUUID(),
    });

    // Interruption episode + link pointing at fx.attemptId.
    const interruptionId = randomUUID();
    await db.insert(schema.attemptInterruptions).values({
      id: interruptionId,
      organizationId: fx.organizationId,
      attemptId: fx.attemptId,
      createdAt: t,
    });
    await db.insert(schema.examIncidentInterruptionLinks).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      attemptId: fx.attemptId,
      interruptionId,
      linkedBy: fx.actorId,
      linkedAt: t,
      operationId: randomUUID(),
    });

    // Audit reference targeting this incident.
    const auditId = randomUUID();
    await db.insert(schema.auditLogs).values({
      id: auditId,
      organizationId: fx.organizationId,
      actorId: fx.actorId,
      action: "incident.investigated",
      targetType: "incident",
      targetId: id,
      metadata: { incidentId: id },
      ipAddress: null,
      userAgent: null,
      createdAt: t,
    });

    try {
      const agg = await repo.getIncidentAggregate(fx.ctx, id);
      expect(agg).not.toBeNull();

      // Wire decision (J5-R0 §6.3): attemptSummaries = anchor ∪ membership
      // ONLY. The link-referenced attempt is validated but NOT summarized —
      // zero memberships means zero summaries, and the link rows still carry
      // the attempt ids.
      expect(agg!.attemptSummaries).toEqual([]);
      // No candidate seed either (no candidate focus, no summary attempts).
      expect(agg!.candidateSummaries).toEqual([]);

      // Action link projected with all fields.
      expect(agg!.actions.length).toBe(1);
      expect(agg!.actions[0]!.actionType).toBe("time_grant");
      expect(agg!.actions[0]!.actionId).toBe(adjustmentId);
      expect(agg!.actions[0]!.attemptId).toBe(fx.attemptId);
      expect(agg!.actions[0]!.actorId).toBe(fx.actorId);
      expect(agg!.actions[0]!.linkedAt).toEqual(t);

      // Interruption link projected with all fields.
      expect(agg!.interruptionLinks.length).toBe(1);
      expect(agg!.interruptionLinks[0]!.interruptionId).toBe(interruptionId);
      expect(agg!.interruptionLinks[0]!.attemptId).toBe(fx.attemptId);
      expect(agg!.interruptionLinks[0]!.linkedBy).toBe(fx.actorId);

      // Time adjustment projected with all fields — fetched by the
      // REFERENCED attempt set (not the summary set), so the canonical
      // atomic time-grant path (adjustment + action link, no membership)
      // still projects its ledger row.
      expect(agg!.timeAdjustmentSummaries.length).toBe(1);
      expect(agg!.timeAdjustmentSummaries[0]!.id).toBe(adjustmentId);
      expect(agg!.timeAdjustmentSummaries[0]!.attemptId).toBe(fx.attemptId);
      expect(agg!.timeAdjustmentSummaries[0]!.addedSeconds).toBe(3600);
      expect(agg!.timeAdjustmentSummaries[0]!.reasonCode).toBe("network");

      // Audit reference projected with actor name (same-org User).
      expect(agg!.auditReferences.length).toBe(1);
      expect(agg!.auditReferences[0]!.id).toBe(auditId);
      expect(agg!.auditReferences[0]!.action).toBe("incident.investigated");
      expect(agg!.auditReferences[0]!.actorId).toBe(fx.actorId);
      expect(agg!.auditReferences[0]!.actorName).toBe("Actor");
    } finally {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.id, auditId));
      await db
        .delete(schema.examIncidentInterruptionLinks)
        .where(eq(schema.examIncidentInterruptionLinks.incidentId, id));
      await db
        .delete(schema.attemptInterruptions)
        .where(eq(schema.attemptInterruptions.id, interruptionId));
      await db
        .delete(schema.examIncidentActions)
        .where(eq(schema.examIncidentActions.incidentId, id));
      await db
        .delete(schema.attemptTimeAdjustments)
        .where(eq(schema.attemptTimeAdjustments.id, adjustmentId));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  // ── P1-3 (round 3): link-referenced attempts are validated, membership NOT required ──

  it("fails closed when an action link's attempt belongs to a different exam", async () => {
    const repo = createRecoveryRepo(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    // attemptId2 is a same-org attempt on fx.examId belonging to candidateId2.
    // Point an action link at an attempt of a DIFFERENT exam to break the
    // scope quadruple: build that attempt via a second exam.
    const exam2 = randomUUID();
    await db.insert(schema.exams).values({
      id: exam2,
      organizationId: fx.organizationId,
      title: "Agg Action Exam Two",
      description: "",
      courseId: fx.courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: EXAM_CLOSE_AT,
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
    const enr2 = randomUUID();
    await db.insert(schema.examEnrollments).values({
      id: enr2,
      organizationId: fx.organizationId,
      examId: exam2,
      candidateId: fx.candidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const att2 = randomUUID();
    await db.insert(schema.examAttempts).values({
      id: att2,
      organizationId: fx.organizationId,
      examId: exam2,
      enrollmentId: enr2,
      candidateId: fx.candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      deadlineAt: ATTEMPT_DEADLINE_AT,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const t = new Date("2028-01-01T00:00:00.000Z");
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: null,
      createdAt: t,
      description: "agg-action-wrong-exam",
    });
    await db.insert(schema.examIncidentActions).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      actionType: "force_submit",
      actionId: randomUUID(),
      attemptId: att2,
      actorId: fx.actorId,
      linkedAt: t,
      operationId: randomUUID(),
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
          message: expect.stringContaining("RECOVERY_AGG_ACTION_ATTEMPT_SCOPE"),
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentActions)
        .where(eq(schema.examIncidentActions.incidentId, id));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when a candidate-focused incident's action link belongs to a different candidate", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2028-02-01T00:00:00.000Z");
    // Candidate-focused exam-wide incident on fx.candidateId; the action link
    // points at attemptId2, which belongs to candidateId2 — candidate matrix
    // violation (ADR-014 §7), even though the attempt IS on the same exam.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: fx.candidateId,
      createdAt: t,
      description: "agg-action-candidate-mismatch",
    });
    await db.insert(schema.examIncidentActions).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      actionType: "force_submit",
      actionId: randomUUID(),
      attemptId: attemptId2,
      actorId: fx.actorId,
      linkedAt: t,
      operationId: randomUUID(),
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
          message: expect.stringContaining("RECOVERY_AGG_ACTION_ATTEMPT_SCOPE"),
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentActions)
        .where(eq(schema.examIncidentActions.incidentId, id));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  it("fails closed when an interruption link's attempt belongs to a different candidate", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2028-03-01T00:00:00.000Z");
    // Same candidate matrix violation via an interruption evidence link.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: null,
      candidateId: fx.candidateId,
      createdAt: t,
      description: "agg-interruption-candidate-mismatch",
    });
    const interruptionId = randomUUID();
    await db.insert(schema.attemptInterruptions).values({
      id: interruptionId,
      organizationId: fx.organizationId,
      attemptId: attemptId2,
      createdAt: t,
    });
    await db.insert(schema.examIncidentInterruptionLinks).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      attemptId: attemptId2,
      interruptionId,
      linkedBy: fx.actorId,
      linkedAt: t,
      operationId: randomUUID(),
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
          message: expect.stringContaining(
            "RECOVERY_AGG_INTERRUPTION_ATTEMPT_SCOPE",
          ),
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentInterruptionLinks)
        .where(eq(schema.examIncidentInterruptionLinks.incidentId, id));
      await db
        .delete(schema.attemptInterruptions)
        .where(eq(schema.attemptInterruptions.id, interruptionId));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });

  // ── P1-4 (round 3): anchor/membership mutual exclusion (ADR-014 §2) ──

  it("fails closed when an anchored incident also carries membership rows", async () => {
    const repo = createRecoveryRepo(db);
    const t = new Date("2028-04-01T00:00:00.000Z");
    // ADR-014 §2: anchor and membership are mutually exclusive. A historical
    // row carrying BOTH is tenant-data corruption — the aggregate must fail
    // closed instead of projecting a graph the authority forbids.
    const id = await insertIncident(db, fx, {
      examId: fx.examId,
      attemptId: fx.attemptId,
      candidateId: fx.candidateId,
      createdAt: t,
      description: "agg-anchor-membership-conflict",
    });
    await db.insert(schema.examIncidentAttempts).values({
      id: randomUUID(),
      organizationId: fx.organizationId,
      incidentId: id,
      attemptId: attemptId2,
      relationshipType: "affected",
      linkedBy: fx.actorId,
      operationId: randomUUID(),
      linkedAt: t,
    });
    try {
      await expect(repo.getIncidentAggregate(fx.ctx, id)).rejects.toMatchObject(
        {
          name: "AuthzUnavailableError",
          code: "AUTHZ_UNAVAILABLE",
          statusCode: 503,
          message: expect.stringContaining(
            "RECOVERY_AGG_ANCHOR_MEMBERSHIP_CONFLICT",
          ),
        },
      );
    } finally {
      await db
        .delete(schema.examIncidentAttempts)
        .where(eq(schema.examIncidentAttempts.incidentId, id));
      await db
        .delete(schema.examIncidents)
        .where(
          and(
            eq(schema.examIncidents.organizationId, fx.organizationId),
            eq(schema.examIncidents.id, id),
          ),
        );
    }
  });
});
