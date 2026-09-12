import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { schema } from "../schema/pg.js";
import { createExamAdmissionRepo } from "./examAdmissionRepo.js";
import type { Database } from "../types.js";

/**
 * #292 — real-PostgreSQL semantics for the durable admission repo:
 * partial-unique idempotent join, CAS admission/consumption, and the
 * (joined_at, id) active-ordering math. No mocks — DB constraints ARE the
 * invariants under test.
 */

function createContext(orgId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId: orgId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: orgId,
  };
}

let db: Database;
let ctx: RequestContext;
let orgId: string;
let examId: string;
let cleanup: (() => Promise<void>) | undefined;

/** Seeds enrollment + attempt rows so consumeActive can pair a REAL attempt id. */
async function seedAttempt(candidateId: string): Promise<string> {
  const now = new Date();
  const enrollmentId = randomUUID();
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId: orgId,
    examId,
    candidateId,
    status: "enrolled",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const attemptId = randomUUID();
  await db.insert(schema.examAttempts).values({
    id: attemptId,
    organizationId: orgId,
    examId,
    enrollmentId,
    candidateId,
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: now,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return attemptId;
}

// candidate_profiles requires an owning user; helper keeps that wiring in one place.
async function seedCandidateProfile(candidateId: string): Promise<void> {
  const now = new Date();
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username: `adm-${candidateId.slice(0, 8)}`,
    passwordHash: "x",
    name: "Admission Repo Test",
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.candidateProfiles).values({
    id: candidateId,
    organizationId: orgId,
    userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
}

/** Creates a fresh exam for tests that depend on exact schedule counts. */
async function createFreshExam(): Promise<string> {
  const now = new Date();
  const courseId = randomUUID();
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: `Admission Course ${courseId.slice(0, 4)}`,
    code: `AC-${courseId.slice(0, 4)}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  const id = randomUUID();
  await db.insert(schema.exams).values({
    id,
    organizationId: orgId,
    title: `Admission Exam ${id.slice(0, 4)}`,
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(Date.now() + 86400000),
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
      requireQueue: true,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    interruptionTimePolicy: "strict",
    interruptionGracePerIncidentSeconds: null,
    interruptionGracePerAttemptSeconds: null,
    syncStartedAt: null,
    createdAt: now,
    updatedAt: now,
  } as never);
  return id;
}

beforeAll(async () => {
  const isolated = await getIsolatedTestDb("exam-admission-repo");
  db = isolated.db;
  cleanup = isolated.cleanup;
  orgId = randomUUID();
  const now = new Date();
  await db.insert(schema.organizations).values({
    id: orgId,
    name: "Admission Org",
    displayName: "Admission Org",
    slug: `adm-${orgId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  ctx = createContext(orgId);

  const courseId = randomUUID();
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: "Admission Course",
    code: `AC-${courseId.slice(0, 4)}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  examId = randomUUID();
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: "Admission Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(Date.now() + 86400000),
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
      requireQueue: true,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    interruptionTimePolicy: "strict",
    interruptionGracePerIncidentSeconds: null,
    interruptionGracePerAttemptSeconds: null,
    syncStartedAt: null,
    createdAt: now,
    updatedAt: now,
  } as never);
}, 120_000);

afterAll(async () => {
  await cleanup?.();
}, 30_000);

describe("examAdmissionRepo (real PostgreSQL)", () => {
  it("joinActive is idempotent under the partial unique index (Q4)", async () => {
    const repo = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidateProfile(candidateId);

    const first = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });
    const retry = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });
    expect(retry.id).toBe(first.id);
  });

  it("admitOnce is a write-once CAS (Q5)", async () => {
    const repo = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidateProfile(candidateId);
    const row = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });

    const t1 = new Date();
    const admitted = await repo.admitOnce(ctx, row.id, t1);
    expect(admitted?.admittedAt).toEqual(t1);
    const again = await repo.admitOnce(ctx, row.id, new Date());
    expect(again).toBeNull();
  });

  it("consumeActive consumes exactly once and pairs the attempt id", async () => {
    const repo = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidateProfile(candidateId);
    const row = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });
    await repo.admitOnce(ctx, row.id, new Date());

    const attemptId = await seedAttempt(candidateId);
    const consumed = await repo.consumeActive(
      ctx,
      orgId,
      examId,
      candidateId,
      new Date(),
      attemptId,
    );
    expect(consumed?.consumedAttemptId).toBe(attemptId);
    const second = await repo.consumeActive(
      ctx,
      orgId,
      examId,
      candidateId,
      new Date(),
      attemptId,
    );
    expect(second).toBeNull();
  });

  it("schedule authority uses ALL rows; consumption only shrinks active position", async () => {
    const localExamId = await createFreshExam();
    const repo = createExamAdmissionRepo(db);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      await seedCandidateProfile(id);
    }
    const t0 = new Date("2025-01-01T09:00:00.000Z");
    const a = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: ids[0]!,
      joinedAt: t0,
    });
    await repo.admitOnce(ctx, a.id, t0);
    const b = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: ids[1]!,
      joinedAt: new Date(t0.getTime() + 1000),
    });
    const c = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: ids[2]!,
      joinedAt: new Date(t0.getTime() + 2000),
    });

    // Schedule ordinal is derived from ALL memberships (active + consumed).
    expect(
      await repo.countAllAhead(ctx, orgId, localExamId, b.joinedAt, b.id),
    ).toBe(1);
    expect(
      await repo.countAllAhead(ctx, orgId, localExamId, c.joinedAt, c.id),
    ).toBe(2);
    expect(await repo.earliestJoinedAt(ctx, orgId, localExamId)).toEqual(t0);

    // Consuming the head shrinks the UI position but MUST NOT shift the
    // schedule anchor or ordinal.
    await repo.consumeActive(
      ctx,
      orgId,
      localExamId,
      ids[0]!,
      new Date(),
      await seedAttempt(ids[0]!),
    );
    expect(await repo.earliestJoinedAt(ctx, orgId, localExamId)).toEqual(t0);
    expect(
      await repo.countAllAhead(ctx, orgId, localExamId, c.joinedAt, c.id),
    ).toBe(2);
    expect(
      await repo.countActiveAhead(ctx, orgId, localExamId, c.joinedAt, c.id),
    ).toBe(1);
  });

  it("a re-join after consumption inserts a FRESH membership (retake flow)", async () => {
    const repo = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidateProfile(candidateId);
    const first = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });
    await repo.admitOnce(ctx, first.id, new Date());
    await repo.consumeActive(
      ctx,
      orgId,
      examId,
      candidateId,
      new Date(),
      await seedAttempt(candidateId),
    );

    const second = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });
    expect(second.id).not.toBe(first.id);
    expect(second.consumedAt).toBeNull();
  });
});

describe("durable schedule authority across instances", () => {
  async function seedCandidate(candidateId: string): Promise<void> {
    await seedCandidateProfile(candidateId);
  }

  it("T3 — restart invariance: a fresh repo instance reads the same schedule facts", async () => {
    const localExamId = await createFreshExam();
    const repo1 = createExamAdmissionRepo(db);
    const aId = randomUUID();
    const bId = randomUUID();
    await seedCandidate(aId);
    await seedCandidate(bId);

    const t0 = new Date("2025-01-01T09:00:00.000Z");
    await repo1.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: aId,
      joinedAt: t0,
    });
    const b = await repo1.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: bId,
      joinedAt: new Date(t0.getTime() + 1000),
    });

    // Simulate API restart: a brand-new repo instance against the same DB.
    const repo2 = createExamAdmissionRepo(db);
    expect(await repo2.earliestJoinedAt(ctx, orgId, localExamId)).toEqual(t0);
    expect(
      await repo2.countAllAhead(ctx, orgId, localExamId, b.joinedAt, b.id),
    ).toBe(1);
  });

  it("T4 — multi-instance invariance: two repo instances agree on release authority", async () => {
    const localExamId = await createFreshExam();
    const repoA = createExamAdmissionRepo(db);
    const repoB = createExamAdmissionRepo(db);
    const aId = randomUUID();
    const bId = randomUUID();
    await seedCandidate(aId);
    await seedCandidate(bId);

    const t0 = new Date("2025-01-01T09:00:00.000Z");
    await repoA.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: aId,
      joinedAt: t0,
    });
    const b = await repoA.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: bId,
      joinedAt: new Date(t0.getTime() + 1000),
    });

    const [anchorA, anchorB, ordinalA, ordinalB] = await Promise.all([
      repoA.earliestJoinedAt(ctx, orgId, localExamId),
      repoB.earliestJoinedAt(ctx, orgId, localExamId),
      repoA.countAllAhead(ctx, orgId, localExamId, b.joinedAt, b.id),
      repoB.countAllAhead(ctx, orgId, localExamId, b.joinedAt, b.id),
    ]);
    expect(anchorA).toEqual(anchorB);
    expect(anchorA).toEqual(t0);
    expect(ordinalA).toBe(ordinalB);
    expect(ordinalA).toBe(1);
  });

  it("C1 — concurrent duplicate joins converge on one durable membership", async () => {
    const repoA = createExamAdmissionRepo(db);
    const repoB = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidate(candidateId);

    const [first, second] = await Promise.all([
      repoA.joinActive(ctx, {
        organizationId: orgId,
        examId,
        candidateId,
        joinedAt: new Date(),
      }),
      repoB.joinActive(ctx, {
        organizationId: orgId,
        examId,
        candidateId,
        joinedAt: new Date(),
      }),
    ]);
    expect(first.id).toBe(second.id);
  });

  it("C2 — concurrent admitOnce converges on one admitted fact", async () => {
    const repo = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidate(candidateId);
    const row = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });

    const t1 = new Date();
    const t2 = new Date(t1.getTime() + 1);
    const [a, b] = await Promise.all([
      repo.admitOnce(ctx, row.id, t1),
      repo.admitOnce(ctx, row.id, t2),
    ]);
    const admitted = a ?? b;
    expect(admitted).not.toBeNull();
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
  });

  it("C3 — concurrent consumeActive converges on one consumed fact", async () => {
    const repo = createExamAdmissionRepo(db);
    const candidateId = randomUUID();
    await seedCandidate(candidateId);
    const row = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId,
      joinedAt: new Date(),
    });
    await repo.admitOnce(ctx, row.id, new Date());

    const attemptId = await seedAttempt(candidateId);
    const [a, b] = await Promise.all([
      repo.consumeActive(
        ctx,
        orgId,
        examId,
        candidateId,
        new Date(),
        attemptId,
      ),
      repo.consumeActive(
        ctx,
        orgId,
        examId,
        candidateId,
        new Date(),
        attemptId,
      ),
    ]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
  });

  it("C4 — consumption of a predecessor does not change another candidate's schedule ordinal", async () => {
    const localExamId = await createFreshExam();
    const repo = createExamAdmissionRepo(db);
    const aId = randomUUID();
    const bId = randomUUID();
    await seedCandidate(aId);
    await seedCandidate(bId);

    const t0 = new Date("2025-01-01T09:00:00.000Z");
    const a = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: aId,
      joinedAt: t0,
    });
    const b = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId: localExamId,
      candidateId: bId,
      joinedAt: new Date(t0.getTime() + 1000),
    });
    await repo.admitOnce(ctx, a.id, new Date());
    await repo.admitOnce(ctx, b.id, new Date());

    const ordinalBefore = await repo.countAllAhead(
      ctx,
      orgId,
      localExamId,
      b.joinedAt,
      b.id,
    );
    await repo.consumeActive(
      ctx,
      orgId,
      localExamId,
      aId,
      new Date(),
      await seedAttempt(aId),
    );
    const ordinalAfter = await repo.countAllAhead(
      ctx,
      orgId,
      localExamId,
      b.joinedAt,
      b.id,
    );
    expect(ordinalBefore).toBe(1);
    expect(ordinalAfter).toBe(1);
  });
});
