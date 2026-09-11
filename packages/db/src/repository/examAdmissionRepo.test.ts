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

  it("countActiveAhead + earliestActiveJoinedAt order over ACTIVE rows by (joined_at, id)", async () => {
    const repo = createExamAdmissionRepo(db);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      await seedCandidateProfile(id);
    }
    const t0 = new Date(Date.now() - 10_000);
    const a = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId: ids[0]!,
      joinedAt: t0,
    });
    await repo.admitOnce(ctx, a.id, t0);
    const b = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId: ids[1]!,
      joinedAt: new Date(t0.getTime() + 1000),
    });
    const c = await repo.joinActive(ctx, {
      organizationId: orgId,
      examId,
      candidateId: ids[2]!,
      joinedAt: new Date(t0.getTime() + 2000),
    });

    expect(
      await repo.countActiveAhead(ctx, orgId, examId, b.joinedAt, b.id),
    ).toBe(1);
    expect(
      await repo.countActiveAhead(ctx, orgId, examId, c.joinedAt, c.id),
    ).toBe(2);
    expect(await repo.earliestActiveJoinedAt(ctx, orgId, examId)).toEqual(t0);

    // Consuming the head shifts the anchor and positions (legacy parity).
    await repo.consumeActive(
      ctx,
      orgId,
      examId,
      ids[0]!,
      new Date(),
      await seedAttempt(ids[0]!),
    );
    expect(await repo.earliestActiveJoinedAt(ctx, orgId, examId)).toEqual(
      b.joinedAt,
    );
    expect(
      await repo.countActiveAhead(ctx, orgId, examId, c.joinedAt, c.id),
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
