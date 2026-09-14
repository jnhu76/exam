/**
 * EXAM-543 — Deterministic answer-save deadline-authority concurrency proof.
 *
 * Issue #543 hypothesis: an in-flight answer save reads exam.closeAt without
 * the locking discipline used by canonical deadline reconciliation, so a
 * concurrently committed closeAt change can invalidate the save decision.
 *
 * Reality audit (current master, #543 fact freeze):
 *   - The save route composes `lockEnrollmentAndAttempt` (Enrollment FOR
 *     UPDATE → Attempt FOR UPDATE) then `prepareReconciledAttemptMutation`,
 *     whose exam reads are PLAIN MVCC reads — no Exam-row lock.
 *   - Every production closeAt writer serializes on Exam FOR UPDATE
 *     (`executeAdminExamTransition`, PATCH /exams/:id). For a LIVE exam the
 *     only reachable closeAt writer is `POST /exams/:id/extend` (PATCH is
 *     draft/published-only; extend is positive-only). A shorten of a live
 *     exam's window is therefore not reachable through the API today; the
 *     reachable concurrent-writer race is the EXTEND direction.
 *   - The deadline scanner already closes this exact race for auto-submit
 *     (Exam FOR UPDATE after the EA seam + 40001 retry); the save preparation
 *     seam does not.
 *
 * The T1 side of every schedule is the save route's own production
 * composition (same repo adapters, same seam call order, same transaction
 * helper) on a dedicated PostgreSQL connection, parked at a barrier to make
 * the interleaving deterministic. T2 is either the canonical exam-row writer
 * shape (lock → update, what every exam command commits through) or the real
 * operator extend route. No sleeps; ordering is enforced by deferreds and
 * PostgreSQL row locks.
 *
 * Under REPEATABLE READ, a SELECT ... FOR UPDATE against a row concurrently
 * updated + committed after the reader's snapshot raises 40001
 * (serialization_failure); `executeInTransaction` retries the whole save
 * transaction, which then observes the new authority. That retry-convergence
 * is the mechanism under test.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Permission, RequestContext, Role } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import {
  lockEnrollmentAndAttempt,
  prepareReconciledAttemptMutation,
  saveAnswer,
} from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { validateAnswerForQuestion } from "../../lib/validateAnswerForQuestion.js";
import { createDeferred, type Deferred } from "../../testing/barrier.js";
import type { ExamAttempt } from "@exam/domain";
import { eq } from "drizzle-orm";

// The deadline scanner must never fire mid-schedule: these tests park
// transactions on purpose, and a background auto-submit would compete with
// the parked save for the same rows. 1h interval ≈ never during a test file.
process.env.DEADLINE_SCAN_INTERVAL_MS = "3600000";

// Time coordinates: production routes (start, extend) reconcile with the REAL
// wall clock, so fixture windows must be wall-clock-future. The save
// composition's `now` is injected by the harness, so each scenario expresses
// its semantics as (closeAt, now) pairs relative to a setup-time base.
const MINUTE_MS = 60_000;
const baseNow = Date.now();

/** All teardown steps run and every error surfaces (no swallowed cleanup). */
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

interface SaveRaceFixture {
  orgId: string;
  examId: string;
  attemptId: string;
  questionId: string;
  candidateCtx: RequestContext;
  adminCtx: RequestContext;
  adminToken: string;
  candidateToken: string;
  /** The closeAt the exam row carries after fixture setup. */
  closeAt: Date;
}

async function setupFixture(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  closeAt: Date,
): Promise<SaveRaceFixture> {
  const now = new Date();
  const slug = `exam-543-${randomUUID().slice(0, 8)}`;

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
  const candidateUserId = randomUUID();
  for (const user of [
    {
      id: adminId,
      username: `admin-${slug}`,
      role: "Admin",
    },
    {
      id: candidateUserId,
      username: `cand-${slug}`,
      role: "Candidate",
    },
  ] as const) {
    await ctx.db.insert(schema.users).values({
      id: user.id,
      organizationId: org.id,
      username: user.username,
      passwordHash,
      name: user.role,
      role: user.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: user.id,
      role: user.role,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

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
  const candidateToken = signJWT(
    {
      actorId: candidateUserId,
      role: "Candidate" as Role,
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
        type: "single_choice" as const,
        content: "EXAM-543",
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

  const exam = (
    await ctx.db
      .insert(schema.exams)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        title: `EXAM-543 ${slug}`,
        description: "",
        courseId: course.id,
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(baseNow - 60 * MINUTE_MS),
        closeAt,
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [question.id],
        questionSnapshot: [
          {
            originalQuestionId: question.id,
            type: "single_choice" as const,
            content: question.content,
            contentDocument: null,
            answerMode: null,
            attachments: [],
            options: question.options,
            standardAnswer: question.standardAnswer,
            score: question.score,
            gradingRule: question.gradingRule,
            order: 0,
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
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const profile = (
    await ctx.db
      .insert(schema.candidateProfiles)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        userId: candidateUserId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const enrollRes = await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${exam.id}/enrollments`,
    payload: { candidateIds: [profile.id] },
    cookies: { "auth-token": adminToken },
  });
  if (enrollRes.statusCode !== 200) {
    throw new Error(`enroll failed: ${enrollRes.statusCode} ${enrollRes.body}`);
  }

  const startRes = await ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${exam.id}/start`,
    cookies: { "auth-token": candidateToken },
  });
  if (startRes.statusCode !== 201) {
    throw new Error(`start failed: ${startRes.statusCode} ${startRes.body}`);
  }

  const adminCtx: RequestContext = {
    actorId: adminId,
    organizationId: org.id,
    role: "Admin",
    permissions: [] as Permission[],
    sessionId: "exam-543-admin",
    targetOrganizationId: org.id,
  };
  const candidateCtx: RequestContext = {
    actorId: candidateUserId,
    organizationId: org.id,
    role: "Candidate",
    permissions: [] as Permission[],
    sessionId: "exam-543-candidate",
    targetOrganizationId: org.id,
  };

  return {
    orgId: org.id,
    examId: exam.id,
    attemptId: startRes.json().id as string,
    questionId: question.id,
    candidateCtx,
    adminCtx,
    adminToken,
    candidateToken,
    closeAt,
  };
}

/**
 * The save route's exact production composition
 * (apps/api/src/routes/attempts.candidate.ts POST /answers/:questionId), with
 * optional deterministic parking. `park` decides WHERE the in-flight request
 * waits — the two points bracket the stale-authority window:
 *   - "before-preparation": parked between the EA lock and the preparation
 *     seam. A closeAt writer committing here lands inside the
 *     [snapshot .. exam serialization point] window.
 *   - "after-preparation": parked holding every lock the save acquires —
 *     an arriving closeAt writer must wait behind it (save-wins ordering).
 *
 * `observedDeadlines` collects the canonical effective deadline from EVERY
 * preparation pass, including aborted 40001 retries — the per-pass evidence
 * of which deadline authority each pass evaluated.
 */
async function runProductionSaveComposition(args: {
  db: Database;
  fixture: SaveRaceFixture;
  now: Date;
  answer?: unknown;
  park?: {
    beforePreparation?: Deferred<void>;
    beforePreparationWait?: Deferred<void>;
    afterPreparation?: Deferred<void>;
    afterPreparationWait?: Deferred<void>;
  };
  observedDeadlines?: Array<Date | null>;
}): Promise<Awaited<ReturnType<typeof saveAnswer>> & { attemptId: string }> {
  const { db, fixture, now, park, observedDeadlines } = args;
  const answer = args.answer ?? "a";
  const ctx = fixture.candidateCtx;

  return executeInTransaction(db, async (tx) => {
    {
      const txRepo = createAttemptRepo(tx);
      const candidateProfile = await createCandidateRepo(tx).findByUserId(
        ctx,
        ctx.actorId,
      );
      if (!candidateProfile) {
        throw new NotFoundError("candidate profile missing");
      }

      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: txRepo,
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        ctx,
      );
      const cap = await lockEnrollmentAndAttempt(
        enrollments,
        attempts,
        fixture.attemptId,
      );

      if (park?.beforePreparation) {
        park.beforePreparation.resolve();
        await park.beforePreparationWait!.promise;
      }

      const preAttempt = await attempts.findById(fixture.attemptId);
      const saveEpisodeRepo = createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        ctx,
      );
      const saveEventRepo = createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        ctx,
      );
      const saveResolution =
        preAttempt?.status === "disrupted"
          ? {
              mode: "active_interruption" as const,
              episodeRepo: saveEpisodeRepo,
              eventRepo: saveEventRepo,
              hint: {
                policy: "strict" as const,
                eligibleSeconds: null,
                adjustmentId: null,
                reasonCode: "deadline_terminalization",
              },
            }
          : {
              mode: "none" as const,
              episodeRepo: saveEpisodeRepo,
              eventRepo: saveEventRepo,
            };

      const { attempt: currentAttempt, mutationContext } =
        await prepareReconciledAttemptMutation(
          exams,
          enrollments,
          attempts,
          createGradingWorksetRepoAdapter(
            createAttemptGradingEntryRepo(tx),
            ctx,
          ),
          cap,
          now,
          saveResolution,
        );
      observedDeadlines?.push(mutationContext.effectiveDeadline);

      if (park?.afterPreparation) {
        park.afterPreparation.resolve();
        await park.afterPreparationWait!.promise;
      }

      if (currentAttempt.candidateId !== candidateProfile.id) {
        throw new NotFoundError("attempt not owned by candidate");
      }

      const saved = await saveAnswer(
        attempts,
        mutationContext,
        {
          attemptId: fixture.attemptId,
          questionId: fixture.questionId,
          answer,
          clientSeq: 1,
          clientSavedAt: now.toISOString(),
          baseVersion: 0,
        },
        validateAnswerForQuestion,
      );
      return { ...saved, attemptId: fixture.attemptId };
    }
  });
}

/** Barrier pair for parking the in-flight save at one point. */
function createPark(): {
  reached: Deferred<void>;
  wait: Deferred<void>;
} {
  return {
    reached: createDeferred<void>("park reached"),
    wait: createDeferred<void>("park release"),
  };
}

/** Canonical exam-row writer shape: Exam FOR UPDATE → closeAt update. */
async function commitCloseAtChange(args: {
  db: Database;
  ctx: RequestContext;
  examId: string;
  closeAt: Date;
}): Promise<void> {
  await executeInTransaction(args.db, async (tx) => {
    const examRepo = createExamRepo(tx);
    const locked = await examRepo.findByIdForUpdate(args.ctx, args.examId);
    if (!locked) throw new NotFoundError("exam missing");
    await examRepo.update(args.ctx, args.examId, { closeAt: args.closeAt });
  });
}

async function readAttemptRow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  attemptId: string,
): Promise<ExamAttempt> {
  const rows = await ctx.db
    .select()
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, attemptId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("attempt row missing");
  return row as unknown as ExamAttempt;
}

describe("EXAM-543 — answer-save deadline authority vs concurrent closeAt change", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let db2: Database;
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };

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
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => sql2.end(),
      () => sql1.end(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  it("H1 closeAt-change-wins: a save parked in-flight cannot commit under stale authority after the committed closeAt change", async () => {
    // Save is legal under the OLD window (now < closeAt). T2 moves the
    // authority into the past while the save is parked before its
    // preparation seam. The save must NOT commit an answer under the
    // replaced authority: the transaction must lose to the concurrent exam
    // write (40001), retry, observe the new authority, and surface the
    // deadline reconciliation outcome (attempt frozen, save rejected).
    const closeAt = new Date(baseNow + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    const newCloseAt = new Date(baseNow - MINUTE_MS);
    const now = new Date(baseNow);
    const observedDeadlines: Array<Date | null> = [];

    const park = createPark();
    const savePromise = runProductionSaveComposition({
      db: db1,
      fixture,
      now,
      park: {
        beforePreparation: park.reached,
        beforePreparationWait: park.wait,
      },
      observedDeadlines,
    }).catch((err) => err as Error);

    // T1 parked with the EA locks held — its REPEATABLE READ snapshot is
    // already fixed at the pre-change closeAt.
    await park.reached.promise;

    // T2 (canonical exam-writer shape) replaces the authority and commits.
    await commitCloseAtChange({
      db: db2,
      ctx: fixture.adminCtx,
      examId: fixture.examId,
      closeAt: newCloseAt,
    });

    park.wait.resolve();
    const saved = (await savePromise) as Awaited<
      ReturnType<typeof saveAnswer>
    > & { attemptId: string };

    // Every preparation pass that survived to mint a mutation context must
    // have evaluated the NEW (committed) authority — a pass that evaluated
    // the stale pre-change closeAt aborts at the Exam-row lock and is
    // retried away by executeInTransaction, never reaching a save decision.
    expect(observedDeadlines.length).toBeGreaterThanOrEqual(1);
    expect(observedDeadlines[observedDeadlines.length - 1]!.getTime()).toBe(
      newCloseAt.getTime(),
    );

    // New authority won: the attempt is deadline-frozen at the NEW closeAt
    // and the save is rejected — never a stale-authority draft commit.
    expect(saved.accepted).toBe(false);
    if (!saved.accepted) {
      expect(saved.conflict.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    }

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(["submitted", "graded"]).toContain(attemptRow.status);
    expect(attemptRow.submittedAt!.getTime()).toBe(newCloseAt.getTime());
    // No draft answer was persisted by any pass (rejected save + rolled-back
    // retry pass must leave the draft answers untouched).
    expect(attemptRow.answers).toEqual([]);

    // The exam row carries the winning authority.
    const examRow = (
      await ctx.db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.id, fixture.examId))
        .limit(1)
    )[0]!;
    expect(examRow.closeAt!.getTime()).toBe(newCloseAt.getTime());
  }, 30_000);

  it("H2 extend-wins: an operator extension that commits during the in-flight window governs the save (stale-expiry freeze must not win)", async () => {
    // The save request arrives just past the OLD closeAt (its authority says
    // expired); while it is parked in-flight the operator extends the exam
    // through the real production route. The extension committed first is
    // the authority: the save must be ACCEPTED under the extended window and
    // the attempt must stay in_progress — never frozen at the stale deadline.
    const oldCloseAt = new Date(baseNow + MINUTE_MS);
    const fixture = await setupFixture(ctx, oldCloseAt);
    const now = new Date(oldCloseAt.getTime() + 1000);
    const extendedCloseAt = new Date(oldCloseAt.getTime() + 30 * MINUTE_MS);
    const observedDeadlines: Array<Date | null> = [];

    const park = createPark();
    const savePromise = runProductionSaveComposition({
      db: db1,
      fixture,
      now,
      park: {
        beforePreparation: park.reached,
        beforePreparationWait: park.wait,
      },
      observedDeadlines,
    }).catch((err) => err as Error);

    await park.reached.promise;

    // Real operator surface: POST /exams/:id/extend commits while the save
    // is in-flight (the parked save holds no exam lock yet).
    const extendRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${fixture.examId}/extend`,
      payload: { extendMinutes: 30, reason: "EXAM-543 incident extend" },
      cookies: { "auth-token": fixture.adminToken },
    });
    expect(extendRes.statusCode).toBe(200);

    park.wait.resolve();
    const saved = (await savePromise) as Awaited<
      ReturnType<typeof saveAnswer>
    > & { attemptId: string };

    // Every completed preparation pass must have evaluated the extension —
    // no pass may survive to a save decision under the stale pre-extension
    // authority. (The stale first pass aborts — via the Exam-row lock or the
    // FK parent check on any attempt write — and executeInTransaction
    // retries the whole save transaction.)
    expect(observedDeadlines.length).toBeGreaterThanOrEqual(1);
    expect(observedDeadlines[observedDeadlines.length - 1]!.getTime()).toBe(
      extendedCloseAt.getTime(),
    );

    expect(saved.accepted).toBe(true);
    expect(saved.serverVersion).toBe(1);

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(attemptRow.status).toBe("in_progress");
    expect(attemptRow.submittedAt).toBeNull();
    const draftAnswers = attemptRow.answers as Array<{
      questionId: string;
      answer: unknown;
      version: number;
    }>;
    expect(draftAnswers).toHaveLength(1);
    expect(draftAnswers[0]!.questionId).toBe(fixture.questionId);
    expect(draftAnswers[0]!.version).toBe(1);

    const examRow = (
      await ctx.db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.id, fixture.examId))
        .limit(1)
    )[0]!;
    expect(examRow.closeAt!.getTime()).toBe(extendedCloseAt.getTime());
  }, 30_000);

  it("H3 save-wins ordering: a closeAt change arriving after the save holds its serialization point waits and applies after the save commits", async () => {
    // Parked AFTER preparation — post-fix the save holds the Exam lock, so
    // the operator extend must wait behind it. The save commits under the
    // pre-change authority (a valid linearization: the request arrived while
    // that authority was current), and the extension still applies. Both
    // effects persist; nothing is lost and nothing deadlocks.
    const closeAt = new Date(baseNow + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const observedDeadlines: Array<Date | null> = [];

    const park = createPark();
    const savePromise = runProductionSaveComposition({
      db: db1,
      fixture,
      now: new Date(baseNow),
      park: { afterPreparation: park.reached, afterPreparationWait: park.wait },
      observedDeadlines,
    }).catch((err) => err as Error);

    await park.reached.promise;

    const extendPromise = ctx.app.inject({
      method: "POST",
      url: `/api/exams/${fixture.examId}/extend`,
      payload: { extendMinutes: 30, reason: "EXAM-543 save-wins" },
      cookies: { "auth-token": fixture.adminToken },
    });

    park.wait.resolve();
    const saved = (await savePromise) as Awaited<
      ReturnType<typeof saveAnswer>
    > & { attemptId: string };

    // Exactly one preparation pass — the save was never invalidated.
    expect(observedDeadlines).toHaveLength(1);
    expect(observedDeadlines[0]!.getTime()).toBe(closeAt.getTime());

    expect(saved.accepted).toBe(true);

    const extendRes = await extendPromise;
    expect(extendRes.statusCode).toBe(200);

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(attemptRow.status).toBe("in_progress");
    const draftAnswers = attemptRow.answers as Array<{
      questionId: string;
      version: number;
    }>;
    expect(draftAnswers).toHaveLength(1);
    expect(draftAnswers[0]!.version).toBe(1);

    const examRow = (
      await ctx.db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.id, fixture.examId))
        .limit(1)
    )[0]!;
    expect(examRow.closeAt!.getTime()).toBe(extendedCloseAt.getTime());
  }, 30_000);

  it("H4 closeAt-update-committed-first: a save that starts after the new authority observes it and is reconciled, not stale", async () => {
    const closeAt = new Date(baseNow + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    const newCloseAt = new Date(baseNow - MINUTE_MS);

    // The authority change fully commits BEFORE the save transaction begins.
    await commitCloseAtChange({
      db: db2,
      ctx: fixture.adminCtx,
      examId: fixture.examId,
      closeAt: newCloseAt,
    });

    const saved = await runProductionSaveComposition({
      db: db1,
      fixture,
      now: new Date(baseNow),
    });

    expect(saved.accepted).toBe(false);
    if (!saved.accepted) {
      expect(saved.conflict.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    }
    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(["submitted", "graded"]).toContain(attemptRow.status);
    expect(attemptRow.submittedAt!.getTime()).toBe(newCloseAt.getTime());
    expect(attemptRow.answers).toEqual([]);
  }, 30_000);

  it("H5 already-expired attempt: save is answered by deadline reconciliation, never persisted as a draft", async () => {
    // The attempt starts while the window is open; the authority then moves
    // into the past (direct canonical exam-row write) before the save.
    const closeAt = new Date(baseNow + MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    const expiredCloseAt = new Date(baseNow - MINUTE_MS);
    await commitCloseAtChange({
      db: db2,
      ctx: fixture.adminCtx,
      examId: fixture.examId,
      closeAt: expiredCloseAt,
    });

    const saved = await runProductionSaveComposition({
      db: db1,
      fixture,
      now: new Date(baseNow),
    });

    expect(saved.accepted).toBe(false);
    if (!saved.accepted) {
      expect(saved.conflict.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    }
    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(["submitted", "graded"]).toContain(attemptRow.status);
    expect(attemptRow.submittedAt!.getTime()).toBe(expiredCloseAt.getTime());
    expect(attemptRow.answers).toEqual([]);
  }, 30_000);

  it("H6 exact boundary instant: now === effectiveDeadline is expired through the real save composition", async () => {
    const closeAt = new Date(baseNow + MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);

    // The canonical expiry predicate is now >= effectiveDeadline — equality
    // is expired. Drive the real composition with now exactly AT the
    // deadline and require the reconciled outcome.
    const saved = await runProductionSaveComposition({
      db: db1,
      fixture,
      now: closeAt,
    });

    expect(saved.accepted).toBe(false);
    if (!saved.accepted) {
      expect(saved.conflict.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
    }
    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(["submitted", "graded"]).toContain(attemptRow.status);
    expect(attemptRow.submittedAt!.getTime()).toBe(closeAt.getTime());
    expect(attemptRow.answers).toEqual([]);
  }, 30_000);
});
