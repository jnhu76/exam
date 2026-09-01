import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createGraderExamAssignmentRepo } from "./graderExamAssignmentRepo.js";

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
  adminId: string;
  graderId: string;
  examAId: string;
  examBId: string;
  ctx: RequestContext;
}

async function createFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const organizationId = randomUUID();
  const adminId = randomUUID();
  const graderId = randomUUID();
  const courseId = randomUUID();
  const examAId = randomUUID();
  const examBId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `Org ${suffix}`,
    displayName: `Org ${suffix}`,
    slug: `org-${suffix}-${organizationId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values([
    {
      id: adminId,
      organizationId,
      username: `admin-${suffix}-${adminId}`,
      passwordHash: "hash",
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: graderId,
      organizationId,
      username: `grader-${suffix}-${graderId}`,
      passwordHash: "hash",
      name: "Grader",
      role: "Grader",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: "Course",
    code: `C-${suffix}-${courseId}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(schema.exams)
    .values([
      examRow(organizationId, courseId, examAId, "Exam A", suffix, now),
      examRow(organizationId, courseId, examBId, "Exam B", suffix, now),
    ]);
  return {
    organizationId,
    actorId: adminId,
    adminId,
    graderId,
    examAId,
    examBId,
    ctx: context(organizationId, adminId),
  };
}

function examRow(
  organizationId: string,
  courseId: string,
  examId: string,
  title: string,
  suffix: string,
  now: Date,
) {
  return {
    id: examId,
    organizationId,
    title: `${title} ${suffix}`,
    description: "",
    courseId,
    status: "draft",
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
      showResultImmediately: false,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  };
}

/** Extract the PostgreSQL constraint name from a 23505 error chain. */
function constraintNameOf(err: unknown): string | null {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current === "object" && current !== null) {
      const e = current as Record<string, unknown>;
      if (e.code === "23505") {
        return String(e.constraint ?? e.constraint_name ?? "");
      }
      current = "cause" in e ? e.cause : null;
    } else {
      current = null;
    }
  }
  return null;
}

describe("grader exam assignment persistence foundation", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: Fixture;
  let beta: Fixture;
  let repo: ReturnType<typeof createGraderExamAssignmentRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("grader-exam-assignment-persist");
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
    repo = createGraderExamAssignmentRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  const now = () => new Date("2026-02-01T00:00:00.000Z");

  /** Inserts a fresh Grader user (each test gets its own to stay independent). */
  async function newGrader(organizationId: string): Promise<string> {
    const graderId = randomUUID();
    await db.insert(schema.users).values({
      id: graderId,
      organizationId,
      username: `grader-${graderId}`,
      passwordHash: "hash",
      name: "Grader",
      role: "Grader",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });
    return graderId;
  }

  it("insert + read back an active episode", async () => {
    const graderId = await newGrader(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(row.status).toBe("active");
    expect(row.revokedBy).toBeNull();
    expect(row.revokedAt).toBeNull();

    const found = await repo.findActiveByGraderAndExam(
      alpha.ctx,
      graderId,
      alpha.examAId,
    );
    expect(found?.id).toBe(row.id);
  });

  it("one-active partial unique rejects a second active episode for the same triple", async () => {
    const graderId = await newGrader(alpha.organizationId);
    await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    let caught: unknown = null;
    try {
      await repo.insertAssignment(alpha.ctx, {
        graderUserId: graderId,
        examId: alpha.examAId,
        assignedBy: alpha.adminId,
        assignedAt: now(),
        createdAt: now(),
        updatedAt: now(),
      });
    } catch (err) {
      caught = err;
    }
    expect(constraintNameOf(caught)).toBe(
      "grader_exam_assignments_active_unique",
    );
  });

  it("revoke flips the episode and the triple becomes reassignable", async () => {
    const graderId = await newGrader(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const revoked = await repo.revokeAssignment(alpha.ctx, row.id, {
      revokedBy: alpha.adminId,
      revokedAt: now(),
      updatedAt: now(),
    });
    expect(revoked?.status).toBe("revoked");
    expect(
      await repo.findActiveByGraderAndExam(alpha.ctx, graderId, alpha.examAId),
    ).toBeNull();

    // Re-assign opens a SECOND episode (history preserved).
    const again = await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(again.id).not.toBe(row.id);
  });

  it("hasActiveAssignment is true only for an active episode", async () => {
    const graderId = await newGrader(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examBId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(
      await repo.hasActiveAssignment(alpha.ctx, alpha.examBId, graderId),
    ).toBe(true);
    await repo.revokeAssignment(alpha.ctx, row.id, {
      revokedBy: alpha.adminId,
      revokedAt: now(),
      updatedAt: now(),
    });
    expect(
      await repo.hasActiveAssignment(alpha.ctx, alpha.examBId, graderId),
    ).toBe(false);
  });

  it("listActiveExamIdsByGrader returns only the assigned active exams", async () => {
    const graderId = await newGrader(alpha.organizationId);
    await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const revoked = await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examBId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    await repo.revokeAssignment(alpha.ctx, revoked.id, {
      revokedBy: alpha.adminId,
      revokedAt: now(),
      updatedAt: now(),
    });
    expect(await repo.listActiveExamIdsByGrader(alpha.ctx, graderId)).toEqual([
      alpha.examAId,
    ]);
  });

  it("tenant boundary: cross-org lookups never match", async () => {
    const graderId = await newGrader(alpha.organizationId);
    await repo.insertAssignment(alpha.ctx, {
      graderUserId: graderId,
      examId: alpha.examAId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    // beta.ctx carries beta's organizationId — the alpha episode must be
    // invisible to every beta lookup.
    expect(
      await repo.hasActiveAssignment(beta.ctx, alpha.examAId, graderId),
    ).toBe(false);
    expect(await repo.listActiveExamIdsByGrader(beta.ctx, graderId)).toEqual(
      [],
    );
  });
});
