import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/schema/pg";
import {
  STANDARD_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
  resolveDeploymentProductConfiguration,
  type ProductCapabilityId,
  type ResolvedProductConfiguration,
} from "@exam/domain";
import type { Database } from "@exam/db/types";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import {
  auditDeploymentSwitch,
  collectOutstandingObligations,
} from "./deploymentSwitchPreflight.js";
import {
  buildTestApp,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import scoreRoutes from "../routes/scores.js";

/**
 * W3.3 pairing counterexample (#678 / ADR-022 Phase 3, r4 "切换静态预设"):
 * ONE legacy Rich + 简答 exam, ONE deployment, the ceiling switching
 * MID-LIFECYCLE from full Standard to Standard-minus-Rich (关闭新增 Rich).
 *
 * The switch is judged BEFORE it takes effect (deploymentSwitchPreflight —
 * kernel fulfillment ruling: all six outstanding obligation classes derive
 * no requirement, so closing NEW Rich is ALLOWED), and after it takes
 * effect the legacy exam must run the FULL chain: 领卷 → 呈现 (the frozen
 * Rich document is still served) → 保存 (rich answer) → 交卷 → 阅卷 → 发布 →
 * 读取 — while NEW commitments beyond the ceiling are rejected at the
 * authoritative write seam and real-time actor authorization keeps
 * applying (an unenrolled candidate cannot enter under any ceiling).
 *
 * Level justification (AGENTS §7 / testing.md §4.0): a browser session
 * cannot witness a deployment config switch (the static bootstrap ceiling
 * changes only across server boots), so the pairing semantics live at the
 * API+PostgreSQL level through the canonical composition-root seam
 * (identical to examPublishCapabilityGate.test.ts); the browser arms of
 * Minimal deployments are covered by the minimal-* E2E specs.
 *
 * The reject arm of the pairing (a ceiling that WOULD cut an obligation →
 * refuse with object+obligation) has no DB-reachable trigger under the
 * kernel ruling — it is pinned by the comparator's own input domain in
 * deploymentSwitchPreflight.test.ts and deliberately NOT fabricated here.
 */

const RICH_PROMPT_DOC = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Solve: ", marks: ["bold"] },
        { type: "inlineMath", latex: "x^2-1=0" },
      ],
    },
  ],
};
const RICH_OPTION_DOC = {
  docVersion: 1,
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "root +1" }] },
  ],
};
const RICH_ANSWER_DOC = {
  docVersion: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "因式分解作答（富文本）" }],
    },
  ],
};

/** Same controlled seam as examPublishCapabilityGate.test.ts (W2c). */
const capabilityHarness = vi.hoisted(() => ({
  enabled: undefined as readonly string[] | undefined,
}));

vi.mock("./compositionRoot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compositionRoot.js")>();
  const domain =
    await vi.importActual<typeof import("@exam/domain")>("@exam/domain");
  return {
    ...actual,
    getResolvedProductConfiguration: (): ResolvedProductConfiguration => {
      // ENVIRONMENT-INDEPENDENT: the fallback resolves the FULL Standard
      // catalog through the ONE domain resolver instead of delegating to
      // the real composition root — the real resolution follows the
      // ambient PRODUCT_PRESET, and this suite (the W3.3 check runs it
      // under PRODUCT_PRESET=minimal) must control its own phases:
      // undefined = full Standard, otherwise the explicit enabled list.
      // Still the same resolver authority — no second validation.
      const enabled = capabilityHarness.enabled;
      const source = {
        ...domain.STANDARD_PRODUCT_CONFIGURATION,
        enabled:
          enabled === undefined
            ? domain.SUPPORTED_PRODUCT_CAPABILITIES
            : domain.SUPPORTED_PRODUCT_CAPABILITIES.filter((capability) =>
                (enabled as readonly string[]).includes(capability),
              ),
      };
      return domain.resolveDeploymentProductConfiguration(source);
    },
  };
});

function standardCeiling(): ResolvedProductConfiguration {
  return resolveDeploymentProductConfiguration(STANDARD_PRODUCT_CONFIGURATION);
}

function ceilingWithout(disabled: readonly ProductCapabilityId[]) {
  return resolveDeploymentProductConfiguration({
    ...STANDARD_PRODUCT_CONFIGURATION,
    enabled: SUPPORTED_PRODUCT_CAPABILITIES.filter(
      (capability) => !disabled.includes(capability),
    ),
  });
}

const RICH_SLOTS = [
  "content.prompt.rich",
  "content.option.rich",
  "answer.text.rich",
] as const;

describe("Rich + 简答 legacy exam under a mid-lifecycle ceiling switch (#678 W3.3)", () => {
  let ctx: TestContext;
  let courseId: string;
  let examId: string;
  let qRichPromptId: string;
  let qRichOptionId: string;
  let qRichAnswerId: string;
  let qPlainShortId: string;

  interface CandidateFixture {
    profileId: string;
    token: string;
    attemptId?: string;
  }
  const candidates = new Map<string, CandidateFixture>();

  function adminCookies() {
    return { cookies: { "auth-token": ctx.adminToken } };
  }

  function candidateCookies(key: string) {
    return { cookies: { "auth-token": candidates.get(key)!.token } };
  }

  async function insertCandidate(key: string): Promise<void> {
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.users).values({
      id: userId,
      organizationId: ctx.org.id,
      username: `pair-${key}-${uniquePrefix()}`,
      passwordHash: await hashPassword("password123"),
      name: `Pairing Candidate ${key}`,
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
    candidates.set(key, {
      profileId,
      token: signJWT(
        {
          actorId: userId,
          role: rows[0]!.role as never,
          organizationId: ctx.org.id,
          authEpoch: rows[0]!.authEpoch,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      ),
    });
  }

  async function createQuestion(
    payload: Record<string, unknown>,
  ): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: { courseId, ...payload },
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  async function startAttempt(key: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      ...candidateCookies(key),
    });
    expect(res.statusCode, res.body).toBe(201);
    const attemptId = res.json().id as string;
    candidates.get(key)!.attemptId = attemptId;
    return attemptId;
  }

  async function saveAnswer(
    key: string,
    attemptId: string,
    questionId: string,
    answer: unknown,
    clientSeq: number,
  ): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer,
        clientSeq,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      ...candidateCookies(key),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Pairing Course",
        code: `PAIR-${uniquePrefix()}`,
        description: "",
      },
      ...adminCookies(),
    });
    expect(courseRes.statusCode, courseRes.body).toBe(201);
    courseId = courseRes.json().id as string;

    for (const key of ["c1", "c2", "u1"]) {
      await insertCandidate(key);
    }

    // The legacy Rich + 简答 exam: rich prompt, rich option, rich-answer
    // 简答 and a plain 简答, authored and published under FULL Standard.
    qRichPromptId = await createQuestion({
      type: "single_choice",
      content: "client projection is never trusted",
      contentDocument: RICH_PROMPT_DOC,
      options: [
        { id: "a", content: "0" },
        { id: "b", content: "1" },
      ],
      standardAnswer: "a",
      score: 10,
    });
    qRichOptionId = await createQuestion({
      type: "single_choice",
      content: "Which root is +1?",
      options: [
        { id: "a", content: "0", contentDocument: RICH_OPTION_DOC },
        { id: "b", content: "1" },
      ],
      standardAnswer: "a",
      score: 10,
    });
    qRichAnswerId = await createQuestion({
      type: "text_response",
      content: "富文本简答",
      rubric: "内容完整、表达清晰",
      answerMode: "rich",
      standardAnswer: null,
      score: 10,
    });
    qPlainShortId = await createQuestion({
      type: "text_response",
      content: "Plain 简答",
      rubric: "内容完整",
      standardAnswer: null,
      score: 10,
    });

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `PAIR-rich-legacy-${uniquePrefix()}`,
        description: "",
        courseId,
        durationMinutes: 60,
        passingScore: 10,
        totalScore: 40,
        resultPublicationMode: "manual",
        questionSelectionMode: "manual",
        openAt: new Date(Date.now() - 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        questionIds: [
          qRichPromptId,
          qRichOptionId,
          qRichAnswerId,
          qPlainShortId,
        ],
      },
      ...adminCookies(),
    });
    expect(examRes.statusCode, examRes.body).toBe(201);
    examId = examRes.json().id as string;

    const publish = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      ...adminCookies(),
    });
    expect(publish.statusCode, publish.body).toBe(200);

    await ctx.db
      .update(schema.exams)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(schema.exams.id, examId));
    const enroll = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: {
        candidateIds: [
          candidates.get("c1")!.profileId,
          candidates.get("c2")!.profileId,
        ],
      },
      ...adminCookies(),
    });
    expect(enroll.statusCode, enroll.body).toBe(200);

    // ── Phase A under FULL Standard: c1 enters, presents, saves (rich),
    // submits → 待人工阅卷.
    const c1Attempt = await startAttempt("c1");
    await saveAnswer("c1", c1Attempt, qRichPromptId, "a", 1);
    await saveAnswer("c1", c1Attempt, qRichOptionId, "a", 2);
    await saveAnswer("c1", c1Attempt, qRichAnswerId, RICH_ANSWER_DOC, 3);
    await saveAnswer("c1", c1Attempt, qPlainShortId, "Plain 简答内容", 4);
    const submitC1 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${c1Attempt}/submit`,
      ...candidateCookies("c1"),
    });
    expect(submitC1.statusCode, submitC1.body).toBe(200);
    expect(submitC1.json().status).toBe("submitted");
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("pre-switch check allows closing NEW Rich, then the legacy exam fulfills the full chain", async () => {
    // ── The switch check runs BEFORE the ceiling change takes effect.
    const richOffTarget = ceilingWithout(RICH_SLOTS);
    const preflight = await auditDeploymentSwitch(
      ctx.db as Database,
      richOffTarget,
    );
    expect(preflight.allowed).toBe(true);
    expect(preflight.violations).toEqual([]);
    // The outstanding facts the check enumerated (evidence trail): the
    // legacy exam IS one of them.
    const obligations = await collectOutstandingObligations(ctx.db as Database);
    expect(obligations.some((o) => o.examId === examId)).toBe(true);

    // ── The ceiling takes effect (关闭新增 Rich).
    capabilityHarness.enabled = SUPPORTED_PRODUCT_CAPABILITIES.filter(
      (capability) => !(RICH_SLOTS as readonly string[]).includes(capability),
    );

    // NEW commitments beyond the ceiling are rejected at the authoritative
    // write seam — the bypass-the-frontend channel included.
    const rejectedCreate = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "new rich prompt",
        contentDocument: RICH_PROMPT_DOC,
        options: [
          { id: "a", content: "0" },
          { id: "b", content: "1" },
        ],
        standardAnswer: "a",
        score: 10,
      },
      ...adminCookies(),
    });
    expect(rejectedCreate.statusCode, rejectedCreate.body).toBe(400);
    expect(rejectedCreate.json().error.code).toBe("VALIDATION_ERROR");
    // The envelope carries the registry wording (details channel), so the
    // persistence witness is the W2b contract: the row never lands.
    const search = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}&search=${encodeURIComponent("new rich prompt")}`,
      ...adminCookies(),
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().total).toBe(0);

    // ── 领卷: c2 enters AFTER the switch.
    const c2Attempt = await startAttempt("c2");

    // ── 呈现: the frozen Rich document is still served to the candidate
    // (promptDocument + option documents survive the ceiling switch).
    const attempt = await ctx.app.inject({
      method: "GET",
      url: `/api/candidate/attempts/${c2Attempt}/take`,
      ...candidateCookies("c2"),
    });
    expect(attempt.statusCode, attempt.body).toBe(200);
    const questions = attempt.json().questions as Array<{
      id: string;
      promptDocument: unknown;
      answerMode: string;
      options?: Array<{ id: string; contentDocument: unknown }>;
    }>;
    const servedPrompt = questions.find((q) => q.id === qRichPromptId);
    expect(servedPrompt?.promptDocument).toEqual(RICH_PROMPT_DOC);
    const servedRichOptionQuestion = questions.find(
      (q) => q.id === qRichOptionId,
    );
    expect(
      servedRichOptionQuestion?.options?.find((o) => o.id === "a")
        ?.contentDocument,
    ).toEqual(RICH_OPTION_DOC);
    const servedRichAnswer = questions.find((q) => q.id === qRichAnswerId);
    expect(servedRichAnswer?.answerMode).toBe("rich");

    // ── 保存: the rich answer still saves under the rich-off ceiling.
    await saveAnswer("c2", c2Attempt, qRichAnswerId, RICH_ANSWER_DOC, 1);
    await saveAnswer("c2", c2Attempt, qRichPromptId, "a", 2);
    await saveAnswer("c2", c2Attempt, qRichOptionId, "a", 3);
    await saveAnswer("c2", c2Attempt, qPlainShortId, "切换后的简答", 4);

    // ── 实时授权: a non-enrolled candidate still cannot enter under any
    // ceiling — the projection never widens authorization.
    const unauthorized = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      ...candidateCookies("u1"),
    });
    expect(unauthorized.statusCode).toBe(403);
    expect(unauthorized.body).toContain("PERMISSION_DENIED");

    // ── 交卷: c2 submits.
    const submitC2 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${c2Attempt}/submit`,
      ...candidateCookies("c2"),
    });
    expect(submitC2.statusCode, submitC2.body).toBe(200);

    // ── 阅卷: staff grades BOTH attempts' manual items under the new
    // ceiling (grading completion is kernel — ADR-022 D5).
    for (const key of ["c1", "c2"] as const) {
      const attemptId = candidates.get(key)!.attemptId!;
      for (const questionId of [qRichAnswerId, qPlainShortId]) {
        const grade = await ctx.app.inject({
          method: "POST",
          url: `/api/admin/attempts/${attemptId}/grade-question`,
          payload: { questionId, score: 10 },
          ...adminCookies(),
        });
        expect(grade.statusCode, grade.body).toBe(200);
      }
    }

    // ── 发布: the unified publication runs under the new ceiling.
    const publishResults = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      ...adminCookies(),
    });
    expect(publishResults.statusCode, publishResults.body).toBe(200);

    // ── 读取: the graded+published attempt reads with its final score; the
    // fully-graded read path and historical result reads are intact.
    const c1Score = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${candidates.get("c1")!.attemptId}`,
      ...candidateCookies("c1"),
    });
    expect(c1Score.statusCode, c1Score.body).toBe(200);
    expect(c1Score.json().showResultImmediately).toBe(true);
    expect(c1Score.json().totalScore).toBe(40);
    const c2Score = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${candidates.get("c2")!.attemptId}`,
      ...candidateCookies("c2"),
    });
    expect(c2Score.statusCode, c2Score.body).toBe(200);
    expect(c2Score.json().showResultImmediately).toBe(true);
    expect(c2Score.json().totalScore).toBe(40);
  });
});
