import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createProctorAssignmentRepo } from "./proctorAssignmentRepo.js";

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
  proctorId: string;
  examId: string;
  ctx: RequestContext;
}

async function createFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const adminId = randomUUID();
  const proctorId = randomUUID();

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
      id: proctorId,
      organizationId,
      username: `proctor-${suffix}-${proctorId}`,
      passwordHash: "hash",
      name: "Proctor",
      role: "Proctor",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
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
  return {
    organizationId,
    actorId: adminId,
    adminId,
    proctorId,
    examId,
    ctx: context(organizationId, adminId),
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

describe("proctor assignment persistence foundation", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: Fixture;
  let beta: Fixture;
  let repo: ReturnType<typeof createProctorAssignmentRepo>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("proctor-assignment-persistence");
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
    repo = createProctorAssignmentRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  const now = () => new Date("2026-02-01T00:00:00.000Z");

  /** Inserts a fresh Proctor user (each test gets its own to stay independent). */
  async function newProctor(organizationId: string): Promise<string> {
    const proctorId = randomUUID();
    await db.insert(schema.users).values({
      id: proctorId,
      organizationId,
      username: `proctor-${proctorId}`,
      passwordHash: "hash",
      name: "Proctor",
      role: "Proctor",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });
    return proctorId;
  }

  it("insert + read back an active episode", async () => {
    const row = await repo.insertAssignment(alpha.ctx, {
      examId: alpha.examId,
      proctorUserId: alpha.proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(row.status).toBe("active");
    expect(row.revokedBy).toBeNull();
    expect(row.revokedAt).toBeNull();

    const found = await repo.findById(alpha.ctx, row.id);
    expect(found?.id).toBe(row.id);
    expect(found?.organizationId).toBe(alpha.organizationId);
  });

  it("cross-organization read fails closed (404 semantics)", async () => {
    const proctorId = await newProctor(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      examId: alpha.examId,
      proctorUserId: proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    // Beta's ctx must not see Alpha's episode.
    const found = await repo.findById(beta.ctx, row.id);
    expect(found).toBeNull();
    const active = await repo.findActiveByExamAndProctor(
      beta.ctx,
      alpha.examId,
      proctorId,
    );
    expect(active).toBeNull();
  });

  it("one-active partial unique: second active episode for the same (org, exam, proctor) → 23505 on exam_proctor_assignments_active_unique", async () => {
    const examId = randomUUID();
    const courseId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: alpha.organizationId,
      name: "Course 2",
      code: `C2-${courseId}`,
      description: "",
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: alpha.organizationId,
      title: "Exam 2",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now(),
      closeAt: new Date("2026-03-01T00:00:00.000Z"),
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
      createdAt: now(),
      updatedAt: now(),
    });

    await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: alpha.proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    // The second active episode must violate the partial unique.
    await expect(
      repo.insertAssignment(alpha.ctx, {
        examId,
        proctorUserId: alpha.proctorId,
        assignedBy: alpha.adminId,
        assignedAt: now(),
        createdAt: now(),
        updatedAt: now(),
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(constraintNameOf(err)).toBe(
        "exam_proctor_assignments_active_unique",
      );
      return true;
    });

    // A REVOKED episode does not collide: reassign after revoke creates a new
    // active episode.
    const first = await repo.findActiveByExamAndProctor(
      alpha.ctx,
      examId,
      alpha.proctorId,
    );
    expect(first).not.toBeNull();
    await repo.revokeAssignment(alpha.ctx, first!.id, {
      revokedBy: alpha.adminId,
      revokedAt: now(),
      updatedAt: now(),
    });
    const second = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: alpha.proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    expect(second.status).toBe("active");
    expect(second.id).not.toBe(first!.id);
  });

  it("revocation shape CHECK: revoked status requires revoked_at + revoked_by", async () => {
    const proctorId = await newProctor(alpha.organizationId);
    const row = await repo.insertAssignment(alpha.ctx, {
      examId: alpha.examId,
      proctorUserId: proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    // Direct UPDATE to status='revoked' without revoked_at/revoked_by must be
    // rejected by exam_proctor_assignments_revocation_shape_check.
    await expect(
      db
        .update(schema.examProctorAssignments)
        .set({ status: "revoked" })
        .where(
          and(
            eq(schema.examProctorAssignments.id, row.id),
            eq(
              schema.examProctorAssignments.organizationId,
              alpha.organizationId,
            ),
          ),
        ),
    ).rejects.toThrow();
  });

  it("event operation unique: same (org, operationId) twice → 23505 on exam_proctor_assignment_events_org_operation_unique", async () => {
    const proctorId = await newProctor(alpha.organizationId);
    const assignment = await repo.insertAssignment(alpha.ctx, {
      examId: alpha.examId,
      proctorUserId: proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    const operationId = randomUUID();
    const event = {
      assignmentId: assignment.id,
      commandType: "assign" as const,
      operationId,
      canonicalPayload: {
        examId: alpha.examId,
        proctorUserId: alpha.proctorId,
        reasonCode: null,
      },
      outcome: "applied" as const,
      actorId: alpha.adminId,
      createdAt: now(),
    };
    await repo.appendEvent(alpha.ctx, event);
    await expect(repo.appendEvent(alpha.ctx, event)).rejects.toSatisfy(
      (err: unknown) => {
        expect(constraintNameOf(err)).toBe(
          "exam_proctor_assignment_events_org_operation_unique",
        );
        return true;
      },
    );
  });

  it("event composite parent FK: an event cannot reference a missing episode", async () => {
    await expect(
      repo.appendEvent(alpha.ctx, {
        assignmentId: "missing-episode",
        commandType: "assign",
        operationId: randomUUID(),
        canonicalPayload: {
          examId: alpha.examId,
          proctorUserId: alpha.proctorId,
          reasonCode: null,
        },
        outcome: "applied",
        actorId: alpha.adminId,
        createdAt: now(),
      }),
    ).rejects.toThrow();
  });

  it("plain user FK: proctor_user_id must reference an existing user (no cascade)", async () => {
    await expect(
      repo.insertAssignment(alpha.ctx, {
        examId: alpha.examId,
        proctorUserId: "no-such-user",
        assignedBy: alpha.adminId,
        assignedAt: now(),
        createdAt: now(),
        updatedAt: now(),
      }),
    ).rejects.toThrow();
  });

  it("findMostRecentRevoked uses the frozen (revoked_at DESC, id DESC) tie-break", async () => {
    const examId = randomUUID();
    const courseId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: alpha.organizationId,
      name: "Course 3",
      code: `C3-${courseId}`,
      description: "",
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: alpha.organizationId,
      title: "Exam 3",
      description: "",
      courseId,
      status: "closed",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now(),
      closeAt: new Date("2026-03-01T00:00:00.000Z"),
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
      createdAt: now(),
      updatedAt: now(),
    });

    const older = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: alpha.proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    await repo.revokeAssignment(alpha.ctx, older.id, {
      revokedBy: alpha.adminId,
      revokedAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: now(),
    });
    const newer = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: alpha.proctorId,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    });
    await repo.revokeAssignment(alpha.ctx, newer.id, {
      revokedBy: alpha.adminId,
      revokedAt: new Date("2026-02-02T00:00:00.000Z"),
      updatedAt: now(),
    });

    const mostRecent = await repo.findMostRecentRevoked(
      alpha.ctx,
      examId,
      alpha.proctorId,
    );
    expect(mostRecent?.id).toBe(newer.id);
  });

  it("findMostRecentEpisodeByExamAndProctor: any-status most recent by (created_at DESC, id DESC)", async () => {
    const examId = randomUUID();
    const courseId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: alpha.organizationId,
      name: "Course 4",
      code: `C4-${courseId}`,
      description: "",
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: alpha.organizationId,
      title: "Exam 4",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now(),
      closeAt: new Date("2026-03-01T00:00:00.000Z"),
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
      createdAt: now(),
      updatedAt: now(),
    });
    const proctorId = await newProctor(alpha.organizationId);

    const t1 = new Date("2026-02-01T00:00:00.000Z");
    const t2 = new Date("2026-02-02T00:00:00.000Z");
    const first = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: proctorId,
      assignedBy: alpha.adminId,
      assignedAt: t1,
      createdAt: t1,
      updatedAt: t1,
    });
    await repo.revokeAssignment(alpha.ctx, first.id, {
      revokedBy: alpha.adminId,
      revokedAt: t1,
      updatedAt: t1,
    });
    const second = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: proctorId,
      assignedBy: alpha.adminId,
      assignedAt: t2,
      createdAt: t2,
      updatedAt: t2,
    });

    // The newest episode of any status (here: the active reassignment). The
    // visible-set is governed by the caller's transaction snapshot, not by an
    // application time bound (ADR-015 §7 Amendment A1).
    const latest = await repo.findMostRecentEpisodeByExamAndProctor(
      alpha.ctx,
      examId,
      proctorId,
    );
    expect(latest?.id).toBe(second.id);
    expect(latest?.status).toBe("active");

    // Cross-organization read fails closed.
    const crossOrg = await repo.findMostRecentEpisodeByExamAndProctor(
      beta.ctx,
      examId,
      proctorId,
    );
    expect(crossOrg).toBeNull();
  });

  it("findMostRecentEpisodeByExamAndProctor tie-breaks on id DESC for identical created_at", async () => {
    const examId = randomUUID();
    const courseId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: alpha.organizationId,
      name: "Course 5",
      code: `C5-${courseId}`,
      description: "",
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: alpha.organizationId,
      title: "Exam 5",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now(),
      closeAt: new Date("2026-03-01T00:00:00.000Z"),
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
      createdAt: now(),
      updatedAt: now(),
    });
    const proctorId = await newProctor(alpha.organizationId);

    const same = new Date("2026-02-01T00:00:00.000Z");
    const lowId = "00000000-0000-0000-0000-000000000001";
    const highId = "00000000-0000-0000-0000-000000000002";
    await db.insert(schema.examProctorAssignments).values({
      id: lowId,
      organizationId: alpha.organizationId,
      examId,
      proctorUserId: proctorId,
      status: "active",
      assignedBy: alpha.adminId,
      assignedAt: same,
      revokedBy: null,
      revokedAt: null,
      createdAt: same,
      updatedAt: same,
    });
    await repo.revokeAssignment(alpha.ctx, lowId, {
      revokedBy: alpha.adminId,
      revokedAt: same,
      updatedAt: same,
    });
    await db.insert(schema.examProctorAssignments).values({
      id: highId,
      organizationId: alpha.organizationId,
      examId,
      proctorUserId: proctorId,
      status: "active",
      assignedBy: alpha.adminId,
      assignedAt: same,
      revokedBy: null,
      revokedAt: null,
      createdAt: same,
      updatedAt: same,
    });

    const found = await repo.findMostRecentEpisodeByExamAndProctor(
      alpha.ctx,
      examId,
      proctorId,
    );
    expect(found?.id).toBe(highId);
  });

  it("listExamProctors: active default + revoked filter + stable keyset pagination", async () => {
    const examId = randomUUID();
    const courseId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: alpha.organizationId,
      name: "Course 4",
      code: `C4-${courseId}`,
      description: "",
      createdAt: now(),
      updatedAt: now(),
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId: alpha.organizationId,
      title: "Exam 4",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now(),
      closeAt: new Date("2026-03-01T00:00:00.000Z"),
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
      createdAt: now(),
      updatedAt: now(),
    });
    const proctorA = randomUUID();
    const proctorB = randomUUID();
    await db.insert(schema.users).values([
      {
        id: proctorA,
        organizationId: alpha.organizationId,
        username: `pa-${proctorA}`,
        passwordHash: "hash",
        name: "PA",
        role: "Proctor",
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: proctorB,
        organizationId: alpha.organizationId,
        username: `pb-${proctorB}`,
        passwordHash: "hash",
        name: "PB",
        role: "Proctor",
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      },
    ]);

    const r1 = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: proctorA,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: now(),
    });
    const r2 = await repo.insertAssignment(alpha.ctx, {
      examId,
      proctorUserId: proctorB,
      assignedBy: alpha.adminId,
      assignedAt: now(),
      createdAt: new Date("2026-02-02T00:00:00.000Z"),
      updatedAt: now(),
    });
    await repo.revokeAssignment(alpha.ctx, r2.id, {
      revokedBy: alpha.adminId,
      revokedAt: new Date("2026-02-03T00:00:00.000Z"),
      updatedAt: now(),
    });

    // Active default: only r1.
    const active = await repo.listExamProctors(alpha.ctx, examId, {
      status: "active",
      limit: 10,
    });
    expect(active.items.map((r) => r.id)).toEqual([r1.id]);
    expect(active.nextCursor).toBeNull();

    // Revoked: only r2.
    const revoked = await repo.listExamProctors(alpha.ctx, examId, {
      status: "revoked",
      limit: 10,
    });
    expect(revoked.items.map((r) => r.id)).toEqual([r2.id]);

    // All: r1 then r2 (created_at order), keyset-paginated with limit 1.
    const page1 = await repo.listExamProctors(alpha.ctx, examId, {
      status: "all",
      limit: 1,
    });
    expect(page1.items.map((r) => r.id)).toEqual([r1.id]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.listExamProctors(alpha.ctx, examId, {
      status: "all",
      limit: 1,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map((r) => r.id)).toEqual([r2.id]);
    expect(page2.nextCursor).toBeNull();
  });

  it("listProctorExams returns only active assignments for the proctor", async () => {
    const rows = await repo.listProctorExams(alpha.ctx, alpha.proctorId);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe("active");
    }
  });

  it("getProctorExamAssignment / hasActiveAssignment reflect the current episode", async () => {
    const current = await repo.getProctorExamAssignment(
      alpha.ctx,
      alpha.examId,
      alpha.proctorId,
    );
    const has = await repo.hasActiveAssignment(
      alpha.ctx,
      alpha.examId,
      alpha.proctorId,
    );
    expect((current != null) === has).toBe(true);
  });
});
