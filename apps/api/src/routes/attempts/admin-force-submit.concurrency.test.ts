/**
 * J5-I1C Slice 2 — Deterministic PostgreSQL Force-Submit Concurrency
 * Verification.
 *
 * Proves, against the SAME production entrypoint the HTTP route uses
 * (`forceSubmitWithOperationRaceRecovery` from
 * `orchestrators/forceSubmitExecution.ts`), the five frozen race matrices of
 * the J5-I1C0 audit §7/§14. Each race uses TRUE transaction overlap: T1
 * inserts its receipt and then HOLDS ITS TRANSACTION OPEN (via the
 * `afterReceiptInsert` observer hook awaiting `releaseT1Commit`), so T2
 * starts a genuinely concurrent transaction while T1 is still uncommitted.
 * A THIRD observer connection (`sqlObserver`) probes `pg_locks` to PROVE T2
 * is really blocked on T1 (db1/db2 are max:1 pools held open by the racers,
 * so a probe on them would queue forever).
 *
 *   A. same Attempt, different operationIds → T2 blocks on T1's EA row lock,
 *      then on commit 40001-retries (PROVEN via distinct txids across
 *      attempts) and sees `graded` → one `applied`, one `no_change`; 2 durable
 *      receipts, 1 forceSubmit audit, final `graded`.
 *   B. same Attempt, same operationId, same canonical payload → T2 blocks on
 *      the EA lock, 40001-retries, then its receipt INSERT hits the REAL 23505
 *      on `attempt_command_receipts_org_operation_unique` and recovers in a
 *      FRESH transaction (recovery txid != primary txid); winner fact ==
 *      replay fact byte-for-byte; 1 receipt, 1 audit.
 *   C. same Attempt, same operationId, different payload → 409
 *      IDEMPOTENCY_CONFLICT; 1 receipt, 1 audit. (Serialized T1-then-T2; the
 *      cross-payload conflict is read-time, not an overlap race.)
 *   D. different Attempts, same operationId (NO shared EA lock — the most
 *      important matrix) → T2 BLOCKS on T1's UNCOMMITTED unique-index entry
 *      (a `transactionid`/`tuple` lock, NOT a row lock), then on T1's commit
 *      gets the REAL 23505 → its WHOLE primary transaction rolls back before
 *      the mutation; A2 is untouched; recovery classifies attempt_id conflict
 *      → IdempotencyConflictError.
 *   E. commit + lost response → a fresh call with the same operationId
 *      returns `idempotent_replay` with the original stored fact.
 *
 * Plus the failure-atomicity faults (audit §20): an injected exception after
 * the receipt insert, before the audit write, or after the audit write rolls
 * back receipt + mutation + audit together.
 *
 * Uses two physical PostgreSQL connections (verified distinct PIDs + same
 * isolated schema), explicit barrier/latch coordination on the production
 * observer hooks, and real pid/txid + SQLSTATE/constraint extracted from the
 * caught error — no randomized retry loops, no reimplemented transaction.
 *
 * @see docs/audits/J5-I1C0-DANGEROUS-COMMAND-IDENTITY-REALITY-AUDIT.md §7/§14/§20
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
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
  forceSubmitWithOperationRaceRecoveryTestOnly as forceSubmitWithOperationRaceRecovery,
  type ForceSubmitExecutionObserver,
} from "../../orchestrators/forceSubmitExecution.js";
import { ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT } from "../../orchestrators/attemptCommandReceiptExecution.js";

const TEST_PREFIX = "j5-i1c-fs-";

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

/**
 * Barrier for the deterministic force-submit races. The race model is:
 *
 *  1. both pre-reads resolve `t1ReadAbsent`/`t2ReadAbsent` and gate on
 *     `releaseT1`/`releaseT2` (pure ordering — the pre-read is outside any
 *     txn);
 *  2. T1 enters its transaction, inserts its receipt, then signals
 *     `t1AfterReceiptInsert` and HOLDS ITS TRANSACTION OPEN by awaiting
 *     `releaseT1Commit` (T1 is now holding the EA row lock with an
 *     uncommitted receipt);
 *  3. T2 enters its own transaction (`t2TransactionAttempt` proves it
 *     started while T1 is still uncommitted) and either blocks on the EA
 *     row lock (Matrix A/B — same attempt) or reaches its own receipt
 *     INSERT and blocks on the unique index (Matrix D — different attempt);
 *  4. the test controller asserts via `pg_locks` that T2 is genuinely
 *     blocked, then resolves `releaseT1Commit` → T1 commits → T2 wakes;
 *  5. under REPEATABLE READ T2's first attempt fails with 40001 and
 *     `executeInTransaction` auto-retries; `t2TransactionAttempts` collects
 *     every attempt's pid/txid so the test PROVES the retry happened with a
 *     fresh txid. For Matrix D T2's INSERT hits the real 23505 and the
 *     fresh recovery transaction classifies the winner.
 *
 * The in-transaction hooks (beforeReceiptInsert, onUniqueViolation,
 * onRecoveryTransaction, onPrimaryCommitted) carry the real pid/txid
 * evidence.
 */
interface ForceSubmitRaceBarrier {
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
  /** T1 has inserted its receipt and is now holding its txn OPEN (uncommitted). */
  t1AfterReceiptInsert: Deferred<{
    pid: number;
    txid: string;
    operationId: string;
    attemptId: string;
  }>;
  /** Gate T1 awaits AFTER inserting the receipt, so the test can hold the txn open. */
  releaseT1Commit: Deferred<void>;
  t1PrimaryCommitted: Deferred<{
    pid: number;
    txid: string;
    disposition: string;
  }>;
  releaseT2: Deferred<void>;
  t2BeforeReceiptInsert: Deferred<{
    pid: number;
    txid: string;
    beforeStatus: string;
    plannedOutcome: string;
  }>;
  t2UniqueViolation: Deferred<{
    code: string;
    constraint: string;
    pid: number;
    txid: string;
  }>;
  t2RecoveryStarted: Deferred<{ pid: number; txid: string }>;
  /** Every `onTransactionAttempt` observation for T2 (primary + each retry + recovery). */
  t2TransactionAttempts: Deferred<
    Array<{ phase: string; attempt: number; pid: number; txid: string }>
  >;
  dispose(): void;
}

function createForceSubmitRaceBarrier(): ForceSubmitRaceBarrier {
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
    t1PrimaryCommitted: createDeferred<{
      pid: number;
      txid: string;
      disposition: string;
    }>("T1 committed"),
    releaseT2: createDeferred<void>("release T2"),
    t2BeforeReceiptInsert: createDeferred<{
      pid: number;
      txid: string;
      beforeStatus: string;
      plannedOutcome: string;
    }>("T2 before receipt insert"),
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

/**
 * Builds the barrier-backed {@link ForceSubmitExecutionObserver} for one
 * label (T1/T2). When `holdT1OpenForOverlap` is true, T1's
 * `afterReceiptInsert` hook holds its transaction OPEN by awaiting
 * `releaseT1Commit` — this is the real-overlap mechanism used by Matrices
 * A/B/D. When false (Matrices C/E), T1 commits immediately and the test
 * serializes T1-before-T2 via `t1PrimaryCommitted` (the original model).
 * The other hooks resolve the evidence deferreds with the real
 * in-transaction values from the production module.
 */
function createBarrierBackedForceSubmitObserver(
  barrier: ForceSubmitRaceBarrier,
  label: "T1" | "T2",
  operationId: string,
  attemptId: string,
  holdT1OpenForOverlap = false,
): ForceSubmitExecutionObserver {
  // T2 collects every transaction attempt (primary + each 40001 retry +
  // recovery) so the test can prove a serialization retry happened with a
  // distinct txid. Resolved once, after the racer settles.
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
        // Hold T1's transaction OPEN (receipt inserted, uncommitted) so T2
        // can genuinely overlap. The EA row lock and the uncommitted unique
        // index entry are both held until releaseT1Commit resolves.
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
          beforeStatus: obs.beforeStatus,
          plannedOutcome: obs.plannedOutcome,
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
      }
    },
    onPrimaryCommitted: async (obs) => {
      if (obs.label === "T1") {
        barrier.t1PrimaryCommitted.resolve({
          pid: obs.pid,
          txid: obs.txid,
          disposition: obs.disposition,
        });
      } else if (obs.label === "T2") {
        // T2 committed on a primary attempt (e.g. no_change after retry).
        // By now every primary attempt (including the retry) has fired
        // onTransactionAttempt, so this is the correct flush point.
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
      barrier.t2RecoveryStarted.resolve({
        pid: obs.pid,
        txid: obs.txid,
      });
    },
  };
}

describe("J5-I1C Slice 2: deterministic force-submit operationId races", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let db2: Database;
  let sql1: ObserverSql;
  let sql2: ObserverSql;
  /**
   * A THIRD, independent connection used ONLY as an observer for the
   * real-overlap pg_locks/pg_stat_activity probes. This must NOT be db1/db2
   * because those are max:1 pools: while T1/T2 hold their connection inside
   * an open transaction, any query on the SAME pool would queue behind it
   * and could never observe the wait state. The observer pool stays free.
   */
  let sqlObserver: ObserverSql;

  beforeAll(async () => {
    const testDbUrl = resolveTestDbUrl();
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
    sql1 = conn1.sql;
    sql2 = conn2.sql;
    const connObserver = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    sqlObserver = connObserver.sql;
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => sqlObserver.end(),
      () => sql2.end(),
      () => sql1.end(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  /** Minimal FastifyRequest for the atomic audit writer (test-only). */
  function fakeAuditRequest(): FastifyRequest {
    return {
      id: `fs-race-${randomUUID()}`,
      headers: {},
      ip: undefined,
    } as unknown as FastifyRequest;
  }

  /** Shared per-org fixture data needed to create more attempts in one org. */
  interface TestOrgFixture {
    adminCtx: RequestContext;
    adminToken: string;
    candidateToken: string;
    candidateProfileId: string;
    courseId: string;
    questionId: string;
  }

  /**
   * Creates an isolated org (users, course, question) and returns the shared
   * fixture. Each call is fully self-contained, so matrices never share state.
   */
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
      {
        actorId: adminId,
        role: "Admin" as Role,
        organizationId: org.id,
        authEpoch: 0,
      },
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
        authEpoch: 0,
      },
      jwtSecret,
    );

    const adminCtx: RequestContext = {
      actorId: adminId,
      organizationId: org.id,
      role: "Admin",
      permissions: [] as Permission[],
      sessionId: "j5-i1c-fs",
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

  /**
   * Creates a published exam in the given org and starts an attempt for its
   * candidate, returning the attemptId. Multiple calls with the SAME fixture
   * create multiple attempts in the SAME organization (matrix D needs this —
   * the shared arbiter is organization-scoped).
   */
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
    if (startRes.statusCode !== 201) {
      throw new Error(
        `Failed to start attempt: ${startRes.statusCode} ${startRes.body}`,
      );
    }
    return { attemptId: startRes.json().id as string };
  }

  /** Creates a fresh org + one started attempt (self-contained matrix fixture). */
  async function createOrgAndAttempt(
    examTitle: string,
  ): Promise<{ adminCtx: RequestContext; attemptId: string }> {
    const t = await createOrg();
    const { attemptId } = await createAttemptInOrg(t, examTitle);
    return { adminCtx: t.adminCtx, attemptId };
  }

  async function listReceipts(attemptId: string) {
    return ctx.db
      .select()
      .from(schema.attemptCommandReceipts)
      .where(eq(schema.attemptCommandReceipts.attemptId, attemptId))
      .orderBy(schema.attemptCommandReceipts.createdAt);
  }

  async function countForceSubmitAudits(attemptId: string) {
    await ctx.drainAuditWrites();
    const rows = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetId, attemptId),
          eq(schema.auditLogs.action, "attempt.forceSubmit"),
        ),
      );
    return rows;
  }

  /**
   * The subset of the postgres-js driver surface the overlap probes need.
   * The test declares its connections with this narrow type instead of the
   * full `postgres.Sql` so the probe helpers stay typed without importing
   * the driver's types into the test.
   */
  interface ObserverSql {
    unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
    end(): Promise<void>;
  }

  /**
   * PROOF that `waiterPid` is genuinely blocked inside a DB transaction.
   * Returns the waiter's `wait_event_type`/`wait_event` from
   * `pg_stat_activity` and the count of the granted/blocked locks it holds
   * that prove it has an open transaction (≥1 transactionid lock) plus, when
   * `blockedOnBlockerPid` is set, that it is waiting on something held by
   * that backend. Deterministic — no sleep. Throws if the waiter is not
   * actually in an active transaction (the real-overlap invariant).
   */
  async function snapshotBackendState(
    sql: ObserverSql,
    pid: number,
  ): Promise<{
    active: boolean;
    waitEventType: string | null;
    waitEvent: string | null;
    inTransaction: boolean;
  }> {
    const rows = (await sql.unsafe(
      `SELECT
         pid,
         state,
         wait_event_type,
         wait_event,
         xact_start IS NOT NULL AS in_transaction
       FROM pg_stat_activity
       WHERE pid = $1`,
      [pid],
    )) as Array<{
      pid: number;
      state: string;
      wait_event_type: string | null;
      wait_event: string | null;
      in_transaction: boolean;
    }>;
    const row = rows[0];
    if (!row) {
      return {
        active: false,
        waitEventType: null,
        waitEvent: null,
        inTransaction: false,
      };
    }
    return {
      active: row.state === "active" || row.state === "idle in transaction",
      waitEventType: row.wait_event_type,
      waitEvent: row.wait_event,
      inTransaction: Boolean(row.in_transaction),
    };
  }

  /**
   * Polls (bounded, deterministic) until `waiterPid` reports an open
   * transaction (`xact_start IS NOT NULL`) — proof the waiter's BEGIN has
   * executed. Resolves with the snapshot; rejects on timeout so a broken
   * race surfaces instead of silently passing.
   */
  async function waitForTransactionStarted(
    sql: ObserverSql,
    pid: number,
    timeoutMs = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snap = await snapshotBackendState(sql, pid);
      if (snap.inTransaction) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Backend ${pid} did not start a transaction within ${timeoutMs}ms`,
    );
  }

  /**
   * Polls (bounded, deterministic) until `waiterPid` reports a non-granted
   * lock request in `pg_locks` — proof it is blocked waiting for a lock held
   * by another transaction (T1's EA row lock or the uncommitted unique index
   * entry). The primary real-overlap signal. Uses `pg_locks` (rather than
   * `pg_stat_activity.wait_event_type`) because the ungranted-lock row
   * persists for the whole wait, so sampling cannot miss a transient window.
   */
  async function waitForBackendBlocked(
    sql: ObserverSql,
    pid: number,
    timeoutMs = 8_000,
  ): Promise<{ blockedOnLocktype: string; mode: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = (await sql.unsafe(
        `SELECT locktype, mode
         FROM pg_locks
         WHERE pid = $1 AND granted = false
         LIMIT 1`,
        [pid],
      )) as Array<{ locktype: string; mode: string }>;
      if (rows.length > 0) {
        return { blockedOnLocktype: rows[0]!.locktype, mode: rows[0]!.mode };
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Backend ${pid} did not report an ungranted lock within ${timeoutMs}ms ` +
        "(the race did not produce real overlap)",
    );
  }

  it("Matrix A: same attempt, different operationIds → one applied, one no_change, 2 receipts, 1 audit (true overlap, 40001 retry)", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("FS Matrix A");
    // db1/db2 are distinct max:1 pools → distinct stable backend PIDs for the
    // pg_stat_activity overlap proof.
    const t1BackendPid = (await collectConnectionEvidence(db1)).pid;
    const t2BackendPid = (await collectConnectionEvidence(db2)).pid;
    expect(t1BackendPid).not.toBe(t2BackendPid);
    const opA = randomUUID();
    const opB = randomUUID();
    const now = new Date();
    const input1 = {
      attemptId,
      operationId: opA,
      reason: "matrix A T1",
      now,
    };
    const input2 = {
      attemptId,
      operationId: opB,
      reason: "matrix A T2",
      now,
    };

    const barrier = createForceSubmitRaceBarrier();
    const t1Promise = forceSubmitWithOperationRaceRecovery(
      db1,
      adminCtx,
      input1,
      {
        observer: createBarrierBackedForceSubmitObserver(
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
    const t2Promise = forceSubmitWithOperationRaceRecovery(
      db2,
      adminCtx,
      input2,
      {
        observer: createBarrierBackedForceSubmitObserver(
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
      // Both pre-reads see absent while T1 is still gated — deterministic.
      const t1Absent = await barrier.t1ReadAbsent.promise;
      const t2Absent = await barrier.t2ReadAbsent.promise;
      expect(t1Absent.operationId).toBe(opA);
      expect(t2Absent.operationId).toBe(opB);
      expect(t1Absent.attemptId).toBe(attemptId);

      // --- REAL OVERLAP, Phase 1: T1 enters its txn and inserts its receipt,
      // then HOLDS ITS TRANSACTION OPEN (awaiting releaseT1Commit). T1 now
      // holds the EA row lock with an uncommitted applied receipt. ---
      barrier.releaseT1.resolve();
      const t1Open = await barrier.t1AfterReceiptInsert.promise;
      expect(t1Open.operationId).toBe(opA);

      // --- REAL OVERLAP, Phase 2: release T2. T2 enters its OWN transaction
      // (this is the proof the old test lacked — T2's txn starts while T1 is
      // still uncommitted). T2 then blocks on the EA row lock T1 holds. ---
      barrier.releaseT2.resolve();
      await waitForTransactionStarted(sqlObserver, t2BackendPid);

      // Prove T2 is genuinely BLOCKED waiting on T1's EA row lock —
      // deterministic, no sleep. This is the real-overlap invariant: T2 has
      // an ungranted lock request (relation/transactionid/tuple) while T1
      // is still uncommitted. The probe MUST run on sqlObserver (a third,
      // independent connection) — db1/db2 are max:1 pools held open by the
      // racers, so a probe on them would queue forever behind the open txn.
      const t2Blocked = await waitForBackendBlocked(sqlObserver, t2BackendPid);
      expect(["relation", "transactionid", "tuple"]).toContain(
        t2Blocked.blockedOnLocktype,
      );

      // --- REAL OVERLAP, Phase 3: commit T1. T2 wakes; under REPEATABLE READ
      // its first attempt's snapshot predates T1's commit, so its locked
      // re-read of the attempt raises 40001 serialization_failure and
      // executeInTransaction auto-retries with a fresh txid. ---
      barrier.releaseT1Commit.resolve();
      const t1Result = await t1Promise;
      expect(t1Result.disposition).toBe("applied");
      expect(t1Result.resultPayload).toMatchObject({
        commandType: "force_submit",
        beforeStatus: "in_progress",
        afterStatus: "graded",
      });
      const t1Commit = await barrier.t1PrimaryCommitted.promise;
      expect(t1Commit.disposition).toBe("applied");

      // T2 settles: on the retry its new snapshot sees graded → no_change.
      const t2Result = await t2Promise;
      expect(t2Result.disposition).toBe("no_change");
      expect(t2Result.outcome).toBe("no_change");
      expect(t2Result.resultPayload).toMatchObject({ beforeStatus: "graded" });
      expect(t2Result.resultPayload).toMatchObject({ afterStatus: "graded" });

      // PROVE the 40001 retry happened: T2 logged ≥2 primary attempts with
      // DISTINCT txids. (If a future PG does not raise 40001 here, T2 would
      // have logged exactly 1 primary attempt — the assertion below would
      // fail loudly rather than silently regress the race proof.)
      const t2Attempts = await barrier.t2TransactionAttempts.promise;
      const primaryAttempts = t2Attempts.filter((a) => a.phase === "primary");
      expect(
        primaryAttempts.length,
        "T2 must have retried its primary transaction after a 40001",
      ).toBeGreaterThanOrEqual(2);
      const primaryTxids = new Set(primaryAttempts.map((a) => a.txid));
      expect(primaryTxids.size).toBe(primaryAttempts.length);
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }

    // 2 durable receipts (one per operation), 1 audit, final graded.
    const receipts = await listReceipts(attemptId);
    expect(receipts).toHaveLength(2);
    expect(receipts.map((r) => r.outcome).sort()).toEqual([
      "applied",
      "no_change",
    ]);
    expect(receipts.find((r) => r.operationId === opA)?.outcome).toBe(
      "applied",
    );
    expect(receipts.find((r) => r.operationId === opB)?.outcome).toBe(
      "no_change",
    );
    // P2-2: the receipt actor authority is ctx.actorId (single source), not a
    // command input — both receipts carry the authenticated admin.
    for (const r of receipts) {
      expect(r.actorId).toBe(adminCtx.actorId);
    }
    expect((await countForceSubmitAudits(attemptId)).length).toBe(1);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.status).toBe("graded");
  }, 30_000);

  it("Matrix B: same attempt, same operationId, same payload → applied + idempotent_replay with real 23505 + fresh recovery txid (true overlap)", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("FS Matrix B");
    const t1BackendPid = (await collectConnectionEvidence(db1)).pid;
    const t2BackendPid = (await collectConnectionEvidence(db2)).pid;
    expect(t1BackendPid).not.toBe(t2BackendPid);
    const sharedOp = randomUUID();
    const now = new Date();
    const input1 = {
      attemptId,
      operationId: sharedOp,
      reason: "matrix B retry",
      now,
    };
    const input2 = { ...input1 };

    const barrier = createForceSubmitRaceBarrier();
    const t1Promise = forceSubmitWithOperationRaceRecovery(
      db1,
      adminCtx,
      input1,
      {
        observer: createBarrierBackedForceSubmitObserver(
          barrier,
          "T1",
          sharedOp,
          attemptId,
          true,
        ),
        label: "T1",
        audit: { request: fakeAuditRequest() },
      },
    );
    const t2Promise = forceSubmitWithOperationRaceRecovery(
      db2,
      adminCtx,
      input2,
      {
        observer: createBarrierBackedForceSubmitObserver(
          barrier,
          "T2",
          sharedOp,
          attemptId,
          true,
        ),
        label: "T2",
        audit: { request: fakeAuditRequest() },
      },
    );

    try {
      // Both pre-reads see absent (T1 still uncommitted at pre-read time).
      await barrier.t1ReadAbsent.promise;
      const t2Absent = await barrier.t2ReadAbsent.promise;
      expect(t2Absent.operationId).toBe(sharedOp);

      // --- REAL OVERLAP: T1 enters txn, inserts receipt, HOLDS OPEN. ---
      barrier.releaseT1.resolve();
      const t1Open = await barrier.t1AfterReceiptInsert.promise;
      expect(t1Open.operationId).toBe(sharedOp);

      // T2 enters its own txn while T1 is uncommitted, then blocks on the EA
      // row lock (same attempt → shared lock). Prove the block on sqlObserver.
      barrier.releaseT2.resolve();
      await waitForTransactionStarted(sqlObserver, t2BackendPid);
      const t2Blocked = await waitForBackendBlocked(sqlObserver, t2BackendPid);
      expect(["relation", "transactionid", "tuple"]).toContain(
        t2Blocked.blockedOnLocktype,
      );

      // Commit T1. T2 wakes; under RR its primary attempt 40001-retries, then
      // its fresh snapshot sees graded → plans no_change → its receipt INSERT
      // hits the REAL 23505 on the committed unique entry → fresh recovery
      // → idempotent_replay of the winner's stored fact.
      barrier.releaseT1Commit.resolve();
      const t1Result = await t1Promise;
      expect(t1Result.disposition).toBe("applied");
      await barrier.t1PrimaryCommitted.promise;

      let t2Resolved = false;
      let t2Result: Awaited<
        ReturnType<typeof forceSubmitWithOperationRaceRecovery>
      > | null = null;
      let t2Error: unknown = null;
      try {
        t2Result = await t2Promise;
        t2Resolved = true;
      } catch (err) {
        t2Error = err;
      }
      expect(t2Resolved, "T2 recovery unexpectedly threw").toBe(true);
      expect(t2Error).toBeNull();
      expect(t2Result!.disposition).toBe("idempotent_replay");
      // Replay returns the ORIGINAL stored outcome + immutable fact.
      expect(t2Result!.outcome).toBe("applied");
      expect(t2Result!.resultPayload).toEqual(t1Result.resultPayload);
      expect(t2Result!.createdAt).toBe(t1Result.createdAt);
      expect(t2Result!.operationId).toBe(sharedOp);

      // The violation evidence comes from the REAL caught error, correlated to
      // the PRIMARY transaction identity.
      const violation = await barrier.t2UniqueViolation.promise;
      expect(violation.code).toBe("23505");
      expect(violation.constraint).toBe(
        ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT,
      );
      const t2BeforeInsert = await barrier.t2BeforeReceiptInsert.promise;
      expect(violation.txid).toBe(t2BeforeInsert.txid);

      // Recovery runs in a FRESH transaction with a distinct txid.
      const recovery = await barrier.t2RecoveryStarted.promise;
      expect(recovery.txid).not.toBe(t2BeforeInsert.txid);
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }

    // Exactly one receipt (the winner's), one audit; the replay wrote nothing.
    const receipts = await listReceipts(attemptId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.operationId).toBe(sharedOp);
    expect(receipts[0]!.outcome).toBe("applied");
    expect((await countForceSubmitAudits(attemptId)).length).toBe(1);
  }, 30_000);

  it("Matrix C: same attempt, same operationId, different payload → 409 IDEMPOTENCY_CONFLICT", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("FS Matrix C");
    const sharedOp = randomUUID();
    const now = new Date();
    const input1 = {
      attemptId,
      operationId: sharedOp,
      reason: "matrix C winner payload",
      now,
    };
    const input2 = {
      attemptId,
      operationId: sharedOp,
      reason: "matrix C DRIFTED payload",
      now,
    };

    const barrier = createForceSubmitRaceBarrier();
    const t1Promise = forceSubmitWithOperationRaceRecovery(
      db1,
      adminCtx,
      input1,
      {
        observer: createBarrierBackedForceSubmitObserver(
          barrier,
          "T1",
          sharedOp,
          attemptId,
        ),
        label: "T1",
        audit: { request: fakeAuditRequest() },
      },
    );
    const t2Promise = forceSubmitWithOperationRaceRecovery(
      db2,
      adminCtx,
      input2,
      {
        observer: createBarrierBackedForceSubmitObserver(
          barrier,
          "T2",
          sharedOp,
          attemptId,
        ),
        label: "T2",
        audit: { request: fakeAuditRequest() },
      },
    );

    try {
      await barrier.t1ReadAbsent.promise;
      await barrier.t2ReadAbsent.promise;
      barrier.releaseT1.resolve();
      const t1Result = await t1Promise;
      expect(t1Result.disposition).toBe("applied");
      await barrier.t1PrimaryCommitted.promise;

      barrier.releaseT2.resolve();
      let t2Resolved = false;
      let t2Error: unknown = null;
      try {
        await t2Promise;
        t2Resolved = true;
      } catch (err) {
        t2Error = err;
      }
      expect(t2Resolved, "T2 recovery unexpectedly succeeded").toBe(false);
      expect(t2Error).toBeInstanceOf(IdempotencyConflictError);

      const violation = await barrier.t2UniqueViolation.promise;
      expect(violation.code).toBe("23505");
      expect(violation.constraint).toBe(
        ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT,
      );
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }

    const receipts = await listReceipts(attemptId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.requestPayload).toEqual({
      reason: "matrix C winner payload",
    });
    expect((await countForceSubmitAudits(attemptId)).length).toBe(1);
  }, 30_000);

  it("Matrix D: different attempts, same organization, same operationId → loser blocks on uncommitted unique index, real 23505, full rollback (attempt untouched, no audit, no receipt)", async () => {
    // The most important matrix: BOTH attempts live in the SAME organization
    // (the arbiter is organization-scoped) but on DIFFERENT exams, so neither
    // the EA lock nor any other row lock overlaps — the shared
    // UNIQUE(organization_id, operation_id) index is the only mutex. This is
    // the unique-index race the reviewer required: T2 blocks on the
    // UNCOMMITTED unique entry, then gets the REAL 23505 once T1 commits.
    const t = await createOrg();
    const a1 = await createAttemptInOrg(t, "FS Matrix D A1");
    const a2 = await createAttemptInOrg(t, "FS Matrix D A2");
    expect(a1.attemptId).not.toBe(a2.attemptId);
    const sharedOp = randomUUID();
    const now = new Date();
    const input1 = {
      attemptId: a1.attemptId,
      operationId: sharedOp,
      reason: "matrix D T1 on A1",
      now,
    };
    const input2 = {
      attemptId: a2.attemptId,
      operationId: sharedOp,
      reason: "matrix D T2 on A2",
      now,
    };

    // Prove the two connections are distinct backends in one schema.
    const ev1 = await collectConnectionEvidence(db1);
    const ev2 = await collectConnectionEvidence(db2);
    const t1BackendPid = ev1.pid;
    const t2BackendPid = ev2.pid;
    expect(t1BackendPid).not.toBe(t2BackendPid);
    expect(ev1.currentSchema).toBe(ev2.currentSchema);
    expect(ev1.currentSchema).toBe(iso.schemaName);

    const barrier = createForceSubmitRaceBarrier();
    const t1Promise = forceSubmitWithOperationRaceRecovery(
      db1,
      t.adminCtx,
      input1,
      {
        observer: createBarrierBackedForceSubmitObserver(
          barrier,
          "T1",
          sharedOp,
          a1.attemptId,
          true,
        ),
        label: "T1",
        audit: { request: fakeAuditRequest() },
      },
    );
    const t2Promise = forceSubmitWithOperationRaceRecovery(
      db2,
      t.adminCtx,
      input2,
      {
        observer: createBarrierBackedForceSubmitObserver(
          barrier,
          "T2",
          sharedOp,
          a2.attemptId,
          true,
        ),
        label: "T2",
        audit: { request: fakeAuditRequest() },
      },
    );

    try {
      await barrier.t1ReadAbsent.promise;
      await barrier.t2ReadAbsent.promise;

      // --- REAL OVERLAP: T1 enters txn, inserts its receipt for A1, then
      // HOLDS ITS TRANSACTION OPEN (awaiting releaseT1Commit). The uncommitted
      // unique-index entry for sharedOp is now held by T1. ---
      barrier.releaseT1.resolve();
      const t1Open = await barrier.t1AfterReceiptInsert.promise;
      expect(t1Open.operationId).toBe(sharedOp);
      expect(t1Open.attemptId).toBe(a1.attemptId);

      // Release T2: it locks A2 (a DIFFERENT row — no EA-lock overlap with
      // T1), reaches its own receipt INSERT for the SAME sharedOp, and BLOCKS
      // on T1's uncommitted unique-index entry. Prove the block on sqlObserver.
      barrier.releaseT2.resolve();
      await waitForTransactionStarted(sqlObserver, t2BackendPid);
      const t2Blocked = await waitForBackendBlocked(sqlObserver, t2BackendPid);
      // T2 is blocked on the uncommitted unique-index entry — the wait is on
      // the inserting transaction's transactionid (or the tuple), NOT on a
      // relation/row lock (the attempts are different rows).
      expect(["transactionid", "tuple", "relation"]).toContain(
        t2Blocked.blockedOnLocktype,
      );

      // Commit T1. T2's blocked INSERT now resolves to the REAL 23505; the
      // whole primary transaction rolls back BEFORE the submit/grade mutation;
      // the fresh recovery transaction classifies an attempt_id conflict →
      // IdempotencyConflictError.
      barrier.releaseT1Commit.resolve();
      const t1Result = await t1Promise;
      expect(t1Result.disposition).toBe("applied");
      expect(t1Result.resultPayload).toMatchObject({
        commandType: "force_submit",
        beforeStatus: "in_progress",
      });
      await barrier.t1PrimaryCommitted.promise;

      let t2Resolved = false;
      let t2Error: unknown = null;
      try {
        await t2Promise;
        t2Resolved = true;
      } catch (err) {
        t2Error = err;
      }
      expect(t2Resolved, "T2 recovery unexpectedly succeeded").toBe(false);
      expect(t2Error).toBeInstanceOf(IdempotencyConflictError);

      const violation = await barrier.t2UniqueViolation.promise;
      expect(violation.code).toBe("23505");
      expect(violation.constraint).toBe(
        ATTEMPT_COMMAND_RECEIPT_OPERATION_UNIQUE_CONSTRAINT,
      );
      const recovery = await barrier.t2RecoveryStarted.promise;
      expect(recovery.txid).toBeTruthy();
    } finally {
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }

    // The loser's attempt A2 was NEVER submitted/graded and carries no
    // receipt, no audit — the receipt insert raced and lost BEFORE the
    // mutation ran.
    const a2After = await createAttemptRepo(ctx.db).findById(
      t.adminCtx,
      a2.attemptId,
    );
    expect(a2After?.status).toBe("in_progress");
    expect(a2After?.submittedAt).toBeNull();
    expect(a2After?.gradedAt).toBeNull();
    expect(await listReceipts(a2.attemptId)).toHaveLength(0);
    expect(await countForceSubmitAudits(a2.attemptId)).toHaveLength(0);

    // The winner's attempt A1 has exactly one applied receipt + one audit.
    const a1Receipts = await listReceipts(a1.attemptId);
    expect(a1Receipts).toHaveLength(1);
    expect(a1Receipts[0]!.outcome).toBe("applied");
    const a1Attempt = await createAttemptRepo(ctx.db).findById(
      t.adminCtx,
      a1.attemptId,
    );
    expect(a1Attempt?.status).toBe("graded");
    expect((await countForceSubmitAudits(a1.attemptId)).length).toBe(1);
  }, 30_000);

  it("Matrix E: commit + lost response → fresh retry with same operationId returns idempotent_replay", async () => {
    const { adminCtx, attemptId } = await createOrgAndAttempt("FS Matrix E");
    const op = randomUUID();
    const now = new Date();
    const input = {
      attemptId,
      operationId: op,
      reason: "matrix E lost response",
      now,
    };

    // First call commits and returns applied; the client "loses" the response.
    const first = await forceSubmitWithOperationRaceRecovery(
      db1,
      adminCtx,
      input,
      {
        audit: { request: fakeAuditRequest() },
      },
    );
    expect(first.disposition).toBe("applied");

    // A fresh connection + fresh request repeats the same operationId: the
    // stored receipt is returned verbatim (immutable fact, same createdAt).
    const second = await forceSubmitWithOperationRaceRecovery(
      db2,
      adminCtx,
      input,
    );
    expect(second.disposition).toBe("idempotent_replay");
    expect(second.outcome).toBe(first.outcome);
    expect(second.resultPayload).toEqual(first.resultPayload);
    expect(second.createdAt).toBe(first.createdAt);

    expect(await listReceipts(attemptId)).toHaveLength(1);
    expect((await countForceSubmitAudits(attemptId)).length).toBe(1);
  }, 30_000);

  it("failure atomicity: exception after the receipt insert rolls back receipt + mutation + audit", async () => {
    const { adminCtx, attemptId } =
      await createOrgAndAttempt("FS Fault Receipt");
    const input = {
      attemptId,
      operationId: randomUUID(),
      reason: "fault after receipt insert",
      now: new Date(),
    };
    const faultObserver: ForceSubmitExecutionObserver = {
      afterReceiptInsert: async () => {
        throw new Error("injected fault after receipt insert");
      },
    };

    await expect(
      forceSubmitWithOperationRaceRecovery(db1, adminCtx, input, {
        observer: faultObserver,
        audit: { request: fakeAuditRequest() },
      }),
    ).rejects.toThrow("injected fault after receipt insert");

    // The whole transaction rolled back: no receipt, no mutation, no audit.
    expect(await listReceipts(attemptId)).toHaveLength(0);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.status).toBe("in_progress");
    expect((await countForceSubmitAudits(attemptId)).length).toBe(0);
  }, 30_000);

  it("failure atomicity: exception after submit/grade but before the audit rolls back everything including the workset", async () => {
    const { adminCtx, attemptId } =
      await createOrgAndAttempt("FS Fault PreAudit");
    const input = {
      attemptId,
      operationId: randomUUID(),
      reason: "fault before audit",
      now: new Date(),
    };
    const faultObserver: ForceSubmitExecutionObserver = {
      beforeAuditWrite: async () => {
        throw new Error("injected fault before audit write");
      },
    };

    await expect(
      forceSubmitWithOperationRaceRecovery(db1, adminCtx, input, {
        observer: faultObserver,
        audit: { request: fakeAuditRequest() },
      }),
    ).rejects.toThrow("injected fault before audit write");

    expect(await listReceipts(attemptId)).toHaveLength(0);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.status).toBe("in_progress");
    expect(attempt?.submittedAt).toBeNull();
    expect(attempt?.gradedAt).toBeNull();
    // No grading workset residue either (the submit freeze barrier's rows
    // were rolled back with the transaction).
    const gradingEntries = await ctx.db
      .select()
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
    expect(gradingEntries).toHaveLength(0);
    expect((await countForceSubmitAudits(attemptId)).length).toBe(0);
  }, 30_000);

  it("failure atomicity: exception after the audit write rolls back receipt + mutation + the audit row itself", async () => {
    const { adminCtx, attemptId } =
      await createOrgAndAttempt("FS Fault PostAudit");
    const input = {
      attemptId,
      operationId: randomUUID(),
      reason: "fault after audit",
      now: new Date(),
    };
    const faultObserver: ForceSubmitExecutionObserver = {
      afterAuditWrite: async () => {
        throw new Error("injected fault after audit write");
      },
    };

    await expect(
      forceSubmitWithOperationRaceRecovery(db1, adminCtx, input, {
        observer: faultObserver,
        audit: { request: fakeAuditRequest() },
      }),
    ).rejects.toThrow("injected fault after audit write");

    expect(await listReceipts(attemptId)).toHaveLength(0);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.status).toBe("in_progress");
    expect((await countForceSubmitAudits(attemptId)).length).toBe(0);
  }, 30_000);

  it("mutation proof: an UNRELATED 23505 is NOT treated as an idempotency race (rethrows, no recovery, full rollback)", async () => {
    const { adminCtx, attemptId } =
      await createOrgAndAttempt("FS Unrelated 23505");
    const input = {
      attemptId,
      operationId: randomUUID(),
      reason: "unrelated unique violation",
      now: new Date(),
    };
    let recoveryStarted = false;
    const unrelated23505 = Object.assign(
      new Error("unrelated unique violation"),
      { code: "23505", constraint: "users_org_username_unique" },
    );
    const faultObserver: ForceSubmitExecutionObserver = {
      afterReceiptInsert: async () => {
        throw unrelated23505;
      },
      onRecoveryTransaction: async () => {
        recoveryStarted = true;
      },
    };

    // The exact-constraint matcher must NOT match this violation: the error is
    // rethrown unchanged and NO recovery transaction is opened.
    await expect(
      forceSubmitWithOperationRaceRecovery(db1, adminCtx, input, {
        observer: faultObserver,
        audit: { request: fakeAuditRequest() },
      }),
    ).rejects.toThrow("unrelated unique violation");
    expect(recoveryStarted).toBe(false);

    expect(await listReceipts(attemptId)).toHaveLength(0);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.status).toBe("in_progress");
    expect((await countForceSubmitAudits(attemptId)).length).toBe(0);
  }, 30_000);

  it("mutation proof: the postcondition verification fails closed when the committed fact diverges from the stored result_payload", async () => {
    // The plan froze afterStatus=graded from the locked in_progress row. The
    // fault hook then mutates the LOCKED row's question snapshot (single
    // choice → text_response) INSIDE the transaction: the engine's submit
    // freeze barrier now classifies the workset pending_manual, grading stays
    // at `submitted`, and the committed fact (afterStatus=submitted) diverges
    // from the stored result_payload (afterStatus=graded). The postcondition
    // must throw and roll back the WHOLE transaction — receipt, mutation, and
    // audit. Removing the verification would let this commit a receipt whose
    // immutable fact contradicts the row.
    const { adminCtx, attemptId } = await createOrgAndAttempt(
      "FS Verify Divergence",
    );
    const input = {
      attemptId,
      operationId: randomUUID(),
      reason: "postcondition divergence",
      now: new Date(),
    };
    const faultObserver: ForceSubmitExecutionObserver = {
      afterReceiptInsert: async ({ tx }) => {
        const attempt = await createAttemptRepo(tx).findById(
          adminCtx,
          attemptId,
        );
        if (!attempt) throw new Error("attempt missing in fault hook");
        await tx
          .update(schema.examAttempts)
          .set({
            questionSnapshot: attempt.questionSnapshot.map((q) => ({
              ...q,
              type: "text_response",
              standardAnswer: null,
            })),
          })
          .where(eq(schema.examAttempts.id, attemptId));
      },
    };

    await expect(
      forceSubmitWithOperationRaceRecovery(db1, adminCtx, input, {
        observer: faultObserver,
        audit: { request: fakeAuditRequest() },
      }),
    ).rejects.toThrow(/Invariant failure/);

    expect(await listReceipts(attemptId)).toHaveLength(0);
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    expect(attempt?.status).toBe("in_progress");
    expect(attempt?.submittedAt).toBeNull();
    expect(attempt?.gradedAt).toBeNull();
    expect((await countForceSubmitAudits(attemptId)).length).toBe(0);
  }, 30_000);
});
