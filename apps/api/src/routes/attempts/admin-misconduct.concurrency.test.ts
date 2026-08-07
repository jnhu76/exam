/**
 * J5-I1C Slice 3 — Deterministic PostgreSQL Misconduct-Mark Concurrency
 * Verification (the §8 experiment gate, recorded).
 *
 * Proves, against the SAME production entrypoint the HTTP route uses
 * (`misconductMarkWithOperationRaceRecovery` from
 * `orchestrators/misconductMarkExecution.ts`), the frozen race matrices of the
 * J5-I1C0 audit §5.2/§7/§9.3 for misconduct-mark. The §8 experiment
 * (2026-08-07, PostgreSQL 18, REPEATABLE READ, two physical connections, true
 * overlap) RECORDED that two concurrent marks on the SAME attempt each leave a
 * durable append receipt and serialize on the `exam_attempts FOR UPDATE` lock;
 * the loser's projection write 40001-fails under RR and `executeInTransaction`
 * auto-retries, re-reading the committed projection and overwriting on its own
 * success. This test encodes that recorded behavior as Matrix A.
 *
 *   A. same Attempt, different operationIds → both `applied` (append receipts
 *      do not collide — the arbiter is `(organization_id, operation_id)`, not
 *      per-attempt); the projection serializes via `FOR UPDATE`; 2 receipts,
 *      2 audits, deterministic final projection (commit-order last writer).
 *   B. same Attempt, same operationId, same canonical payload → T2's receipt
 *      INSERT hits the REAL 23505 on `attempt_command_receipts_org_operation_unique`
 *      and recovers in a FRESH transaction; winner fact == replay fact
 *      byte-for-byte; 1 receipt, 1 audit.
 *   C. same Attempt, same operationId, different payload → 409
 *      IDEMPOTENCY_CONFLICT; 1 receipt, 1 audit.
 *   D. different Attempts, same operationId (NO shared row lock) → the loser
 *      BLOCKS on the uncommitted unique-index entry, gets the REAL 23505, its
 *      WHOLE primary transaction rolls back; attempt B untouched; recovery
 *      classifies attempt_id conflict → IdempotencyConflictError.
 *   E. commit + lost response → a fresh call with the same operationId returns
 *      `idempotent_replay` with the original stored fact.
 *
 * Plus failure-atomicity faults: an injected exception after the receipt
 * insert rolls back receipt + projection + audit together.
 *
 * Uses two physical PostgreSQL connections (verified distinct PIDs + same
 * isolated schema), explicit barrier/latch coordination on the production
 * observer hooks, and real pid/txid + SQLSTATE/constraint extracted from the
 * caught error — no randomized retry loops, no reimplemented transaction.
 *
 * @see docs/audits/J5-I1C0-DANGEROUS-COMMAND-IDENTITY-REALITY-AUDIT.md §5.2/§7/§9.3
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Permission, RequestContext, Role } from "@exam/domain";
import { IdempotencyConflictError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { createDeferred } from "../../testing/barrier.js";
import type { Deferred } from "../../testing/barrier.js";
import { collectConnectionEvidence } from "../../testing/operatorGrantConcurrencyHarness.js";
import {
  misconductMarkWithOperationRaceRecoveryTestOnly as misconductMarkWithOperationRaceRecovery,
  type MisconductMarkExecutionObserver,
} from "../../orchestrators/misconductMarkExecution.js";
import { ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT } from "../../orchestrators/attemptCommandReceiptExecution.js";
import {
  countMisconductAudits as countMisconductAuditsFor,
  listReceipts as listReceiptsFor,
} from "./attempts.testHelpers.js";

const TEST_PREFIX = "j5-i1c-mm-";

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

/**
 * Barrier for the deterministic misconduct races. Mirrors the force-submit
 * barrier model (T1 inserts its receipt then HOLDS ITS TRANSACTION OPEN via
 * `afterReceiptInsert` awaiting `releaseT1Commit`), so T2 starts a genuinely
 * concurrent transaction while T1 is still uncommitted. A third observer
 * connection probes `pg_locks` to PROVE T2 is really blocked.
 */
interface MisconductRaceBarrier {
  t1ReadAbsent: Deferred<{
    label: string;
    operationId: string;
    attemptId: string;
  }>;
  t2ReadAbsent: Deferred<{
    label: string;
    operationId: string;
    attemptId: string;
  }>;
  releaseT1: Deferred<void>;
  t1AfterReceiptInsert: Deferred<{
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }>;
  releaseT1Commit: Deferred<void>;
  t1PrimaryCommitted: Deferred<{ pid: number; txid: string }>;
  releaseT2: Deferred<void>;
  t2BeforeReceiptInsert: Deferred<{
    pid: number;
    txid: string;
    severity: string;
    notes: string;
  }>;
  /** Fires on T2's FIRST primary transaction attempt (proves T2 entered its txn while T1 was still open). */
  t2StartedTx: Deferred<{ pid: number; txid: string }>;
  t2UniqueViolation: Deferred<{
    code: string;
    constraint: string;
    pid: number;
    txid: string;
  }>;
  t2RecoveryStarted: Deferred<{ pid: number; txid: string }>;
  t2TransactionAttempts: Deferred<
    Array<{ phase: string; attempt: number; pid: number; txid: string }>
  >;
  dispose(): void;
}

function createMisconductRaceBarrier(): MisconductRaceBarrier {
  const deferreds = {
    t1ReadAbsent: createDeferred<{
      label: string;
      operationId: string;
      attemptId: string;
    }>("T1 read absent"),
    t2ReadAbsent: createDeferred<{
      label: string;
      operationId: string;
      attemptId: string;
    }>("T2 read absent"),
    releaseT1: createDeferred<void>("release T1"),
    t1AfterReceiptInsert: createDeferred<{
      pid: number;
      txid: string;
      operationId: string;
      attemptId: string;
    }>("T1 after receipt insert (txn open)"),
    releaseT1Commit: createDeferred<void>("release T1 commit"),
    t1PrimaryCommitted: createDeferred<{ pid: number; txid: string }>(
      "T1 committed",
    ),
    releaseT2: createDeferred<void>("release T2"),
    t2BeforeReceiptInsert: createDeferred<{
      pid: number;
      txid: string;
      severity: string;
      notes: string;
    }>("T2 before receipt insert"),
    t2StartedTx: createDeferred<{ pid: number; txid: string }>(
      "T2 started txn",
    ),
    t2UniqueViolation: createDeferred<{
      code: string;
      constraint: string;
      pid: number;
      txid: string;
    }>("T2 unique violation"),
    t2RecoveryStarted: createDeferred<{ pid: number; txid: string }>(
      "T2 recovery started",
    ),
    t2TransactionAttempts: createDeferred<
      Array<{ phase: string; attempt: number; pid: number; txid: string }>
    >("T2 transaction attempts"),
  };
  return {
    ...deferreds,
    dispose() {
      for (const d of Object.values(deferreds)) {
        if (!d.isSettled()) {
          d.resolve("barrier disposed" as never);
        }
      }
    },
  };
}

function createBarrierBackedMisconductObserver(
  barrier: MisconductRaceBarrier,
  label: "T1" | "T2",
  operationId: string,
  attemptId: string,
  holdT1OpenForOverlap = false,
): MisconductMarkExecutionObserver {
  const t2Attempts: Array<{
    phase: string;
    attempt: number;
    pid: number;
    txid: string;
  }> = [];
  const flushT2Attempts = (() => {
    let flushed = false;
    return () => {
      if (flushed) return;
      flushed = true;
      barrier.t2TransactionAttempts.resolve([...t2Attempts]);
    };
  })();
  return {
    afterOperationLookupAbsent: async (obs) => {
      if (obs.operationId !== operationId) return;
      const observation = {
        label: obs.label,
        operationId: obs.operationId,
        attemptId: obs.attemptId,
      };
      if (label === "T1") {
        barrier.t1ReadAbsent.resolve(observation);
        await barrier.releaseT1.promise;
      } else {
        barrier.t2ReadAbsent.resolve(observation);
        await barrier.releaseT2.promise;
      }
    },
    afterReceiptInsert: async (obs) => {
      if (label === "T1" && holdT1OpenForOverlap) {
        barrier.t1AfterReceiptInsert.resolve({
          pid: obs.pid,
          txid: obs.txid,
          operationId: obs.operationId,
          attemptId: obs.attemptId,
        });
        await barrier.releaseT1Commit.promise;
      }
    },
    beforeReceiptInsert: async (obs) => {
      if (label === "T2") {
        barrier.t2BeforeReceiptInsert.resolve({
          pid: obs.pid,
          txid: obs.txid,
          severity: obs.severity,
          notes: obs.notes,
        });
      }
    },
    onTransactionAttempt: async (obs) => {
      if (label === "T2") {
        t2Attempts.push({
          phase: obs.phase,
          attempt: obs.attempt,
          pid: obs.pid,
          txid: obs.txid,
        });
        if (obs.phase === "primary" && obs.attempt === 1) {
          barrier.t2StartedTx.resolve({ pid: obs.pid, txid: obs.txid });
        }
      }
    },
    onPrimaryCommitted: async (obs) => {
      if (obs.label === "T1") {
        barrier.t1PrimaryCommitted.resolve({ pid: obs.pid, txid: obs.txid });
      } else if (obs.label === "T2") {
        flushT2Attempts();
      }
    },
    onUniqueViolation: async (obs) => {
      barrier.t2UniqueViolation.resolve({
        code: obs.code,
        constraint: obs.constraint,
        pid: obs.pid,
        txid: obs.txid,
      });
      flushT2Attempts();
    },
    onRecoveryTransaction: async (obs) => {
      barrier.t2RecoveryStarted.resolve({ pid: obs.pid, txid: obs.txid });
    },
  };
}

describe("J5-I1C Slice 3: deterministic misconduct-mark operationId races", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let db2: Database;
  let end1: () => Promise<void>;
  let end2: () => Promise<void>;

  beforeAll(async () => {
    const testDbUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.TEST_DB_URL ??
      (() => {
        throw new Error("TEST_DATABASE_URL or TEST_DB_URL must be set");
      })();
    iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: testDbUrl,
    });
    ctx = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName },
    );
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = conn1.db;
    db2 = conn2.db;
    end1 = async () => {
      await conn1.sql.end();
    };
    end2 = async () => {
      await conn2.sql.end();
    };
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => end2(),
      () => end1(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  function fakeAuditRequest(): FastifyRequest {
    return {
      id: `mm-race-${randomUUID()}`,
      headers: {},
      ip: undefined,
    } as unknown as FastifyRequest;
  }

  interface TestOrgFixture {
    adminCtx: RequestContext;
    adminToken: string;
    candidateToken: string;
    candidateProfileId: string;
    courseId: string;
    questionId: string;
  }

  async function createOrg(): Promise<TestOrgFixture> {
    const slug = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;
    const now = new Date();
    const org = (
      await ctx.db
        .insert(schema.organizations)
        .values({
          id: randomUUID(),
          name: slug,
          displayName: slug,
          slug,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const passwordHash = await hashPassword("password123");
    const adminId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: adminId,
      organizationId: org.id,
      username: `admin-${slug}`,
      passwordHash,
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: adminId,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const { jwtSecret } = getRuntimeConfig().authSecret;
    const adminToken = signJWT(
      { actorId: adminId, role: "Admin" as Role, organizationId: org.id },
      jwtSecret,
    );
    const course = (
      await ctx.db
        .insert(schema.courses)
        .values({
          id: randomUUID(),
          organizationId: org.id,
          name: `Course ${slug}`,
          code: `C-${slug}`,
          description: "",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const question = (
      await ctx.db
        .insert(schema.questions)
        .values({
          id: randomUUID(),
          organizationId: org.id,
          courseId: course.id,
          type: "single_choice",
          content: "test",
          options: [
            { id: "a", content: "1" },
            { id: "b", content: "2" },
          ],
          standardAnswer: "a",
          attachments: [],
          score: 100,
          difficulty: 1,
          tags: [],
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const candidateId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: candidateId,
      organizationId: org.id,
      username: `cand-${slug}`,
      passwordHash,
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: candidateId,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const profile = (
      await ctx.db
        .insert(schema.candidateProfiles)
        .values({
          id: randomUUID(),
          organizationId: org.id,
          userId: candidateId,
          fields: {},
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const candidateToken = signJWT(
      {
        actorId: candidateId,
        role: "Candidate" as Role,
        organizationId: org.id,
      },
      jwtSecret,
    );
    const adminCtx: RequestContext = {
      actorId: adminId,
      organizationId: org.id,
      role: "Admin",
      permissions: [] as Permission[],
      sessionId: "j5-i1c-mm",
      targetOrganizationId: org.id,
    };
    return {
      adminCtx,
      adminToken,
      candidateToken,
      candidateProfileId: profile.id,
      courseId: course.id,
      questionId: question.id,
    };
  }

  async function createAttemptInOrg(
    t: TestOrgFixture,
    examTitle: string,
  ): Promise<{ attemptId: string }> {
    const now = new Date();
    const exam = (
      await ctx.db
        .insert(schema.exams)
        .values({
          id: randomUUID(),
          organizationId: t.adminCtx.organizationId,
          title: examTitle,
          description: "",
          courseId: t.courseId,
          status: "open",
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(now.getTime() - 3600000),
          closeAt: new Date(now.getTime() + 86400000),
          passingScore: 60,
          totalScore: 100,
          questionSelectionMode: "manual",
          questionIds: [t.questionId],
          questionSnapshot: [
            {
              originalQuestionId: t.questionId,
              type: "single_choice",
              content: "test",
              attachments: [],
              options: [
                { id: "a", content: "1" },
                { id: "b", content: "2" },
              ],
              standardAnswer: "a",
              score: 100,
              gradingRule: {
                multiSelectScoring: "all_correct_full",
                fillBlankMatchMode: "exact",
              },
              order: 1,
              rubric: null,
            },
          ],
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
          maxAttempts: 10,
          interruptionTimePolicy: "operator_incident",
          interruptionGracePerIncidentSeconds: null,
          interruptionGracePerAttemptSeconds: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${exam.id}/enrollments`,
      payload: { candidateIds: [t.candidateProfileId] },
      cookies: { "auth-token": t.adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${exam.id}/start`,
      cookies: { "auth-token": t.candidateToken },
    });
    if (startRes.statusCode !== 201)
      throw new Error(
        `Failed to start attempt: ${startRes.statusCode} ${startRes.body}`,
      );
    return { attemptId: startRes.json().id as string };
  }

  async function createOrgAndAttempt(
    examTitle: string,
  ): Promise<{ adminCtx: RequestContext; attemptId: string }> {
    const t = await createOrg();
    const { attemptId } = await createAttemptInOrg(t, examTitle);
    return { adminCtx: t.adminCtx, attemptId };
  }

  // Shared helpers (SQL-filtered action, oldest-first receipts) bound to the
  // suite's ctx so call sites stay unchanged.
  const listReceipts = (attemptId: string) => listReceiptsFor(ctx, attemptId);
  const countMisconductAudits = (attemptId: string) =>
    countMisconductAuditsFor(ctx, attemptId);

  it("Matrix A: same attempt, different operationIds → both applied, 2 receipts, 2 audits, deterministic projection (true overlap, FOR UPDATE serialization)", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("MM Matrix A");
    const t1Pid = (await collectConnectionEvidence(db1)).pid;
    const t2Pid = (await collectConnectionEvidence(db2)).pid;
    expect(t1Pid).not.toBe(t2Pid);
    const opA = randomUUID();
    const opB = randomUUID();
    const now = new Date();
    const input1 = {
      attemptId,
      operationId: opA,
      severity: "warning" as const,
      notes: "T1 notes",
      now,
    };
    const input2 = {
      attemptId,
      operationId: opB,
      severity: "serious" as const,
      notes: "T2 notes",
      now,
    };

    const barrier = createMisconductRaceBarrier();
    const t1Promise = misconductMarkWithOperationRaceRecovery(
      db1,
      adminCtx,
      input1,
      {
        observer: createBarrierBackedMisconductObserver(
          barrier,
          "T1",
          opA,
          attemptId,
          true,
        ),
        label: "T1",
        audit: { request: fakeAuditRequest() },
      },
    );
    const t2Promise = misconductMarkWithOperationRaceRecovery(
      db2,
      adminCtx,
      input2,
      {
        observer: createBarrierBackedMisconductObserver(
          barrier,
          "T2",
          opB,
          attemptId,
          true,
        ),
        label: "T2",
        audit: { request: fakeAuditRequest() },
      },
    );

    try {
      await barrier.t1ReadAbsent.promise;
      barrier.releaseT1.resolve();
      await barrier.t1AfterReceiptInsert.promise;
      // T1 holds its txn open with the FOR UPDATE row lock + an uncommitted
      // receipt. Now release T2 so it starts its own transaction.
      barrier.releaseT2.resolve();
      // PROVE T2 entered its transaction while T1 is still uncommitted (true
      // overlap). T2 then blocks on findByIdForUpdate (T1 holds the row lock).
      const t2Start = await barrier.t2StartedTx.promise;
      expect(t2Start.txid).not.toBe("");
      // Release T1 so it commits (releases the FOR UPDATE lock). T2 wakes, its
      // first RR attempt 40001-fails, executeInTransaction auto-retries, and
      // T2 re-reads T1's committed projection then proceeds.
      barrier.releaseT1Commit.resolve();
      await barrier.t2BeforeReceiptInsert.promise;
      const [r1, r2] = await Promise.all([t1Promise, t2Promise]);
      expect(r1.disposition).toBe("applied");
      expect(r2.disposition).toBe("applied");

      // PROVE the serialization retry actually happened: T2 has >=2 primary
      // attempts with distinct txids (attempt 1 = 40001 failure, attempt 2 =
      // the executeInTransaction retry that succeeded).
      const t2Attempts = await barrier.t2TransactionAttempts.promise;
      const primaryTxids = t2Attempts
        .filter((a) => a.phase === "primary")
        .map((a) => a.txid);
      expect(new Set(primaryTxids).size).toBeGreaterThanOrEqual(2);

      // Both append receipts survive (the arbiter is (org, operationId), not
      // per-attempt — each operationId is a distinct command).
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(2);
      const ops = receipts.map((r) => r.operationId).sort();
      expect(ops).toEqual([opA, opB].sort());

      // Two audit rows (one per applied mark).
      const audits = await countMisconductAudits(attemptId);
      expect(audits).toHaveLength(2);

      // The projection reflects the LATEST committed applied receipt
      // (commit-order last writer wins, serialized by the FOR UPDATE lock).
      const attempt = await createAttemptRepo(ctx.db).findById(
        adminCtx,
        attemptId,
      );
      expect(attempt?.misconduct).toMatchObject({
        severity: "serious",
        notes: "T2 notes",
      });
    } finally {
      barrier.dispose();
    }
  }, 30_000);

  it("Matrix B: same attempt, same operationId, same payload → applied + idempotent_replay with real 23505 + fresh recovery txid (true overlap)", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("MM Matrix B");
    const operationId = randomUUID();
    const now = new Date();
    const input = {
      attemptId,
      operationId,
      severity: "warning" as const,
      notes: "same payload",
      now,
    };

    const barrier = createMisconductRaceBarrier();
    const t1Promise = misconductMarkWithOperationRaceRecovery(
      db1,
      adminCtx,
      input,
      {
        observer: createBarrierBackedMisconductObserver(
          barrier,
          "T1",
          operationId,
          attemptId,
          true,
        ),
        label: "T1",
        audit: { request: fakeAuditRequest() },
      },
    );
    const t2Promise = misconductMarkWithOperationRaceRecovery(
      db2,
      adminCtx,
      input,
      {
        observer: createBarrierBackedMisconductObserver(
          barrier,
          "T2",
          operationId,
          attemptId,
          true,
        ),
        label: "T2",
        audit: { request: fakeAuditRequest() },
      },
    );

    try {
      await barrier.t1ReadAbsent.promise;
      barrier.releaseT1.resolve();
      await barrier.t1AfterReceiptInsert.promise;
      barrier.releaseT2.resolve();
      // T2 enters its txn (true overlap) then blocks on T1's FOR UPDATE row
      // lock. Release T1 so it commits; T2 wakes, 40001-retries, re-reads the
      // committed attempt, and its receipt INSERT then hits the real 23505 on
      // the shared (organization_id, operation_id) arbiter.
      const t2Start = await barrier.t2StartedTx.promise;
      expect(t2Start.txid).not.toBe("");
      barrier.releaseT1Commit.resolve();

      const [r1, r2] = await Promise.all([t1Promise, t2Promise]);
      expect(r1.disposition).toBe("applied");
      expect(r2.disposition).toBe("idempotent_replay");
      // The replay returns the stored immutable fact byte-for-byte.
      expect(r2.resultPayload).toEqual(r1.resultPayload);
      expect(r2.createdAt).toBe(r1.createdAt);

      // The 23505 was on the exact shared arbiter, recovered in a fresh tx.
      const uv = await barrier.t2UniqueViolation.promise;
      expect(uv.code).toBe("23505");
      expect(uv.constraint).toBe(
        ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT,
      );
      const recovery = await barrier.t2RecoveryStarted.promise;
      expect(recovery.txid).not.toBe(uv.txid);

      // 1 receipt, 1 audit.
      const receipts = await listReceipts(attemptId);
      expect(receipts).toHaveLength(1);
      const audits = await countMisconductAudits(attemptId);
      expect(audits).toHaveLength(1);
    } finally {
      barrier.dispose();
    }
  }, 30_000);

  it("Matrix C: same attempt, same operationId, different payload → 409 IDEMPOTENCY_CONFLICT (1 receipt, 1 audit)", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("MM Matrix C");
    const operationId = randomUUID();
    const now = new Date();
    const first = await misconductMarkWithOperationRaceRecovery(
      db1,
      adminCtx,
      {
        attemptId,
        operationId,
        severity: "warning",
        notes: "first",
        now,
      },
      { audit: { request: fakeAuditRequest() } },
    );
    expect(first.disposition).toBe("applied");

    await expect(
      misconductMarkWithOperationRaceRecovery(
        db2,
        adminCtx,
        {
          attemptId,
          operationId,
          severity: "serious",
          notes: "drift",
          now,
        },
        { audit: { request: fakeAuditRequest() } },
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const receipts = await listReceipts(attemptId);
    expect(receipts).toHaveLength(1);
    const audits = await countMisconductAudits(attemptId);
    expect(audits).toHaveLength(1);
  }, 30_000);

  it("Matrix D: different attempts, same organization, same operationId → loser 23505, full rollback (attempt B untouched, no receipt, no audit)", async () => {
    const t = await createOrg();
    const { attemptId: attemptA } = await createAttemptInOrg(
      t,
      "MM Matrix D A",
    );
    const { attemptId: attemptB } = await createAttemptInOrg(
      t,
      "MM Matrix D B",
    );
    const operationId = randomUUID();
    const now = new Date();

    const barrier = createMisconductRaceBarrier();
    const t1Promise = misconductMarkWithOperationRaceRecovery(
      db1,
      t.adminCtx,
      {
        attemptId: attemptA,
        operationId,
        severity: "warning",
        notes: "on A",
        now,
      },
      {
        observer: createBarrierBackedMisconductObserver(
          barrier,
          "T1",
          operationId,
          attemptA,
          true,
        ),
        label: "T1",
        audit: { request: fakeAuditRequest() },
      },
    );
    const t2Promise = misconductMarkWithOperationRaceRecovery(
      db2,
      t.adminCtx,
      {
        attemptId: attemptB,
        operationId,
        severity: "warning",
        notes: "on B",
        now,
      },
      {
        observer: createBarrierBackedMisconductObserver(
          barrier,
          "T2",
          operationId,
          attemptB,
          true,
        ),
        label: "T2",
        audit: { request: fakeAuditRequest() },
      },
    );

    try {
      await barrier.t1ReadAbsent.promise;
      barrier.releaseT1.resolve();
      await barrier.t1AfterReceiptInsert.promise;
      barrier.releaseT2.resolve();
      await barrier.t2BeforeReceiptInsert.promise;
      barrier.releaseT1Commit.resolve();

      const r1 = await t1Promise;
      expect(r1.disposition).toBe("applied");
      await expect(t2Promise).rejects.toBeInstanceOf(IdempotencyConflictError);

      const uv = await barrier.t2UniqueViolation.promise;
      expect(uv.constraint).toBe(
        ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT,
      );

      // Attempt A: one receipt + one audit (T1 applied).
      const receiptsA = await listReceipts(attemptA);
      expect(receiptsA).toHaveLength(1);
      // Attempt B: untouched (0 receipts, 0 audits, no projection).
      const receiptsB = await listReceipts(attemptB);
      expect(receiptsB).toHaveLength(0);
      const auditsB = await countMisconductAudits(attemptB);
      expect(auditsB).toHaveLength(0);
      const attemptBRow = await createAttemptRepo(ctx.db).findById(
        t.adminCtx,
        attemptB,
      );
      expect(attemptBRow?.misconduct).toBeNull();
    } finally {
      barrier.dispose();
    }
  }, 30_000);

  it("Matrix E: commit + lost response → fresh retry with same operationId returns idempotent_replay", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("MM Matrix E");
    const operationId = randomUUID();
    const now = new Date();
    const first = await misconductMarkWithOperationRaceRecovery(
      db1,
      adminCtx,
      {
        attemptId,
        operationId,
        severity: "warning",
        notes: "first",
        now,
      },
      { audit: { request: fakeAuditRequest() } },
    );
    expect(first.disposition).toBe("applied");

    // Simulate a lost response: the same operationId retried on a fresh call.
    const retry = await misconductMarkWithOperationRaceRecovery(
      db2,
      adminCtx,
      {
        attemptId,
        operationId,
        severity: "warning",
        notes: "first",
        now,
      },
      { audit: { request: fakeAuditRequest() } },
    );
    expect(retry.disposition).toBe("idempotent_replay");
    expect(retry.resultPayload).toEqual(first.resultPayload);
    expect(retry.createdAt).toBe(first.createdAt);

    const receipts = await listReceipts(attemptId);
    expect(receipts).toHaveLength(1);
    const audits = await countMisconductAudits(attemptId);
    expect(audits).toHaveLength(1);
  }, 30_000);

  it("failure atomicity: exception after the receipt insert rolls back receipt + projection + audit", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("MM Atomicity");
    const operationId = randomUUID();
    const now = new Date();
    const boom = new Error("injected fault after receipt insert");
    await expect(
      misconductMarkWithOperationRaceRecovery(
        db1,
        adminCtx,
        {
          attemptId,
          operationId,
          severity: "warning",
          notes: "fault",
          now,
        },
        {
          audit: { request: fakeAuditRequest() },
          observer: {
            afterReceiptInsert: async () => {
              throw boom;
            },
          },
        },
      ),
    ).rejects.toBe(boom);

    // Nothing committed: 0 receipts, 0 audits, projection unchanged.
    const receipts = await listReceipts(attemptId);
    expect(receipts).toHaveLength(0);
    const audits = await countMisconductAudits(attemptId);
    expect(audits).toHaveLength(0);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.misconduct).toBeNull();
  }, 30_000);
});
