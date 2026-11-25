import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/schema/pg";
import { STARTER_PROFILE_RECIPES } from "@exam/domain";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import examProfileRoutes from "./examProfile.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * #678 W1.2 — same-deployment A/B interleaved visibility acceptance.
 *
 * One organization, ONE test deployment, TWO exams created through the
 * profile copy-on-apply chain (docs/contracts/exam-profile-templates.md
 * §10/§11/§12):
 *
 *   - Exam A applies a basic_quiz profile and OMITS every profile-owned
 *     field, so the recipe defaults materialize into the exam columns
 *     (resultPublicationMode=immediate, 30min, maxAttempts=1, no timing
 *     gates). No queue, no proctoring — the plain path.
 *   - Exam B applies a standard_online profile and explicitly overrides
 *     after_grading → manual, minSubmit/latestStart → explicit null
 *     (§11 null-wins), while every untouched profile field still
 *     materializes (bounded_grace caps). Admission queue requires batched
 *     release.
 *
 * Both exams carry 4 objective questions + 1 plain text_response (manual
 * item), so both sit pending_manual after submit. The stages then interleave
 * on the SAME deployment:
 *
 *   ① both submitted with manual items pending → every candidate gets the
 *      submit confirmation and the result stays hidden;
 *   ② staff completes grading through the REAL gradeQuestion →
 *      finalizeTerminalGrading command chain (POST /admin/attempts/:id/
 *      grade-question, EXSEM-009/010 terminal projection in one transaction)
 *      → A becomes visible (immediate + fully_graded), B stays hidden;
 *   ③ an authorized admin publishes ONLY exam B → B becomes visible and A's
 *      already-visible result is untouched.
 *
 * Candidate assertions read the candidate's ACTUAL responses (candidate
 * tokens). Queue release is clock-controlled via ctx.setNow — no sleeps.
 */
describe("A/B interleaved visibility on one deployment (#678)", () => {
  let ctx: TestContext;
  let courseId: string;
  const objectiveQuestionIds: string[] = [];
  let textResponseQuestionId: string;

  let profileAId: string;
  let profileBId: string;
  let examAId: string;
  let examBId: string;

  const T0 = new Date();

  interface CandidateFixture {
    profileId: string;
    token: string;
    attemptA?: string;
    attemptB?: string;
  }
  const candidates: Record<"a" | "b1" | "b2", CandidateFixture> = {
    a: { profileId: "", token: "" },
    b1: { profileId: "", token: "" },
    b2: { profileId: "", token: "" },
  };

  function adminCookies() {
    return { cookies: { "auth-token": ctx.adminToken } };
  }

  function candidateCookies(key: "a" | "b1" | "b2") {
    return { cookies: { "auth-token": candidates[key]!.token } };
  }

  async function insertQuestion(input: {
    type: "true_false" | "text_response";
    content: string;
    standardAnswer: unknown;
    rubric?: string;
  }) {
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.questions).values({
      id,
      organizationId: ctx.org.id,
      courseId,
      type: input.type,
      content: input.content,
      options: [],
      standardAnswer: input.standardAnswer,
      attachments: [],
      score: 10,
      difficulty: 1,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: input.rubric ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function createProfileFromRecipe(
    key: "basic_quiz" | "standard_online",
  ): Promise<string> {
    const recipe = STARTER_PROFILE_RECIPES.find((r) => r.key === key);
    if (!recipe) throw new Error(`unknown recipe ${key}`);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exam-profiles",
      payload: { ...recipe.defaults, name: `${key}-${uniquePrefix()}` },
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  /** Every candidate answers the 4 objective questions correctly. */
  async function answerObjectiveQuestions(
    attemptId: string,
    key: "a" | "b1" | "b2",
  ) {
    for (const [index, questionId] of objectiveQuestionIds.entries()) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${questionId}`,
        payload: {
          attemptId,
          questionId,
          answer: true,
          clientSeq: index + 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        ...candidateCookies(key),
      });
      expect(res.statusCode, res.body).toBe(200);
    }
  }

  async function submitAttempt(attemptId: string, key: "a" | "b1" | "b2") {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      ...candidateCookies(key),
    });
    expect(res.statusCode, res.body).toBe(200);
    // Mixed exam: the submit confirmation commits, but the attempt stays
    // submitted with pending_manual grading (EXSEM-008 freeze barrier).
    expect(res.json().status).toBe("submitted");
  }

  async function fetchCandidateResult(
    key: "a" | "b1" | "b2",
    attemptId: string,
  ) {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      ...candidateCookies(key),
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      status: string;
      showResultImmediately: boolean;
      hiddenReason?: string;
      totalScore?: number;
      passed?: boolean;
      questionResults?: unknown[];
    };
  }

  async function gradeTextResponse(attemptId: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: textResponseQuestionId, score: 10 },
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(examProfileRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    // Controlled clock: the whole scenario runs at T0, advanced once to
    // release exam B's second admission batch (demand-driven reconcile).
    ctx.setNow(T0);

    courseId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "AB Course",
      code: `AB-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (let i = 0; i < 4; i += 1) {
      objectiveQuestionIds.push(
        await insertQuestion({
          type: "true_false",
          content: `AB objective ${i + 1}`,
          standardAnswer: true,
        }),
      );
    }
    textResponseQuestionId = await insertQuestion({
      type: "text_response",
      content: "AB plain short answer",
      standardAnswer: null,
      rubric: "内容完整、表达清晰",
    });

    // Candidates A, B1, B2 (direct rows, mirrors admissions.candidate.test).
    const now = new Date();
    for (const key of ["a", "b1", "b2"] as const) {
      const userId = crypto.randomUUID();
      const profileId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: userId,
        organizationId: ctx.org.id,
        username: `ab-${key}-${uniquePrefix()}`,
        passwordHash: await hashPassword("password123"),
        name: `AB Candidate ${key}`,
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.candidateProfiles).values({
        id: profileId,
        organizationId: ctx.org.id,
        userId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      });
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      candidates[key]!.profileId = profileId;
      candidates[key]!.token = signJWT(
        {
          actorId: userId,
          role: rows[0]!.role as never,
          organizationId: ctx.org.id,
          authEpoch: rows[0]!.authEpoch,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );
    }

    // Profiles from the shipped starter recipes (the authoring path the UI
    // prefills): every profile-owned exam field stays OMITTED at create time.
    profileAId = await createProfileFromRecipe("basic_quiz");
    profileBId = await createProfileFromRecipe("standard_online");

    const sharedAuthoring = {
      description: "",
      courseId,
      openAt: new Date(T0.getTime() - 3_600_000).toISOString(),
      closeAt: new Date(T0.getTime() + 86_400_000).toISOString(),
      passingScore: 25,
      totalScore: 50,
      questionSelectionMode: "manual",
      questionIds: [...objectiveQuestionIds, textResponseQuestionId],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        restrictIp: false,
        requireLockdown: false,
      },
    };

    // Exam A — basic_quiz applied, NO profile-owned field sent: the recipe
    // defaults must materialize (copy-on-apply §12), and controlFlags carry
    // no showResultImmediately (the legacy flag would count as an explicit
    // publication-mode input and defeat the materialization witness).
    const createA = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...sharedAuthoring,
        title: `AB-A-${uniquePrefix()}`,
        profileId: profileAId,
        controlFlags: { ...sharedAuthoring.controlFlags, requireQueue: false },
      },
      ...adminCookies(),
    });
    expect(createA.statusCode, createA.body).toBe(201);
    const bodyA = createA.json();
    examAId = bodyA.id as string;
    expect(bodyA.resultPublicationMode).toBe("immediate");
    expect(bodyA.durationMinutes).toBe(30);
    expect(bodyA.latestStartOffsetMinutes).toBeNull();
    expect(bodyA.minSubmitAfterStartMinutes).toBeNull();
    expect(bodyA.retakePolicy).toBe("max_attempts");
    expect(bodyA.maxAttempts).toBe(1);
    expect(bodyA.scoreStrategy).toBe("highest");
    expect(bodyA.interruptionTimePolicy).toBe("strict");

    // Exam B — standard_online applied with explicit overrides:
    // after_grading → manual, minSubmit/latestStart → explicit null (§11);
    // every untouched profile field still materializes; batched admission.
    const createB = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        ...sharedAuthoring,
        title: `AB-B-${uniquePrefix()}`,
        profileId: profileBId,
        resultPublicationMode: "manual",
        minSubmitAfterStartMinutes: null,
        latestStartOffsetMinutes: null,
        controlFlags: {
          ...sharedAuthoring.controlFlags,
          requireQueue: true,
          batchSize: 1,
          batchInterval: 60,
        },
      },
      ...adminCookies(),
    });
    expect(createB.statusCode, createB.body).toBe(201);
    const bodyB = createB.json();
    examBId = bodyB.id as string;
    expect(bodyB.resultPublicationMode).toBe("manual");
    expect(bodyB.durationMinutes).toBe(60);
    expect(bodyB.latestStartOffsetMinutes).toBeNull();
    expect(bodyB.minSubmitAfterStartMinutes).toBeNull();
    expect(bodyB.retakePolicy).toBe("max_attempts");
    expect(bodyB.maxAttempts).toBe(2);
    expect(bodyB.scoreStrategy).toBe("highest");
    expect(bodyB.interruptionTimePolicy).toBe("bounded_grace");
    expect(bodyB.interruptionGracePerIncidentSeconds).toBe(300);
    expect(bodyB.interruptionGracePerAttemptSeconds).toBe(600);

    for (const examId of [examAId, examBId]) {
      const publish = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/publish`,
        ...adminCookies(),
      });
      expect(publish.statusCode, publish.body).toBe(200);
    }

    const enroll = async (examId: string, profileIds: string[]) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId}/enrollments`,
        payload: { candidateIds: profileIds },
        ...adminCookies(),
      });
      expect(res.statusCode, res.body).toBe(200);
    };
    await enroll(examAId, [candidates.a!.profileId]);
    await enroll(examBId, [candidates.b1!.profileId, candidates.b2!.profileId]);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("① both exams submitted with pending manual items → submit confirmation, results hidden", async () => {
    // Exam A (no queue): start → answer → submit at frozen T0.
    const startA = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examAId}/start`,
      ...candidateCookies("a"),
    });
    expect(startA.statusCode, startA.body).toBe(201);
    candidates.a!.attemptA = startA.json().id as string;
    await answerObjectiveQuestions(candidates.a!.attemptA!, "a");
    await submitAttempt(candidates.a!.attemptA!, "a");

    // Exam B admission queue (batchSize=1, interval=60s, controlled clock):
    // the first joiner anchors the batch and is ready immediately. The
    // schedule ordinal derives from (joined_at, id) over ALL rows — joining
    // B2 at the SAME frozen instant would tie on joined_at and let the uuid
    // tiebreak flip the order, so the clock moves 1s first: B2 deterministically
    // lands batch 2 → waiting; start without admission is 409.
    const joinB1 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examBId}/queue`,
      ...candidateCookies("b1"),
    });
    expect(joinB1.statusCode, joinB1.body).toBe(200);
    expect(joinB1.json().status).toBe("ready");
    ctx.setNow(new Date(T0.getTime() + 1_000));
    const joinB2 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examBId}/queue`,
      ...candidateCookies("b2"),
    });
    expect(joinB2.statusCode, joinB2.body).toBe(200);
    expect(joinB2.json().status).toBe("waiting");
    const rejectedStart = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examBId}/start`,
      ...candidateCookies("b2"),
    });
    expect(rejectedStart.statusCode).toBe(409);

    // Release: demand-driven reconcile at the NEXT authoritative interaction
    // after the interval elapses — advance the controlled clock, no sleep.
    ctx.setNow(new Date(T0.getTime() + 61_000));
    const rejoinB2 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examBId}/queue`,
      ...candidateCookies("b2"),
    });
    expect(rejoinB2.statusCode, rejoinB2.body).toBe(200);
    expect(rejoinB2.json().status).toBe("ready");

    for (const key of ["b1", "b2"] as const) {
      const start = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examBId}/start`,
        ...candidateCookies(key),
      });
      expect(start.statusCode, start.body).toBe(201);
      candidates[key]!.attemptB = start.json().id as string;
      await answerObjectiveQuestions(candidates[key]!.attemptB!, key);
      await submitAttempt(candidates[key]!.attemptB!, key);
    }

    // ① candidate-visible truth: every candidate holds the submit
    // confirmation; every result is hidden (submitted ≠ computable result,
    // hiddenReason names the still-closed gate).
    const hiddenA = await fetchCandidateResult("a", candidates.a!.attemptA!);
    expect(hiddenA.showResultImmediately).toBe(false);
    expect(hiddenA.hiddenReason).toBe("not_started");
    for (const key of ["b1", "b2"] as const) {
      const hiddenB = await fetchCandidateResult(
        key,
        candidates[key]!.attemptB!,
      );
      expect(hiddenB.showResultImmediately).toBe(false);
      expect(hiddenB.hiddenReason).toBe("not_started");
    }
  });

  it("② real grading chain → A (immediate) visible, B (manual) still hidden", async () => {
    // Staff grades the manual item through the REAL command chain
    // (gradeQuestion → finalizeTerminalGrading: terminal workset aggregation
    // + EXSEM-010 enrollment projection in one transaction).
    for (const key of ["a", "b1", "b2"] as const) {
      const attemptId =
        key === "a" ? candidates.a!.attemptA! : candidates[key]!.attemptB!;
      await gradeTextResponse(attemptId);
    }

    // A: immediate + fully_graded → candidate sees the full result.
    const visibleA = await fetchCandidateResult("a", candidates.a!.attemptA!);
    expect(visibleA.showResultImmediately).toBe(true);
    expect(visibleA.totalScore).toBe(50);
    expect(visibleA.passed).toBe(true);
    expect(visibleA.questionResults).toHaveLength(5);

    // B: grading done but manual mode keeps the result behind the publish gate.
    for (const key of ["b1", "b2"] as const) {
      const stillHidden = await fetchCandidateResult(
        key,
        candidates[key]!.attemptB!,
      );
      expect(stillHidden.showResultImmediately).toBe(false);
      expect(stillHidden.hiddenReason).toBe("pending_publish");
    }

    // EXSEM-010 projection witness: the enrollment projection carries the
    // terminal score right after grading (grading fact ≠ publication gate).
    const detailA = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/exams/${examAId}`,
      ...candidateCookies("a"),
    });
    expect(detailA.statusCode, detailA.body).toBe(200);
    expect(detailA.json().bestScore).toBe(50);
  });

  it("③ publish exam B only → B visible, A's already-visible result unchanged", async () => {
    const publishB = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examBId}/publish-results`,
      ...adminCookies(),
    });
    expect(publishB.statusCode, publishB.body).toBe(200);
    expect(publishB.json().resultsPublishedAt).toBeTruthy();

    for (const key of ["b1", "b2"] as const) {
      const visibleB = await fetchCandidateResult(
        key,
        candidates[key]!.attemptB!,
      );
      expect(visibleB.showResultImmediately).toBe(true);
      expect(visibleB.totalScore).toBe(50);
      expect(visibleB.questionResults).toHaveLength(5);
    }

    // Interleave witness: exam A was NEVER published (manual publish is
    // per-exam), yet A's result must be exactly as visible as after ②.
    const afterPublishA = await fetchCandidateResult(
      "a",
      candidates.a!.attemptA!,
    );
    expect(afterPublishA.showResultImmediately).toBe(true);
    expect(afterPublishA.totalScore).toBe(50);
    expect(afterPublishA.passed).toBe(true);
    expect(afterPublishA.questionResults).toHaveLength(5);
  });
});
