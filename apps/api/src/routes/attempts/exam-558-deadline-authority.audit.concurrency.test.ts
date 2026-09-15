/**
 * EXAM-558 — CODE-REALITY AUDIT probes (audit branch artifact; NOT a regression
 * gate). Companion to candidate-save-deadline-race.concurrency.test.ts (#543).
 *
 * Purpose: prove, against current master, the actual deadline-authority
 * behavior of the candidate take/submit entrypoints under a concurrently
 * committed exam closeAt change, and pin down the REPEATABLE READ mechanism
 * (40001-on-lock vs stale-plain-read vs incidental FK locking) that decides
 * whether a stale decision becomes durable.
 *
 * Production facts under test (base e4bb06c8):
 *   - take route (apps/api/src/routes/attempts.candidate.ts "take"): tx = EA
 *     seam + ensureAttemptDeadlineReconciled whose Exam read is PLAIN; after
 *     the tx commits, the snapshot is built from a SECOND plain exam read on
 *     a different connection. No Exam FOR UPDATE anywhere on the path.
 *   - candidate submit (apps/api/src/orchestrators/submitAndGradeAttempt.ts):
 *     same plain reconciliation plus a second plain exam read for
 *     minSubmitAfterStartMinutes. No Exam FOR UPDATE anywhere on the path.
 *   - The only live-exam closeAt writer is POST /exams/:id/extend (open ->
 *     open, positive-only) which commits through Exam FOR UPDATE inside
 *     executeAdminExamTransition.
 *
 * Determinism: T1 is a REAL production surface (real route via app.inject, or
 * the real submitAndGradeAttempt orchestrator). The interleaving is forced by
 * an enrollment row-lock barrier: T3 holds Enrollment FOR UPDATE, so T1 —
 * whose transaction's first statement is the EA locator read (this fixes the
 * REPEATABLE READ snapshot) — deterministically blocks at the seam's
 * Enrollment FOR UPDATE, i.e. AFTER its snapshot is fixed but BEFORE its
 * plain exam read. T3 observes T1's arrival precisely via pg_locks waiters on
 * T3's own transaction id (a liveness predicate with a hard timeout — not a
 * timing assumption; a miss fails the test loudly). The only wall-clock
 * coordination is the fixture's short deadline window: T1 is released after
 * the wall clock has passed the pre-extension closeAt so the stale snapshot
 * is provably expired at reconciliation time. No sleeps gate correctness.
 *
 * STOP RULE: this file documents the PRE-FIX reality. It is expected to pass
 * on the audit branch (the bug scenarios assert the STALE outcome current
 * master produces) and is NOT to be merged as a regression suite — the
 * post-fix suite belongs to the #558 implementation.
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
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { NotFoundError as DomainNotFoundError } from "@exam/domain";
import {
  lockEnrollmentAndAttempt,
  ensureAttemptDeadlineReconciled,
} from "@exam/exam-engine";
import { submitAndGradeAttempt } from "../../orchestrators/submitAndGradeAttempt.js";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Permission, RequestContext, Role } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import {
  executeInTransaction,
  hasPostgresErrorCode,
} from "@exam/db/src/types.js";
import { createDeferred, type Deferred } from "../../testing/barrier.js";
import { and, eq, sql as drizzleSql } from "drizzle-orm";

process.env.DEADLINE_SCAN_INTERVAL_MS = "3600000";

const MINUTE_MS = 60_000;

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

interface AuditFixture {
  orgId: string;
  examId: string;
  attemptId: string;
  enrollmentId: string;
  candidateProfileId: string;
  candidateCtx: RequestContext;
  adminToken: string;
  candidateToken: string;
  closeAt: Date;
}

async function setupFixture(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  closeAt: Date,
  options: {
    timingMode?: "timed_window" | "deadline";
    durationMinutes?: number | null;
    /**
     * Two-phase wall geometry: the exam is created with the comfortably
     * future `closeAt` (so the real /start route accepts it), and after the
     * attempt exists the canonical exam-row writer shape (Exam FOR UPDATE ->
     * update closeAt, what every exam command commits through) moves the
     * authority to `shortenCloseAtTo`. This keeps the post-setup race window
     * small without racing the fixture setup itself.
     */
    shortenCloseAtTo?: Date;
  } = {},
): Promise<AuditFixture> {
  const now = new Date();
  const slug = `exam-558-${randomUUID().slice(0, 8)}`;

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
    { id: adminId, username: `admin-${slug}`, role: "Admin" },
    { id: candidateUserId, username: `cand-${slug}`, role: "Candidate" },
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
        content: "EXAM-558",
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
        title: `EXAM-558 ${slug}`,
        description: "",
        courseId: course.id,
        status: "open",
        timingMode: options.timingMode ?? "deadline",
        durationMinutes: options.durationMinutes ?? null,
        openAt: new Date(Date.now() - 60 * MINUTE_MS),
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

  if (options.shortenCloseAtTo) {
    const adminCtx: RequestContext = {
      actorId: adminId,
      organizationId: org.id,
      role: "Admin",
      permissions: [] as Permission[],
      sessionId: "exam-558-admin",
      targetOrganizationId: org.id,
    };
    await executeInTransaction(ctx.db, async (tx) => {
      const examRepo = createExamRepo(tx);
      const locked = await examRepo.findByIdForUpdate(adminCtx, exam.id);
      if (!locked) throw new NotFoundError("exam missing during shorten");
      await examRepo.update(adminCtx, exam.id, {
        closeAt: options.shortenCloseAtTo!,
      });
    });
  }

  const enrollmentRow = (
    await ctx.db
      .select()
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.examId, exam.id),
          eq(schema.examEnrollments.candidateId, profile.id),
        ),
      )
      .limit(1)
  )[0];

  const candidateCtx: RequestContext = {
    actorId: candidateUserId,
    organizationId: org.id,
    role: "Candidate",
    permissions: [] as Permission[],
    sessionId: "exam-558-candidate",
    targetOrganizationId: org.id,
  };

  return {
    orgId: org.id,
    examId: exam.id,
    attemptId: startRes.json().id as string,
    enrollmentId: enrollmentRow?.id ?? "",
    candidateProfileId: profile.id,
    candidateCtx,
    adminToken,
    candidateToken,
    closeAt,
  };
}

async function readAttemptRow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  attemptId: string,
): Promise<Record<string, unknown>> {
  const row = (
    await ctx.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("attempt row missing");
  return row as unknown as Record<string, unknown>;
}

async function readExamRow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  examId: string,
): Promise<Record<string, unknown>> {
  const row = (
    await ctx.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("exam row missing");
  return row as unknown as Record<string, unknown>;
}

/** Bounded wall-clock wait: resolve no earlier than `at` (ms epoch). */
async function waitUntilWallClock(
  at: number,
  deadlineMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() < at) {
    if (Date.now() - start > deadlineMs) {
      throw new Error("wall-clock wait exceeded its deadline");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Enrollment row-lock barrier on a dedicated connection.
 *
 * T1's transaction fixes its RR snapshot at the EA locator read, then blocks
 * at the seam's Enrollment FOR UPDATE — after snapshot-fix, before the exam
 * read. The barrier captures its own transaction xid INSIDE the barrier
 * transaction (`txid_current()` on the tx handle) and then observes T1's
 * arrival precisely via pg_locks waiters on that exact xid from a separate
 * pooled session (a liveness predicate with a hard timeout — a miss fails the
 * test instead of silently degrading determinism).
 */
async function startEnrollmentBarrier(
  fixture: AuditFixture,
  databaseUrl: string,
  schemaName: string,
): Promise<{
  holding: Deferred<void>;
  waiterSeen: Deferred<void>;
  release: Deferred<void>;
  done: Promise<unknown>;
  close: () => Promise<void>;
}> {
  const holding = createDeferred<void>("barrier holding");
  const waiterSeen = createDeferred<void>("barrier waiter seen");
  const release = createDeferred<void>("barrier release");
  // The auto-timeout rejections must never become unhandled rejections when a
  // test aborts before awaiting a barrier point.
  holding.promise.catch(() => {});
  waiterSeen.promise.catch(() => {});
  release.promise.catch(() => {});

  // Two dedicated single-connection pools: connTx reserves its only session
  // for the barrier transaction; connProbe must NOT share that pool (max:1
  // pools would queue the pg_locks predicate behind the parked transaction
  // and deadlock the barrier).
  const connTx = await createPostgresDatabase(databaseUrl, schemaName);
  const connProbe = await createPostgresDatabase(databaseUrl, schemaName);
  const done = executeInTransaction(connTx.db, async (tx) => {
    const enrollmentRepo = createEnrollmentRepo(tx);
    const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
      fixture.candidateCtx,
      fixture.examId,
      fixture.candidateProfileId,
    );
    if (!enrollment) {
      throw new NotFoundError("barrier: enrollment row missing");
    }
    holding.resolve();
    const xidResult = (await tx.execute(
      drizzleSql`SELECT txid_current()::text AS xid`,
    )) as unknown;
    const xidRows =
      (xidResult as { rows?: Array<{ xid: string }> }).rows ??
      (xidResult as Array<{ xid: string }>);
    const xid = xidRows[0]!.xid;
    const predicateDeadline = Date.now() + 10_000;
    for (;;) {
      const waiters = await connProbe.sql`
        SELECT count(*)::int AS n
        FROM pg_locks
        WHERE locktype = 'transactionid'
          AND NOT granted
          AND transactionid = ${xid}::xid
      `;
      if ((waiters[0] as { n: number }).n > 0) {
        waiterSeen.resolve();
        break;
      }
      if (Date.now() > predicateDeadline) {
        throw new Error("no lock waiter appeared on the barrier transaction");
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await release.promise;
  }).catch((err) => err as Error);

  return {
    holding,
    waiterSeen,
    release,
    done,
    close: async () => {
      await connTx.sql.end();
      await connProbe.sql.end();
    },
  };
}

describe("EXAM-558 audit — REPEATABLE READ mechanism probes (P1–P3)", () => {
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
    // Guards: with vitest -t filtering this suite's beforeAll may never run.
    await teardownAll(
      () => sql2?.end(),
      () => sql1?.end(),
      () => ctx?.cleanup(),
      () => iso?.cleanup(),
    );
  }, 30_000);

  it("P1 RR: SELECT..FOR UPDATE after a concurrent closeAt commit raises 40001 and executeInTransaction retries the whole tx onto the new authority", async () => {
    const oldCloseAt = new Date(Date.now() + 30 * MINUTE_MS);
    const newCloseAt = new Date(Date.now() + 90 * MINUTE_MS);
    const fixture = await setupFixture(ctx, oldCloseAt);

    const park = {
      reached: createDeferred<void>("P1 reached"),
      wait: createDeferred<void>("P1 release"),
    };
    const passLog: Array<{ pass: number; closeAt: Date | null }> = [];
    const observed40001: unknown[] = [];
    let pass = 0;

    const t1 = executeInTransaction(db1, async (tx) => {
      pass += 1;
      const examRepo = createExamRepo(tx);
      const plain = await examRepo.findById(
        fixture.candidateCtx,
        fixture.examId,
      );
      passLog.push({ pass, closeAt: plain?.closeAt ?? null });
      if (pass === 1) {
        park.reached.resolve();
        await park.wait.promise;
      }
      try {
        const locked = await examRepo.findByIdForUpdate(
          fixture.candidateCtx,
          fixture.examId,
        );
        return locked?.closeAt ?? null;
      } catch (err) {
        observed40001.push(err);
        throw err;
      }
    }).catch((err) => err as Error);

    await park.reached.promise;
    await executeInTransaction(db2, async (tx) => {
      const examRepo = createExamRepo(tx);
      await examRepo.update(fixture.candidateCtx, fixture.examId, {
        closeAt: newCloseAt,
      });
    });
    park.wait.resolve();

    const result = (await t1) as Date | Error;
    expect(observed40001.length).toBe(1);
    expect(hasPostgresErrorCode(observed40001[0], "40001")).toBe(true);
    expect(passLog.map((p) => p.pass)).toEqual([1, 2]);
    expect(passLog[0]!.closeAt!.getTime()).toBe(oldCloseAt.getTime());
    expect((result as Date).getTime()).toBe(newCloseAt.getTime());
  }, 30_000);

  it("P2 RR: a plain exam read after the concurrent closeAt commit stays on the stale snapshot — no error, no serialization", async () => {
    const oldCloseAt = new Date(Date.now() + 30 * MINUTE_MS);
    const newCloseAt = new Date(Date.now() + 90 * MINUTE_MS);
    const fixture = await setupFixture(ctx, oldCloseAt);

    const park = {
      reached: createDeferred<void>("P2 reached"),
      wait: createDeferred<void>("P2 release"),
    };
    let pass = 0;
    const reads: Array<Date | null> = [];

    const t1 = executeInTransaction(db1, async (tx) => {
      pass += 1;
      const examRepo = createExamRepo(tx);
      const first = await examRepo.findById(
        fixture.candidateCtx,
        fixture.examId,
      );
      reads.push(first?.closeAt ?? null);
      if (pass === 1) {
        park.reached.resolve();
        await park.wait.promise;
      }
      const second = await examRepo.findById(
        fixture.candidateCtx,
        fixture.examId,
      );
      reads.push(second?.closeAt ?? null);
      return second?.closeAt ?? null;
    });

    await park.reached.promise;
    await executeInTransaction(db2, async (tx) => {
      const examRepo = createExamRepo(tx);
      await examRepo.update(fixture.candidateCtx, fixture.examId, {
        closeAt: newCloseAt,
      });
    });
    park.wait.resolve();

    const result = await t1;
    expect(reads).toHaveLength(2);
    expect(reads[0]!.getTime()).toBe(oldCloseAt.getTime());
    expect(reads[1]!.getTime()).toBe(oldCloseAt.getTime());
    expect((result as Date).getTime()).toBe(oldCloseAt.getTime());
  }, 30_000);

  it("P3 RR: an FK parent check (insert referencing the exam) after a concurrent closeAt commit does NOT raise 40001 — incidental FK locking is not authority", async () => {
    const oldCloseAt = new Date(Date.now() + 30 * MINUTE_MS);
    const newCloseAt = new Date(Date.now() + 90 * MINUTE_MS);
    const fixture = await setupFixture(ctx, oldCloseAt);

    const park = {
      reached: createDeferred<void>("P3 reached"),
      wait: createDeferred<void>("P3 release"),
    };
    let pass = 0;

    const t1 = executeInTransaction(db1, async (tx) => {
      pass += 1;
      const examRepo = createExamRepo(tx);
      await examRepo.findById(fixture.candidateCtx, fixture.examId);
      if (pass === 1) {
        park.reached.resolve();
        await park.wait.promise;
      }
      // FK-bearing insert against the exam parent: PostgreSQL takes FOR KEY
      // SHARE on the referenced row. closeAt is a non-key column, so a
      // concurrent non-key update neither blocks nor raises 40001 — this
      // insert proves the incidental parent check cannot serialize the
      // deadline decision. A second candidate profile keeps the insert clear
      // of the fixture's org+exam+candidate unique enrollment.
      const now = new Date();
      const secondUserId = randomUUID();
      const secondProfileId = randomUUID();
      await tx.insert(schema.users).values({
        id: secondUserId,
        organizationId: fixture.orgId,
        username: `p3-${secondProfileId.slice(0, 8)}`,
        passwordHash: await hashPassword("password123"),
        name: "P3",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.candidateProfiles).values({
        id: secondProfileId,
        organizationId: fixture.orgId,
        userId: secondUserId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.examEnrollments).values({
        id: randomUUID(),
        organizationId: fixture.orgId,
        examId: fixture.examId,
        candidateId: secondProfileId,
        status: "assigned",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return "committed";
    });

    await park.reached.promise;
    await executeInTransaction(db2, async (tx) => {
      const examRepo = createExamRepo(tx);
      await examRepo.update(fixture.candidateCtx, fixture.examId, {
        closeAt: newCloseAt,
      });
    });
    park.wait.resolve();

    const result = await t1;
    expect(result).toBe("committed");
    const examRow = await readExamRow(ctx, fixture.examId);
    expect((examRow.closeAt as Date).getTime()).toBe(newCloseAt.getTime());
  }, 30_000);
});

describe("EXAM-558 audit — take/submit vs concurrently committed extend (R1–R4, R1c)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminApp: Awaited<ReturnType<typeof buildTestApp>>;
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
    // Second app instance with its own DB pool for the concurrent exam
    // writer: the candidate app's pool is max:1, and a parked candidate
    // transaction holds its only connection.
    adminApp = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName },
    );
    const conn = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = conn.db;
    sql1 = conn.sql;
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db2 = conn2.db;
    sql2 = conn2.sql;
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => sql2?.end(),
      () => sql1?.end(),
      () => ctx?.cleanup(),
      () => adminApp?.cleanup(),
      () => iso?.cleanup(),
    );
  }, 30_000);

  it("R1 take vs in-flight extend (REALITY): the take decision is pinned to request arrival — no stale freeze is producible through the real routes, and the extension commits without waiting", async () => {
    // Geometry: the canonical writer moves closeAt to real-now + 2.5s while
    // the exam stays open. T1 (real take route) parks at the enrollment
    // barrier with its RR snapshot fixed at that closeAt and its `now`
    // sampled at request arrival (BEFORE closeAt). T2 (real extend route)
    // commits +30min while T1 is parked. T1 is released only after the wall
    // clock has passed the pre-extension closeAt. The freeze predicate is
    // evaluated with the ARRIVAL now against the ARRIVAL snapshot — both
    // pinned before the extension — so the take cannot and does not freeze:
    // the route-side extend guard (reconcile-first, refuses once closeAt has
    // passed) makes the #558 stale-freeze schedule unreachable through real
    // surfaces. deadline-mode: effectiveDeadline === exam.closeAt exactly.
    const closeAt = new Date(Date.now() + 2_500);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(
      ctx,
      new Date(Date.now() + 60 * MINUTE_MS),
      {
        timingMode: "deadline",
        shortenCloseAtTo: closeAt,
      },
    );
    const barrier = await startEnrollmentBarrier(
      fixture,
      iso.databaseUrl,
      iso.schemaName,
    );

    try {
      await barrier.holding.promise;

      // T1: real production take route.
      const takePromise = ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${fixture.attemptId}/take`,
        cookies: { "auth-token": fixture.candidateToken },
      });

      await barrier.waiterSeen.promise;

      // T2: real operator extend route on the separate admin app instance
      // (see R1c note) — commits while T1 is parked pre-exam-read.
      const extendRes = await adminApp.app.inject({
        method: "POST",
        url: `/api/exams/${fixture.examId}/extend`,
        payload: { extendMinutes: 30, reason: "EXAM-558 R1" },
        cookies: { "auth-token": fixture.adminToken },
      });
      console.error("R1-DEBUG extend", extendRes.statusCode, extendRes.body);
      expect(extendRes.statusCode).toBe(200);

      // Release T1 only after the OLD closeAt is provably in the past.
      await waitUntilWallClock(closeAt.getTime() + 500);
      barrier.release.resolve();
      await barrier.done;

      const takeRes = await takePromise;
      expect(takeRes.statusCode).toBe(200);

      const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
      // ACTUAL current-master outcome: the attempt stays in_progress. The
      // take's reconciliation evaluated the ARRIVAL now against the ARRIVAL
      // snapshot (closeAt still future at both), so no freeze occurred; the
      // extension that committed during the flight is simply the new
      // authority afterwards.
      expect(attemptRow.status).toBe("in_progress");
      expect(attemptRow.submittedAt).toBeNull();
      expect(attemptRow.submissionReason).toBeNull();

      const examRow = await readExamRow(ctx, fixture.examId);
      expect((examRow.closeAt as Date).getTime()).toBe(
        extendedCloseAt.getTime(),
      );

      // Post-tx mixed-version projection: the response's effectiveDeadline
      // comes from the post-tx exam read (extended), while the attempt state
      // was reconciled under the pre-extension authority.
      const body = takeRes.json();
      expect(body.attemptStatus).toBe("in_progress");
      expect(body.effectiveDeadline).toBe(extendedCloseAt.toISOString());
    } finally {
      barrier.release.resolve();
      await barrier.done;
      await barrier.close();
    }
  }, 40_000);

  it("R2 submit vs in-flight extend (REALITY): the submit decision is pinned to request arrival — the manual submit is accepted under arrival semantics and the extension commits without waiting", async () => {
    // Same geometry as R1, through the real candidate submit route.
    const closeAt = new Date(Date.now() + 2_500);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(
      ctx,
      new Date(Date.now() + 60 * MINUTE_MS),
      {
        timingMode: "deadline",
        shortenCloseAtTo: closeAt,
      },
    );
    const barrier = await startEnrollmentBarrier(
      fixture,
      iso.databaseUrl,
      iso.schemaName,
    );

    try {
      await barrier.holding.promise;

      // T1: real production submit route.
      const submitPromise = ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${fixture.attemptId}/submit`,
        cookies: { "auth-token": fixture.candidateToken },
      });

      await barrier.waiterSeen.promise;

      const extendRes = await adminApp.app.inject({
        method: "POST",
        url: `/api/exams/${fixture.examId}/extend`,
        payload: { extendMinutes: 30, reason: "EXAM-558 R2" },
        cookies: { "auth-token": fixture.adminToken },
      });
      expect(extendRes.statusCode).toBe(200);

      await waitUntilWallClock(closeAt.getTime() + 500);
      barrier.release.resolve();
      await barrier.done;

      const submitRes = await submitPromise;
      expect(submitRes.statusCode).toBe(200);

      const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
      // ACTUAL current-master outcome: the candidate submit is accepted as a
      // MANUAL submit under request-arrival semantics. Its `now` was sampled
      // at arrival (before closeAt), so reconciliation did not freeze; the
      // manual submit then committed after the extension had already landed.
      // submittedAt is the arrival-time sample — a valid candidate-wins
      // linearization, not a stale-authority freeze.
      expect(["submitted", "graded"]).toContain(attemptRow.status);
      expect(attemptRow.submissionReason).toBe("manual");
      expect((attemptRow.submittedAt as Date).getTime()).toBeLessThan(
        closeAt.getTime(),
      );

      const examRow = await readExamRow(ctx, fixture.examId);
      expect((examRow.closeAt as Date).getTime()).toBe(
        extendedCloseAt.getTime(),
      );
    } finally {
      barrier.release.resolve();
      await barrier.done;
      await barrier.close();
    }
  }, 40_000);

  it("R1c take mixed-version snapshot: attempt reconciled under the pre-extension authority, response deadline projected from the post-extension authority (display-benign in the extend direction)", async () => {
    // closeAt stays comfortably in the future: no freeze can occur. The
    // extension commits while take is parked; the tx reconciles under the
    // OLD authority, the post-tx plain exam read projects the NEW one.
    // deadline-mode: effectiveDeadline === exam.closeAt, so the response
    // projection exactly reveals which exam generation the post-tx read saw.
    const closeAt = new Date(Date.now() + 60 * MINUTE_MS);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt, {
      timingMode: "deadline",
    });
    const barrier = await startEnrollmentBarrier(
      fixture,
      iso.databaseUrl,
      iso.schemaName,
    );

    try {
      await barrier.holding.promise;

      const takePromise = ctx.app.inject({
        method: "GET",
        url: `/api/candidate/attempts/${fixture.attemptId}/take`,
        cookies: { "auth-token": fixture.candidateToken },
      });

      await barrier.waiterSeen.promise;

      // T2 rides the SEPARATE admin app instance: the candidate app's DB
      // pool is max:1, and T1's parked transaction holds its only
      // connection, so an extend dispatched through the same app would queue
      // behind T1 instead of racing it.
      const extendRes = await adminApp.app.inject({
        method: "POST",
        url: `/api/exams/${fixture.examId}/extend`,
        payload: { extendMinutes: 30, reason: "EXAM-558 R1c" },
        cookies: { "auth-token": fixture.adminToken },
      });
      expect(extendRes.statusCode).toBe(200);

      barrier.release.resolve();
      await barrier.done;

      const takeRes = await takePromise;
      expect(takeRes.statusCode).toBe(200);
      const body = takeRes.json();
      expect(body.attemptStatus).toBe("in_progress");
      expect(body.canSubmit).toBe(true);
      // Mixed-version snapshot: the attempt was reconciled under the OLD
      // closeAt inside the tx, but the response's effectiveDeadline comes from
      // the post-tx read of the EXTENDED exam row.
      expect(body.effectiveDeadline).toBe(extendedCloseAt.toISOString());

      const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
      expect(attemptRow.status).toBe("in_progress");
      expect(attemptRow.submittedAt).toBeNull();
    } finally {
      barrier.release.resolve();
      await barrier.done;
      await barrier.close();
    }
  }, 40_000);

  // ── Staged variants: the STRUCTURAL gap, isolated from the route guards ──
  //
  // The real-route tests above prove the #558 stale-freeze schedule is not
  // producible through the production surfaces today (the extend guard
  // refuses once closeAt has passed, and the candidate `now` is pinned to
  // request arrival). The variants below inject `now` — exactly the #543
  // harness pattern (candidate-save-deadline-race.concurrency.test.ts H1) —
  // and use the canonical exam-row writer shape (Exam FOR UPDATE → closeAt
  // update) as T2, so the interleaving involves ONLY dedicated DB
  // connections and no HTTP surfaces. They record what the take/submit
  // compositions do when a candidate's arrival authority is superseded
  // mid-flight: the freeze commits durably, because NO serialization point
  // against the Exam row exists on these paths. This is the precise sense in
  // which the #558 structural gap is real on current master: it is a
  // composition-level defect whose production exploitability is blocked
  // only by the writer-side guard, not by anything on the take/submit side.

  it("R1s staged take: a take frozen at the stale authority commits durably although a closeAt change committed before the take transaction ended (no Exam serialization point)", async () => {
    // closeAt = +60s real; injected arrivalNow = closeAt + 1s stages a
    // candidate whose ARRIVAL authority was already past its deadline. The
    // composition is the take route's transaction body verbatim
    // (apps/api/src/routes/attempts.candidate.ts GET .../take), parked AFTER
    // reconciliation with the freeze executed but uncommitted; the writer
    // then commits the extension while that stale freeze is in-flight.
    const closeAt = new Date(Date.now() + 60_000);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const arrivalNow = new Date(closeAt.getTime() + 1_000);
    const fixture = await setupFixture(ctx, closeAt, {
      timingMode: "deadline",
    });

    const park = {
      reached: createDeferred<void>("R1s reached"),
      wait: createDeferred<void>("R1s release"),
    };

    const takePromise = executeInTransaction(db1, async (tx) => {
      const txRepo = createAttemptRepo(tx);
      const candidateProfile = await createCandidateRepo(tx).findByUserId(
        fixture.candidateCtx,
        fixture.candidateCtx.actorId,
      );
      if (!candidateProfile) {
        throw new DomainNotFoundError("candidate profile missing");
      }
      const { exams, enrollments, attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: txRepo,
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        fixture.candidateCtx,
      );
      const cap = await lockEnrollmentAndAttempt(
        enrollments,
        attempts,
        fixture.attemptId,
      );
      const preRead = await attempts.findById(fixture.attemptId);
      const episodeRepo = createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        fixture.candidateCtx,
      );
      const eventRepo = createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        fixture.candidateCtx,
      );
      const resolution: SubmitInterruptionResolution =
        preRead?.status === "disrupted"
          ? {
              mode: "active_interruption",
              episodeRepo,
              eventRepo,
              hint: {
                policy: "strict",
                eligibleSeconds: null,
                adjustmentId: null,
                reasonCode: "deadline_terminalization",
              },
            }
          : { mode: "none", episodeRepo, eventRepo };
      const reconciled = await ensureAttemptDeadlineReconciled(
        exams,
        enrollments,
        attempts,
        createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(tx),
          fixture.candidateCtx,
        ),
        cap,
        arrivalNow,
        resolution,
      );
      if (reconciled.candidateId !== candidateProfile.id) {
        throw new DomainNotFoundError("attempt not owned by candidate");
      }
      park.reached.resolve();
      await park.wait.promise;
      return reconciled;
    }).catch((err) => err as Error);

    await park.reached.promise;
    // The tx must still be parked here; if it already settled with an
    // error, surface it instead of asserting against a rolled-back state.
    const settled = await Promise.race([
      takePromise.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 50)),
    ]);
    if (settled) {
      const outcome = await takePromise;
      throw outcome instanceof Error
        ? outcome
        : new Error("take settled early");
    }

    // Canonical authority change, committed while the take transaction
    // holds a durable stale-freeze-in-progress and no Exam serialization
    // point. NOTE: this is a plain row UPDATE (FOR NO KEY UPDATE) rather
    // than findByIdForUpdate — a concurrent SELECT ... FOR UPDATE would
    // queue behind the INCIDENTAL FOR KEY SHARE that the freeze's FK checks
    // took on the exam row (a live observation recorded for §6 of the
    // audit: incidental FK locking does not act as authority in either
    // direction, but it can stall writers).
    await executeInTransaction(db2, async (tx) => {
      const examRepo = createExamRepo(tx);
      await examRepo.update(fixture.candidateCtx, fixture.examId, {
        closeAt: extendedCloseAt,
      });
    });

    park.wait.resolve();
    const takeOutcome = await takePromise;
    if (takeOutcome instanceof Error) {
      throw takeOutcome;
    }

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    // The stale freeze became durable: submittedAt = the pre-extension
    // closeAt, submissionReason = deadline — although the extension (new
    // authority) committed BEFORE the take transaction ended. Contrast with
    // the #543 save seam, whose later Exam FOR UPDATE turns this exact
    // schedule into a 40001 whole-tx retry (P1).
    expect(["submitted", "graded"]).toContain(attemptRow.status);
    expect((attemptRow.submittedAt as Date).getTime()).toBe(closeAt.getTime());
    expect(attemptRow.submissionReason).toBe("deadline");

    const examRow = await readExamRow(ctx, fixture.examId);
    expect((examRow.closeAt as Date).getTime()).toBe(extendedCloseAt.getTime());
  }, 40_000);

  it("R2s staged submit: the real submitAndGradeAttempt orchestrator freezes durably at the stale authority when a closeAt change commits mid-flight", async () => {
    // T1 is the REAL production orchestrator (injected `now` — its own
    // parameter), parked at the EA seam via the enrollment barrier: its RR
    // snapshot is fixed before the writer commits, and the reconciliation
    // then evaluates the injected arrival-now against the pre-extension
    // closeAt and freezes. No Exam lock exists anywhere on the path, so the
    // concurrent committed closeAt change never aborts the transaction.
    const closeAt = new Date(Date.now() + 60_000);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const arrivalNow = new Date(closeAt.getTime() + 1_000);
    const fixture = await setupFixture(ctx, closeAt, {
      timingMode: "deadline",
    });
    const barrier = await startEnrollmentBarrier(
      fixture,
      iso.databaseUrl,
      iso.schemaName,
    );

    try {
      await barrier.holding.promise;

      const submitPromise = submitAndGradeAttempt(
        db1,
        fixture.candidateCtx,
        fixture.attemptId,
        fixture.candidateProfileId,
        arrivalNow,
      ).catch((err) => err as Error);

      await barrier.waiterSeen.promise;

      // Plain row UPDATE (see R1s note): FOR UPDATE would queue behind the
      // freeze's incidental FK FOR KEY SHARE on the exam row.
      await executeInTransaction(db2, async (tx) => {
        const examRepo = createExamRepo(tx);
        await examRepo.update(fixture.candidateCtx, fixture.examId, {
          closeAt: extendedCloseAt,
        });
      });

      barrier.release.resolve();
      await barrier.done;

      const result = (await submitPromise) as unknown as {
        attempt: { status: string; submittedAt: Date | null };
        alreadyGraded: boolean;
      };
      if (result instanceof Error) {
        throw result;
      }
      expect(result.alreadyGraded).toBe(true);

      const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
      expect(["submitted", "graded"]).toContain(attemptRow.status);
      expect((attemptRow.submittedAt as Date).getTime()).toBe(
        closeAt.getTime(),
      );
      expect(attemptRow.submissionReason).toBe("deadline");

      const examRow = await readExamRow(ctx, fixture.examId);
      expect((examRow.closeAt as Date).getTime()).toBe(
        extendedCloseAt.getTime(),
      );
    } finally {
      barrier.release.resolve();
      await barrier.done;
      await barrier.close();
    }
  }, 40_000);

  it("R3 take-wins: take decision commits first, extension applies after — both succeed, no deadlock, and extend does NOT queue behind the take (no Exam serialization point exists pre-fix)", async () => {
    const closeAt = new Date(Date.now() + 60 * MINUTE_MS);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt, {
      timingMode: "deadline",
    });

    const takeRes = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${fixture.attemptId}/take`,
      cookies: { "auth-token": fixture.candidateToken },
    });
    expect(takeRes.statusCode).toBe(200);
    expect(takeRes.json().attemptStatus).toBe("in_progress");

    // The extension is not gated by the take transaction at all pre-fix.
    const extendRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${fixture.examId}/extend`,
      payload: { extendMinutes: 30, reason: "EXAM-558 R3" },
      cookies: { "auth-token": fixture.adminToken },
    });
    expect(extendRes.statusCode).toBe(200);

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(attemptRow.status).toBe("in_progress");
    expect(attemptRow.submittedAt).toBeNull();
    const examRow = await readExamRow(ctx, fixture.examId);
    expect((examRow.closeAt as Date).getTime()).toBe(extendedCloseAt.getTime());
  }, 40_000);

  it("R4 submit-wins: candidate submit commits under the then-current authority, extension applies after — both succeed, no deadlock", async () => {
    const closeAt = new Date(Date.now() + 60 * MINUTE_MS);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt, {
      timingMode: "deadline",
    });

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fixture.attemptId}/submit`,
      cookies: { "auth-token": fixture.candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);

    const extendRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${fixture.examId}/extend`,
      payload: { extendMinutes: 30, reason: "EXAM-558 R4" },
      cookies: { "auth-token": fixture.adminToken },
    });
    expect(extendRes.statusCode).toBe(200);

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(["submitted", "graded"]).toContain(attemptRow.status);
    expect(attemptRow.submissionReason).toBe("manual");
    const examRow = await readExamRow(ctx, fixture.examId);
    expect((examRow.closeAt as Date).getTime()).toBe(extendedCloseAt.getTime());
  }, 40_000);
});
