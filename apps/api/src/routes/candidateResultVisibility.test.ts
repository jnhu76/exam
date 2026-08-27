import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import postgres from "postgres";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

/**
 * Issue #324 — candidate result-visibility projection regression.
 *
 * Invariant under test: no candidate-facing response may reveal
 * score-derived result facts until the exam publication policy says the
 * result is visible. The canonical decision is the same one
 * /api/scores/attempts/:attemptId applies (P2D-J5a); every other candidate
 * projection must agree with it.
 *
 * Leak repros (manual mode + fully graded + resultsPublishedAt = null):
 *   L1 submit response, L2 GET /attempts/:id, L3 candidate exam list,
 *   L4 candidate exam detail, L5 pass_then_stop blockingReason.
 *
 * #324 review P1-2 regressions: the pass_then_stop start oracle — while the
 * result is hidden, passed and failed candidates must get the IDENTICAL
 * opaque start rejection (no 409-vs-201 differential); after publish-results
 * the durable pass_then_stop policy resumes (passed blocked, failed retakes).
 */
describe("P1 #324: candidate result visibility projection", () => {
  let ctx: TestContext;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Course",
      code: `324-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "Choose A",
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
      ],
      standardAnswer: "a",
      attachments: [],
      score: 10,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const existing = await ctx.db
      .select({ id: schema.candidateProfiles.id })
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
    if (existing[0]) {
      candidateProfileId = existing[0].id;
    } else {
      await ctx.db.insert(schema.candidateProfiles).values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function candidateCtx() {
    return {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  async function forceGradingStatus(
    attemptId: string,
    status: "auto_graded" | "pending_manual" | "fully_graded",
  ) {
    await createAttemptRepo(ctx.db).update(candidateCtx(), attemptId, {
      gradingStatus: status,
    });
  }

  /**
   * Creates + publishes an exam with the given publication mode, enrolls the
   * candidate, starts an attempt, answers (correctly → full score → passed,
   * or incorrectly → zero → failed), and submits. Returns the graded
   * attemptId and examId.
   */
  async function createGradedAttemptForMode(
    resultPublicationMode: "immediate" | "after_grading" | "manual",
    retakePolicy: "unlimited" | "pass_then_stop" = "unlimited",
    outcome: "pass" | "fail" = "pass",
  ): Promise<{ attemptId: string; examId: string }> {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `324-${resultPublicationMode}-${retakePolicy}`,
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
        retakePolicy,
        scoreStrategy: "highest",
        maxAttempts: 3,
        resultPublicationMode,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(createResponse.statusCode).toBe(201);
    const examId = createResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const startResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: outcome === "pass" ? "a" : "b",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    const submitResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(submitResponse.statusCode).toBe(200);
    return { attemptId: submitResponse.json().id as string, examId };
  }

  async function getCandidateAttempt(attemptId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  async function getCandidateExamList() {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Array<Record<string, unknown>>;
  }

  async function getCandidateExamDetail(examId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/exams/${examId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  async function getTakeSnapshot(attemptId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${attemptId}/take`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  // ── Manual mode, pre-publish leak repros ─────────────────────────

  it("L1: manual + graded + unpublished — submit response must not expose score/passed", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.score).toBeUndefined();
    expect(body.passed).toBeUndefined();
  });

  it("L2: manual + graded + unpublished — GET /attempts/:id must not expose score/passed", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const body = await getCandidateAttempt(attemptId);
    expect(body.score).toBeUndefined();
    expect(body.passed).toBeUndefined();
  });

  it("L3: manual + graded + unpublished — candidate exam list must not expose bestScore/bestScorePercent", async () => {
    const { examId } = await createGradedAttemptForMode("manual");
    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBeUndefined();
    expect(entry!.bestScorePercent).toBeUndefined();
  });

  it("L4: manual + graded + unpublished — candidate exam detail must not expose bestScore/bestScorePercent", async () => {
    const { examId } = await createGradedAttemptForMode("manual");
    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBeUndefined();
    expect(detail.bestScorePercent).toBeUndefined();
  });

  it("L5: manual + passed + unpublished — pass_then_stop detail must not disclose already_passed", async () => {
    const { examId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
    );
    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBeUndefined();
    expect(detail.blockingReason).not.toBe("already_passed");
    expect(detail.canStartNewAttempt).toBe(false);
    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBeUndefined();
  });

  // ── pass_then_stop start oracle closure (#324 review P1-2) ────────
  //
  // The engine's durable pass_then_stop block distinguishes passed (409)
  // from failed (201) candidates on POST /attempts/:examId/start. While the
  // result is hidden that difference IS the pass/fail fact. Retake
  // eligibility is deferred until publication: both outcomes must behave
  // identically pre-publish, then diverge exactly as the durable policy says.

  it("start oracle: manual + unpublished — passed and failed candidates get the IDENTICAL opaque start rejection", async () => {
    const { examId: passedExamId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
      "pass",
    );
    const { examId: failedExamId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
      "fail",
    );

    const passedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${passedExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const failedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${failedExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(passedStart.statusCode).toBe(409);
    expect(failedStart.statusCode).toBe(409);
    const stripRequestId = (body: unknown) => {
      const parsed = body as { error: Record<string, unknown> };
      const { requestId: _req, ...error } = parsed.error;
      return error;
    };
    expect(stripRequestId(passedStart.json())).toEqual(
      stripRequestId(failedStart.json()),
    );
    expect(JSON.stringify(stripRequestId(passedStart.json()))).not.toContain(
      "已通过",
    );

    const passedDetail = await getCandidateExamDetail(passedExamId);
    const failedDetail = await getCandidateExamDetail(failedExamId);
    expect(passedDetail.canStartNewAttempt).toBe(false);
    expect(failedDetail.canStartNewAttempt).toBe(false);
    expect(passedDetail.blockingReason).toBeUndefined();
    expect(failedDetail.blockingReason).toBeUndefined();
  });

  it("start oracle: manual + published — durable pass_then_stop policy resumes (passed blocked, failed may retake)", async () => {
    const { examId: passedExamId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
      "pass",
    );
    const { examId: failedExamId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
      "fail",
    );
    for (const examId of [passedExamId, failedExamId]) {
      const publishResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish-results`,
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(publishResponse.statusCode).toBe(200);
    }

    // Read the projection BEFORE starting anything — a successful failed-side
    // start would create an in_progress attempt and change the detail.
    const passedDetail = await getCandidateExamDetail(passedExamId);
    const failedDetail = await getCandidateExamDetail(failedExamId);
    expect(passedDetail.canStartNewAttempt).toBe(false);
    expect(passedDetail.blockingReason).toBe("already_passed");
    expect(failedDetail.canStartNewAttempt).toBe(true);

    const passedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${passedExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const failedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${failedExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(passedStart.statusCode).toBe(409);
    expect(failedStart.statusCode).toBe(201);
  });

  it("start oracle P1-3: terminal grading commits while start waits on the enrollment lock — passed and failed candidates get the IDENTICAL opaque 409, no attempt created", async () => {
    // Deterministic interleaving at the wire (issue #324 review P1-3). The
    // round-1 pre-check read enrollment OUTSIDE the transaction, so a start
    // that arrived while attempt #1 was still grading could observe
    // finalAttemptId=null and — once grading committed — leak a pass/fail
    // oracle (passed 409, failed 201). The decision now lives inside the
    // engine, under the enrollment lock shared with the grading finalizer.
    // Here we HOLD that lock in a test transaction, fire the start (it blocks
    // on the engine's FOR UPDATE), wait until it is verifiably blocked, commit
    // the terminalization, and assert both outcomes land on the same opaque
    // 409 with no attempt #2 created.
    async function createInFlightAttempt(outcome: "pass" | "fail") {
      const createResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: `324-race-${uniquePrefix()}-${outcome}`,
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3_600_000).toISOString(),
          closeAt: new Date(Date.now() + 86_400_000).toISOString(),
          passingScore: 6,
          totalScore: 10,
          questionSelectionMode: "manual",
          questionIds: [questionId],
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
          retakePolicy: "pass_then_stop",
          scoreStrategy: "highest",
          maxAttempts: 3,
          resultPublicationMode: "manual",
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(createResponse.statusCode).toBe(201);
      const examId = createResponse.json().id as string;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: [candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });
      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(startResponse.statusCode).toBe(201);
      const attemptId = startResponse.json().id as string;
      // Hold attempt #1 at the grading boundary: not active, no terminal
      // projection, enrollment.finalAttemptId still null.
      await createAttemptRepo(ctx.db).update(candidateCtx(), attemptId, {
        status: "grading",
        gradingStatus: "auto_graded",
      });
      const enrollment = await createEnrollmentRepo(
        ctx.db,
      ).findByExamAndCandidate(candidateCtx(), examId, candidateProfileId);
      expect(enrollment).not.toBeNull();
      return { examId, attemptId, enrollmentId: enrollment!.id };
    }

    for (const outcome of ["pass", "fail"] as const) {
      const { examId, attemptId, enrollmentId } =
        await createInFlightAttempt(outcome);

      // Hold the enrollment FOR UPDATE lock, fire the start, and wait until it
      // is verifiably blocked on the engine's lock acquisition before writing
      // the terminal grading facts (mirroring finalizeTerminalGrading).
      //
      // The lock-hold runs on a dedicated auxiliary client, not ctx.conn.sql:
      // under file-schema isolation createPostgresDatabase forces that pool to
      // max:1 (a single backend shared by the app and this transaction). A
      // sql.begin on it starves the app's only backend — the start request
      // never reaches PostgreSQL at all, so no Lock waiter exists for the
      // pg_stat_activity probe to observe. With the test transaction on its
      // own connection (same database + search_path), the engine acquires a
      // real backend and blocks server-side on the enrollment row lock exactly
      // as it does under worker-database pools.
      const shown = await ctx.conn.sql`SHOW search_path`;
      const searchPath = String(
        (shown[0] as Record<string, unknown>).search_path,
      );
      const co = ctx.conn.sql.options;
      const lockHoldSql = postgres({
        host: Array.isArray(co.host) ? co.host[0] : co.host,
        port: Array.isArray(co.port) ? co.port[0] : co.port,
        username: co.user,
        password: co.pass ?? undefined,
        database: co.database,
        max: 1,
        connection: { search_path: searchPath },
      });
      try {
        let startRes: Awaited<ReturnType<typeof ctx.app.inject>> | undefined;
        await lockHoldSql.begin(async (sql) => {
          await sql`SELECT id FROM exam_enrollments WHERE id = ${enrollmentId} FOR UPDATE`;
          startRes = ctx.app.inject({
            method: "POST",
            url: `/api/attempts/${examId}/start`,
            cookies: { "auth-token": ctx.candidateToken },
          });
          let blocked = false;
          for (let i = 0; i < 200; i++) {
            const rows = (await sql`
              SELECT count(*)::int AS waiting
              FROM pg_stat_activity
              WHERE pid <> pg_backend_pid()
                AND datname = current_database()
                AND wait_event_type = 'Lock'
            `) as unknown as Array<{ waiting: number }>;
            if (rows[0]?.waiting && rows[0].waiting > 0) {
              blocked = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 10));
          }
          expect(blocked).toBe(true);
          const passed = outcome === "pass";
          const score = passed ? 10 : 0;
          await sql`UPDATE exam_attempts SET status = 'graded', total_score = ${score}, passed = ${passed}, graded_at = now(), grading_status = 'auto_graded', grading_result = ${JSON.stringify(
            [
              {
                questionId,
                score,
                maxScore: 10,
                correct: passed,
                candidateAnswer: passed ? "a" : "b",
                standardAnswer: "a",
              },
            ],
          )}::jsonb WHERE id = ${attemptId}`;
          await sql`UPDATE exam_enrollments SET final_score = ${score}, final_passed = ${passed}, final_attempt_id = ${attemptId}, status = ${passed ? "completed" : "started"} WHERE id = ${enrollmentId}`;
        });
        const response = await startRes!;

        // The start was in-flight before the terminalization committed and is
        // decided on the committed state: identical opaque 409 for both outcomes.
        // ConflictError's wire code normalizes to RESOURCE_CONFLICT (legacy map).
        expect(response.statusCode).toBe(409);
        const stripRequestId = (body: unknown) => {
          const parsed = body as { error: Record<string, unknown> };
          const { requestId: _req, ...error } = parsed.error;
          return error;
        };
        expect(stripRequestId(response.json()).code).toBe("RESOURCE_CONFLICT");
        expect(JSON.stringify(stripRequestId(response.json()))).not.toContain(
          "已通过",
        );

        const attempts = await createAttemptRepo(ctx.db).findByExamAndCandidate(
          candidateCtx(),
          examId,
          candidateProfileId,
        );
        // No attempt #2 was created for either outcome.
        expect(attempts.filter((a) => a.status === "in_progress")).toHaveLength(
          0,
        );
      } finally {
        await lockHoldSql.end({ timeout: 5 });
      }
    }
  });

  it("take-snapshot: manual + graded + unpublished — resultVisibility stays hidden", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("hidden");
    expect(snapshot).not.toHaveProperty("score");
    expect(snapshot).not.toHaveProperty("passed");
  });

  it("standardAnswer isolation: candidate attempt response never carries standardAnswer", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const body = await getCandidateAttempt(attemptId);
    const snapshot = body.questionSnapshot as Array<Record<string, unknown>>;
    expect(snapshot.length).toBeGreaterThan(0);
    for (const question of snapshot) {
      expect(question).not.toHaveProperty("standardAnswer");
      expect(question).not.toHaveProperty("rubric");
    }
  });

  // ── Manual mode, post-publish restoration ────────────────────────

  it("manual + publish-results — all candidate surfaces expose intended results consistently", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("manual");
    const publishResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishResponse.statusCode).toBe(200);

    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBe(10);
    expect(attemptBody.passed).toBe(true);

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBe(10);
    expect(entry!.bestScorePercent).toBe(100);

    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBe(10);
    expect(detail.bestScorePercent).toBe(100);

    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("visible");
  });

  it("manual + publish-results + pass_then_stop — already_passed blocking reason restored", async () => {
    const { examId } = await createGradedAttemptForMode(
      "manual",
      "pass_then_stop",
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const detail = await getCandidateExamDetail(examId);
    expect(detail.blockingReason).toBe("already_passed");
    expect(detail.canStartNewAttempt).toBe(false);
    expect(detail.bestScore).toBe(10);
  });

  // ── immediate / after_grading semantics unchanged ────────────────

  it("immediate — submit response and list expose results (no regression)", async () => {
    const { attemptId, examId } = await createGradedAttemptForMode("immediate");
    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBe(10);
    expect(attemptBody.passed).toBe(true);

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBe(10);

    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("visible");
  });

  it("after_grading + auto_graded — result hidden on every candidate surface (converges with score endpoint)", async () => {
    const { attemptId, examId } =
      await createGradedAttemptForMode("after_grading");
    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBeUndefined();
    expect(attemptBody.passed).toBeUndefined();

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBeUndefined();

    const detail = await getCandidateExamDetail(examId);
    expect(detail.bestScore).toBeUndefined();

    const snapshot = await getTakeSnapshot(attemptId);
    expect(snapshot.resultVisibility).toBe("hidden");

    const scoreResponse = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(scoreResponse.json().showResultImmediately).toBe(false);
  });

  it("after_grading + fully_graded — result visible on every candidate surface", async () => {
    const { attemptId, examId } =
      await createGradedAttemptForMode("after_grading");
    await forceGradingStatus(attemptId, "fully_graded");
    const attemptBody = await getCandidateAttempt(attemptId);
    expect(attemptBody.score).toBe(10);
    expect(attemptBody.passed).toBe(true);

    const list = await getCandidateExamList();
    const entry = list.find((item) => item.examId === examId);
    expect(entry).toBeDefined();
    expect(entry!.bestScore).toBe(10);
  });

  // ── Admin all-view unaffected ────────────────────────────────────

  it("admin all-view — sees full result even when manual + unpublished", async () => {
    const { attemptId } = await createGradedAttemptForMode("manual");
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.showResultImmediately).toBe(true);
    expect(body.totalScore).toBe(10);
  });
});
