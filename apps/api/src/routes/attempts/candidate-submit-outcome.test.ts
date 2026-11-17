import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Writable } from "node:stream";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  setTransactionRetryLogger,
  executeInTransaction,
} from "@exam/db/types";
import { schema } from "@exam/db/schema/pg";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createAttemptGradingEntryRepo } from "@exam/db/repository/attemptGradingEntryRepo";
import { createAttemptInterruptionRepo } from "@exam/db/repository/attemptInterruptionRepo";
import { createAttemptInterruptionEventRepo } from "@exam/db/repository/attemptInterruptionEventRepo";
import { submitAttempt, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import {
  NotFoundError,
  type Permission as DomainPermission,
  type RequestContext,
} from "@exam/domain";
import { Permission } from "@exam/authz";
import { buildTestApp } from "../testHelpers.js";
import { setupRequestIdHeader } from "../../plugins/requestIdHeader.js";
import { getRequestContext } from "../helpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { submitAndGradeAttempt } from "../../orchestrators/submitAndGradeAttempt.js";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { createCandidateRepo } from "@exam/db/repository/candidateRepo";
import {
  buildExamPayload,
  enrollCandidateForExam,
  ensureCandidateProfile,
  createIsolatedAttemptOrg,
} from "./__tests__/attempts.testHelpers.js";

/**
 * #1007 — commit-authoritative submit outcome
 * (`attempt.submit.completed`, five-value classification).
 *
 * Every semantic test runs against REAL PostgreSQL through the REAL
 * `/attempts/:attemptId/submit` route, and every log assertion reads the real
 * Pino serialization output captured at the Fastify logger's stream (the
 * #1020 pattern): `logger:false` app builds can prove business behavior but not
 * log semantics, so they are not used here.
 *
 * Commit-authoritative means the line may exist only after the winning
 * transaction's COMMIT is confirmed:
 *  - intermediate attempts that classify and then fail at COMMIT emit nothing
 *    (deferred constraint triggers raise DURING commit, i.e. after the
 *    callback returned — the deterministic proof that "callback finished" is
 *    not "committed");
 *  - audit mid-tx failures, retry exhaustion, permanent commit faults and
 *    state-machine rejections emit nothing;
 *  - after COMMIT, a later response-construction failure (the orchestrator's
 *    internal re-read, the route's exam re-read 404, parse 400 or
 *    serialization 500) must not lose or rewrite the line.
 *
 * The classification channel itself (`SubmitOutcomeClassification`) is
 * additionally pinned by the crash-recovery fixtures here and by the
 * deadline-authority race suite (different-branch retry: the aborted pass
 * never leaks its would-be classification into the winner's line).
 */

type LogLine = Record<string, unknown>;

const COMPLETED_EVENT = "attempt.submit.completed";
const RETRY_MSG = "transaction retry";

describe("candidate submit outcome — attempt.submit.completed (#1007)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let candidateProfileId: string;
  let courseId: string;
  let objectiveQuestionId: string;
  let subjectiveQuestionId: string;
  let restoreTransaction: (() => void) | undefined;

  // Real Pino output at info level (retry WARNs, request traces and the new
  // completed lines all land in the SAME stream so the reqId joins are real).
  const logChunks: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc: unknown, cb: (err?: Error | null) => void) {
      logChunks.push(chunk.toString());
      cb();
    },
  });

  function lines(): LogLine[] {
    return logChunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line) as LogLine);
  }

  function rawCompletedLines(): string[] {
    return logChunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.includes(COMPLETED_EVENT));
  }

  function completedLines(): LogLine[] {
    return lines().filter((line) => line.event === COMPLETED_EVENT);
  }

  function retryWarns(): LogLine[] {
    return lines().filter((line) => line.msg === RETRY_MSG);
  }

  function sharedCandidateCtx(): RequestContext {
    return {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Candidate",
      permissions: [] as DomainPermission[],
      sessionId: "candidate-submit-outcome-test",
    };
  }

  beforeAll(async () => {
    const combinedPlugin: FastifyPluginAsync = async (fastify) => {
      setupRequestIdHeader(fastify);
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });

      // Test-only mirror of the production submit route whose ONLY deviation
      // is a fault injected AFTER submitAndGradeAttempt resolves (matrix 9:
      // the production post-commit failure family is the exam re-read 404,
      // the response parse 400 and the serialization 500 — all after the
      // emission point). Business path, transaction and emission are real.
      fastify.post(
        "/attempts/:attemptId/submit-postcommit-fault",
        {
          preHandler: [
            fastify.authenticate,
            fastify.requireOwnAttempt(Permission.AttemptSubmit, "attemptId"),
          ],
        },
        async (request) => {
          const reqCtx = getRequestContext(request);
          const { attemptId } = request.params as { attemptId: string };
          const profile = await createCandidateRepo(fastify.db).findByUserId(
            reqCtx,
            reqCtx.actorId,
          );
          if (!profile) {
            throw new NotFoundError("Candidate profile not found");
          }
          await submitAndGradeAttempt(
            fastify.db,
            reqCtx,
            attemptId,
            profile.id,
            fastify.now(),
            { request },
          );
          throw new NotFoundError("Exam not found (injected post-commit)");
        },
      );
    };
    ctx = await buildTestApp(combinedPlugin, {
      logger: { level: "info", stream: logStream },
    });
    // Production wiring owner: plugins/db.ts (retry WARNs must be observable
    // for the commit-fault matrix rows).
    setTransactionRetryLogger(ctx.app.log);

    const now = new Date();
    courseId = crypto.randomUUID();
    objectiveQuestionId = crypto.randomUUID();
    subjectiveQuestionId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Submit Outcome Course",
      code: `SOC-${crypto.randomUUID().slice(0, 8)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.questions).values({
      id: objectiveQuestionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "objective submit outcome question",
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
        { id: "c", content: "3" },
      ],
      standardAnswer: "b",
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
    });
    await ctx.db.insert(schema.questions).values({
      id: subjectiveQuestionId,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: "subjective submit outcome question",
      options: [],
      standardAnswer: null,
      rubric: "Score 0-100 by clarity.",
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
    });
    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    setTransactionRetryLogger(null);
    await ctx.cleanup();
  });

  beforeEach(() => {
    logChunks.length = 0;
    restoreTransaction = undefined;
  });

  afterEach(() => {
    restoreTransaction?.();
    restoreTransaction = undefined;
  });

  /** Creates + publishes + enrolls an exam and starts one attempt. */
  async function createStartedAttempt(opts: {
    title: string;
    questionIds: string[];
    durationMinutes?: number;
  }): Promise<{ examId: string; attemptId: string; deadlineAt: Date }> {
    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: buildExamPayload({
        title: opts.title,
        courseId,
        questionIds: opts.questionIds,
        durationMinutes: opts.durationMinutes ?? 60,
      }),
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode).toBe(201);
    const examId = examRes.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await enrollCandidateForExam(ctx, candidateProfileId, examId);
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    return {
      examId,
      attemptId: startRes.json().id as string,
      deadlineAt: new Date(startRes.json().deadlineAt as string),
    };
  }

  async function saveObjectiveAnswer(attemptId: string): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${objectiveQuestionId}`,
      payload: {
        attemptId,
        questionId: objectiveQuestionId,
        answer: "b",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
  }

  async function submit(attemptId: string) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
  }

  async function attemptRow(attemptId: string) {
    const rows = await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    return rows[0]!;
  }

  async function countSubmitAudits(attemptId: string): Promise<number> {
    await ctx.drainAuditWrites();
    const rows = await ctx.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetId, attemptId),
          eq(schema.auditLogs.action, "attempt.submit"),
        ),
      );
    return rows.length;
  }

  /** Fires the FIRST `count` transactions with the SQLSTATE pre-callback (#1020 pattern). */
  function failTransactions(count: number | "all", sqlstate = "40001"): void {
    const db = ctx.db as unknown as Record<string, unknown>;
    const original = (
      db.transaction as (...args: unknown[]) => Promise<unknown>
    ).bind(db);
    let remaining = count;
    db.transaction = async (fn: unknown, config: unknown) => {
      if (remaining === "all" || remaining > 0) {
        if (remaining !== "all") remaining -= 1;
        throw Object.assign(new Error("could not serialize access"), {
          code: sqlstate,
        });
      }
      return original(fn, config);
    };
    restoreTransaction = () => {
      Reflect.deleteProperty(db, "transaction");
    };
  }

  /** Undoes {@link failTransactions} inside a test body (narrowing-safe). */
  function restoreFailedTransactions(): void {
    restoreTransaction?.();
    restoreTransaction = undefined;
  }

  /**
   * Faults the orchestrator's INTERNAL post-commit response re-read — the
   * out-of-tx `attemptRepo.findById` that runs after COMMIT is confirmed
   * (matrix 9b; distinct from matrix 9, whose fault sits at the ROUTE's
   * response construction, after the orchestrator has fully returned — a
   * passing matrix 9 alone cannot tell an emit placed before the internal
   * re-read from one placed after it).
   *
   * Why the DB-client boundary: PostgreSQL has no SELECT-time trigger, and
   * permission revocation or backend termination cannot be deterministically
   * interleaved between COMMIT and this single read, so a real-SQL fault at
   * exactly this point is not constructible. The injection instead wraps
   * the shared db handle's own methods — the same external boundary (and
   * suite pattern) the `failTransactions` helper above already uses for
   * `db.transaction`: `db.transaction` delegates to the real driver and
   * arms the fault only after it resolves (the awaited resolve IS the
   * COMMIT confirmation `executeInTransaction` is built on), then the
   * FIRST `db.select` on the armed handle throws once — precisely the
   * orchestrator's re-read, the only post-commit read through this handle
   * in that request. Transaction, commit, repositories, emitter, logger
   * and the global error handler all stay real.
   */
  function installPostCommitReReadFault(): void {
    const db = ctx.db as unknown as Record<string, unknown>;
    const originalTransaction = (
      db.transaction as (...args: unknown[]) => Promise<unknown>
    ).bind(ctx.db);
    const originalSelect = (db.select as (...args: unknown[]) => unknown).bind(
      ctx.db,
    );
    const selectWasOwn = Object.prototype.hasOwnProperty.call(db, "select");
    let committed = false;
    db.transaction = async (fn: unknown, config: unknown) => {
      const result = await originalTransaction(fn, config);
      // Arm only after the awaited resolve: that is COMMIT confirmed
      // (`executeInTransaction` = `return await db.transaction(...)`).
      committed = true;
      return result;
    };
    db.select = (...args: unknown[]) => {
      if (committed) {
        // One-shot: fault exactly the first post-commit read — the
        // orchestrator's re-read — then disarm so later verification
        // reads through this handle succeed.
        committed = false;
        throw new Error("injected post-commit response re-read fault");
      }
      return originalSelect(...args);
    };
    restoreTransaction = () => {
      Reflect.deleteProperty(db, "transaction");
      if (selectWasOwn) {
        db.select = originalSelect;
      } else {
        Reflect.deleteProperty(db, "select");
      }
    };
  }

  /**
   * Installs a DEFERRABLE INITIALLY DEFERRED constraint trigger that raises
   * at COMMIT time (after the transaction callback returned) on the attempt's
   * submitted_at null->set transition. `sqlstate` selects retryability:
   * "40001" (retryable commit fault, fired once via the sequence) or "23514"
   * (permanent commit fault, fires on every commit). Sequences are
   * non-transactional, so the fire-once marker survives the rollback of the
   * attempt it doomed — the deterministic retry discriminator.
   */
  async function installCommitFault(
    sqlstate: "40001" | "23514",
  ): Promise<() => Promise<void>> {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.execute(
      sql.raw(`CREATE SEQUENCE submit_outcome_fault_seq_${suffix}`),
    );
    await ctx.db.execute(
      sql.raw(`
        CREATE FUNCTION submit_outcome_commit_fault_${suffix}() RETURNS trigger AS $$
        BEGIN
          ${
            sqlstate === "40001"
              ? `IF nextval('submit_outcome_fault_seq_${suffix}') = 1 THEN`
              : "IF TRUE THEN"
          }
            RAISE EXCEPTION 'injected commit-phase fault' USING ERRCODE = '${sqlstate}';
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql
      `),
    );
    await ctx.db.execute(
      sql.raw(`
        CREATE CONSTRAINT TRIGGER submit_outcome_commit_fault_t_${suffix}
        AFTER UPDATE ON exam_attempts
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        WHEN (NEW.submitted_at IS NOT NULL AND OLD.submitted_at IS NULL)
        EXECUTE FUNCTION submit_outcome_commit_fault_${suffix}()
      `),
    );
    return async () => {
      await ctx.db.execute(
        sql.raw(
          `DROP TRIGGER IF EXISTS submit_outcome_commit_fault_t_${suffix} ON exam_attempts`,
        ),
      );
      await ctx.db.execute(
        sql.raw(
          `DROP FUNCTION IF EXISTS submit_outcome_commit_fault_${suffix}()`,
        ),
      );
      await ctx.db.execute(
        sql.raw(`DROP SEQUENCE IF EXISTS submit_outcome_fault_seq_${suffix}`),
      );
    };
  }

  /** Installs the audit_atomicity-style BEFORE INSERT fault on attempt.submit. */
  async function installSubmitAuditFailure(): Promise<() => Promise<void>> {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    await ctx.db.execute(
      sql.raw(`
        CREATE FUNCTION submit_outcome_audit_fault_${suffix}() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'injected attempt submit audit failure';
        END;
        $$ LANGUAGE plpgsql
      `),
    );
    await ctx.db.execute(
      sql.raw(`
        CREATE TRIGGER submit_outcome_audit_fault_t_${suffix}
        BEFORE INSERT ON audit_logs
        FOR EACH ROW
        WHEN (NEW.action = 'attempt.submit')
        EXECUTE FUNCTION submit_outcome_audit_fault_${suffix}()
      `),
    );
    return async () => {
      await ctx.db.execute(
        sql.raw(
          `DROP TRIGGER IF EXISTS submit_outcome_audit_fault_t_${suffix} ON audit_logs`,
        ),
      );
      await ctx.db.execute(
        sql.raw(
          `DROP FUNCTION IF EXISTS submit_outcome_audit_fault_${suffix}()`,
        ),
      );
    };
  }

  /**
   * Crash-recovery fixture: runs the REAL engine submit (freeze + workset
   * materialization) in its own committed transaction WITHOUT the grading
   * step — the exact "submit landed, grading didn't" state the orchestrator's
   * `submitted` entry branch exists for.
   */
  async function submitOnlyViaEngine(attemptId: string): Promise<void> {
    const candidateCtx = sharedCandidateCtx();
    await executeInTransaction(ctx.db, async (tx) => {
      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: createAttemptRepo(tx),
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        candidateCtx,
      );
      await lockEnrollmentAndAttempt(enrollments, attempts, attemptId);
      const attempt = await attempts.findById(attemptId);
      if (!attempt) throw new NotFoundError("Attempt not found");
      const workset = createGradingWorksetRepoAdapter(
        createAttemptGradingEntryRepo(tx),
        candidateCtx,
      );
      await submitAttempt(attempts, workset, attemptId, new Date(), {
        source: "candidate",
        minSubmitAfterStartMinutes:
          (await exams.findById(attempt.examId))?.minSubmitAfterStartMinutes ??
          null,
        resolution: {
          mode: "none",
          episodeRepo: createInterruptionEpisodeRepoAdapter(
            createAttemptInterruptionRepo(tx),
            candidateCtx,
          ),
          eventRepo: createInterruptionEventRepoAdapter(
            createAttemptInterruptionEventRepo(tx),
            candidateCtx,
          ),
        },
      });
    });
  }

  it("matrix 1a: fresh objective submit emits exactly one completed line (graded) joined to the request identity", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Fresh Objective",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    const res = await submit(attemptId);
    expect(res.statusCode).toBe(200);

    const requestId = res.headers["x-request-id"] as string;
    expect(requestId).toBeTruthy();

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    const line = emitted[0]!;
    // Closed field whitelist: the pino envelope (level/time/pid/hostname),
    // the request-child bindings every authenticated request log carries
    // (actorId/actorRole/organizationId + reqId — plugins/auth.ts:203), and
    // exactly the three contract fields. Nothing spread from request/ctx/
    // result.
    expect(Object.keys(line).sort()).toEqual([
      "actorId",
      "actorRole",
      "attemptId",
      "event",
      "hostname",
      "level",
      "organizationId",
      "outcome",
      "pid",
      "reqId",
      "time",
    ]);
    expect(line.event).toBe(COMPLETED_EVENT);
    expect(line.outcome).toBe("graded");
    expect(line.attemptId).toBe(attemptId);
    expect(line.organizationId).toBe(ctx.org.id);
    expect(line.actorId).toBe(ctx.candidate.id);
    // Identity join: the SAME server-minted id keys the line, the response
    // header and the framework request trace (one authority, not duplicated
    // as a second payload field).
    expect(line.reqId).toBe(requestId);
    const trace = lines().find(
      (l) =>
        l.msg === "request completed" &&
        l.reqId === requestId &&
        (l.res as { statusCode?: number } | undefined)?.statusCode === 200,
    );
    expect(trace).toBeDefined();

    // Repo-wide raw line budget (crossTenant 512B precedent; the #1007 256B
    // target is measured and reported in the perf evidence, not asserted
    // here — envelope keys like hostname legitimately vary).
    for (const raw of rawCompletedLines()) {
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(512);
    }

    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
  });

  it("matrix 1b + privacy marker: fresh manual submit emits pending_manual; no answer content reaches any line", async () => {
    const marker = `MARKER-PRIVACY-${crypto.randomUUID()}`;
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Fresh Manual",
      questionIds: [subjectiveQuestionId],
    });
    const saveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${subjectiveQuestionId}`,
      payload: {
        attemptId,
        questionId: subjectiveQuestionId,
        answer: marker,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(saveRes.statusCode).toBe(200);

    const res = await submit(attemptId);
    expect(res.statusCode).toBe(200);

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("pending_manual");
    // The synthetic privacy marker was reachable in the answer payload; the
    // serialized output of the whole request must not contain it.
    for (const chunk of logChunks) {
      expect(chunk).not.toContain(marker);
    }

    const row = await attemptRow(attemptId);
    expect(row.status).toBe("submitted");
    expect(row.gradingStatus).toBe("pending_manual");
  });

  it("matrix 2: graded replay emits replay_no_change and keeps the idempotent side effects", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Graded Replay",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);
    const first = await submit(attemptId);
    expect(first.statusCode).toBe(200);
    const firstRow = await attemptRow(attemptId);
    expect(await countSubmitAudits(attemptId)).toBe(1);

    logChunks.length = 0;
    const replay = await submit(attemptId);
    expect(replay.statusCode).toBe(200);

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("replay_no_change");
    expect(emitted[0]!.attemptId).toBe(attemptId);
    expect(emitted[0]!.reqId).toBe(replay.headers["x-request-id"]);

    // Idempotent side effects: no second audit, no rewrite of the graded
    // facts (EXSEM-008: repeated submit must not rebuild facts).
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
    expect(row.submittedAt?.getTime()).toBe(firstRow.submittedAt?.getTime());
    expect(row.score).toBe(firstRow.score);
    expect(await countSubmitAudits(attemptId)).toBe(1);
  });

  it("matrix 3: deadline reconciliation freeze emits deadline_frozen, distinguishable from the graded replay that shares alreadyGraded=true", async () => {
    const { attemptId, deadlineAt } = await createStartedAttempt({
      title: "Outcome Deadline Freeze",
      questionIds: [objectiveQuestionId],
      durationMinutes: 1,
    });
    await saveObjectiveAnswer(attemptId);

    try {
      ctx.setNow(new Date(deadlineAt.getTime() + 5 * 60_000));
      const res = await submit(attemptId);
      expect(res.statusCode).toBe(200);
    } finally {
      ctx.setNow(null);
    }

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    // The freeze early-return and the graded replay both produce
    // alreadyGraded=true — the outcome channel must keep them apart.
    expect(emitted[0]!.outcome).toBe("deadline_frozen");

    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
    expect(row.submissionReason).toBe("deadline");
    expect(row.submittedAt?.getTime()).toBe(deadlineAt.getTime());
    // The freeze path is not a fresh candidate submit: no attempt.submit audit.
    expect(await countSubmitAudits(attemptId)).toBe(0);
  });

  it("matrix 4a: submitted crash-recovery (objective) emits recovered", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Recovered",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);
    await submitOnlyViaEngine(attemptId);
    expect((await attemptRow(attemptId)).status).toBe("submitted");

    const res = await submit(attemptId);
    expect(res.statusCode).toBe(200);

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("recovered");
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
    expect(row.score).toBe(100);
  });

  it("matrix 4b: submitted + pending_manual holds for the manual queue — pending_manual, never recovered", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Submitted Pending Manual",
      questionIds: [subjectiveQuestionId],
    });
    const saveRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${subjectiveQuestionId}`,
      payload: {
        attemptId,
        questionId: subjectiveQuestionId,
        answer: "held for manual grading",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(saveRes.statusCode).toBe(200);
    await submitOnlyViaEngine(attemptId);
    const held = await attemptRow(attemptId);
    expect(held.status).toBe("submitted");
    expect(held.gradingStatus).toBe("pending_manual");

    const res = await submit(attemptId);
    expect(res.statusCode).toBe(200);

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    // Entering the `submitted` branch is NOT recovery success: the manual
    // queue owns the terminal transition, so this is pending_manual.
    expect(emitted[0]!.outcome).toBe("pending_manual");
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("submitted");
    expect(row.gradingStatus).toBe("pending_manual");
  });

  it("matrix 5: atomic audit failure rolls back business + audit and emits zero completed", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Audit Fault",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    const removeFailure = await installSubmitAuditFailure();
    let status = 0;
    try {
      const faulted = await submit(attemptId);
      status = faulted.statusCode;
      expect(faulted.statusCode).toBe(500);
    } finally {
      await removeFailure();
    }
    expect(status).toBe(500);

    expect(completedLines()).toHaveLength(0);
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("in_progress");
    expect(row.submittedAt).toBeNull();
    expect(await countSubmitAudits(attemptId)).toBe(0);
  });

  it("matrix 6: commit-phase 40001 AFTER the callback classified → intermediate zero completed, retry emits exactly one line from the last successful transaction", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Commit Retry",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    // DEFERRABLE INITIALLY DEFERRED: the trigger raises DURING the first
    // COMMIT — the callback has already returned its classification (PG
    // runs deferred constraint triggers at commit, after the callback), and
    // the 40001 sends executeInTransaction into its real retry. The sequence
    // makes the fault fire exactly once, so the retry commits.
    const removeFault = await installCommitFault("40001");
    try {
      const res = await submit(attemptId);
      expect(res.statusCode).toBe(200);
    } finally {
      await removeFault();
    }

    // The discarded intermediate attempt is observable as a retry WARN…
    const warns = retryWarns();
    expect(warns.map((w) => w.attempt)).toEqual([1]);
    expect(warns[0]!.sqlstate).toBe("40001");
    // …but NEVER as a completed line: exactly one line exists, carrying the
    // LAST (winning) transaction's classification.
    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("graded");
    expect(emitted[0]!.attemptId).toBe(attemptId);

    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
    expect(await countSubmitAudits(attemptId)).toBe(1);
  });

  it("matrix 7: retry exhaustion emits zero completed with the original 409 mapping; a refused transition emits zero with 409", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Exhausted",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    failTransactions("all", "40001");
    const res = await submit(attemptId);
    expect(res.statusCode).toBe(409);
    expect(completedLines()).toHaveLength(0);
    expect(retryWarns()).toHaveLength(3);
    restoreFailedTransactions();

    // Non-retryable unique violation: same 409 boundary, zero warns (the
    // #1020 join table already owns this shape; here it pins zero completed).
    logChunks.length = 0;
    failTransactions(1, "23505");
    const unique = await submit(attemptId);
    expect(unique.statusCode).toBe(409);
    expect(completedLines()).toHaveLength(0);
    restoreFailedTransactions();

    // State-machine refusal (voided attempt): no transaction classification
    // is possible, so no line may exist.
    const { attemptId: voidedId } = await createStartedAttempt({
      title: "Outcome Voided",
      questionIds: [objectiveQuestionId],
    });
    await ctx.db
      .update(schema.examAttempts)
      .set({ status: "voided" })
      .where(eq(schema.examAttempts.id, voidedId));
    logChunks.length = 0;
    const refused = await submit(voidedId);
    expect(refused.statusCode).toBe(409);
    expect(completedLines()).toHaveLength(0);
    expect(retryWarns()).toHaveLength(0);
  });

  it("matrix 8: permanent commit-phase fault proves callback completion is not commit — zero completed, then success emits", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Commit Permanent Fault",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    const removeFault = await installCommitFault("23514");
    let status = 0;
    try {
      const faulted = await submit(attemptId);
      status = faulted.statusCode;
      expect(faulted.statusCode).toBe(500);
    } finally {
      await removeFault();
    }
    expect(status).toBe(500);

    // The deferred trigger firing proves the callback finished (its
    // submitted_at write was queued and PG reached COMMIT) — yet the line
    // count is zero because the commit itself failed and the orchestrator
    // never resolved.
    expect(completedLines()).toHaveLength(0);
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("in_progress");
    expect(row.submittedAt).toBeNull();

    const retry = await submit(attemptId);
    expect(retry.statusCode).toBe(200);
    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("graded");
  });

  it("matrix 9: post-commit response-construction failure keeps the committed facts and the emitted line; HTTP error semantics unchanged", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Postcommit Response Fault",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit-postcommit-fault`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    // The production analog of this position maps NotFoundError to 404 via
    // the global error handler; the business transaction has committed.
    expect(res.statusCode).toBe(404);

    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("graded");
    expect(emitted[0]!.attemptId).toBe(attemptId);
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
    expect(row.score).toBe(100);
    expect(await countSubmitAudits(attemptId)).toBe(1);
  });

  it("matrix 9b: the orchestrator's INTERNAL post-commit re-read fails → committed facts stand, exactly one completed line, original error semantics reach HTTP unchanged", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Internal Re-read Fault",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    installPostCommitReReadFault();
    const res = await submit(attemptId);

    // The injected read fault is an unexpected error: production maps it
    // through the global error handler to 500 INTERNAL_ERROR — the mapping
    // is unchanged by the already-committed business outcome.
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");

    // The business facts are COMMITTED: the transaction's effects stand.
    const row = await attemptRow(attemptId);
    expect(row.status).toBe("graded");
    expect(row.score).toBe(100);
    expect(row.submittedAt).not.toBeNull();
    expect(await countSubmitAudits(attemptId)).toBe(1);

    // The completed line was emitted BEFORE the internal re-read: exactly
    // one, correctly classified, joined to the faulted request's identity.
    // (This is the assertion matrix 9 cannot make: its fault route lets the
    // orchestrator — internal re-read included — finish successfully.)
    const emitted = completedLines();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.outcome).toBe("graded");
    expect(emitted[0]!.attemptId).toBe(attemptId);
    expect(emitted[0]!.reqId).toBe(res.headers["x-request-id"]);
  });

  it("non-HTTP caller: without the HTTP request handle the orchestrator commits but emits nothing", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Non HTTP Caller",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    // The demo-seed-grader production caller shape: no `audit` handle, so no
    // HTTP identity exists — emitting would fabricate one.
    const result = await submitAndGradeAttempt(
      ctx.db,
      sharedCandidateCtx(),
      attemptId,
      candidateProfileId,
      new Date(),
    );
    expect(result.attempt.status).toBe("graded");
    expect(completedLines()).toHaveLength(0);
  });

  it("ownership/authz rejection (anti-enumeration 404 preHandler) emits zero completed", async () => {
    const { attemptId } = await createStartedAttempt({
      title: "Outcome Authz Rejection",
      questionIds: [objectiveQuestionId],
    });
    await saveObjectiveAnswer(attemptId);

    // A DIFFERENT organization's candidate probes the submit endpoint: the
    // own-attempt preHandler answers 404 via reply.send (handler never
    // reached, no transaction opened) — nothing may be reported as
    // committed.
    const outsider = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: "submit-outcome-out-",
      label: "OutcomeOutsider",
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": outsider.candidateToken },
    });
    expect(res.statusCode).toBe(404);
    expect(completedLines()).toHaveLength(0);
    expect((await attemptRow(attemptId)).status).toBe("in_progress");
  });

  it("two organizations: each concurrent submit's completed line joins its own request and attempt — no cross-pollution", async () => {
    const orgA = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: "submit-outcome-a-",
      label: "OutcomeA",
    });
    const orgB = await createIsolatedAttemptOrg(ctx, {
      slugPrefix: "submit-outcome-b-",
      label: "OutcomeB",
    });

    const start = async (t: typeof orgA) => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: `Outcome Cross Org ${t.orgId}`,
          courseId: t.courseId,
          questionIds: [t.questionId],
        }),
        cookies: { "auth-token": t.adminToken },
      });
      const examId = examRes.json().id as string;
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
      expect(startRes.statusCode).toBe(201);
      return startRes.json().id as string;
    };

    const [attemptA, attemptB] = [await start(orgA), await start(orgB)];
    for (const [t, attemptId] of [
      [orgA, attemptA],
      [orgB, attemptB],
    ] as const) {
      const saveRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${t.questionId}`,
        payload: {
          attemptId,
          questionId: t.questionId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": t.candidateToken },
      });
      expect(saveRes.statusCode).toBe(200);
    }
    const [resA, resB] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptA}/submit`,
        cookies: { "auth-token": orgA.candidateToken },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptB}/submit`,
        cookies: { "auth-token": orgB.candidateToken },
      }),
    ]);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    const emitted = completedLines();
    expect(emitted).toHaveLength(2);
    for (const line of emitted) {
      expect(Object.keys(line).sort()).toEqual([
        "actorId",
        "actorRole",
        "attemptId",
        "event",
        "hostname",
        "level",
        "organizationId",
        "outcome",
        "pid",
        "reqId",
        "time",
      ]);
    }
    const byAttempt = new Map(emitted.map((l) => [l.attemptId, l]));
    expect(byAttempt.get(attemptA)!.reqId).toBe(resA.headers["x-request-id"]);
    expect(byAttempt.get(attemptB)!.reqId).toBe(resB.headers["x-request-id"]);
    expect(byAttempt.get(attemptA)!.reqId).not.toBe(
      byAttempt.get(attemptB)!.reqId,
    );
    // Each line's inherited org binding matches its OWN request's org — the
    // join can never attribute org A's submit to org B's request.
    expect(byAttempt.get(attemptA)!.organizationId).toBe(orgA.orgId);
    expect(byAttempt.get(attemptB)!.organizationId).toBe(orgB.orgId);
  });
});

/** Minimal sync-throw sink for the emitter isolation boundary test. */
function throwingSink(): { info: (obj: object, msg?: string) => void } {
  return {
    info() {
      throw new Error("injected synchronous sink fault");
    },
  };
}

describe("submit outcome emitter — synchronous failure isolation (#1007)", () => {
  it("a synchronous sink throw is swallowed: no propagation, no recursion", async () => {
    const { emitSubmitCompleted } =
      await import("../../orchestrators/submitAndGradeAttempt.js");
    expect(() =>
      emitSubmitCompleted(throwingSink(), "graded", "attempt-id"),
    ).not.toThrow();
  });
});
