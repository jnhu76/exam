/**
 * Proctor-assignment concurrency tests — ADR-015 §7 frozen outcomes, driven
 * through the REAL production path (`withProctorAssignmentOperationRecovery`
 * + `assignProctorToExam` / `revokeProctorFromExam`) against real PostgreSQL
 * (isolated worker schema). Every assertion checks final database state, so
 * the tests are winner-agnostic — exactly what the ADR's expected-results
 * table requires. Each test uses its own (exam, proctor) pair so no state
 * leaks between races.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import { createAuditLogWriter } from "@exam/db/src/repository/auditLogRepo.js";
import { createProctorAssignmentRepo } from "@exam/db/src/repository/proctorAssignmentRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import {
  assignProctorToExam,
  revokeProctorFromExam,
  type ProctorAssignmentRepo,
} from "@exam/exam-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withProctorAssignmentOperationRecovery } from "./proctorAssignmentOperationRecovery.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

describe("proctor assignment concurrency (ADR-015 §7)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let organizationId: string;
  let adminId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("proctor-assignment-concurrency");
    db = result.db;
    cleanup = result.cleanup;

    const now = new Date("2026-01-01T00:00:00.000Z");
    organizationId = randomUUID();
    adminId = randomUUID();
    ctx = context(organizationId, adminId);
    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Org race",
      displayName: "Org race",
      slug: `org-race-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.users).values({
      id: adminId,
      organizationId,
      username: `admin-race-${adminId}`,
      passwordHash: "hash",
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  const NOW = new Date("2026-02-01T00:00:00.000Z");

  /** Fresh (exam, proctor) pair for one race — no state shared across tests. */
  async function newExamProctor(suffix: string): Promise<{
    examId: string;
    proctorId: string;
    payload: { examId: string; proctorUserId: string; reasonCode: null };
  }> {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const courseId = randomUUID();
    const examId = randomUUID();
    const proctorId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      name: `Course ${suffix}`,
      code: `C-${suffix}-${courseId}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId,
      title: `Exam ${suffix}`,
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
    await db.insert(schema.users).values({
      id: proctorId,
      organizationId,
      username: `proctor-${suffix}-${proctorId}`,
      passwordHash: "hash",
      name: "Proctor",
      role: "Proctor",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return {
      examId,
      proctorId,
      payload: { examId, proctorUserId: proctorId, reasonCode: null },
    };
  }

  function assignRunner(
    examId: string,
    proctorId: string,
    operationId: string,
  ) {
    return (tx: Database) => {
      const repo = createProctorAssignmentRepo(
        tx,
      ) as unknown as ProctorAssignmentRepo;
      return assignProctorToExam(
        repo,
        ctx,
        { operationId, examId, proctorUserId: proctorId },
        {
          now: NOW,
          audit: async (action, metadata) => {
            await createAuditLogWriter(tx).insert(ctx, {
              actorId: ctx.actorId,
              action,
              targetType: "exam",
              targetId: examId,
              metadata,
            });
          },
          lookupExam: async () => ({ organizationId, id: examId }),
          lookupProctorUser: async (userId) =>
            userId === proctorId
              ? { organizationId, isActive: true, hasActiveProctorRole: true }
              : null,
        },
      );
    };
  }

  function revokeRunner(
    examId: string,
    proctorId: string,
    operationId: string,
  ) {
    return (tx: Database) => {
      const repo = createProctorAssignmentRepo(
        tx,
      ) as unknown as ProctorAssignmentRepo;
      return revokeProctorFromExam(
        repo,
        ctx,
        { operationId, examId, proctorUserId: proctorId },
        {
          now: NOW,
          audit: async (action, metadata) => {
            await createAuditLogWriter(tx).insert(ctx, {
              actorId: ctx.actorId,
              action,
              targetType: "exam",
              targetId: examId,
              metadata,
            });
          },
        },
      );
    };
  }

  async function activeEpisodes(examId: string, proctorId: string) {
    return db
      .select()
      .from(schema.examProctorAssignments)
      .where(
        and(
          eq(schema.examProctorAssignments.organizationId, organizationId),
          eq(schema.examProctorAssignments.examId, examId),
          eq(schema.examProctorAssignments.proctorUserId, proctorId),
          eq(schema.examProctorAssignments.status, "active"),
        ),
      );
  }

  async function eventsByOpIds(operationIds: string[]) {
    const all = await db
      .select()
      .from(schema.examProctorAssignmentEvents)
      .where(
        eq(schema.examProctorAssignmentEvents.organizationId, organizationId),
      );
    return all.filter((e) => operationIds.includes(e.operationId));
  }

  async function countAuditRows(
    action: string,
    examId: string,
  ): Promise<number> {
    const rows = await db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, organizationId),
          eq(schema.auditLogs.action, action),
          eq(schema.auditLogs.targetId, examId),
        ),
      );
    return rows.length;
  }

  it("concurrent assign with DIFFERENT operationIds → one applied + one no_change, one active episode, two durable receipts, one audit", async () => {
    const { examId, proctorId, payload } = await newExamProctor("diff-op");
    const op1 = randomUUID();
    const op2 = randomUUID();
    const [r1, r2] = await Promise.all([
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        op1,
        "assign",
        payload,
        NOW,
        assignRunner(examId, proctorId, op1),
      ),
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        op2,
        "assign",
        payload,
        NOW,
        assignRunner(examId, proctorId, op2),
      ),
    ]);

    // Exactly one winner and one no_change receipt (winner-agnostic).
    expect([r1.outcome, r2.outcome].sort()).toEqual(["applied", "no_change"]);
    // Both commands resolve to the SAME active episode.
    expect(r1.assignment.id).toBe(r2.assignment.id);

    const active = await activeEpisodes(examId, proctorId);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(r1.assignment.id);

    const events = await eventsByOpIds([op1, op2]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.outcome).sort()).toEqual([
      "applied",
      "no_change",
    ]);
    expect(events.map((e) => e.operationId).sort()).toEqual([op1, op2].sort());
    // Every event references a concrete episode (NOT NULL assignment_id).
    for (const e of events) {
      expect(e.assignmentId).toBe(r1.assignment.id);
    }

    // Exactly ONE compliance audit (the applied state change only).
    expect(await countAuditRows("exam.proctor_assigned", examId)).toBe(1);
  });

  it("concurrent assign with the SAME operationId (retry) → one applied + one idempotent_replayed, ONE receipt, ONE audit", async () => {
    const { examId, proctorId, payload } = await newExamProctor("same-op");
    const op = randomUUID();
    const [r1, r2] = await Promise.all([
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        op,
        "assign",
        payload,
        NOW,
        assignRunner(examId, proctorId, op),
      ),
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        op,
        "assign",
        payload,
        NOW,
        assignRunner(examId, proctorId, op),
      ),
    ]);

    expect([r1.outcome, r2.outcome].sort()).toEqual([
      "applied",
      "idempotent_replayed",
    ]);
    expect(r1.assignment.id).toBe(r2.assignment.id);

    const events = await eventsByOpIds([op]);
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe("applied");
    expect(await countAuditRows("exam.proctor_assigned", examId)).toBe(1);
  });

  it("concurrent revoke with DIFFERENT operationIds → one applied + one no_change, one revoked episode, two receipts, one audit", async () => {
    const { examId, proctorId, payload } = await newExamProctor("revoke");
    // Establish an active episode first.
    const assignOp = randomUUID();
    await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      assignOp,
      "assign",
      payload,
      NOW,
      assignRunner(examId, proctorId, assignOp),
    );

    const op1 = randomUUID();
    const op2 = randomUUID();
    const [r1, r2] = await Promise.all([
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        op1,
        "revoke",
        payload,
        NOW,
        revokeRunner(examId, proctorId, op1),
      ),
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        op2,
        "revoke",
        payload,
        NOW,
        revokeRunner(examId, proctorId, op2),
      ),
    ]);

    expect([r1.outcome, r2.outcome].sort()).toEqual(["applied", "no_change"]);
    expect(r1.assignment.id).toBe(r2.assignment.id);
    expect(r1.assignment.status).toBe("revoked");
    expect(r1.assignment.revokedAt).not.toBeNull();
    expect(r1.assignment.revokedBy).toBe(adminId);

    expect(await activeEpisodes(examId, proctorId)).toHaveLength(0);
    const events = await eventsByOpIds([op1, op2]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.outcome).sort()).toEqual([
      "applied",
      "no_change",
    ]);
    expect(await countAuditRows("exam.proctor_revoked", examId)).toBe(1);
  });

  it("assign vs revoke race leaves an internally valid final state", async () => {
    const { examId, proctorId, payload } = await newExamProctor("race");
    const assignOp = randomUUID();
    const revokeOp = randomUUID();

    const [assignResult, revokeResult] = await Promise.allSettled([
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        assignOp,
        "assign",
        payload,
        NOW,
        assignRunner(examId, proctorId, assignOp),
      ),
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        revokeOp,
        "revoke",
        payload,
        NOW,
        revokeRunner(examId, proctorId, revokeOp),
      ),
    ]);

    // Final state must be internally valid:
    //  - at most one active episode;
    //  - a revoked row carries revoked_at + revoked_by;
    //  - every event references a concrete episode.
    const episodes = await db
      .select()
      .from(schema.examProctorAssignments)
      .where(
        and(
          eq(schema.examProctorAssignments.organizationId, organizationId),
          eq(schema.examProctorAssignments.examId, examId),
        ),
      );
    const activeRows = episodes.filter((e) => e.status === "active");
    const revokedRows = episodes.filter((e) => e.status === "revoked");
    expect(activeRows.length).toBeLessThanOrEqual(1);
    for (const r of revokedRows) {
      expect(r.revokedAt).not.toBeNull();
      expect(r.revokedBy).not.toBeNull();
    }

    const events = await eventsByOpIds([assignOp, revokeOp]);
    for (const e of events) {
      const episode = episodes.find((ep) => ep.id === e.assignmentId);
      expect(episode, "event references a concrete episode").toBeDefined();
    }

    // Result/state consistency: if the revoke applied, no active row remains.
    if (revokeResult.status === "fulfilled") {
      expect(revokeResult.value.outcome).toBe("applied");
      expect(activeRows).toHaveLength(0);
    } else {
      // Revoke legitimately found no episode (404) — the assign may stand.
      expect(revokeResult.reason).toBeInstanceOf(NotFoundError);
    }
    if (assignResult.status === "fulfilled") {
      expect(["applied", "no_change"]).toContain(assignResult.value.outcome);
    }
  });

  it("an unrelated 23505 is surfaced, never swallowed by the recovery", async () => {
    // A run that violates an unrelated unique (duplicate org slug) must
    // propagate unchanged instead of being treated as an assignment race.
    await expect(
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        randomUUID(),
        "assign",
        { examId: randomUUID(), proctorUserId: randomUUID(), reasonCode: null },
        NOW,
        async (tx) => {
          // Insert INSIDE the transaction (same connection — using the outer
          // db here would queue behind the open tx and deadlock).
          await tx.insert(schema.organizations).values({
            id: randomUUID(),
            name: "Dup",
            displayName: "Dup",
            slug: `org-race-${organizationId}`,
            createdAt: NOW,
            updatedAt: NOW,
          });
          throw new Error("unreachable");
        },
      ),
    ).rejects.toThrow();
  });
});
