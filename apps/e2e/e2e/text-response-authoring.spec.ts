import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import type { SeededCandidate } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  adminGet,
  candidateLogin,
  candidateApiToken,
  startExamFromList,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
  getCandidateResult,
  publishResultsApi,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * P2 authoring closeout — the real-UI text_response product loop.
 *
 * This is the authoring proof the historical audit said was missing and that
 * no prior E2E provided: a text_response question created through the real
 * QuestionForm (NOT seedExam), then driven through the full product path:
 *
 *   Admin UI creates text_response (type + content + rubric + optional ref)
 *     → list + type filter reach it
 *     → edit round-trips rubric + reference answer
 *     → API assembles an exam with the UI-authored question, publishes it
 *     → candidate (enrolled) starts, sees the prompt, does NOT see rubric /
 *       reference, answers multiline plain text, submits
 *     → admin grading queue shows the attempt; admin sees the frozen rubric
 *       and frozen reference answer and the frozen candidate answer
 *     → admin completes manual grading → graded + fully_graded
 *     → final score identity
 *
 * The question is created through the UI (the authoring surface under test).
 * Exam assembly / enrollment / grading use API helpers — per the task, the
 * loop may consume the UI-authored entity via API; only question authoring
 * must be UI-driven (that is the gap this task closes).
 */

const STAMP = `${Date.now()}`;
const Q_CONTENT = `P2论述题-${STAMP}-请阐述考试安全边界`;
const Q_CONTENT_EDITED = `P2论述题-${STAMP}-已修改`;
const RUBRIC = `评分标准：\n1. 关键概念正确\n2. 论证逻辑完整\n3. 结合实际场景`;
const RUBRIC_EDITED = `评分标准（修改）：\n1. 概念\n2. 逻辑\n3. 实际`;
const REFERENCE = `参考答案：从身份核验、网络隔离、作答冻结三方面论述`;
const CANDIDATE_ANSWER =
  "考试安全边界首先依赖身份核验，其次需要网络隔离，最后通过作答冻结保证不可篡改。";
const ESSAY_SCORE = 40;

/** Open the type <Select> (a11y label 题目类型) and pick a visible option. */
async function pickQuestionType(page: Page, optionName: string) {
  await page.getByRole("combobox", { name: "题目类型" }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("P2 text_response authoring + product loop", () => {
  test("UI-author a text_response, then publish → candidate answers → graded", async ({
    page,
    request,
  }) => {
    // ── Setup: reuse an existing seed course (avoiding CI pagination flakiness
    // when many parallel E2E tests create courses). The seed data guarantees
    // "基础安全培训" (SAFETY-101) is always present. ──
    const adminToken = await adminApiToken(request);
    const coursesRes = await adminGet(
      request,
      adminToken,
      `/api/courses?search=${encodeURIComponent("基础安全")}`,
    );
    const coursesBody = (await coursesRes.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    const seedCourse = coursesBody.items.find(
      (c: { name: string }) => c.name === "基础安全培训",
    );
    expect(seedCourse, "seed course 基础安全培训 must exist").toBeTruthy();
    const courseId = seedCourse!.id;

    // Also provision a candidate (API) for the product-loop half.
    const candStamp = STAMP;
    const candidateUsername = `e2e-p2-${candStamp}`;
    const candidateName = `P2候选人-${candStamp}`;
    const candRes = await request.post(`${BASE_URL}/api/candidates`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        username: candidateUsername,
        password: "candidate123",
        name: candidateName,
        fields: { candidateNo: `E2E-P2-${candStamp}` },
      },
    });
    expect(candRes.ok()).toBeTruthy();
    const candBody = (await candRes.json()) as {
      id: string;
      userId: string;
    };
    const candidateProfileId = candBody.id;
    const candidate: SeededCandidate = {
      profileId: candBody.id,
      userId: candBody.userId,
      username: candidateUsername,
      name: candidateName,
      password: "candidate123",
    };

    // ════════════════════════════════════════════════════════════════════
    // PART 1 — UI authoring (the surface under test). No seedExam here.
    // ════════════════════════════════════════════════════════════════════
    await loginAsAdmin(page);

    await page.goto("/admin/questions");
    await page.getByRole("button", { name: /新增题目/ }).click();
    await page.waitForURL(/\/admin\/questions\/new/);

    // Select the course + text_response type. The course selector is a
    // searchable Popover (CourseSearchSelect). The type selector is a
    // standard <Select> with aria-label "题目类型".
    const SEED_COURSE_NAME = seedCourse!.name;
    await page.getByRole("combobox").first().click();
    await page.getByPlaceholder("搜索课程名称或代码...").fill(SEED_COURSE_NAME);
    await page
      .getByRole("option", { name: SEED_COURSE_NAME, exact: true })
      .click();
    await pickQuestionType(page, "文本作答题");

    // Content (multiline plain text).
    await page.getByPlaceholder("输入题目内容").fill(Q_CONTENT);
    // Required rubric (multiline).
    await page
      .getByPlaceholder("请描述评分时应考虑的关键点、完整性、准确性或论证质量")
      .fill(RUBRIC);
    // Optional reference answer (multiline).
    await page
      .getByPlaceholder("供阅卷人参考的示例答案，不影响自动判分")
      .fill(REFERENCE);
    // Score must be a finite positive number. The score input is the only
    // spinbutton on the form (its <Label> is a visual sibling, no htmlFor).
    await page.getByRole("spinbutton").fill(String(ESSAY_SCORE));

    const createResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().endsWith("/api/questions"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^保存$/ }).click();
    const createdRes = await createResponse;
    expect(createdRes.status()).toBe(201);
    const createdBody = await createdRes.json();
    const questionId = createdBody.id as string;
    expect(questionId).toBeTruthy();
    // Authoring payload truth: type + rubric + reference answer + no options.
    expect(createdBody.type).toBe("text_response");
    expect(createdBody.rubric).toBe(RUBRIC);
    expect(createdBody.standardAnswer).toBe(REFERENCE);
    expect(createdBody.options).toEqual([]);

    // ── List + type filter: the new question is reachable and filterable. ─
    await page.waitForURL("**/admin/questions");
    await page.getByPlaceholder(/搜索/).fill(Q_CONTENT);
    // The question content appears both in the list table cell (an aria-labeled
    // span) and in any live preview; pin the assertion to the table cell.
    await page
      .getByLabel(Q_CONTENT, { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });

    // The type filter (authoritative API) returns the UI-authored question
    // when filtering by text_response — proves the bank can find it by type.
    const filteredByType = await (
      await adminGet(
        request,
        adminToken,
        `/api/questions?type=text_response&search=${encodeURIComponent(Q_CONTENT)}`,
      )
    ).json();
    const foundByType = (filteredByType.items ?? []).some(
      (q: { id: string }) => q.id === questionId,
    );
    expect(
      foundByType,
      "expected the UI-authored question under text_response filter",
    ).toBeTruthy();

    // ── Edit: readback symmetry + rubric edit persistence. ──────────────
    // Scope the edit button to THIS question's row so a stale/unfiltered row
    // or another question can never be opened instead.
    const myRow = page
      .getByRole("row", { name: Q_CONTENT })
      .filter({ has: page.getByLabel(Q_CONTENT, { exact: true }) });
    await myRow.getByRole("button", { name: /编辑/ }).click();
    await page.waitForURL(/\/admin\/questions\/.+\/edit/);

    const contentField = page.getByPlaceholder("输入题目内容");
    const rubricField = page.getByPlaceholder(
      "请描述评分时应考虑的关键点、完整性、准确性或论证质量",
    );
    const referenceField = page.getByPlaceholder(
      "供阅卷人参考的示例答案，不影响自动判分",
    );
    // Readback: content + rubric + reference answer echoed verbatim.
    await expect(contentField).toHaveValue(Q_CONTENT);
    await expect(rubricField).toHaveValue(RUBRIC);
    await expect(referenceField).toHaveValue(REFERENCE);

    // Edit rubric + content; reference answer unchanged.
    await rubricField.fill(RUBRIC_EDITED);
    await contentField.fill(Q_CONTENT_EDITED);

    const patchResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        res.url().includes(`/api/questions/${questionId}`),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^保存$/ }).click();
    const patchedRes = await patchResponse;
    expect(patchedRes.status()).toBe(200);
    const patchedBody = await patchedRes.json();
    expect(patchedBody.rubric).toBe(RUBRIC_EDITED);
    expect(patchedBody.content).toBe(Q_CONTENT_EDITED);
    // Reference answer preserved across the rubric edit.
    expect(patchedBody.standardAnswer).toBe(REFERENCE);

    // Re-open the edit page (PATCH success navigates to the list) and verify
    // the edits persisted via a fresh GET — readback after a fresh load.
    await page.goto(`/admin/questions/${questionId}/edit`);
    await page.waitForURL(/\/admin\/questions\/.+\/edit/);
    await expect(contentField).toHaveValue(Q_CONTENT_EDITED);
    await expect(rubricField).toHaveValue(RUBRIC_EDITED);
    await expect(referenceField).toHaveValue(REFERENCE);

    // ════════════════════════════════════════════════════════════════════
    // PART 2 — Product loop consuming the UI-authored question (API-driven
    // assembly, candidate UI answer, admin grading).
    // ════════════════════════════════════════════════════════════════════
    const examRes = await adminPost(request, adminToken, "/api/exams", {
      title: `P2产品环-${STAMP}`,
      description: "",
      courseId,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3_600_000).toISOString(),
      closeAt: new Date(Date.now() + 86_400_000).toISOString(),
      passingScore: Math.floor(ESSAY_SCORE / 2),
      totalScore: ESSAY_SCORE,
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
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 3,
      minSubmitAfterStartMinutes: null,
      latestStartOffsetMinutes: null,
      resultPublicationMode: "immediate",
    });
    expect(examRes.status()).toBe(201);
    const examId = (await examRes.json()).id as string;

    // Publish (publishExam must accept the UI-authored rubric; a missing
    // rubric would be rejected here — proof the UI produced a valid item).
    const publishRes = await adminPost(
      request,
      adminToken,
      `/api/exams/${examId}/publish`,
      {},
    );
    expect(publishRes.status()).toBeLessThan(300);

    // Enroll the candidate.
    const enrollRes = await adminPost(
      request,
      adminToken,
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [candidateProfileId] },
    );
    expect(enrollRes.status()).toBeLessThan(300);

    // The frozen snapshot authority is the attempt's questionSnapshot (copied
    // at publish time), not the exam detail endpoint. It is asserted below
    // via the grading-details projection once the candidate has started +
    // submitted — that projection reads the frozen rubric / reference answer
    // and proves the UI-authored values were frozen at publish.

    // ── Candidate: sees prompt, NOT rubric/reference; answers; submits. ──
    await candidateLogin(page, candidate);

    // Capture the start-attempt response to obtain the authoritative attempt
    // id (more robust than re-deriving it from the candidate exam list shape).
    const startResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 15_000 },
    );
    await startExamFromList(page, examId);
    const startResponse = await startResponsePromise;
    expect([200, 201]).toContain(startResponse.status());
    const attemptIdAuth = (await startResponse.json()).id as string;

    // The prompt is visible; rubric / reference text must NOT appear. The
    // markers below are unique to the grader's rubric / reference answer.
    const section = page.getByTestId("take-question-section");
    await expect(section.getByText(Q_CONTENT_EDITED)).toBeVisible();
    await expect(section.getByText("评分标准")).toHaveCount(0);
    await expect(section.getByText(/关键概念/)).toHaveCount(0);
    await expect(section.getByText(/参考答案/)).toHaveCount(0);
    await expect(section.getByText(/三方面论述/)).toHaveCount(0);

    await answerTextResponse(page, CANDIDATE_ANSWER);
    await waitForSaveSaved(page);

    // Authoritative take API (API-level leak guard, not just UI).
    const candidateToken = await candidateApiToken(request, candidate);
    const takeRes = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptIdAuth}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeRes.status()).toBe(200);
    const takeBody = await takeRes.json();
    const takeQ = takeBody.questions[0];
    expect(takeQ).not.toHaveProperty("rubric");
    expect(takeQ).not.toHaveProperty("standardAnswer");
    expect(takeQ).not.toHaveProperty("gradingMode");
    // Serialized-body leak guard: the rubric and reference-answer text must
    // not appear anywhere in the candidate payload. Use markers that are
    // UNIQUE to the rubric / reference answer and do NOT appear in the
    // candidate's own draft answer (which legitimately shares the topic).
    expect(JSON.stringify(takeBody)).not.toContain("评分标准");
    expect(JSON.stringify(takeBody)).not.toContain("三方面论述");

    await submitExam(page);

    // ── Grading queue: the attempt appears in the admin grading queue
    // with pendingQuestionCount = 1 (proves the submit → manual-grading
    // pipeline works, not just direct API access to a known attemptId). ──
    const queueRes = await adminGet(
      request,
      adminToken,
      `/api/admin/grading-queue?pageSize=100`,
    );
    expect(queueRes.status()).toBe(200);
    const queueBody = (await queueRes.json()) as {
      items: Array<{ attemptId: string; pendingQuestionCount?: number }>;
    };
    const queueItem = queueBody.items.find(
      (i: { attemptId: string }) => i.attemptId === attemptIdAuth,
    );
    expect(
      queueItem,
      "the submitted text_response attempt must appear in the admin grading queue",
    ).toBeTruthy();
    expect(queueItem!.pendingQuestionCount).toBe(1);

    // ── Admin grading: frozen rubric + reference + candidate answer visible;
    // grading completes the attempt to graded + fully_graded. ──────────────
    const detailsRes = await adminGet(
      request,
      adminToken,
      `/api/admin/attempts/${attemptIdAuth}/grading-details`,
    );
    expect(detailsRes.status()).toBe(200);
    const details = await detailsRes.json();

    // Grader authority: the attempt's frozen snapshot carries the UI-authored
    // rubric + reference answer, plus the candidate's frozen answer. Asserting
    // on the parsed question object avoids newline-escaping ambiguity.
    const graded = (details.questions ?? []).find(
      (q: { questionId?: string; originalQuestionId?: string }) =>
        (q.questionId ?? q.originalQuestionId) === questionId,
    ) as
      | {
          questionId?: string;
          rubric?: string;
          standardAnswer?: string;
          candidateAnswer?: string;
          entry?: unknown;
        }
      | undefined;
    expect(graded, "expected the essay in grading-details").toBeTruthy();
    // Runtime truthy guard above; narrow for the typed assertions below.
    const gradedQ = graded as {
      rubric?: string;
      standardAnswer?: string;
      candidateAnswer?: string;
      entry?: unknown;
    };
    expect(gradedQ.rubric).toBe(RUBRIC_EDITED);
    expect(gradedQ.standardAnswer).toBe(REFERENCE);
    expect(gradedQ.candidateAnswer).toBe(CANDIDATE_ANSWER);

    // The pending-manual entry has not been graded yet.
    expect(gradedQ.entry).toBeNull();

    const gradeScore = ESSAY_SCORE;
    const gradeRes = await adminPost(
      request,
      adminToken,
      `/api/admin/attempts/${attemptIdAuth}/grade-question`,
      { questionId, score: gradeScore, comment: "论证完整" },
    );
    expect(gradeRes.status()).toBeLessThan(300);

    // After grading: the authoritative candidate-take snapshot reports the
    // attempt as graded + fully_graded (mirrors manual-grading.spec's terminal
    // verification). There is no plain GET /api/admin/attempts/:id; the take
    // snapshot carries attemptStatus + gradingStatus as the live truth.
    const takeAfter = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptIdAuth}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeAfter.status()).toBe(200);
    const takeAfterBody = await takeAfter.json();
    expect(takeAfterBody.attemptStatus).toBe("graded");
    expect(takeAfterBody.gradingStatus).toBe("fully_graded");

    // Result is visible to the candidate (immediate publication) and matches.
    await publishResultsApi(request, adminToken, examId).catch(() => {
      /* immediate mode: already visible; publish-results is a no-op */
    });
    const result = await getCandidateResult(
      request,
      candidateToken,
      attemptIdAuth,
    );
    expect(result.showResultImmediately).toBeTruthy();
    expect(result.totalScore).toBe(gradeScore);
    expect(result.passed).toBe(true);
  });
});
