import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  buildTestApp,
  uniquePrefix,
  type TestContext,
} from "../routes/testHelpers.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import scoreRoutes from "../routes/scores.js";
import {
  FULFILLMENT_REQUIREMENTS,
  auditDeploymentSwitch,
  auditDeploymentSwitchWithRequirements,
  collectOutstandingObligations,
  evaluateDeploymentSwitch,
  type OutstandingObligation,
} from "./deploymentSwitchPreflight.js";

/**
 * W3.1 counterexamples (ADR-022 Phase 3 #678, r4 "切换静态预设"): BEFORE a
 * static deployment ceiling change takes effect, the deployment audits the
 * ACCEPTED execution obligations it would carry over (r4 enumeration:
 * 已发布待开考 / 已 open 但合格考生尚无 attempt / 排队或待恢复 / 待阅卷 /
 * 已定稿待统一发布 / 历史读取). Obligations derive from persisted facts via
 * the existing authorities; the switch is rejected ONLY when the new
 * configuration would cut a concrete obligation, and the rejection names the
 * objects and the obligation (product-capability-composition.md §8).
 *
 * Fulfillment-requirement ruling encoded by these tests: every outstanding
 * obligation class runs on kernel paths (§4.1) with retained decoders/
 * renderers (§7), so NO capability omission cuts any of the six known
 * classes — that is exactly why the pairing acceptance below (switch with
 * every Rich slot disabled while a legacy Rich + 简答 exam is outstanding)
 * must be ALLOWED. The reject branch is therefore exercised through the
 * comparator's own input domain (an obligation carrying a requirement): DB
 * fact vocabulary is CHECK-constrained (exam_attempts_status_check), so no
 * real row can express an unclassifiable/cut obligation today.
 */
describe("pre-switch outstanding obligation audit (#678 W3.1)", () => {
  let ctx: TestContext;
  let courseId: string;

  const T0 = new Date();
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

  interface ExamFixture {
    id: string;
    questionIds: string[];
  }

  /** candidateKey → { profileId, token, attemptId? } */
  const candidates = new Map<
    string,
    { profileId: string; token: string; attemptId?: string }
  >();

  const exams: Record<
    "published" | "active" | "awaiting" | "historic" | "queued",
    ExamFixture
  > = {
    published: { id: "", questionIds: [] },
    active: { id: "", questionIds: [] },
    awaiting: { id: "", questionIds: [] },
    historic: { id: "", questionIds: [] },
    queued: { id: "", questionIds: [] },
  };

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
      username: `w31-${key}-${uniquePrefix()}`,
      passwordHash: await hashPassword("password123"),
      name: `W31 Candidate ${key}`,
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

  async function createExam(
    key: keyof typeof exams,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: `W31-${key}-${uniquePrefix()}`,
        description: "",
        courseId,
        durationMinutes: 60,
        passingScore: 50,
        questionSelectionMode: "manual",
        ...payload,
      },
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(201);
    exams[key].id = res.json().id as string;
  }

  async function publish(examId: string): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function enroll(examId: string, profileIds: string[]): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: profileIds },
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function markOpen(examId: string): Promise<void> {
    // Fixture-level window transition: the audit reads exam.status as the
    // persisted fact; the published→open state machine authority is covered
    // by its own suite. Time-based openAt is already in the past here.
    await ctx.db
      .update(schema.exams)
      .set({ status: "open", updatedAt: new Date() })
      .where(eq(schema.exams.id, examId));
  }

  async function startAttempt(key: string, examId: string): Promise<string> {
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

  async function submitAttempt(key: string, attemptId: string): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      ...candidateCookies(key),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function gradeQuestion(
    attemptId: string,
    questionId: string,
    score: number,
  ): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId, score },
      ...adminCookies(),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function publishResults(examId: string): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      ...adminCookies(),
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
    ctx.setNow(T0);

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "W31 Switch Audit Course",
        code: `W31-${uniquePrefix()}`,
        description: "",
      },
      ...adminCookies(),
    });
    expect(courseRes.statusCode, courseRes.body).toBe(201);
    courseId = courseRes.json().id as string;

    for (const key of ["p1", "r1", "r2", "r4", "q1", "h1", "w1", "w2"]) {
      await insertCandidate(key);
    }

    // Exam "active" — the legacy Rich + 简答 exam (pairing acceptance卷):
    // rich prompt, rich option, rich-answer 简答 and a plain 简答.
    const qRichPrompt = await createQuestion({
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
    const qRichOption = await createQuestion({
      type: "single_choice",
      content: "Which root is +1?",
      options: [
        { id: "a", content: "0", contentDocument: RICH_OPTION_DOC },
        { id: "b", content: "1" },
      ],
      standardAnswer: "a",
      score: 10,
    });
    const qRichAnswer = await createQuestion({
      type: "text_response",
      content: "富文本简答",
      rubric: "内容完整、表达清晰",
      answerMode: "rich",
      standardAnswer: null,
      score: 10,
    });
    const qPlainShort = await createQuestion({
      type: "text_response",
      content: "Plain 简答",
      rubric: "内容完整",
      standardAnswer: null,
      score: 10,
    });
    exams.active.questionIds = [
      qRichPrompt,
      qRichOption,
      qRichAnswer,
      qPlainShort,
    ];
    await createExam("active", {
      openAt: new Date(T0.getTime() - 3_600_000).toISOString(),
      closeAt: new Date(T0.getTime() + 86_400_000).toISOString(),
      passingScore: 10,
      totalScore: 40,
      resultPublicationMode: "manual",
      questionIds: exams.active.questionIds,
    });
    await publish(exams.active.id);
    await markOpen(exams.active.id);

    // Exam "published" — 已发布待考（future window, frozen, not yet open）.
    const pObj = await createQuestion({
      type: "true_false",
      content: "W31 objective P",
      standardAnswer: true,
      score: 100,
    });
    exams.published.questionIds = [pObj];
    await createExam("published", {
      openAt: new Date(T0.getTime() + 7_200_000).toISOString(),
      closeAt: new Date(T0.getTime() + 172_800_000).toISOString(),
      totalScore: 100,
      questionIds: [pObj],
    });
    await publish(exams.published.id);
    await enroll(exams.published.id, [candidates.get("p1")!.profileId]);

    // Exam "awaiting" — 已定稿待统一发布: objective attempt fully graded,
    // manual publication, resultsPublishedAt still null.
    const qObjQ = await createQuestion({
      type: "true_false",
      content: "W31 objective Q",
      standardAnswer: true,
      score: 100,
    });
    exams.awaiting.questionIds = [qObjQ];
    await createExam("awaiting", {
      openAt: new Date(T0.getTime() - 3_600_000).toISOString(),
      closeAt: new Date(T0.getTime() + 86_400_000).toISOString(),
      totalScore: 100,
      resultPublicationMode: "manual",
      questionIds: [qObjQ],
    });
    await publish(exams.awaiting.id);
    await markOpen(exams.awaiting.id);

    // Exam "historic" — 历史读取: results already published.
    const qObjH = await createQuestion({
      type: "true_false",
      content: "W31 objective H",
      standardAnswer: true,
      score: 100,
    });
    exams.historic.questionIds = [qObjH];
    await createExam("historic", {
      openAt: new Date(T0.getTime() - 3_600_000).toISOString(),
      closeAt: new Date(T0.getTime() + 86_400_000).toISOString(),
      totalScore: 100,
      resultPublicationMode: "manual",
      questionIds: [qObjH],
    });
    await publish(exams.historic.id);
    await markOpen(exams.historic.id);

    // Exam "queued" — 排队作答: batched admission, second joiner waiting.
    const qObjW = await createQuestion({
      type: "true_false",
      content: "W31 objective W",
      standardAnswer: true,
      score: 100,
    });
    exams.queued.questionIds = [qObjW];
    await createExam("queued", {
      openAt: new Date(T0.getTime() - 3_600_000).toISOString(),
      closeAt: new Date(T0.getTime() + 86_400_000).toISOString(),
      totalScore: 100,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        restrictIp: false,
        requireLockdown: false,
        requireQueue: true,
        batchSize: 1,
        batchInterval: 60,
      },
      questionIds: [qObjW],
    });
    await publish(exams.queued.id);
    await markOpen(exams.queued.id);

    // Enroll every participant, then drive the per-class execution facts.
    await enroll(exams.active.id, [
      candidates.get("r1")!.profileId,
      candidates.get("r2")!.profileId,
      candidates.get("r4")!.profileId,
    ]);
    await enroll(exams.awaiting.id, [candidates.get("q1")!.profileId]);
    await enroll(exams.historic.id, [candidates.get("h1")!.profileId]);
    await enroll(exams.queued.id, [
      candidates.get("w1")!.profileId,
      candidates.get("w2")!.profileId,
    ]);

    // r1: full flow → submitted with pending_manual（待人工阅卷）.
    const r1Attempt = await startAttempt("r1", exams.active.id);
    await saveAnswer("r1", r1Attempt, qRichPrompt, "a", 1);
    await saveAnswer("r1", r1Attempt, qRichOption, "a", 2);
    await saveAnswer("r1", r1Attempt, qRichAnswer, RICH_ANSWER_DOC, 3);
    await saveAnswer("r1", r1Attempt, qPlainShort, "Plain 简答内容", 4);
    await submitAttempt("r1", r1Attempt);

    // r2: mid-attempt, rich answer already saved → resumable（可恢复作答）.
    const r2Attempt = await startAttempt("r2", exams.active.id);
    await saveAnswer("r2", r2Attempt, qRichAnswer, RICH_ANSWER_DOC, 1);
    await saveAnswer("r2", r2Attempt, qRichPrompt, "a", 2);

    // q1: objective flow → graded, awaiting unified publication.
    const q1Attempt = await startAttempt("q1", exams.awaiting.id);
    await saveAnswer("q1", q1Attempt, qObjQ, true, 1);
    await submitAttempt("q1", q1Attempt);

    // h1: objective flow → graded → unified publication（历史读取）.
    const h1Attempt = await startAttempt("h1", exams.historic.id);
    await saveAnswer("h1", h1Attempt, qObjH, true, 1);
    await submitAttempt("h1", h1Attempt);
    await publishResults(exams.historic.id);

    // Queue joins (batchSize=1): w1 ready, w2 deterministically waiting.
    const joinW1 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${exams.queued.id}/queue`,
      ...candidateCookies("w1"),
    });
    expect(joinW1.statusCode, joinW1.body).toBe(200);
    ctx.setNow(new Date(T0.getTime() + 1_000));
    const joinW2 = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${exams.queued.id}/queue`,
      ...candidateCookies("w2"),
    });
    expect(joinW2.statusCode, joinW2.body).toBe(200);
    expect(joinW2.json().status).toBe("waiting");
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  function standardCeiling(): ResolvedProductConfiguration {
    return resolveDeploymentProductConfiguration(
      STANDARD_PRODUCT_CONFIGURATION,
    );
  }

  function ceilingWithout(disabled: readonly ProductCapabilityId[]) {
    return resolveDeploymentProductConfiguration({
      ...STANDARD_PRODUCT_CONFIGURATION,
      enabled: SUPPORTED_PRODUCT_CAPABILITIES.filter(
        (capability) => !disabled.includes(capability),
      ),
    });
  }

  function byKind(
    audit: ReturnType<typeof evaluateDeploymentSwitch>,
    kind: OutstandingObligation["kind"],
  ) {
    return audit.obligations.filter((obligation) => obligation.kind === kind);
  }

  it("enumerates all six outstanding obligation classes from persisted facts", async () => {
    const obligations = await collectOutstandingObligations(ctx.db as Database);

    // 已发布待考
    expect(byKindKind(obligations, "published_awaiting_start")).toEqual([
      {
        kind: "published_awaiting_start",
        examId: exams.published.id,
        requiredCapabilities: [],
      },
    ]);
    // 已 open 尚无 attempt 的合格参与者（queue-free exam only; queued
    // participants belong to the queued class below）
    expect(byKindKind(obligations, "open_eligible_without_attempt")).toEqual([
      {
        kind: "open_eligible_without_attempt",
        examId: exams.active.id,
        candidateProfileId: candidates.get("r4")!.profileId,
        requiredCapabilities: [],
      },
    ]);
    // 排队/可恢复作答: one resumable attempt + both queued admissions
    const queued = byKindKind(obligations, "queued_or_resumable");
    expect(queued).toHaveLength(3);
    expect(queued).toContainEqual({
      kind: "queued_or_resumable",
      examId: exams.active.id,
      attemptId: candidates.get("r2")!.attemptId,
      requiredCapabilities: [],
    });
    expect(queued).toContainEqual({
      kind: "queued_or_resumable",
      examId: exams.queued.id,
      candidateProfileId: candidates.get("w1")!.profileId,
      requiredCapabilities: [],
    });
    expect(queued).toContainEqual({
      kind: "queued_or_resumable",
      examId: exams.queued.id,
      candidateProfileId: candidates.get("w2")!.profileId,
      requiredCapabilities: [],
    });
    // 待人工阅卷
    expect(byKindKind(obligations, "pending_manual_grading")).toEqual([
      {
        kind: "pending_manual_grading",
        examId: exams.active.id,
        attemptId: candidates.get("r1")!.attemptId,
        requiredCapabilities: [],
      },
    ]);
    // 已定稿待统一发布
    expect(byKindKind(obligations, "finalized_awaiting_publication")).toEqual([
      {
        kind: "finalized_awaiting_publication",
        examId: exams.awaiting.id,
        attemptId: candidates.get("q1")!.attemptId,
        requiredCapabilities: [],
      },
    ]);
    // 历史读取
    expect(byKindKind(obligations, "historical_results_readable")).toEqual([
      {
        kind: "historical_results_readable",
        examId: exams.historic.id,
        requiredCapabilities: [],
      },
    ]);
  });

  it("allows switching to a Rich-disabled ceiling while the legacy Rich + 简答 exam is outstanding (pairing)", async () => {
    const obligations = await collectOutstandingObligations(ctx.db as Database);
    const audit = evaluateDeploymentSwitch(
      obligations,
      ceilingWithout([
        "content.prompt.rich",
        "content.option.rich",
        "answer.text.rich",
      ]),
    );

    // §7/D5: fulfillment paths are kernel and the Rich decoder/renderer is
    // retained, so closing NEW Rich cuts none of the six outstanding
    // obligations — the switch is allowed and the pairing flow can run.
    expect(audit.allowed).toBe(true);
    expect(audit.violations).toEqual([]);
    for (const kind of [
      "published_awaiting_start",
      "open_eligible_without_attempt",
      "queued_or_resumable",
      "pending_manual_grading",
      "finalized_awaiting_publication",
      "historical_results_readable",
    ] as const) {
      expect(byKind(audit, kind).length).toBeGreaterThan(0);
    }
  });

  it("derives no fulfillment capability requirement for any known class (kernel ruling)", async () => {
    const obligations = await collectOutstandingObligations(ctx.db as Database);
    expect(obligations.length).toBeGreaterThanOrEqual(6);
    for (const obligation of obligations) {
      expect(obligation.requiredCapabilities).toEqual([]);
    }
    // The same facts allow the full Standard ceiling trivially.
    expect(
      evaluateDeploymentSwitch(obligations, standardCeiling()).allowed,
    ).toBe(true);
  });

  it("做减法: skips the database entirely while no obligation class is gated", async () => {
    // #678 review: with an empty rule table the enumeration cannot change
    // the verdict, so the startup audit must not touch the database at all.
    // The proxy fails on ANY property access — an O(history) scan at every
    // boot would throw here instead of silently returning.
    const untouchableDb = new Proxy({} as Database, {
      get() {
        throw new Error("preflight touched the database with no gated class");
      },
    });
    const audit = await auditDeploymentSwitch(untouchableDb, standardCeiling());
    expect(audit).toEqual({
      allowed: true,
      obligations: [],
      violations: [],
      scanned: false,
      gatedKinds: [],
    });
    // The production differential on the real (non-empty) database: the
    // same skip — the fixtures above DO carry obligations, none gated.
    const onFixtures = await auditDeploymentSwitch(
      ctx.db as Database,
      ceilingWithout([
        "content.prompt.rich",
        "content.option.rich",
        "answer.text.rich",
      ]),
    );
    expect(onFixtures.scanned).toBe(false);
    expect(onFixtures.gatedKinds).toEqual([]);
    expect(onFixtures.allowed).toBe(true);
  });

  it("walks persisted data to a rejection when a rule-table entry registers a requirement", async () => {
    // The composition seam over an injected rule table: this is the
    // production machinery (collect from persisted facts → filter to gated
    // classes → compare), proven with a FUTURE entry shape before any real
    // one exists. The pending-manual attempt the fixtures persisted is the
    // named object; the ceiling that omits grading.manual is the cut.
    const r1AttemptId = candidates.get("r1")!.attemptId;
    if (r1AttemptId === undefined) {
      throw new Error("seed did not record r1's submitted attempt");
    }
    const injected = {
      ...FULFILLMENT_REQUIREMENTS,
      pending_manual_grading: ["grading.manual"] as const,
    };
    const audit = await auditDeploymentSwitchWithRequirements(
      ctx.db as Database,
      // question.text_response must go too: the resolver's dependency rule
      // rejects a ceiling that enables subjective questions without their
      // manual completion path.
      ceilingWithout(["grading.manual", "question.text_response"]),
      injected,
    );
    expect(audit.scanned).toBe(true);
    expect(audit.gatedKinds).toEqual(["pending_manual_grading"]);
    expect(audit.allowed).toBe(false);
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0]).toMatchObject({
      kind: "pending_manual_grading",
      capability: "grading.manual",
    });
    expect(audit.violations[0]!.objects).toContainEqual({
      examId: exams.active.id,
      attemptId: r1AttemptId,
    });

    // Target-driven both ways: the same injected table against a ceiling
    // that ADMITS the requirement stays allowed.
    const admitted = await auditDeploymentSwitchWithRequirements(
      ctx.db as Database,
      standardCeiling(),
      injected,
    );
    expect(admitted.allowed).toBe(true);
    expect(admitted.violations).toEqual([]);
  });

  it("rejects with object + obligation + reason when a requirement is not admitted", () => {
    // Comparator input domain: an obligation carrying a fulfillment
    // requirement (future rule-table entries, e.g. #645 result delivery).
    // No CHECK-constrained row can express this today — the DB-derived
    // assertions above pin the current ruling; THIS pins the reject channel.
    const r1AttemptId = candidates.get("r1")!.attemptId;
    if (r1AttemptId === undefined) {
      throw new Error("seed did not record r1's submitted attempt");
    }
    const pendingManual: OutstandingObligation = {
      kind: "pending_manual_grading",
      examId: exams.active.id,
      attemptId: r1AttemptId,
      requiredCapabilities: ["grading.manual"],
    };
    const noManualTarget = ceilingWithout([
      "grading.manual",
      "question.text_response",
      "content.prompt.rich",
      "content.option.rich",
      "answer.text.rich",
    ]);

    const audit = evaluateDeploymentSwitch([pendingManual], noManualTarget);
    expect(audit.allowed).toBe(false);
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0]).toMatchObject({
      kind: "pending_manual_grading",
      capability: "grading.manual",
      objects: [
        { examId: exams.active.id, attemptId: pendingManual.attemptId },
      ],
    });
    expect(audit.violations[0]!.reason).toMatch(/grading\.manual/);

    // Target-driven both ways: the same obligation under a ceiling that
    // admits its requirement is allowed, without any violation.
    const admitted = evaluateDeploymentSwitch(
      [pendingManual],
      standardCeiling(),
    );
    expect(admitted.allowed).toBe(true);
    expect(admitted.violations).toEqual([]);
  });
});

/** Local helper — keeps the kind filter above readable. */
function byKindKind(
  obligations: readonly OutstandingObligation[],
  kind: OutstandingObligation["kind"],
): readonly OutstandingObligation[] {
  return obligations.filter((obligation) => obligation.kind === kind);
}
