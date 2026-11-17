/**
 * #1008 / E07 / W07 — admin force-submit / time-grant final command outcome
 * and denial correlation, asserted at the REAL Fastify + Pino serialization
 * boundary (a capturing stream, per the #1020 W03 precedent in
 * `retryCorrelation.w03.test.ts`; `logger:false` can only prove business).
 *
 * Commit-authoritative contract under test:
 *  - `admin.command.completed` is emitted ONLY after the full
 *    `forceSubmitWithOperationRaceRecovery` / `grantWithOperationRaceRecovery`
 *    wrapper resolves successfully (primary committed, auto-retry committed,
 *    exact-23505 recovery, or the no-transaction pre-read replay of an
 *    already-committed receipt), BEFORE the response schema parse, from the
 *    wrapper's own verified disposition / outcome — never from the HTTP
 *    status, the receipt history, or a transaction-internal candidate.
 *  - `admin.command.denied` (forbidden / not_found / conflict) is emitted at
 *    most once per request for 403/404/409, covering preHandler exits the
 *    handler never reaches; 400/401/500/503 stay silent.
 *  - Payloads are closed whitelists; denial lines never carry the target
 *    attemptId / operationId / reason / error details; anti-enumeration 404
 *    keeps one uniform outcome value.
 *  - Both events carry a fixed `event` field (`admin.command.completed` /
 *    `admin.command.denied`) in the payload, matching the event catalog used
 *    by the other technical event lines. `msg` stays human-readable content
 *    and is NEVER used as a selection basis here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { eq, like, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { canonicalizeForceSubmitPayload } from "@exam/domain";
import { schema } from "@exam/db/schema/pg";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createAttemptCommandReceiptRepo } from "@exam/db/repository/attemptCommandReceiptRepo";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { setupRequestIdHeader } from "../../plugins/requestIdHeader.js";
import { planForceSubmitExecution } from "../../orchestrators/forceSubmitExecution.js";
import { createExamEngineRepos } from "../../adapters/repoAdapters.js";
import { emitForceSubmitCommandCompleted } from "../adminCommandTelemetry.js";
import {
  buildExamPayload,
  createIsolatedAttemptOrg,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

type LogLine = Record<string, unknown>;

/** Event-catalog names — the payload `event` field IS the selection basis. */
const COMPLETED_EVENT = "admin.command.completed";
const DENIED_EVENT = "admin.command.denied";
const SLUG_PREFIX = "w07-admin-outcome-";
/** Raw pino line upper bound, pinned like the #1006 WARN budget (512 B). */
const MAX_EVENT_LINE_BYTES = 512;

/**
 * Sorted key sets a w07 line may carry: pino envelope + closed payload +
 * the request child-logger's inherited bindings. The authenticate preHandler
 * binds the CALLER's own server-verified identity (plugins/auth.ts:203-207 —
 * actorId/actorRole/organizationId of the requester, per the business-line
 * policy in docs/contracts/observability.md). They are never the denied
 * target's data — the cross-org test asserts that by value.
 */
const INHERITED_CALLER_BINDING_KEYS = [
  "actorId",
  "actorRole",
  "organizationId",
];
const COMPLETED_LINE_KEYS = [
  "attemptId",
  "command",
  "disposition",
  "event",
  "hostname",
  "level",
  "msg",
  "operationId",
  "outcome",
  "pid",
  "reqId",
  "time",
  ...INHERITED_CALLER_BINDING_KEYS,
].sort();
const DENIED_LINE_KEYS = [
  "command",
  "event",
  "hostname",
  "level",
  "msg",
  "outcome",
  "pid",
  "reqId",
  "time",
  ...INHERITED_CALLER_BINDING_KEYS,
].sort();

describe("admin force-submit / time-grant command outcome telemetry (#1008 W07)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  const logChunks: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: (err?: Error | null) => void) {
      logChunks.push(chunk.toString());
      cb();
    },
  });

  function rawLines(): string[] {
    return logChunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.trim().startsWith("{"));
  }

  function parsedLines(): LogLine[] {
    return rawLines().map((line) => JSON.parse(line) as LogLine);
  }

  function completedLines(requestId?: string): LogLine[] {
    return parsedLines().filter(
      (line) =>
        line.event === COMPLETED_EVENT &&
        (requestId === undefined || line.reqId === requestId),
    );
  }

  function deniedLines(requestId?: string): LogLine[] {
    return parsedLines().filter(
      (line) =>
        line.event === DENIED_EVENT &&
        (requestId === undefined || line.reqId === requestId),
    );
  }

  function adminCommandEventLines(): LogLine[] {
    return parsedLines().filter(
      (line) => line.event === COMPLETED_EVENT || line.event === DENIED_EVENT,
    );
  }

  function makeAdminCtx(t: IsolatedAttemptOrg) {
    return {
      actorId: t.adminUserId,
      organizationId: t.orgId,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
      targetOrganizationId: t.orgId,
    };
  }

  async function createStartedAttempt(
    t: IsolatedAttemptOrg,
    examTitle: string,
    policy: "strict" | "operator_incident" = "operator_incident",
  ): Promise<{ attemptId: string }> {
    const exam = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...buildExamPayload({
          title: examTitle,
          courseId: t.courseId,
          questionIds: [t.questionId],
          durationMinutes: 60,
        }),
        interruptionTimePolicy: policy,
      },
      cookies: { "auth-token": t.adminToken },
    });
    const examId = exam.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": t.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [t.candidateProfileId] },
      cookies: { "auth-token": t.adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": t.candidateToken },
    });
    return { attemptId: startRes.json().id as string };
  }

  function forceSubmit(
    t: IsolatedAttemptOrg,
    attemptId: string,
    body: { operationId: string; reason: string },
    token?: string,
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/force-submit`,
      payload: body,
      cookies: { "auth-token": token ?? t.adminToken },
    });
  }

  function timeGrant(
    t: IsolatedAttemptOrg,
    attemptId: string,
    body: {
      operationId: string;
      addedSeconds: number;
      reasonCode: string;
      reasonText: string;
    },
    token?: string,
  ) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/time-grants`,
      payload: body,
      cookies: { "auth-token": token ?? t.adminToken },
    });
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
      .where(eq(schema.auditLogs.targetId, attemptId));
    return rows.filter((r) => r.action === "attempt.forceSubmit");
  }

  /**
   * Fault-injects the DB transaction boundary (W03 precedent): the first
   * `count` transaction attempts throw the given SQLSTATE (optionally with
   * constraint fields) before the callback runs. `"all"` exhausts the retry
   * ceiling.
   */
  function failTransactions(
    count: number | "all",
    sqlstate: string,
    fields?: Record<string, string>,
  ): () => void {
    const db = ctx.db as unknown as Record<string, unknown>;
    const original = (
      db.transaction as (...args: unknown[]) => Promise<unknown>
    ).bind(db);
    let remaining = count;
    db.transaction = async (fn: unknown, config: unknown) => {
      if (remaining === "all" || remaining > 0) {
        if (remaining !== "all") remaining -= 1;
        throw Object.assign(new Error("injected transaction fault"), {
          code: sqlstate,
          ...fields,
        });
      }
      return original(fn, config);
    };
    return () => {
      Reflect.deleteProperty(db, "transaction");
    };
  }

  /**
   * Deterministically slips a concurrent WINNER receipt in between the
   * force-submit pre-read (which missed) and the primary transaction's BEGIN:
   * the first `db.transaction` call first inserts the winner row (autocommit,
   * same schema), then delegates. The primary's receipt INSERT then hits the
   * REAL `attempt_command_receipts_org_operation_unique` 23505 and the
   * production recovery runs. This is scheduling-only injection — the
   * violation, the rollback, and the recovery are all real PostgreSQL and
   * real production code.
   */
  function slipConcurrentReceiptWinner(
    winnerInsert: () => Promise<void>,
  ): () => void {
    const db = ctx.db as unknown as Record<string, unknown>;
    const original = (
      db.transaction as (...args: unknown[]) => Promise<unknown>
    ).bind(db);
    let injected = false;
    db.transaction = async (fn: unknown, config: unknown) => {
      if (!injected) {
        injected = true;
        await winnerInsert();
      }
      return original(fn, config);
    };
    return () => {
      Reflect.deleteProperty(db, "transaction");
    };
  }

  /** Inserts a committed winner receipt for `operationId` via the real repo. */
  async function insertWinnerReceipt(
    t: IsolatedAttemptOrg,
    attemptId: string,
    operationId: string,
    reason: string,
  ) {
    const adminCtx = makeAdminCtx(t);
    // Engine-repo adapter = the production row→domain mapping the orchestrator
    // itself uses, so the plan comes from the real planner on a real
    // ExamAttempt (no hand-copied payload shape).
    const { attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(ctx.db),
        attemptRepo: createAttemptRepo(ctx.db),
        enrollmentRepo: createEnrollmentRepo(ctx.db),
      },
      adminCtx,
    );
    const locked = await attempts.findById(attemptId);
    expect(locked).not.toBeNull();
    const plan = planForceSubmitExecution(locked!, new Date());
    await createAttemptCommandReceiptRepo(ctx.db).insertReceipt(adminCtx, {
      attemptId,
      operationId,
      commandType: "force_submit",
      requestPayload: canonicalizeForceSubmitPayload({ reason }),
      resultPayload: plan.resultPayload,
      outcome: plan.outcome,
      actorId: t.adminUserId,
      createdAt: new Date(),
    });
  }

  /**
   * One-shot response-send fault for W07-9 (owner review round 1, item 4):
   * when armed, the FIRST response send in this app throws inside the send
   * phase — a wire-exit failure injected on the REAL production routes (the
   * routes `attempts.admin.ts` registers, complete with the production
   * `adminCommandDeniedOnResponse` hook). Consumed on first use so the error
   * envelope's own send passes through untouched.
   */
  let armResponseSendFault = false;

  beforeAll(async () => {
    const combinedPlugin: FastifyPluginAsync = async (fastify) => {
      setupRequestIdHeader(fastify);
      fastify.addHook("onSend", async (_request, _reply, payload) => {
        if (!armResponseSendFault) {
          return payload;
        }
        armResponseSendFault = false;
        throw new Error("injected response send failure");
      });
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    };
    ctx = await buildTestApp(combinedPlugin, {
      logger: { level: "info", stream: logStream },
    });
  });

  afterAll(async () => {
    await ctx.drainAuditWritesStrict();
    const stale = await ctx.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(like(schema.organizations.slug, `${SLUG_PREFIX}%`));
    for (const org of stale) {
      await cleanupOrganizationTestData(ctx.db, org.id);
    }
    await ctx.cleanup();
  });

  beforeEach(async () => {
    logChunks.length = 0;
    await ctx.drainAuditWritesStrict();
  });

  describe("W07-1 force_submit completed dispositions", () => {
    it("applied: one completed line, closed payload, reqId joins the x-request-id header", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Applied");
      const operationId = crypto.randomUUID();

      const res = await forceSubmit(t, attemptId, {
        operationId,
        reason: "w07 applied",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().disposition).toBe("applied");

      const requestId = res.headers["x-request-id"] as string;
      expect(requestId).toBeTruthy();
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      const line = linesForRequest[0]!;
      expect(Object.keys(line).sort()).toEqual(COMPLETED_LINE_KEYS);
      expect(line.event).toBe(COMPLETED_EVENT);
      expect(line.command).toBe("force_submit");
      expect(line.outcome).toBe("applied");
      expect(line.disposition).toBe("applied");
      expect(line.attemptId).toBe(attemptId);
      expect(line.operationId).toBe(operationId);
      expect(line.level).toBe(30);
      // No denial for a successful command.
      expect(deniedLines(requestId)).toHaveLength(0);
    });

    it("first no_change on a terminal attempt: replay_no_change/no_change, receipt created, no audit", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 NoChange");
      // Terminalize via a first force-submit, then issue a NEW operationId.
      const firstOp = crypto.randomUUID();
      await forceSubmit(t, attemptId, { operationId: firstOp, reason: "one" });
      const secondOp = crypto.randomUUID();

      const res = await forceSubmit(t, attemptId, {
        operationId: secondOp,
        reason: "two",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().disposition).toBe("no_change");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.outcome).toBe("replay_no_change");
      expect(linesForRequest[0]!.disposition).toBe("no_change");

      // Existing contract: a first no_change DOES create a durable receipt,
      // but adds no business mutation and no audit.
      const receipts = await listReceipts(attemptId);
      expect(receipts.map((r) => r.outcome).sort()).toEqual([
        "applied",
        "no_change",
      ]);
      expect(await countForceSubmitAudits(attemptId)).toHaveLength(1);
    });

    it("replay of an applied receipt and replay of a no_change receipt both record idempotent_replay", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Replays");
      const appliedOp = crypto.randomUUID();
      await forceSubmit(t, attemptId, {
        operationId: appliedOp,
        reason: "original",
      });
      const noChangeOp = crypto.randomUUID();
      await forceSubmit(t, attemptId, {
        operationId: noChangeOp,
        reason: "terminal noop",
      });

      const replayApplied = await forceSubmit(t, attemptId, {
        operationId: appliedOp,
        reason: "original",
      });
      const replayNoChange = await forceSubmit(t, attemptId, {
        operationId: noChangeOp,
        reason: "terminal noop",
      });
      expect(replayApplied.json().disposition).toBe("idempotent_replay");
      expect(replayNoChange.json().disposition).toBe("idempotent_replay");

      for (const res of [replayApplied, replayNoChange]) {
        const requestId = res.headers["x-request-id"] as string;
        const linesForRequest = completedLines(requestId);
        expect(linesForRequest).toHaveLength(1);
        // The log dimension keeps the replay distinction; it does NOT claim
        // this execution re-applied, and does not flatten to the stored
        // receipt's historical outcome either.
        expect(linesForRequest[0]!.outcome).toBe("replay_no_change");
        expect(linesForRequest[0]!.disposition).toBe("idempotent_replay");
      }
      // Still exactly two receipts — replays wrote nothing.
      expect(await listReceipts(attemptId)).toHaveLength(2);
    });
  });

  describe("W07-2 time_grant completed outcomes", () => {
    it("granted: applied/granted", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Granted");
      const operationId = crypto.randomUUID();

      const res = await timeGrant(t, attemptId, {
        operationId,
        addedSeconds: 300,
        reasonCode: "candidate_request",
        reasonText: "w07 granted",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("granted");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(Object.keys(linesForRequest[0]!).sort()).toEqual(
        COMPLETED_LINE_KEYS,
      );
      expect(linesForRequest[0]!.command).toBe("time_grant");
      expect(linesForRequest[0]!.outcome).toBe("applied");
      expect(linesForRequest[0]!.disposition).toBe("granted");
      expect(linesForRequest[0]!.attemptId).toBe(attemptId);
      expect(linesForRequest[0]!.operationId).toBe(operationId);
    });

    it("terminal on an expired attempt: replay_no_change/terminal (NOT flattened to applied)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Terminal");
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const res = await timeGrant(t, attemptId, {
        operationId: crypto.randomUUID(),
        addedSeconds: 600,
        reasonCode: "technical_incident",
        reasonText: "too late",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("terminal");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.outcome).toBe("replay_no_change");
      expect(linesForRequest[0]!.disposition).toBe("terminal");
    });

    it("idempotent replay of a committed grant: replay_no_change/idempotent_replay", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 GrantReplay");
      const operationId = crypto.randomUUID();
      await timeGrant(t, attemptId, {
        operationId,
        addedSeconds: 300,
        reasonCode: "candidate_request",
        reasonText: "first",
      });

      const res = await timeGrant(t, attemptId, {
        operationId,
        addedSeconds: 300,
        reasonCode: "candidate_request",
        reasonText: "first",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("idempotent_replay");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.outcome).toBe("replay_no_change");
      expect(linesForRequest[0]!.disposition).toBe("idempotent_replay");
    });
  });

  describe("W07-3 same-operation concurrency (per-request signal, protocol-owned side effects)", () => {
    it("two concurrent same-operationId force-submits: one applied + one replay, each request exactly one completed line", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Concurrent");
      const operationId = crypto.randomUUID();
      const body = { operationId, reason: "concurrent" };

      const [r1, r2] = await Promise.all([
        forceSubmit(t, attemptId, body),
        forceSubmit(t, attemptId, body),
      ]);
      expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);

      const id1 = r1.headers["x-request-id"] as string;
      const id2 = r2.headers["x-request-id"] as string;
      expect(id1).not.toBe(id2);
      // Per request: exactly one final signal (NOT one line globally).
      expect(completedLines(id1)).toHaveLength(1);
      expect(completedLines(id2)).toHaveLength(1);
      // Exactly one execution applied; the other replayed the winner.
      const outcomes = [r1, r2].map((r) => r.json().disposition as string);
      expect(outcomes.sort()).toEqual(["applied", "idempotent_replay"]);
      // Business side effects stay owned by the idempotency protocol.
      expect(await listReceipts(attemptId)).toHaveLength(1);
      expect(await countForceSubmitAudits(attemptId)).toHaveLength(1);
      expect(deniedLines()).toHaveLength(0);
    });
  });

  describe("W07-4 exact-23505 race recovery", () => {
    it("primary rollback on the real receipt unique violation → recovery replay: exactly one completed, zero denied", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 23505");
      const operationId = crypto.randomUUID();
      const reason = "raced winner";
      const restore = slipConcurrentReceiptWinner(() =>
        insertWinnerReceipt(t, attemptId, operationId, reason),
      );

      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, { operationId, reason });
      } finally {
        restore();
      }
      expect(res.statusCode).toBe(200);
      expect(res.json().disposition).toBe("idempotent_replay");

      const requestId = res.headers["x-request-id"] as string;
      // The failed primary emitted nothing; the final replay emits once.
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.outcome).toBe("replay_no_change");
      expect(linesForRequest[0]!.disposition).toBe("idempotent_replay");
      expect(deniedLines(requestId)).toHaveLength(0);
      // One receipt only (the slipped winner); the loser wrote nothing.
      expect(await listReceipts(attemptId)).toHaveLength(1);
      // No auto-retry: 23505 is not retryable, so no retry WARNs either.
      expect(
        parsedLines().filter((line) => line.msg === "transaction retry"),
      ).toHaveLength(0);
    });

    it("recovery classifies a drifted payload as conflict: exactly one denied, zero completed", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 23505c");
      const operationId = crypto.randomUUID();
      const restore = slipConcurrentReceiptWinner(() =>
        insertWinnerReceipt(
          t,
          attemptId,
          operationId,
          "winner committed a different reason",
        ),
      );

      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, {
          operationId,
          reason: "loser drifted payload",
        });
      } finally {
        restore();
      }
      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("IDEMPOTENCY_CONFLICT");

      const requestId = res.headers["x-request-id"] as string;
      expect(completedLines(requestId)).toHaveLength(0);
      const denied = deniedLines(requestId);
      expect(denied).toHaveLength(1);
      expect(denied[0]!.command).toBe("force_submit");
      expect(denied[0]!.outcome).toBe("conflict");
    });
  });

  describe("W07-5/6 non-target 23505, retry exhaustion, audit rollback", () => {
    it("non-target 23505 is neither swallowed nor converted to success: 409, one denied, zero completed", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 23505x");
      const restore = failTransactions(1, "23505");

      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, {
          operationId: crypto.randomUUID(),
          reason: "non-target violation",
        });
      } finally {
        restore();
      }
      expect(res.statusCode).toBe(409);
      expect(res.json().error?.code).toBe("RESOURCE_CONFLICT");
      const requestId = res.headers["x-request-id"] as string;
      expect(completedLines(requestId)).toHaveLength(0);
      expect(deniedLines(requestId)).toHaveLength(1);
      expect(deniedLines(requestId)[0]!.outcome).toBe("conflict");
      expect(await listReceipts(attemptId)).toHaveLength(0);
    });

    it("retry exhaustion: 409 with zero completed and exactly one denied", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Exhaust");
      const restore = failTransactions("all", "40001");

      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, {
          operationId: crypto.randomUUID(),
          reason: "exhausted",
        });
      } finally {
        restore();
      }
      expect(res.statusCode).toBe(409);
      const requestId = res.headers["x-request-id"] as string;
      expect(completedLines(requestId)).toHaveLength(0);
      expect(deniedLines(requestId)).toHaveLength(1);
      expect(deniedLines(requestId)[0]!.outcome).toBe("conflict");
      expect(await listReceipts(attemptId)).toHaveLength(0);
    });

    it("in-transaction audit failure rolls back everything: 500, zero completed, zero denied", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 AuditFail");
      const suffix = crypto.randomUUID().replaceAll("-", "");
      const fn = `fail_fs_audit_${suffix}`;
      const trigger = `fail_fs_audit_t_${suffix}`;
      await ctx.db.execute(
        sql.raw(`
          CREATE FUNCTION ${fn}() RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'injected force-submit audit failure';
          END;
          $$ LANGUAGE plpgsql
        `),
      );
      await ctx.db.execute(
        sql.raw(`
          CREATE TRIGGER ${trigger}
          BEFORE INSERT ON audit_logs
          FOR EACH ROW
          WHEN (NEW.action = 'attempt.forceSubmit')
          EXECUTE FUNCTION ${fn}()
        `),
      );

      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, {
          operationId: crypto.randomUUID(),
          reason: "audit must roll back",
        });
      } finally {
        await ctx.db.execute(
          sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs`),
        );
        await ctx.db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`));
      }
      expect(res.statusCode).toBe(500);
      const requestId = res.headers["x-request-id"] as string;
      expect(completedLines(requestId)).toHaveLength(0);
      expect(deniedLines(requestId)).toHaveLength(0);
      // The whole transaction rolled back — no receipt survived.
      expect(await listReceipts(attemptId)).toHaveLength(0);
    });
  });

  describe("W07-7 denial ownership and envelopes", () => {
    it("400 stays out of the denied vocabulary (zero admin.command.* lines)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 400");
      const res = await forceSubmit(t, attemptId, {
        operationId: "",
        reason: "",
      });
      expect(res.statusCode).toBe(400);
      expect(adminCommandEventLines()).toHaveLength(0);
    });

    it("401 stays out of the denied vocabulary", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 401");
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit`,
        payload: { operationId: crypto.randomUUID(), reason: "anon" },
      });
      expect(res.statusCode).toBe(401);
      expect(adminCommandEventLines()).toHaveLength(0);
    });

    it("403 role preset denial (preHandler, handler unreachable): one denied forbidden with closed payload", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 403");
      const res = await forceSubmit(
        t,
        attemptId,
        { operationId: crypto.randomUUID(), reason: "candidate cannot" },
        t.candidateToken,
      );
      expect(res.statusCode).toBe(403);
      expect(res.json().error?.code).toBe("PERMISSION_DENIED");

      const requestId = res.headers["x-request-id"] as string;
      const denied = deniedLines(requestId);
      expect(denied).toHaveLength(1);
      expect(Object.keys(denied[0]!).sort()).toEqual(DENIED_LINE_KEYS);
      expect(denied[0]!.event).toBe(DENIED_EVENT);
      expect(denied[0]!.command).toBe("force_submit");
      expect(denied[0]!.outcome).toBe("forbidden");
      // Inherited child-logger bindings carry the CALLER's own identity only.
      expect(denied[0]!.actorId).toBe(t.candidateUserId);
      expect(denied[0]!.actorRole).toBe("Candidate");
      expect(denied[0]!.organizationId).toBe(t.orgId);
      expect(completedLines(requestId)).toHaveLength(0);
    });

    it("404 for a nonexistent attempt: one denied not_found", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const res = await forceSubmit(t, crypto.randomUUID(), {
        operationId: crypto.randomUUID(),
        reason: "missing target",
      });
      expect(res.statusCode).toBe(404);
      const requestId = res.headers["x-request-id"] as string;
      const denied = deniedLines(requestId);
      expect(denied).toHaveLength(1);
      expect(denied[0]!.outcome).toBe("not_found");
    });

    it("404 anti-enumeration: a cross-organization target is logged with the SAME not_found value", async () => {
      const orgA = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07A",
      });
      const orgB = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07B",
      });
      const { attemptId } = await createStartedAttempt(orgA, "W07 CrossOrg");

      const res = await forceSubmit(orgB, attemptId, {
        operationId: crypto.randomUUID(),
        reason: "cross-org target",
      });
      expect(res.statusCode).toBe(404);
      const requestId = res.headers["x-request-id"] as string;
      const denied = deniedLines(requestId);
      expect(denied).toHaveLength(1);
      // Uniform value — no private "actually cross-org" classification.
      expect(denied[0]!.outcome).toBe("not_found");
      // Anti-leak by value: the inherited organizationId is the CALLER's own
      // org (orgB), never the denied target's org (orgA); no target
      // attemptId either.
      expect(denied[0]!.organizationId).toBe(orgB.orgId);
      expect(denied[0]!.organizationId).not.toBe(orgA.orgId);
      expect(denied[0]!.actorId).toBe(orgB.adminUserId);
      expect("attemptId" in denied[0]!).toBe(false);
      expect("operationId" in denied[0]!).toBe(false);
    });

    it("409 invalid state (voided attempt): one denied conflict, zero completed", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Voided");
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));
      const res = await forceSubmit(t, attemptId, {
        operationId: crypto.randomUUID(),
        reason: "voided",
      });
      expect(res.statusCode).toBe(409);
      const requestId = res.headers["x-request-id"] as string;
      expect(completedLines(requestId)).toHaveLength(0);
      const denied = deniedLines(requestId);
      expect(denied).toHaveLength(1);
      expect(denied[0]!.outcome).toBe("conflict");
    });

    it("409 payload drift on a committed operationId: one denied conflict (time-grant command)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Drift");
      const operationId = crypto.randomUUID();
      await timeGrant(t, attemptId, {
        operationId,
        addedSeconds: 300,
        reasonCode: "candidate_request",
        reasonText: "first",
      });
      const res = await timeGrant(t, attemptId, {
        operationId,
        addedSeconds: 999,
        reasonCode: "candidate_request",
        reasonText: "drifted",
      });
      expect(res.statusCode).toBe(409);
      const requestId = res.headers["x-request-id"] as string;
      expect(completedLines(requestId)).toHaveLength(0);
      const denied = deniedLines(requestId);
      expect(denied).toHaveLength(1);
      expect(denied[0]!.command).toBe("time_grant");
      expect(denied[0]!.outcome).toBe("conflict");
    });

    it("misconduct (out-of-scope admin command) emits NO admin.command.* lines, on success or denial", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Scope");

      const deniedRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
        payload: {
          operationId: crypto.randomUUID(),
          severity: "warning",
          notes: "scope probe",
        },
        cookies: { "auth-token": t.candidateToken },
      });
      expect(deniedRes.statusCode).toBe(403);

      const okRes = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/misconduct`,
        payload: {
          operationId: crypto.randomUUID(),
          severity: "warning",
          notes: "scope probe",
        },
        cookies: { "auth-token": t.adminToken },
      });
      expect(okRes.statusCode).toBe(200);
      expect(adminCommandEventLines()).toHaveLength(0);
    });
  });

  describe("W07-8 replay zero-write with signal", () => {
    it("pre-read replay opens NO transaction, mutates nothing, and still emits completed", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 ZeroWrite");
      const operationId = crypto.randomUUID();
      await forceSubmit(t, attemptId, { operationId, reason: "first" });
      const before = await listReceipts(attemptId);
      const auditsBefore = await countForceSubmitAudits(attemptId);

      // Any transaction attempt during the replay request fails loudly —
      // proving the committed-receipt pre-read path opens no new transaction.
      const restore = failTransactions("all", "P0001");
      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, { operationId, reason: "first" });
      } finally {
        restore();
      }
      expect(res.statusCode).toBe(200);
      expect(res.json().disposition).toBe("idempotent_replay");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.disposition).toBe("idempotent_replay");

      // Stored facts unchanged — byte-equal receipt rows, no new audit.
      const after = await listReceipts(attemptId);
      expect(after).toEqual(before);
      expect(await countForceSubmitAudits(attemptId)).toHaveLength(
        auditsBefore.length,
      );
    });
  });

  describe("W07-9 committed fact survives a wire-exit failure on the REAL routes", () => {
    it("force-submit: send-phase failure after commit keeps one completed, no false denied (production hook installed), business fact intact", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 WireFault");
      const operationId = crypto.randomUUID();

      // Arm the one-shot send fault, then hit the REAL production route
      // (registered by attempts.admin.ts WITH the production
      // adminCommandDeniedOnResponse hook — unlike the old variant-route
      // probe, this asserts the hook itself stays silent on a wire fault).
      armResponseSendFault = true;
      let res: Awaited<ReturnType<typeof forceSubmit>>;
      try {
        res = await forceSubmit(t, attemptId, {
          operationId,
          reason: "wire fault probe",
        });
      } finally {
        armResponseSendFault = false;
      }
      expect(res.statusCode).toBe(500);
      expect(res.json().error?.code).toBe("INTERNAL_ERROR");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.outcome).toBe("applied");
      expect(linesForRequest[0]!.disposition).toBe("applied");
      // A wire failure is NOT a denial — the production hook observes this
      // 500 and must not emit admin.command.denied.
      expect(deniedLines(requestId)).toHaveLength(0);
      // The business fact really committed.
      expect(await listReceipts(attemptId)).toHaveLength(1);
    });

    it("time-grant: send-phase failure after commit keeps one completed, no false denied (production hook installed), ledger committed", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 GrantWire");
      const operationId = crypto.randomUUID();

      armResponseSendFault = true;
      let res: Awaited<ReturnType<typeof timeGrant>>;
      try {
        res = await timeGrant(t, attemptId, {
          operationId,
          addedSeconds: 300,
          reasonCode: "candidate_request",
          reasonText: "wire fault probe",
        });
      } finally {
        armResponseSendFault = false;
      }
      expect(res.statusCode).toBe(500);
      expect(res.json().error?.code).toBe("INTERNAL_ERROR");

      const requestId = res.headers["x-request-id"] as string;
      const linesForRequest = completedLines(requestId);
      expect(linesForRequest).toHaveLength(1);
      expect(linesForRequest[0]!.command).toBe("time_grant");
      expect(linesForRequest[0]!.outcome).toBe("applied");
      expect(linesForRequest[0]!.disposition).toBe("granted");
      expect(deniedLines(requestId)).toHaveLength(0);
      // The adjustment ledger row really committed.
      const adjustments = await ctx.db
        .select()
        .from(schema.attemptTimeAdjustments)
        .where(eq(schema.attemptTimeAdjustments.attemptId, attemptId));
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.operationId).toBe(operationId);
    });
  });

  describe("common counter-examples: privacy, isolation, cross-org partitioning", () => {
    it("synthetic privacy markers never reach any admin.command line (reason, URL, error text)", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Privacy");
      const marker = `SECRET-MARKER-${crypto.randomUUID()}`;

      await forceSubmit(t, attemptId, {
        operationId: crypto.randomUUID(),
        reason: `visible reason carrying ${marker}`,
      });
      await forceSubmit(t, crypto.randomUUID(), {
        operationId: crypto.randomUUID(),
        reason: `denied target carrying ${marker}`,
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/force-submit?leak=${marker}`,
        payload: { operationId: crypto.randomUUID(), reason: "url marker" },
        cookies: { "auth-token": t.adminToken },
      });
      await forceSubmit(t, attemptId, {
        operationId: "",
        reason: `schema-fail carrying ${marker}`,
      });

      const eventLines = adminCommandEventLines();
      expect(eventLines.length).toBeGreaterThanOrEqual(2);
      const completedRawTag = `"event":"${COMPLETED_EVENT}"`;
      const deniedRawTag = `"event":"${DENIED_EVENT}"`;
      for (const raw of rawLines()) {
        if (raw.includes(completedRawTag) || raw.includes(deniedRawTag)) {
          expect(raw).not.toContain(marker);
        }
      }
    });

    it("emitter synchronous throw cannot change a committed outcome (isolation boundary)", async () => {
      const throwingLog = {
        info() {
          throw new Error("sync sink failure");
        },
      };
      // The boundary must swallow the synchronous failure…
      expect(() =>
        emitForceSubmitCommandCompleted(
          { log: throwingLog } as unknown as Parameters<
            typeof emitForceSubmitCommandCompleted
          >[0],
          {
            attemptId: "att",
            operationId: "op",
            disposition: "applied",
          },
        ),
      ).not.toThrow();
      // …and a real request with a healthy sink still works end-to-end.
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Isolation");
      const res = await forceSubmit(t, attemptId, {
        operationId: crypto.randomUUID(),
        reason: "isolation",
      });
      expect(res.statusCode).toBe(200);
      expect(
        completedLines(res.headers["x-request-id"] as string),
      ).toHaveLength(1);
    });

    it("two organizations interleaved: request identities and completed facts do not cross", async () => {
      const orgA = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07A",
      });
      const orgB = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07B",
      });
      const a = await createStartedAttempt(orgA, "W07 Interleave A");
      const b = await createStartedAttempt(orgB, "W07 Interleave B");
      const opA = crypto.randomUUID();
      const opB = crypto.randomUUID();

      const [resA, resB] = await Promise.all([
        forceSubmit(orgA, a.attemptId, { operationId: opA, reason: "A" }),
        forceSubmit(orgB, b.attemptId, { operationId: opB, reason: "B" }),
      ]);
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);

      const idA = resA.headers["x-request-id"] as string;
      const idB = resB.headers["x-request-id"] as string;
      const lineA = completedLines(idA);
      const lineB = completedLines(idB);
      expect(lineA).toHaveLength(1);
      expect(lineB).toHaveLength(1);
      expect(lineA[0]!.attemptId).toBe(a.attemptId);
      expect(lineA[0]!.operationId).toBe(opA);
      expect(lineB[0]!.attemptId).toBe(b.attemptId);
      expect(lineB[0]!.operationId).toBe(opB);
      // Partition check: every completed line joins exactly one request.
      for (const line of completedLines()) {
        const owner =
          line.reqId === idA ? "A" : line.reqId === idB ? "B" : "foreign";
        expect(owner).not.toBe("foreign");
      }
    });

    it("raw completed/denied line byte sizes stay within the event budget", async () => {
      const t = await createIsolatedAttemptOrg(ctx, {
        slugPrefix: SLUG_PREFIX,
        label: "W07",
      });
      const { attemptId } = await createStartedAttempt(t, "W07 Bytes");
      const operationId = crypto.randomUUID();
      await forceSubmit(t, attemptId, { operationId, reason: "bytes" });
      await forceSubmit(t, crypto.randomUUID(), {
        operationId: crypto.randomUUID(),
        reason: "bytes denied",
      });

      const completedRaw = rawLines().find((l) =>
        l.includes(`"event":"${COMPLETED_EVENT}"`),
      );
      const deniedRaw = rawLines().find((l) =>
        l.includes(`"event":"${DENIED_EVENT}"`),
      );
      expect(completedRaw).toBeDefined();
      expect(deniedRaw).toBeDefined();
      // Raw-line budget, pinned like the #1006 retry-WARN 512 B bound. As-built
      // reference measurements (real Pino JSON, full line incl. envelope +
      // inherited caller bindings + the catalog event field): completed 445 B
      // (event payload 208 B), denied 313 B (payload 79 B) — see
      // docs/contracts/observability.md.
      expect(completedRaw!.length).toBeLessThanOrEqual(MAX_EVENT_LINE_BYTES);
      expect(deniedRaw!.length).toBeLessThanOrEqual(MAX_EVENT_LINE_BYTES);
    });
  });
});
