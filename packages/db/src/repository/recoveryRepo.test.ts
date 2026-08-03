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
