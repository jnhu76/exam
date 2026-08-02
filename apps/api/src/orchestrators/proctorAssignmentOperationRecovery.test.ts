/**
 * Proctor-assignment concurrency tests — ADR-015 §7 frozen outcomes, driven
 * through the REAL production path (`withProctorAssignmentOperationRecovery`
 * + `assignProctorToExam` / `revokeProctorFromExam`) against real PostgreSQL.
 *
 * Unlike a single shared connection, this file opens TWO physical PostgreSQL
 * connections (`max: 1` each) pointed at the SAME isolated worker schema, so
 * two racing transactions genuinely overlap. A barrier harness decorates the
 * repo passed to the engine commands so the test controller can fix
 * T1-before-T2 ordering at the operationId pre-read, and observe the REAL
 * 23505 the loser throws on `insertAssignment` (active-unique) or
 * `appendEvent` (events operation-unique). The production recovery wrapper is
 * unchanged — the decoration lives in the test.
 *
 * The one-shot gate wrappers are built once per racer (outside the transaction
 * callback) so they survive `executeInTransaction`'s 40001/40P01 auto-retry:
 * the repo is recreated inside `run(tx)` on each attempt, but the frozen
 * `onceAsync` wrappers are not.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { IdempotencyConflictError } from "@exam/domain";
import { and, eq } from "drizzle-orm";
import { createAuditLogWriter } from "@exam/db/src/repository/auditLogRepo.js";
import { createProctorAssignmentRepo } from "@exam/db/src/repository/proctorAssignmentRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import type { Database } from "@exam/db/src/types.js";
import {
  assignProctorToExam,
  revokeProctorFromExam,
  isConstraintViolation,
  PROCTOR_ASSIGNMENT_ACTIVE_UNIQUE_CONSTRAINT,
  PROCTOR_ASSIGNMENT_EVENTS_OPERATION_UNIQUE_CONSTRAINT,
  type ProctorAssignmentRepo,
} from "@exam/exam-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formLoserReceipt,
  withProctorAssignmentOperationRecovery,
} from "./proctorAssignmentOperationRecovery.js";
import { collectConnectionEvidence } from "../testing/operatorGrantConcurrencyHarness.js";
import {
  createProctorRaceBarrier,
  onceAsync,
  wrapRepoForRace,
  type ProctorRaceHooks,
} from "../testing/proctorAssignmentConcurrencyHarness.js";
import { createDeferred } from "../testing/barrier.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

/**
 * Runs all teardown steps and fails the test if ANY errored, instead of
 * swallowing every error with `.catch(() => {})`.
 */
async function teardownAll(
  ...steps: Array<() => Promise<unknown>>
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `teardown failed with ${errors.length} error(s): ` +
        errors.map((e) => String(e)).join(" | "),
    );
  }
}

describe("proctor assignment concurrency (ADR-015 §7)", () => {
  // Two racing pools + one setup/assertion pool, all on the same schema.
  let db1: Database;
  let db2: Database;
  let db: Database;
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };
  let sqlSetup: { end(): Promise<void> };
  let cleanup: () => Promise<void>;
  let organizationId: string;
  let adminId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "proctor-assignment-concurrency",
      databaseUrl: resolveTestDbUrl(),
    });
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connSetup = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    db1 = conn1.db;
    db2 = conn2.db;
    db = connSetup.db;
    sql1 = conn1.sql;
    sql2 = conn2.sql;
    sqlSetup = connSetup.sql;

    // Migrate once — all three connections share the same schema.
    await withTestInfraLifecycleLock(iso.databaseUrl, () =>
      migratePostgres(connSetup.db, { migrationsSchema: iso.schemaName }),
    );

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

    cleanup = async () => {
      await teardownAll(
        () => sql1.end(),
        () => sql2.end(),
        () => sqlSetup.end(),
        () => iso.cleanup(),
      );
    };
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  const NOW = new Date("2026-02-01T00:00:00.000Z");

  /** Fresh (exam, proctor) pair for one race — no state shared across tests. */
  async function newExamProctor(suffix: string): Promise<{
    examId: string;
    proctorId: string;
    payload: {
      examId: string;
      proctorUserId: string;
      reasonCode: string | null;
    };
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

  /**
   * Builds a runner whose inner repo is decorated with race hooks. The one-shot
   * gate wrappers are frozen once per racer (outside the transaction callback),
   * so they survive `executeInTransaction`'s 40001/40P01 auto-retry. Pass
   * `hooks = undefined` to run on the un-decorated production path.
   */
  function raceRunner(
    racerDb: Database,
    examId: string,
    proctorId: string,
    operationId: string,
    hooks: ProctorRaceHooks | undefined,
    kind: "assign" | "revoke",
    now: Date = NOW,
    reasonCode: string | null = null,
  ) {
    const afterOp = onceAsync(hooks?.afterOperationLookupAbsent);
    const afterAct = onceAsync(hooks?.afterActiveLookupAbsent);
    const beforeRrt = onceAsync(hooks?.beforeResolveRevokeTarget);
    const afterRrt = onceAsync(hooks?.afterResolveRevokeTarget);
    return (tx: Database) => {
      const rawRepo = createProctorAssignmentRepo(
        tx,
      ) as unknown as ProctorAssignmentRepo;
      const repo = hooks
        ? wrapRepoForRace(rawRepo, {
            afterOperationLookupAbsent: afterOp,
            afterActiveLookupAbsent: afterAct,
            beforeResolveRevokeTarget: beforeRrt,
            afterResolveRevokeTarget: afterRrt,
            ...(hooks.onInsertAssignmentError
              ? { onInsertAssignmentError: hooks.onInsertAssignmentError }
              : {}),
            ...(hooks.onAppendEventError
              ? { onAppendEventError: hooks.onAppendEventError }
              : {}),
          })
        : rawRepo;
      const deps = {
        now,
        audit: async (action: string, metadata: Record<string, unknown>) => {
          await createAuditLogWriter(tx).insert(ctx, {
            actorId: ctx.actorId,
            action,
            targetType: "exam",
            targetId: examId,
            metadata,
          });
        },
      };
      if (kind === "assign") {
        return assignProctorToExam(
          repo,
          ctx,
          { operationId, examId, proctorUserId: proctorId, reasonCode },
          {
            ...deps,
            lookupExam: async () => ({ organizationId, id: examId }),
            lookupProctorUser: async (userId) =>
              userId === proctorId
                ? { organizationId, isActive: true, hasActiveProctorRole: true }
                : null,
          },
        );
      }
      return revokeProctorFromExam(
        repo,
        ctx,
        { operationId, examId, proctorUserId: proctorId },
        deps,
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

  it("the two racing connections are distinct PostgreSQL backends on one schema", async () => {
    const ev1 = await collectConnectionEvidence(db1);
    const ev2 = await collectConnectionEvidence(db2);
    expect(ev1.pid).not.toBe(ev2.pid);
    expect(ev1.currentSchema).toBe(ev2.currentSchema);
  });

  // ── Case 1: different-opId concurrent assign → real active-unique 23505 ──

  it("concurrent assign with DIFFERENT operationIds → one applied + one no_change, one active episode, two durable receipts, one audit", async () => {
    const { examId, proctorId, payload } = await newExamProctor("diff-op");
    const op1 = randomUUID();
    const op2 = randomUUID();
    const barrier = createProctorRaceBarrier();

    // T2 records the real 23505 from its `insertAssignment`.
    let t2Error: unknown = null;
    const hooks1: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t1OpAbsent.resolve({ label: "T1", operationId: op1 });
        await barrier.releaseT1.promise;
      },
    };
    const hooks2: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t2OpAbsent.resolve({ label: "T2", operationId: op2 });
        await barrier.releaseT2.promise;
      },
      onInsertAssignmentError: (error) => {
        t2Error = error;
        barrier.activeUniqueViolation.resolve({ label: "T2", error });
      },
    };

    const t1Promise = withProctorAssignmentOperationRecovery(
      db1,
      ctx,
      op1,
      "assign",
      payload,
      NOW,
      raceRunner(db1, examId, proctorId, op1, hooks1, "assign"),
    );
    const t2Promise = withProctorAssignmentOperationRecovery(
      db2,
      ctx,
      op2,
      "assign",
      payload,
      NOW,
      raceRunner(db2, examId, proctorId, op2, hooks2, "assign"),
    );

    try {
      // Both pre-reads return absent → both release gates armed.
      const t1Obs = await barrier.t1OpAbsent.promise;
      const t2Obs = await barrier.t2OpAbsent.promise;
      expect(t1Obs.operationId).toBe(op1);
      expect(t2Obs.operationId).toBe(op2);

      // Release T1; await its commit (post-commit signal).
      barrier.releaseT1.resolve();
      const r1 = await t1Promise;
      expect(r1.outcome).toBe("applied");

      // Release T2; its INSERT must hit the real active-unique 23505.
      barrier.releaseT2.resolve();
      const r2 = await t2Promise;
      expect(r2.outcome).toBe("no_change");

      // The real 23505 evidence (production matcher classifies it).
      const violation = await barrier.activeUniqueViolation.promise;
      expect(
        isConstraintViolation(
          violation.error,
          PROCTOR_ASSIGNMENT_ACTIVE_UNIQUE_CONSTRAINT,
        ),
      ).toBe(true);
      expect(t2Error).toBe(violation.error);

      // Both resolve to the SAME active episode.
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
      for (const e of events) {
        expect(e.assignmentId).toBe(r1.assignment.id);
      }
      expect(await countAuditRows("exam.proctor_assigned", examId)).toBe(1);
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }
  }, 30_000);

  // ── Case 2a: same-opId concurrent assign → real events operation-unique 23505 ──

  it("concurrent assign with the SAME operationId (replay) → one applied + one idempotent_replayed, ONE receipt, ONE audit", async () => {
    const { examId, proctorId, payload } = await newExamProctor("same-op");
    // Pre-build an active E1 so neither racer creates an assignment (the
    // active-unique is never involved). Both append no_change events for the
    // same operationId; the second appends → events operation-unique 23505.
    const seedOp = randomUUID();
    await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      seedOp,
      "assign",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, seedOp, undefined, "assign"),
    );

    const op = randomUUID();
    const barrier = createProctorRaceBarrier();

    const hooks1: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t1OpAbsent.resolve({ label: "T1", operationId: op });
        await barrier.releaseT1.promise;
      },
    };
    const hooks2: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t2OpAbsent.resolve({ label: "T2", operationId: op });
        await barrier.releaseT2.promise;
      },
      onAppendEventError: (error) => {
        barrier.eventUniqueViolation.resolve({ label: "T2", error });
      },
    };

    const t1Promise = withProctorAssignmentOperationRecovery(
      db1,
      ctx,
      op,
      "assign",
      payload,
      NOW,
      raceRunner(db1, examId, proctorId, op, hooks1, "assign"),
    );
    const t2Promise = withProctorAssignmentOperationRecovery(
      db2,
      ctx,
      op,
      "assign",
      payload,
      NOW,
      raceRunner(db2, examId, proctorId, op, hooks2, "assign"),
    );

    try {
      await barrier.t1OpAbsent.promise;
      await barrier.t2OpAbsent.promise;

      barrier.releaseT1.resolve();
      const r1 = await t1Promise;
      expect(r1.outcome).toBe("no_change"); // both see the pre-built E1

      barrier.releaseT2.resolve();
      // T2's no_change append hits the events operation-unique 23505 → recovery
      // reruns the command → pre-read finds the committed event → replay.
      const r2 = await t2Promise;

      // The real events operation-unique 23505 evidence.
      const violation = await barrier.eventUniqueViolation.promise;
      expect(
        isConstraintViolation(
          violation.error,
          PROCTOR_ASSIGNMENT_EVENTS_OPERATION_UNIQUE_CONSTRAINT,
        ),
      ).toBe(true);

      // Final outcome: both replay the seed E1 (both no_change for the same op).
      expect([r1.outcome, r2.outcome].sort()).toEqual([
        "idempotent_replayed",
        "no_change",
      ]);
      expect(r1.assignment.id).toBe(r2.assignment.id);

      // Exactly ONE receipt for the racing operationId.
      const events = await eventsByOpIds([op]);
      expect(events).toHaveLength(1);
      expect(
        ["no_change", "idempotent_replayed"].includes(events[0]!.outcome),
      ).toBe(true);
      expect(await countAuditRows("exam.proctor_assigned", examId)).toBe(1);
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }
  }, 30_000);

  // ── Case 2b: same-opId, different canonical payload → IdempotencyConflict ──

  it("concurrent assign with the SAME operationId but DIFFERENT reasonCode → loser throws IdempotencyConflictError", async () => {
    const { examId, proctorId } = await newExamProctor("same-op-conflict");
    // Pre-build an active E1.
    const seedPayload = {
      examId,
      proctorUserId: proctorId,
      reasonCode: null,
    };
    const seedOp = randomUUID();
    await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      seedOp,
      "assign",
      seedPayload,
      NOW,
      raceRunner(db, examId, proctorId, seedOp, undefined, "assign"),
    );

    // Same operationId, but two different reasonCodes → two different canonical
    // payloads. Only the payload difference is under test; no new assignment.
    const op = randomUUID();
    const payloadA = { examId, proctorUserId: proctorId, reasonCode: "a" };
    const payloadB = { examId, proctorUserId: proctorId, reasonCode: "b" };
    const barrier = createProctorRaceBarrier();

    const hooks1: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t1OpAbsent.resolve({ label: "T1", operationId: op });
        await barrier.releaseT1.promise;
      },
    };
    const hooks2: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t2OpAbsent.resolve({ label: "T2", operationId: op });
        await barrier.releaseT2.promise;
      },
      onAppendEventError: (error) => {
        barrier.eventUniqueViolation.resolve({ label: "T2", error });
      },
    };

    const t1Promise = withProctorAssignmentOperationRecovery(
      db1,
      ctx,
      op,
      "assign",
      payloadA,
      NOW,
      raceRunner(db1, examId, proctorId, op, hooks1, "assign", NOW, "a"),
    );
    const t2Promise = withProctorAssignmentOperationRecovery(
      db2,
      ctx,
      op,
      "assign",
      payloadB,
      NOW,
      raceRunner(db2, examId, proctorId, op, hooks2, "assign", NOW, "b"),
    );

    try {
      await barrier.t1OpAbsent.promise;
      await barrier.t2OpAbsent.promise;

      barrier.releaseT1.resolve();
      const r1 = await t1Promise;
      expect(r1.outcome).toBe("no_change");

      barrier.releaseT2.resolve();
      // T2 loses the event append; fresh lookup sees a committed event with a
      // DIFFERENT canonical payload → IdempotencyConflictError.
      let t2Resolved = false;
      let t2Error: unknown = null;
      try {
        await t2Promise;
        t2Resolved = true;
      } catch (err) {
        t2Error = err;
      }
      expect(t2Resolved, "T2 unexpectedly succeeded").toBe(false);
      expect(t2Error).toBeInstanceOf(IdempotencyConflictError);
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }
  }, 30_000);

  // ── Case: concurrent revoke → real FOR UPDATE lock race + 40001 retry ──

  it("concurrent revoke with DIFFERENT operationIds → one applied + one no_change, one audit", async () => {
    const { examId, proctorId, payload } = await newExamProctor("revoke");
    // Pre-build an active E1 to revoke.
    const seedOp = randomUUID();
    await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      seedOp,
      "assign",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, seedOp, undefined, "assign"),
    );

    const op1 = randomUUID();
    const op2 = randomUUID();
    const barrier = createProctorRaceBarrier();

    const hooks1: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t1OpAbsent.resolve({ label: "T1", operationId: op1 });
        await barrier.releaseT1.promise;
      },
      afterResolveRevokeTarget: async () => {
        // T1 now holds the FOR UPDATE lock; pause so T2 blocks behind it.
        barrier.t1HoldingLock.resolve();
        await barrier.releaseT1Lock.promise;
      },
    };
    const hooks2: ProctorRaceHooks = {
      afterOperationLookupAbsent: async () => {
        barrier.t2OpAbsent.resolve({ label: "T2", operationId: op2 });
        await barrier.releaseT2.promise;
      },
      beforeResolveRevokeTarget: async () => {
        barrier.t2LockStarted.resolve();
      },
    };

    const t1Promise = withProctorAssignmentOperationRecovery(
      db1,
      ctx,
      op1,
      "revoke",
      payload,
      NOW,
      raceRunner(db1, examId, proctorId, op1, hooks1, "revoke"),
    );
    const t2Promise = withProctorAssignmentOperationRecovery(
      db2,
      ctx,
      op2,
      "revoke",
      payload,
      NOW,
      raceRunner(db2, examId, proctorId, op2, hooks2, "revoke"),
    );

    try {
      await barrier.t1OpAbsent.promise;
      await barrier.t2OpAbsent.promise;

      // Release T1: it resolves the target and takes FOR UPDATE, then pauses.
      barrier.releaseT1.resolve();
      await barrier.t1HoldingLock.promise;

      // Release T2: it enters resolveRevokeTarget and blocks on FOR UPDATE.
      barrier.releaseT2.resolve();
      await barrier.t2LockStarted.promise;

      // Let T1 commit its revoke. T2's old RR snapshot hits the revoked row →
      // 40001 → auto-retry → new snapshot sees revoked E1 → no_change.
      barrier.releaseT1Lock.resolve();
      const [r1, r2] = await Promise.all([t1Promise, t2Promise]);

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
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }
  }, 30_000);

  // ── Recovery snapshot: Test A — a reassignment committed BEFORE the recovery
  // snapshot is selected. ─────────────────────────────────────────────────────

  it("recovery binds to a reassignment visible in its RR snapshot (Test A: E2 visible)", async () => {
    const { examId, proctorId, payload } = await newExamProctor("snap-visible");
    const e1Op = randomUUID();
    const revokeOp = randomUUID();
    const e2Op = randomUUID();
    const loserOp = randomUUID();

    // E1 assign → commit.
    const e1 = await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      e1Op,
      "assign",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, e1Op, undefined, "assign"),
    );
    expect(e1.outcome).toBe("applied");

    // Revoke E1 → commit, then assign E2 → commit — all BEFORE recovery.
    await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      revokeOp,
      "revoke",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, revokeOp, undefined, "revoke"),
    );
    const e2 = await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      e2Op,
      "assign",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, e2Op, undefined, "assign"),
    );
    expect(e2.outcome).toBe("applied");
    expect(e2.assignment.id).not.toBe(e1.assignment.id);

    // Recovery snapshot is established AFTER E2 committed → E2 visible & active.
    const recovery = await formLoserReceipt(
      db,
      ctx,
      loserOp,
      "assign",
      payload,
      NOW,
    );
    expect(recovery.outcome).toBe("no_change");
    expect(recovery.assignment.id).toBe(e2.assignment.id);
    expect(recovery.assignment.status).toBe("active");
  });

  // ── Recovery snapshot: Test B — E1 revoked before the snapshot, E2 assigned
  // after the snapshot. Active lookup is absent; fallback resolves revoked E1;
  // E2 is invisible. ──────────────────────────────────────────────────────────

  it("recovery falls back to a revoked episode when a later reassignment is invisible to its RR snapshot (Test B: E2 invisible)", async () => {
    const { examId, proctorId, payload } =
      await newExamProctor("snap-invisible");
    const e1Op = randomUUID();
    const revokeOp = randomUUID();
    const e2Op = randomUUID();
    const loserOp = randomUUID();

    // E1 assign → commit, then revoke E1 → commit — all BEFORE recovery.
    const e1 = await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      e1Op,
      "assign",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, e1Op, undefined, "assign"),
    );
    await withProctorAssignmentOperationRecovery(
      db,
      ctx,
      revokeOp,
      "revoke",
      payload,
      NOW,
      raceRunner(db, examId, proctorId, revokeOp, undefined, "revoke"),
    );

    // R starts recovery on db1. The SQL-free seam fires AFTER the event lookup
    // returns absent (RR snapshot established) and BEFORE the episode lookup,
    // pausing recovery so W can commit E2 after the snapshot.
    const resumeRecovery = createDeferred<void>("resume recovery");
    const recoveryPausedAfterSnapshot = createDeferred<void>(
      "recovery paused after snapshot",
    );
    const hooks = {
      afterOperationLookupAbsent: async () => {
        recoveryPausedAfterSnapshot.resolve();
        await resumeRecovery.promise;
      },
    };

    const recoveryPromise = formLoserReceipt(
      db1,
      ctx,
      loserOp,
      "assign",
      payload,
      NOW,
      hooks,
    );

    try {
      // Wait until R's event lookup has returned absent (snapshot established).
      await recoveryPausedAfterSnapshot.promise;

      // W commits E2 AFTER R's snapshot — E2 must be invisible to R.
      const e2 = await withProctorAssignmentOperationRecovery(
        db2,
        ctx,
        e2Op,
        "assign",
        payload,
        NOW,
        raceRunner(db2, examId, proctorId, e2Op, undefined, "assign"),
      );
      expect(e2.outcome).toBe("applied");
      expect(e2.assignment.status).toBe("active");

      // Resume R: active lookup is absent (E2 invisible), fallback resolves
      // revoked E1 (most-recent visible episode by created_at DESC, id DESC).
      resumeRecovery.resolve();
      const recovery = await recoveryPromise;
      expect(recovery.outcome).toBe("no_change");
      expect(recovery.assignment.id).toBe(e1.assignment.id);
      expect(recovery.assignment.status).toBe("revoked");
    } finally {
      resumeRecovery.resolve();
      recoveryPausedAfterSnapshot.resolve();
      await Promise.allSettled([recoveryPromise]);
    }
  }, 30_000);

  // ── Negative: an unrelated 23505 is never swallowed by the recovery ──

  it("an unrelated 23505 is surfaced, never swallowed by the recovery", async () => {
    await expect(
      withProctorAssignmentOperationRecovery(
        db,
        ctx,
        randomUUID(),
        "assign",
        { examId: randomUUID(), proctorUserId: randomUUID(), reasonCode: null },
        NOW,
        async (tx) => {
          // Insert INSIDE the transaction (same connection — the outer db here
          // would queue behind the open tx and deadlock).
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
