/**
 * #1006 — cross-tenant interleaved retry correlation (Owner acceptance evidence 1).
 *
 * #1006 requires two interleaved organizations/requests to keep separate,
 * correct correlation. The answer-save route passes identity EXPLICITLY per call
 * (no ALS/global state), but structural isolation is not counter-evidence:
 * this file runs two authenticated candidates from two DISTINCT organizations
 * concurrently through the real HTTP save route and asserts that every
 * `transaction retry` WARN's COMPLETE closed correlation payload
 * (requestId/attemptId/organizationId/operation) belongs to its own request,
 * with an explicit no-cross-contamination partition check.
 *
 * Determinism WITHOUT timing luck: the injected retryable failure is a
 * two-party barrier at the driver boundary (`db.transaction`). Both requests
 * are issued concurrently; their FIRST transaction attempts are parked until
 * both have arrived, then released together, so both fail with the injected
 * SQLSTATE while the other is provably in flight, their retries overlap, and
 * the subsequent attempts run against the REAL database. No sleep, no
 * "usually fast enough" assumption: correctness depends only on the barrier.
 *
 * Real-PostgreSQL 40001/40P01 retry/backoff ownership stays with
 * `packages/db/src/transactionRetry.test.ts` (deadlock 40P01) and the
 * exam-668 concurrency suite (real 40001 through this same save route); their
 * HEAD results are reported in the PR evidence, so this file deliberately does
 * not claim a real-PG fault.
 *
 * Volume bound (acceptance evidence 3): every raw WARN line is asserted
 * <= 512 bytes, pinning the event-shape amplitude for the retry-only emit.
 */
import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { cleanupOrganizationTestData } from "@exam/db/testCleanup";
import { schema } from "@exam/db/schema/pg";
import { setTransactionRetryLogger } from "@exam/db/types";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { setupRequestIdHeader } from "../../plugins/requestIdHeader.js";
import {
  buildExamPayload,
  createIsolatedAttemptOrg,
  type IsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

type LogLine = Record<string, unknown>;

const RETRY_MSG = "transaction retry";
const COMPLETED_MSG = "request completed";
const SLUG_PREFIX = "retry-correlation-cross-tenant-";
/** Raw pino line upper bound for one retry WARN (event-shape amplitude). */
const MAX_WARN_LINE_BYTES = 512;
/** Bounded fail-fast for the two-party barrier (not a correctness wait). */
const BARRIER_TIMEOUT_MS = 10_000;

describe("POST /attempts/:attemptId/answers — cross-tenant retry correlation (#1006)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgA: IsolatedAttemptOrg;
  let orgB: IsolatedAttemptOrg;
  let attemptA: string;
  let attemptB: string;

  const logChunks: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: (err?: Error | null) => void) {
      logChunks.push(chunk.toString());
      cb();
    },
  });

  let restoreTransaction: (() => void) | undefined;

  function rawLines(): string[] {
    return logChunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.trim().startsWith("{"));
  }

  function parsedLines(): LogLine[] {
    return rawLines().map((line) => JSON.parse(line) as LogLine);
  }

  function correlationOf(line: LogLine): Record<string, unknown> {
    return line.correlation as Record<string, unknown>;
  }

  function retryWarnsFor(requestId: string): LogLine[] {
    return parsedLines().filter(
      (line) =>
        line.msg === RETRY_MSG && correlationOf(line).requestId === requestId,
    );
  }

  /**
   * Two-party failure barrier: the first transaction attempt of each of the
   * two interleaved requests parks until the peer also arrives, then both throw
   * the injected SQLSTATE. Later attempts delegate to the real transaction.
   */
  interface TwoPartyFailureBarrier {
    /** Resolves once one transaction attempt from EACH request is parked. */
    bothArrived: Promise<void>;
    /** Releases both parked attempts with the injected SQLSTATE. */
    release: () => void;
    restore: () => void;
  }

  function installTwoPartyFailureBarrier(): TwoPartyFailureBarrier {
    const db = ctx.db as unknown as Record<string, unknown>;
    const original = (
      db.transaction as (...args: unknown[]) => Promise<unknown>
    ).bind(db);

    let transactionCalls = 0;
    const parked: Array<() => void> = [];
    let bothArrived: () => void = () => {};
    const bothArrivedPromise = new Promise<void>((resolve) => {
      bothArrived = resolve;
    });

    db.transaction = async (fn: unknown, config: unknown) => {
      transactionCalls += 1;
      if (transactionCalls <= 2) {
        await new Promise<void>((release) => {
          parked.push(release);
          if (parked.length === 2) {
            bothArrived();
          }
        });
        throw Object.assign(new Error("could not serialize access"), {
          code: "40001",
        });
      }
      return original(fn, config);
    };

    return {
      bothArrived: bothArrivedPromise,
      release: () => {
        for (const release of parked) {
          release();
        }
      },
      restore: () => {
        Reflect.deleteProperty(db, "transaction");
      },
    };
  }

  async function createStartedAttempt(
    org: IsolatedAttemptOrg,
    examTitle: string,
  ): Promise<string> {
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: examTitle,
        courseId: org.courseId,
        questionIds: [org.questionId],
        durationMinutes: 60,
      }),
      cookies: { "auth-token": org.adminToken },
    });
    expect(examRes.statusCode).toBe(201);
    const examId = examRes.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": org.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [org.candidateProfileId] },
      cookies: { "auth-token": org.adminToken },
    });
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": org.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    return startRes.json().id as string;
  }

  function saveAnswer(org: IsolatedAttemptOrg, attemptId: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${org.questionId}`,
      payload: {
        attemptId,
        questionId: org.questionId,
        answer: "b",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": org.candidateToken },
    });
  }

  beforeAll(async () => {
    const combinedPlugin: FastifyPluginAsync = async (fastify) => {
      setupRequestIdHeader(fastify);
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    };
    ctx = await buildTestApp(combinedPlugin, {
      logger: { level: "info", stream: logStream },
    });
    // Production wiring owner: plugins/db.ts:35 (buildTestApp's reduced db
    // plugin only decorates `fastify.db`).
    setTransactionRetryLogger(ctx.app.log);

    const suffix = uniquePrefix();
    orgA = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: `${SLUG_PREFIX}a-${suffix}-`,
      label: "Cross Tenant A",
    });
    orgB = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: `${SLUG_PREFIX}b-${suffix}-`,
      label: "Cross Tenant B",
    });
    attemptA = await createStartedAttempt(orgA, "Cross Tenant Exam A");
    attemptB = await createStartedAttempt(orgB, "Cross Tenant Exam B");
  });

  afterAll(async () => {
    setTransactionRetryLogger(null);
    await ctx.drainAuditWritesStrict();
    const stale = await ctx.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(like(schema.organizations.slug, `${SLUG_PREFIX}%`));
    for (const org of stale) {
      await cleanupOrganizationTestData(ctx.db, org.id);
    }
    await ctx.drainAuditWritesStrict();
    await ctx.cleanup();
  });

  beforeEach(() => {
    logChunks.length = 0;
    restoreTransaction?.();
    restoreTransaction = undefined;
  });

  it("keeps each in-flight request's retry correlation bound to its own org/request/attempt", async () => {
    const barrier = installTwoPartyFailureBarrier();
    restoreTransaction = barrier.restore;

    const pendingA = saveAnswer(orgA, attemptA);
    const pendingB = saveAnswer(orgB, attemptB);

    // Bounded fail-fast: the barrier is the correctness mechanism; this race
    // only prevents an indefinite hang if the fixture is broken.
    await Promise.race([
      barrier.bothArrived,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("two-party barrier timed out")),
          BARRIER_TIMEOUT_MS,
        ),
      ),
    ]);
    barrier.release();

    const [resA, resB] = await Promise.all([pendingA, pendingB]);
    restoreTransaction?.();
    restoreTransaction = undefined;

    // The saves themselves are real: both complete after their own retry.
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.json().accepted).toBe(true);
    expect(resB.json().accepted).toBe(true);

    const requestIdA = resA.headers["x-request-id"] as string;
    const requestIdB = resB.headers["x-request-id"] as string;
    expect(requestIdA).toBeTruthy();
    expect(requestIdB).toBeTruthy();
    expect(requestIdA).not.toBe(requestIdB);

    const warnsA = retryWarnsFor(requestIdA);
    const warnsB = retryWarnsFor(requestIdB);

    // Exactly one retried failure per request: the injected attempt warned,
    // the terminal blowup would not.
    expect(warnsA.map((line) => line.attempt)).toEqual([1]);
    expect(warnsB.map((line) => line.attempt)).toEqual([1]);
    expect(warnsA.every((line) => line.sqlstate === "40001")).toBe(true);
    expect(warnsB.every((line) => line.sqlstate === "40001")).toBe(true);

    const assertOwnIdentity = (
      warns: LogLine[],
      own: {
        requestId: string;
        attemptId: string;
        organizationId: string;
      },
    ): void => {
      for (const warn of warns) {
        const correlation = warn.correlation as Record<string, unknown>;
        // Complete closed payload: exact key set, exact own values.
        expect(Object.keys(correlation).sort()).toEqual([
          "attemptId",
          "operation",
          "organizationId",
          "requestId",
        ]);
        expect(correlation).toEqual({
          requestId: own.requestId,
          attemptId: own.attemptId,
          organizationId: own.organizationId,
          operation: "attempt.answer.save",
        });
      }
    };
    assertOwnIdentity(warnsA, {
      requestId: requestIdA,
      attemptId: attemptA,
      organizationId: orgA.orgId,
    });
    assertOwnIdentity(warnsB, {
      requestId: requestIdB,
      attemptId: attemptB,
      organizationId: orgB.orgId,
    });

    // Explicit no-cross-contamination partition: each requestId owns exactly
    // its own identity tuple, and the two identity sets are disjoint.
    const identities = (warns: LogLine[]) =>
      new Set(
        warns.map((warn) => {
          const correlation = warn.correlation as Record<string, unknown>;
          return `${correlation.requestId}|${correlation.attemptId}|${correlation.organizationId}`;
        }),
      );
    const identitiesA = identities(warnsA);
    const identitiesB = identities(warnsB);
    expect(identitiesA.size).toBe(1);
    expect(identitiesB.size).toBe(1);
    for (const identity of identitiesA) {
      expect(identitiesB.has(identity)).toBe(false);
    }
    const attemptIdsSeen = [...identitiesA, ...identitiesB].map(
      (identity) => identity.split("|")[1],
    );
    expect(new Set(attemptIdsSeen)).toEqual(new Set([attemptA, attemptB]));

    // The request-trace join still lands on the same request identity.
    for (const requestId of [requestIdA, requestIdB]) {
      const trace = parsedLines().find(
        (line) => line.msg === COMPLETED_MSG && line.reqId === requestId,
      );
      expect(trace).toBeDefined();
      expect((trace?.res as { statusCode?: number }).statusCode).toBe(200);
    }

    // Event-shape / amplitude bound: retry-only lines stay small and bounded.
    const rawWarnLines = rawLines().filter((line) =>
      line.includes(`"msg":"${RETRY_MSG}"`),
    );
    expect(rawWarnLines).toHaveLength(2);
    for (const line of rawWarnLines) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(
        MAX_WARN_LINE_BYTES,
      );
    }
  });
});
