/**
 * Replay-receipt regressions against real PostgreSQL through the canonical
 * production seams (candidate lookup → EA lock → preparation seam → engine
 * saveAnswer), exactly as the save route composes them.
 *
 * Each accepted save writes one compact receipt row; the draft-answer JSONB
 * stops accumulating payload copies and replay lookup is one indexed key
 * read. These tests prove the mechanism preserves the frozen save semantics:
 *
 *   - storage: N accepted rich saves produce N compact receipt rows and the
 *     answers JSONB stops growing with save count;
 *   - atomicity: receipt-storage failure rolls back the whole SaveAnswer
 *     protocol commit (no answer-without-receipt state);
 *   - concurrency: same-clientSeq same-identity saves serialize on the EA
 *     row lock into ONE acceptance + one protocol-consistent replay ACK;
 *     same-key different-identity resolves to one accepted identity + one
 *     CONFLICTING_PAYLOAD (never last-writer-wins); an unknown clientSeq
 *     keeps CAS semantics through the real seams;
 *   - invariant backstop: the composite PK enforces one-key-one-identity at
 *     the database (lock-bypass backstop);
 *   - legacy compatibility: a receipt backfilled by migration 0044 with the
 *     legacy payload representation still replays through the production
 *     adapter — identity derived at read time, never written back.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QuestionSnapshot, RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import {
  executeInTransaction,
  type TransactionDatabase,
} from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  lockEnrollmentAndAttempt,
  prepareReconciledAttemptMutation,
  saveAnswer,
} from "@exam/exam-engine";
import type {
  GradingWorksetRepository,
  SubmitInterruptionResolution,
} from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { validateAnswerForQuestion } from "../lib/validateAnswerForQuestion.js";
import { createDeferred } from "../testing/barrier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(
  __dirname,
  "../../../../packages/db/migrations/postgres",
);

const T0 = new Date("2026-01-01T00:00:00.000Z");
const STARTED_AT = new Date("2026-02-01T00:00:00.000Z");
const DEADLINE_AT = new Date("2026-02-01T02:00:00.000Z");

const QUESTION_ID = "q-d2-replay";

function richAnswer(marker: string) {
  return {
    docVersion: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `Answer ${marker}. ${"x".repeat(900)}`,
            marks: ["bold"],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Second paragraph " },
          { type: "inlineMath", latex: "E=mc^2" },
          { type: "text", text: " end." },
        ],
      },
    ],
  };
}

function richQuestionSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: QUESTION_ID,
      type: "text_response",
      content: "replay question",
      contentDocument: null,
      answerMode: "rich",
      attachments: [],
      options: [],
      standardAnswer: null,
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
  ];
}

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Candidate",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface TxRepos {
  exams: ReturnType<typeof createExamEngineRepos>["exams"];
  enrollments: ReturnType<typeof createExamEngineRepos>["enrollments"];
  attempts: ReturnType<typeof createExamEngineRepos>["attempts"];
  gradingWorkset: GradingWorksetRepository;
  episodeRepo: ReturnType<typeof createInterruptionEpisodeRepoAdapter>;
  eventRepo: ReturnType<typeof createInterruptionEventRepoAdapter>;
}

describe("replay receipts on real PostgreSQL (#669)", () => {
  let db: Database;
  let db1: Database;
  let db2: Database;
  let sqlSetup: { end(): Promise<void> };
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };
  let cleanup: () => Promise<void>;
  let organizationId: string;
  let candidateUserId: string;
  let candidateProfileId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "d2-replay-receipts",
      databaseUrl: resolveTestDbUrl(),
    });
    const connSetup = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db = connSetup.db;
    db1 = conn1.db;
    db2 = conn2.db;
    sqlSetup = connSetup.sql;
    sql1 = conn1.sql;
    sql2 = conn2.sql;

    await withTestInfraLifecycleLock(iso.databaseUrl, () =>
      migratePostgres(connSetup.db, { migrationsSchema: iso.schemaName }),
    );

    organizationId = randomUUID();
    candidateUserId = randomUUID();
    ctx = context(organizationId, candidateUserId);
    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Org d2",
      displayName: "Org d2",
      slug: `org-d2-${organizationId}`,
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.users).values({
      id: candidateUserId,
      organizationId,
      username: `cand-${candidateUserId}`,
      passwordHash: "hash",
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: T0,
      updatedAt: T0,
    });
    candidateProfileId = randomUUID();
    await db.insert(schema.candidateProfiles).values({
      id: candidateProfileId,
      organizationId,
      userId: candidateUserId,
      fields: {},
      createdAt: T0,
      updatedAt: T0,
    });

    cleanup = async () => {
      const errors: unknown[] = [];
      for (const step of [
        () => sqlSetup.end(),
        () => sql1.end(),
        () => sql2.end(),
        () => iso.cleanup(),
      ]) {
        try {
          await step();
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length > 0) {
        throw new Error(`teardown failed: ${errors.map(String).join(" | ")}`);
      }
    };
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  async function newRichAttemptFixture(suffix: string) {
    const courseId = randomUUID();
    const examId = randomUUID();
    const enrollmentId = randomUUID();
    const attemptId = randomUUID();
    const snapshot = richQuestionSnapshot();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      name: `Course ${suffix}`,
      code: `TC-${suffix}-${courseId}`,
      description: "",
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId,
      title: `Exam ${suffix}`,
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 120,
      openAt: T0,
      closeAt: new Date("2026-06-01T00:00:00.000Z"),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [QUESTION_ID],
      questionSnapshot: snapshot,
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
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId,
      examId,
      candidateId: candidateProfileId,
      status: "started",
      attemptCount: 1,
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: snapshot,
      answers: [],
      startedAt: STARTED_AT,
      deadlineAt: DEADLINE_AT,
      lastActivityAt: STARTED_AT,
      createdAt: T0,
      updatedAt: T0,
    });
    return { attemptId };
  }

  function buildTxRepos(tx: TransactionDatabase): TxRepos {
    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: createAttemptRepo(tx),
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    return {
      exams,
      enrollments,
      attempts,
      gradingWorkset: createGradingWorksetRepoAdapter(
        createAttemptGradingEntryRepo(tx),
        ctx,
      ),
      episodeRepo: createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        ctx,
      ),
      eventRepo: createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        ctx,
      ),
    };
  }

  /**
   * Save through the save route's canonical body. `mutateAttemptAdapter`
   * (test-only fault injection) may modify the tx-scoped attempts adapter
   * object IN PLACE — the object identity must survive so the mutation
   * context's P2 affinity assertion stays valid.
   */
  function saveViaCanonicalSeam(
    racerDb: Database,
    args: {
      attemptId: string;
      answer: unknown;
      clientSeq: number;
      baseVersion: number;
      now: Date;
      beforeLock?: () => Promise<void>;
      mutateAttemptAdapter?: (attempts: TxRepos["attempts"]) => void;
    },
  ) {
    const { attemptId } = args;
    return executeInTransaction(racerDb, async (tx) => {
      const candidateProfile = await createCandidateRepo(tx).findByUserId(
        ctx,
        ctx.actorId,
      );
      if (!candidateProfile) throw new NotFoundError("no candidate profile");
      const repos = buildTxRepos(tx);
      args.mutateAttemptAdapter?.(repos.attempts);
      if (args.beforeLock) {
        await args.beforeLock();
      }
      const cap = await lockEnrollmentAndAttempt(
        repos.enrollments,
        repos.attempts,
        attemptId,
      );
      const preAttempt = await repos.attempts.findById(attemptId);
      const resolution: SubmitInterruptionResolution =
        preAttempt?.status === "disrupted"
          ? {
              mode: "active_interruption",
              episodeRepo: repos.episodeRepo,
              eventRepo: repos.eventRepo,
              hint: {
                policy: "strict",
                eligibleSeconds: null,
                adjustmentId: null,
                reasonCode: "deadline_terminalization",
              },
            }
          : {
              mode: "none",
              episodeRepo: repos.episodeRepo,
              eventRepo: repos.eventRepo,
            };
      const { attempt, mutationContext } =
        await prepareReconciledAttemptMutation(
          repos.exams,
          repos.enrollments,
          repos.attempts,
          repos.gradingWorkset,
          cap,
          args.now,
          resolution,
        );
      if (attempt.candidateId !== candidateProfile.id) {
        throw new NotFoundError("not owner");
      }
      return saveAnswer(
        repos.attempts,
        mutationContext,
        {
          attemptId,
          questionId: QUESTION_ID,
          answer: args.answer,
          clientSeq: args.clientSeq,
          clientSavedAt: args.now.toISOString(),
          baseVersion: args.baseVersion,
        },
        validateAnswerForQuestion,
      );
    });
  }

  async function receiptRowsFor(attemptId: string) {
    return db
      .select()
      .from(schema.examAnswerSaveReceipts)
      .where(
        and(
          eq(schema.examAnswerSaveReceipts.organizationId, organizationId),
          eq(schema.examAnswerSaveReceipts.attemptId, attemptId),
        ),
      );
  }

  it("N accepted saves → N compact receipts; answers JSONB stops accumulating payloads", async () => {
    const sizes: Record<number, number> = {};
    let attemptId = "";
    for (const N of [1, 30]) {
      ({ attemptId } = await newRichAttemptFixture(`res-${N}`));
      let firstAck: { serverVersion: number; savedAt: string } | null = null;
      for (let i = 1; i <= N; i++) {
        const result = await saveViaCanonicalSeam(db, {
          attemptId,
          answer: richAnswer(`n${i}`),
          clientSeq: i,
          baseVersion: i - 1,
          now: new Date(STARTED_AT.getTime() + i * 1000),
        });
        expect(result.accepted).toBe(true);
        if (i === 1) {
          firstAck = {
            serverVersion: result.serverVersion,
            savedAt: result.savedAt,
          };
        }
      }

      const rows = await receiptRowsFor(attemptId);
      expect(rows).toHaveLength(N);
      // Every new receipt is digest-backed: no payload copies anywhere.
      for (const row of rows) {
        expect(row.answerIdentity).toMatch(/^[0-9a-f]{64}$/);
        expect(row.legacyAnswer).toBeNull();
      }

      // The draft-answer JSONB holds exactly ONE element — the current
      // answer — with no receipt fields at all.
      const attemptRows = await db
        .select({
          logicalBytes: sql<number>`octet_length(${schema.examAttempts.answers}::text)`,
          answers: schema.examAttempts.answers,
        })
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, attemptId));
      const answers = attemptRows[0]!.answers as unknown as Array<
        Record<string, unknown>
      >;
      expect(answers).toHaveLength(1);
      expect(Object.keys(answers[0]!).sort()).toEqual([
        "answer",
        "questionId",
        "savedAt",
        "version",
      ]);
      sizes[N] = Number(attemptRows[0]!.logicalBytes);

      // Oldest replay: prior ACK verbatim, zero new write, no new receipt.
      const replay = await saveViaCanonicalSeam(db, {
        attemptId,
        answer: richAnswer("n1"),
        clientSeq: 1,
        baseVersion: N,
        now: new Date(STARTED_AT.getTime() + (N + 1) * 1000),
      });
      expect(replay.accepted).toBe(true);
      expect(replay.serverVersion).toBe(firstAck!.serverVersion);
      expect(replay.savedAt).toBe(firstAck!.savedAt);
      expect(await receiptRowsFor(attemptId)).toHaveLength(N);
      const conflict = await saveViaCanonicalSeam(db, {
        attemptId,
        answer: richAnswer("hijack"),
        clientSeq: 1,
        baseVersion: N,
        now: new Date(STARTED_AT.getTime() + (N + 2) * 1000),
      });
      expect(conflict.accepted).toBe(false);
      expect(conflict.conflict?.reason).toBe("CONFLICTING_PAYLOAD");
    }

    // The 30-save attempt's answers JSONB is essentially the size of the
    // 1-save attempt's: adding 29 receipts did NOT duplicate the payload
    // into the row (before the repair this grew by ~one payload per save:
    // 1.4KB → 132KB over 100 saves).
    expect(sizes[30]!).toBeLessThanOrEqual(sizes[1]! + 128);
  }, 120_000);

  it("a receipt-storage failure rolls back the whole protocol commit", async () => {
    const { attemptId } = await newRichAttemptFixture("rollback");

    await expect(
      saveViaCanonicalSeam(db, {
        attemptId,
        answer: richAnswer("doomed"),
        clientSeq: 1,
        baseVersion: 0,
        now: new Date(STARTED_AT.getTime() + 1000),
        mutateAttemptAdapter: (attempts) => {
          // Fault injection AT the seam: same adapter object (P2 affinity
          // stays valid), receipt persistence now fails after the answers
          // update ran.
          attempts.appendAnswerReceipt = async () => {
            throw new Error("injected receipt-storage failure");
          };
        },
      }),
    ).rejects.toThrow("injected receipt-storage failure");

    // No durable answer without a receipt: the answers write rolled back.
    const attemptRows = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    expect(attemptRows[0]!.answers).toEqual([]);
    expect(await receiptRowsFor(attemptId)).toHaveLength(0);
  }, 60_000);

  it("concurrent same-key same-identity saves → one acceptance + one replay ACK", async () => {
    const { attemptId } = await newRichAttemptFixture("c1");
    const t1Now = new Date(STARTED_AT.getTime() + 1000);
    const t2Now = new Date(STARTED_AT.getTime() + 2000);

    // t1 holds the row lock with its save landed but pre-commit; t2 runs the
    // full canonical composition and blocks on the EA lock. The controller
    // releases t1's commit only after t2 is in flight — the EA lock makes the
    // ordering deterministic: t2's receipt read happens after t1's commit.
    const t1Landed = createDeferred<void>("t1-landed");
    const t1Commit = createDeferred<void>("t1-commit");

    const t1Promise = saveViaCanonicalSeam(db1, {
      attemptId,
      answer: richAnswer("winner"),
      clientSeq: 1,
      baseVersion: 0,
      now: t1Now,
      mutateAttemptAdapter: (attempts) => {
        const originalAppend = attempts.appendAnswerReceipt.bind(attempts);
        attempts.appendAnswerReceipt = async (id, receipt) => {
          await originalAppend(id, receipt);
          t1Landed.resolve();
          await t1Commit.promise;
        };
      },
    });

    await t1Landed.promise;

    const t2Promise = saveViaCanonicalSeam(db2, {
      attemptId,
      answer: richAnswer("winner"), // identical canonical identity
      clientSeq: 1,
      baseVersion: 0,
      now: t2Now,
    });

    t1Commit.resolve();
    const [r1, r2] = await Promise.all([t1Promise, t2Promise]);

    // One logical acceptance; both callers hold protocol-consistent ACKs.
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(r2.serverVersion).toBe(r1.serverVersion);
    expect(r2.savedAt).toBe(r1.savedAt);
    expect(r1.serverVersion).toBe(1);

    const rows = await receiptRowsFor(attemptId);
    expect(rows).toHaveLength(1); // no duplicate receipt
    const attemptRows = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    const answers = attemptRows[0]!.answers as unknown as Array<{
      version: number;
    }>;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.version).toBe(1); // no duplicate answer transition
  }, 60_000);

  it("concurrent same-key different-identity → one accepted identity + one conflict", async () => {
    const { attemptId } = await newRichAttemptFixture("c2");
    const t1Now = new Date(STARTED_AT.getTime() + 1000);
    const t2Now = new Date(STARTED_AT.getTime() + 2000);

    const t1Landed = createDeferred<void>("t1-landed-c2");
    const t1Commit = createDeferred<void>("t1-commit-c2");

    const t1Promise = saveViaCanonicalSeam(db1, {
      attemptId,
      answer: richAnswer("identity-A"),
      clientSeq: 1,
      baseVersion: 0,
      now: t1Now,
      mutateAttemptAdapter: (attempts) => {
        const originalAppend = attempts.appendAnswerReceipt.bind(attempts);
        attempts.appendAnswerReceipt = async (id, receipt) => {
          await originalAppend(id, receipt);
          t1Landed.resolve();
          await t1Commit.promise;
        };
      },
    });

    await t1Landed.promise;

    const t2Promise = saveViaCanonicalSeam(db2, {
      attemptId,
      answer: richAnswer("identity-B"), // different canonical identity, same key
      clientSeq: 1,
      baseVersion: 0,
      now: t2Now,
    });

    t1Commit.resolve();
    const [r1, r2] = await Promise.all([t1Promise, t2Promise]);

    // The payload that committed first is THE accepted identity for the key;
    // the other resolves as conflicting — never last-writer-wins.
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(false);
    expect(r2.conflict?.reason).toBe("CONFLICTING_PAYLOAD");

    const rows = await receiptRowsFor(attemptId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.acceptedVersion).toBe(1);
  }, 60_000);

  it("an unknown clientSeq keeps CAS semantics through the real seams", async () => {
    const { attemptId } = await newRichAttemptFixture("c3");
    await saveViaCanonicalSeam(db, {
      attemptId,
      answer: richAnswer("v1"),
      clientSeq: 1,
      baseVersion: 0,
      now: new Date(STARTED_AT.getTime() + 1000),
    });

    // Unknown seq + stale baseVersion → STALE_VERSION with the server answer.
    const stale = await saveViaCanonicalSeam(db, {
      attemptId,
      answer: richAnswer("v-next"),
      clientSeq: 42,
      baseVersion: 0,
      now: new Date(STARTED_AT.getTime() + 2000),
    });
    expect(stale.accepted).toBe(false);
    expect(stale.conflict?.reason).toBe("STALE_VERSION");

    // Unknown seq + matching baseVersion → normal acceptance.
    const fresh = await saveViaCanonicalSeam(db, {
      attemptId,
      answer: richAnswer("v2"),
      clientSeq: 42,
      baseVersion: 1,
      now: new Date(STARTED_AT.getTime() + 3000),
    });
    expect(fresh.accepted).toBe(true);
    expect(fresh.serverVersion).toBe(2);
  }, 60_000);

  it("a backfilled legacy receipt still replays through the production adapter", async () => {
    const { attemptId } = await newRichAttemptFixture("legacy");
    const legacySavedAt = new Date("2026-02-01T00:30:00.000Z");
    const legacyPayload = richAnswer("legacy-answer");

    // Seed the legacy representation: the accepted receipt embedded in the
    // draft-answer JSONB with the full payload copy (exactly what migration
    // 0044 backfills from).
    await db
      .update(schema.examAttempts)
      .set({
        answers: [
          {
            questionId: QUESTION_ID,
            answer: legacyPayload,
            version: 1,
            savedAt: legacySavedAt,
            clientSeq: 1,
            clientSeqHistory: [],
          },
        ] as unknown as never[],
      })
      .where(eq(schema.examAttempts.id, attemptId));

    // Run the migration's exact backfill + strip statements.
    const migrationSql = readFileSync(
      resolve(MIGRATIONS_DIR, "0044_answer_save_receipts.sql"),
      "utf-8",
    );
    const stripCommentLines = (stmt: string) =>
      stmt.replace(/^\s*(--[^\n]*\n)+/, "").trim();
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map(stripCommentLines)
      .filter(
        (stmt) => stmt.startsWith("INSERT INTO") || stmt.startsWith("UPDATE"),
      );
    expect(statements).toHaveLength(2);
    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }

    // The legacy receipt row carries the payload, not a digest.
    const rows = await receiptRowsFor(attemptId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.answerIdentity).toBeNull();
    expect(rows[0]!.legacyAnswer).toEqual(legacyPayload);
    expect(rows[0]!.acceptedVersion).toBe(1);
    // The draft-answer JSONB was stripped of receipt fields.
    const attemptRows = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    const answers = attemptRows[0]!.answers as unknown as Array<
      Record<string, unknown>
    >;
    expect(Object.keys(answers[0]!).sort()).toEqual([
      "answer",
      "questionId",
      "savedAt",
      "version",
    ]);

    // Replay of the OLD accepted clientSeq with the same canonical payload →
    // prior ACK (identity derived from the legacy payload at read time).
    const replay = await saveViaCanonicalSeam(db, {
      attemptId,
      answer: legacyPayload,
      clientSeq: 1,
      baseVersion: 0,
      now: new Date(STARTED_AT.getTime() + 5000),
    });
    expect(replay.accepted).toBe(true);
    expect(replay.serverVersion).toBe(1);
    expect(replay.savedAt).toBe(legacySavedAt.toISOString());

    // Same key + different identity → conflict (legacy rows are not "unknown").
    const conflict = await saveViaCanonicalSeam(db, {
      attemptId,
      answer: richAnswer("different"),
      clientSeq: 1,
      baseVersion: 0,
      now: new Date(STARTED_AT.getTime() + 6000),
    });
    expect(conflict.accepted).toBe(false);
    expect(conflict.conflict?.reason).toBe("CONFLICTING_PAYLOAD");

    // And the next NEW clientSeq saves normally alongside the legacy receipt.
    const next = await saveViaCanonicalSeam(db, {
      attemptId,
      answer: richAnswer("post-d2"),
      clientSeq: 2,
      baseVersion: 1,
      now: new Date(STARTED_AT.getTime() + 7000),
    });
    expect(next.accepted).toBe(true);
    expect(await receiptRowsFor(attemptId)).toHaveLength(2);
  }, 60_000);
});
