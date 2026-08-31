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
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Rich content / WYSIWYG V1 product loop (issue 301).
 *
 * Two representative E2E flows, UI-driven at the rich-specific surfaces:
 *
 * 1. Rich text_response: admin authors the question with answerMode=rich,
 *    the candidate answers through the REAL WYSIWYG editor (typing, bold
 *    mark, inline math insertion — the part jsdom cannot prove), the draft
 *    round-trips as a canonical ContentDocumentV1 through the take snapshot,
 *    and the attempt submits cleanly.
 *
 * 2. Math-rich single_choice: admin authors a rich PROMPT containing inline
 *    math; the candidate READ path renders it through KaTeX while never
 *    mounting an editor surface (objective question), and the stored
 *    `content` mirrors the plain projection including the math source.
 */

const STAMP = `${Date.now()}`;
const RUBRIC = "评分标准：内容完整、论证清晰、公式正确";

/** Open a Select by aria-label and pick a visible option. */
async function pickSelect(page: Page, label: string, optionName: string) {
  // exact: the per-option mode selects ("选项 A 内容模式") substring-match
  // the prompt-mode label; only the exact name is unambiguous.
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: optionName }).click();
}

interface ExamIds {
  examId: string;
}

/** Assembles + publishes + enrolls an exam over the given question ids. */
async function assembleExam(
  request: APIRequestContext,
  adminToken: string,
  courseId: string,
  title: string,
  questionIds: string[],
  candidateProfileId: string,
  totalScore: number,
): Promise<ExamIds> {
  const examRes = await adminPost(request, adminToken, "/api/exams", {
    title,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date(Date.now() - 3_600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 0,
    totalScore,
    questionSelectionMode: "manual",
    questionIds,
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
  const publishRes = await adminPost(
    request,
    adminToken,
    `/api/exams/${examId}/publish`,
    {},
  );
  expect(publishRes.status()).toBeLessThan(300);
  const enrollRes = await adminPost(
    request,
    adminToken,
    `/api/exams/${examId}/enrollments`,
    { candidateIds: [candidateProfileId] },
  );
  expect(enrollRes.status()).toBeLessThan(300);
  return { examId };
}

async function provisionCandidate(
  request: APIRequestContext,
  tag: string,
): Promise<SeededCandidate> {
  const res = await request.post(`${BASE_URL}/api/candidates`, {
    data: {
      username: `e2e-301-${tag}`,
      password: "candidate123",
      name: `富文本考生-${tag}`,
      fields: { candidateNo: `E2E-301-${tag}` },
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { id: string; userId: string };
  return {
    profileId: body.id,
    userId: body.userId,
    username: `e2e-301-${tag}`,
    name: `富文本考生-${tag}`,
    password: "candidate123",
  };
}

async function seedCourseId(
  request: APIRequestContext,
  adminToken: string,
): Promise<string> {
  const coursesRes = await adminGet(
    request,
    adminToken,
    `/api/courses?search=${encodeURIComponent("基础安全")}`,
  );
  const body = (await coursesRes.json()) as {
    items: Array<{ id: string; name: string }>;
  };
  const seedCourse = body.items.find((c) => c.name === "基础安全培训");
  expect(seedCourse, "seed course 基础安全培训 must exist").toBeTruthy();
  return seedCourse!.id;
}

test.describe("issue 301 rich content product loop", () => {
  test("rich text_response: UI authoring → WYSIWYG answer → canonical draft → submit", async ({
    page,
    request,
  }) => {
    const adminToken = await adminApiToken(request);
    const courseId = await seedCourseId(request, adminToken);
    const candidate = await provisionCandidate(request, `tr-${STAMP}`);

    // ── UI authoring: text_response with answerMode = rich ──────────────
    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    await page.getByRole("button", { name: /新增题目/ }).click();
    await page.waitForURL(/\/admin\/questions\/new/);

    await page.getByRole("button", { name: "所属课程" }).click();
    await page.getByPlaceholder("搜索课程名称或代码...").fill("基础安全培训");
    await page.getByRole("option", { name: "基础安全培训" }).click();
    await pickSelect(page, "题目类型", "文本作答题");

    const PROMPT = `301富文本作答题-${STAMP}`;
    await page.getByPlaceholder("输入题目内容").fill(PROMPT);
    await page
      .getByPlaceholder("请描述评分时应考虑的关键点、完整性、准确性或论证质量")
      .fill(RUBRIC);
    // Score 20 must match the assembled exam's totalScore.
    await page.getByRole("spinbutton").fill("20");
    // Switch the ANSWER mode to the rich editor (issue 301).
    await pickSelect(page, "作答模式", "富文本");

    const createResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().endsWith("/api/questions"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^保存$/ }).click();
    const createdRes = await createResponse;
    expect(createdRes.status()).toBe(201);
    const createdBody = (await createdRes.json()) as {
      id: string;
      answerMode: string;
      contentDocument: unknown;
    };
    const questionId = createdBody.id;
    expect(createdBody.answerMode).toBe("rich");
    expect(createdBody.contentDocument).toBeNull();

    const { examId } = await assembleExam(
      request,
      adminToken,
      courseId,
      `301富文本产品环-${STAMP}`,
      [questionId],
      candidate.profileId,
      20,
    );

    // ── Candidate: answer through the real WYSIWYG editor ───────────────
    await candidateLogin(page, candidate);
    const startResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 15_000 },
    );
    await startExamFromList(page, examId);
    const startRes = await startResponse;
    expect([200, 201]).toContain(startRes.status());
    const attemptId = ((await startRes.json()) as { id: string }).id;

    const section = page.getByTestId("take-question-section");
    await expect(section.getByText(PROMPT)).toBeVisible();
    // The WYSIWYG editor is mounted (lazy chunk loaded) for the rich answer.
    const editor = section.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);

    // Type, add a bold segment, then insert inline math — real editor UI.
    await editor.click();
    await page.keyboard.type("301富文本作答：");
    await page.getByRole("button", { name: "加粗" }).click();
    await page.keyboard.type("重点结论");
    await page.getByRole("button", { name: "加粗" }).click();
    await page.keyboard.type("；并且");
    await page.getByPlaceholder("输入 LaTeX").fill("a^2+b^2=c^2");
    await page.getByRole("button", { name: "行内公式" }).click();
    await waitForSaveSaved(page);

    // Authoritative draft shape: the take snapshot's answerValue is a
    // canonical ContentDocumentV1 carrying the bold mark and the math node.
    const candidateToken = await candidateApiToken(request, candidate);
    const takeRes = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeRes.ok()).toBeTruthy();
    const take = (await takeRes.json()) as {
      questions: Array<{
        answerValue: unknown;
        answerMode?: string;
      }>;
    };
    const draftDoc = take.questions[0]?.answerValue as {
      docVersion?: number;
      content?: Array<{
        type: string;
        content?: Array<{
          type: string;
          text?: string;
          marks?: string[];
          type_name?: string;
        }>;
      }>;
    };
    expect(draftDoc?.docVersion).toBe(1);
    const draftRuns = draftDoc?.content?.[0]?.content ?? [];
    expect(
      draftRuns.some(
        (r) =>
          r.type === "text" &&
          r.marks?.includes("bold") &&
          r.text === "重点结论",
      ),
    ).toBe(true);
    expect(draftRuns.some((r) => r.type === "inlineMath")).toBe(true);

    // Reload: the editor restores the draft (marks + rendered math).
    await page.reload();
    const restoredEditor = page
      .getByTestId("take-question-section")
      .locator(".ProseMirror");
    await expect(restoredEditor).toHaveCount(1);
    await expect(restoredEditor).toContainText("301富文本作答：");
    await expect(restoredEditor).toContainText("重点结论");
    await expect(
      restoredEditor.locator(".katex, [data-latex]"),
    ).not.toHaveCount(0);

    await submitExam(page);
  });

  test("math-rich single_choice prompt renders statically for candidates", async ({
    page,
    request,
  }) => {
    const adminToken = await adminApiToken(request);
    const courseId = await seedCourseId(request, adminToken);
    const candidate = await provisionCandidate(request, `sc-${STAMP}`);

    // ── UI authoring: single_choice with a RICH prompt containing math ──
    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    await page.getByRole("button", { name: /新增题目/ }).click();
    await page.waitForURL(/\/admin\/questions\/new/);

    await page.getByRole("button", { name: "所属课程" }).click();
    await page.getByPlaceholder("搜索课程名称或代码...").fill("基础安全培训");
    await page.getByRole("option", { name: "基础安全培训" }).click();
    await pickSelect(page, "题目类型", "单选题");

    // Switch the PROMPT to rich mode; the lazy editor appears.
    await pickSelect(page, "内容模式", "富文本");
    const editor = page.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);
    await editor.click();
    const PROMPT_PREFIX = `301数学单选-${STAMP}：`;
    await page.keyboard.type(`${PROMPT_PREFIX}动能公式为 `);
    await page.getByPlaceholder("输入 LaTeX").fill("E=mc^2");
    await page.getByRole("button", { name: "行内公式" }).click();

    await page.getByPlaceholder("选项 A").fill("正确选项");
    await page.getByPlaceholder("选项 B").fill("错误选项");
    // Mark A correct (Radix radio-group item is a button role=radio).
    await page.getByRole("radio").first().click();

    const createResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        res.url().endsWith("/api/questions"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^保存$/ }).click();
    const createdRes = await createResponse;
    expect(createdRes.status()).toBe(201);
    const createdBody = (await createdRes.json()) as {
      id: string;
      content: string;
      contentDocument: {
        content: Array<{
          content: Array<{ type: string }>;
        }>;
      } | null;
    };
    const questionId = createdBody.id;
    // B′ authority: the document is stored; content mirrors the plain
    // projection and carries the math source for search.
    expect(createdBody.contentDocument).not.toBeNull();
    expect(createdBody.content).toContain("E=mc^2");
    expect(createdBody.contentDocument?.content[0]?.content.at(-1)?.type).toBe(
      "inlineMath",
    );

    const { examId } = await assembleExam(
      request,
      adminToken,
      courseId,
      `301数学单选产品环-${STAMP}`,
      [questionId],
      candidate.profileId,
      10,
    );

    // ── Candidate READ: math renders, NO editor is mounted ──────────────
    await candidateLogin(page, candidate);
    await startExamFromList(page, examId);

    const section = page.getByTestId("take-question-section");
    await expect(section.getByText(PROMPT_PREFIX)).toBeVisible();
    // KaTeX rendered the prompt's inline math on the READ path.
    await expect(section.locator(".katex").first()).toBeVisible();
    // Objective question: the WYSIWYG editor surface must never appear.
    await expect(section.locator(".ProseMirror")).toHaveCount(0);

    // Answer + submit to finish the flow.
    await section.getByRole("radio").first().check();
    await waitForSaveSaved(page);
    await submitExam(page);
  });
});

test.describe("issue 301 corrective pass — editor identity, reconciliation, grading closure", () => {
  /** Creates a rich text_response question via API (UI authoring is proven
   *  above; these tests focus on the candidate/read paths). */
  async function createRichQuestion(
    request: APIRequestContext,
    adminToken: string,
    courseId: string,
    prompt: string,
  ): Promise<string> {
    const res = await adminPost(request, adminToken, "/api/questions", {
      courseId,
      score: 20,
      difficulty: 1,
      type: "text_response",
      contentDocument: {
        docVersion: 1,
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: prompt }] },
        ],
      },
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: RUBRIC,
    });
    expect(res.status(), await res.text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  function answerDoc(text: string): unknown {
    return {
      docVersion: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    };
  }

  test("two rich questions keep separate WYSIWYG documents across navigation, and both render in grading", async ({
    page,
    request,
  }) => {
    const adminToken = await adminApiToken(request);
    const courseId = await seedCourseId(request, adminToken);
    const candidate = await provisionCandidate(request, `iso-${STAMP}`);
    const prompt1 = `隔离题一-${STAMP}`;
    const prompt2 = `隔离题二-${STAMP}`;
    const q1 = await createRichQuestion(request, adminToken, courseId, prompt1);
    const q2 = await createRichQuestion(request, adminToken, courseId, prompt2);
    const { examId } = await assembleExam(
      request,
      adminToken,
      courseId,
      `301隔离-${STAMP}`,
      [q1, q2],
      candidate.profileId,
      40,
    );

    await candidateLogin(page, candidate);
    const startResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 15_000 },
    );
    await startExamFromList(page, examId);
    const attemptId = ((await (await startResponse).json()) as { id: string })
      .id;

    const section = page.getByTestId("take-question-section");
    await expect(section.getByText(prompt1)).toBeVisible();
    let editor = section.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);
    await editor.click();
    await page.keyboard.type("甲作答");
    await waitForSaveSaved(page);

    // Switch to Q2: the editor MUST remount empty — the identity key fix
    // (P0) prevents reusing Q1's Tiptap document for Q2.
    await page.getByRole("button", { name: "下一题" }).click();
    await expect(section.getByText(prompt2)).toBeVisible();
    editor = section.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);
    await expect(editor).not.toContainText("甲作答");
    await editor.click();
    await page.keyboard.type("乙作答");
    await waitForSaveSaved(page);

    // Back to Q1: the draft restores from the server into a remounted editor.
    await page.getByRole("button", { name: "上一题" }).click();
    await expect(section.getByText(prompt1)).toBeVisible();
    const q1Editor = section.locator(".ProseMirror");
    await expect(q1Editor).toContainText("甲作答");
    await expect(q1Editor).not.toContainText("乙作答");

    // Server-side separation: each question holds its own canonical doc.
    const candidateToken = await candidateApiToken(request, candidate);
    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    const questions = (
      (await take.json()) as {
        questions: Array<{ answerValue: unknown; answerMode?: string }>;
      }
    ).questions;
    expect(questions).toHaveLength(2);
    const texts = questions.map((q) =>
      JSON.stringify(q.answerValue).includes("甲作答") ? "甲" : "乙",
    );
    expect(texts).toContain("甲");
    expect(texts).toContain("乙");

    // Grading closure: submit, then the admin detail page renders BOTH rich
    // answers through the rich renderer (frozen answerMode round-trip).
    await submitExam(page);
    await loginAsAdmin(page);
    await page.goto(`/admin/grading-queue/${attemptId}`);
    await expect(page.getByText(prompt1)).toBeVisible();
    await expect(page.getByText(prompt2)).toBeVisible();
    await expect(
      page.getByTestId(`grading-candidate-answer-${q1}`),
    ).toContainText("甲作答");
    await expect(
      page.getByTestId(`grading-candidate-answer-${q2}`),
    ).toContainText("乙作答");

    // ── Manual grading closure: score + finalize BOTH rich answers ────────
    await page.getByTestId(`grading-score-input-${q1}`).fill("15");
    await page.getByTestId(`grading-comment-input-${q1}`).fill("完整清晰");
    await page.getByTestId(`grading-submit-btn-${q1}`).click();
    await page.getByRole("button", { name: "确认提交" }).click();
    // First of two manual entries → non-terminal save toast (评分已保存).
    await expect(page.getByText("评分已保存", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId(`grading-score-input-${q2}`).fill("15");
    await page.getByTestId(`grading-comment-input-${q2}`).fill("论证到位");
    await page.getByTestId(`grading-submit-btn-${q2}`).click();
    await page.getByRole("button", { name: "确认提交" }).click();
    // Last pending-manual entry → finalizeTerminalGrading → 评分已完成.
    await expect(page.getByText("评分已完成", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // ── Terminal: attempt graded + fully_graded ──────────────────────────
    const takeAfter = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeAfter.status()).toBe(200);
    const takeAfterBody = (await takeAfter.json()) as {
      attemptStatus: string;
      gradingStatus: string;
    };
    expect(takeAfterBody.attemptStatus).toBe("graded");
    expect(takeAfterBody.gradingStatus).toBe("fully_graded");

    // ── Candidate result: visible, total 30, rich answers render safely ──
    await candidateLogin(page, candidate);
    await page.goto(`/exam/${attemptId}/result`);
    await expect(page.getByTestId("result-total-score")).toHaveText("30");
    await expect(page.getByText("甲作答")).toBeVisible();
    await expect(page.getByText("乙作答")).toBeVisible();
  });

  test("stale server answer replaces the editor content (two-way ownership reconciliation)", async ({
    page,
    request,
  }) => {
    const adminToken = await adminApiToken(request);
    const courseId = await seedCourseId(request, adminToken);
    const candidate = await provisionCandidate(request, `rec-${STAMP}`);
    const prompt = `回调节-${STAMP}`;
    const q = await createRichQuestion(request, adminToken, courseId, prompt);
    const { examId } = await assembleExam(
      request,
      adminToken,
      courseId,
      `301回调节-${STAMP}`,
      [q],
      candidate.profileId,
      20,
    );

    await candidateLogin(page, candidate);
    const startResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 15_000 },
    );
    await startExamFromList(page, examId);
    const attemptId = ((await (await startResponse).json()) as { id: string })
      .id;

    const section = page.getByTestId("take-question-section");
    const editor = section.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);
    await editor.click();
    await page.keyboard.type("甲作答");
    await waitForSaveSaved(page); // client caches version 1

    // A concurrent session (API) writes version 2 behind the UI's back.
    const candidateToken = await candidateApiToken(request, candidate);
    const apiSave = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/answers/${q}`,
      {
        headers: { Cookie: `auth-token=${candidateToken}` },
        data: {
          attemptId,
          questionId: q,
          answer: answerDoc("乙作答"),
          clientSeq: 900 + Number(STAMP.slice(-4)),
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
      },
    );
    expect(apiSave.status()).toBe(200);
    expect(((await apiSave.json()) as { accepted: boolean }).accepted).toBe(
      true,
    );

    // The UI keeps typing — its baseVersion (1) is now stale, so the save
    // returns STALE_VERSION and the SERVER's authoritative document must
    // replace the editor content (the two-way ownership protocol).
    await editor.click();
    await page.keyboard.type("丙作答");
    await expect(editor).toContainText("乙作答");
    await expect(editor).not.toContainText("丙作答");

    // Server still holds the authoritative version 2 document.
    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    const answerValue = (
      (await take.json()) as { questions: Array<{ answerValue: unknown }> }
    ).questions[0]?.answerValue;
    expect(JSON.stringify(answerValue)).toContain("乙作答");
  });

  test("server rollback to an EMPTY authoritative answer clears the editor; typing resumes from empty", async ({
    page,
    request,
  }) => {
    // Ownership regression (round-2): initial = EMPTY; local edit → LOCAL; the
    // server's authoritative value becomes EMPTY again. The editor must become
    // EMPTY (the old appliedRef-baseline model skipped this and kept showing
    // LOCAL), and the next local edit must start from the EMPTY baseline.
    const adminToken = await adminApiToken(request);
    const courseId = await seedCourseId(request, adminToken);
    const candidate = await provisionCandidate(request, `rb-${STAMP}`);
    const prompt = `清空回调节-${STAMP}`;
    const q = await createRichQuestion(request, adminToken, courseId, prompt);
    const { examId } = await assembleExam(
      request,
      adminToken,
      courseId,
      `301清空回调节-${STAMP}`,
      [q],
      candidate.profileId,
      20,
    );

    await candidateLogin(page, candidate);
    const startResponse = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/attempts\/[^/]+\/start$/.test(res.url()),
      { timeout: 15_000 },
    );
    await startExamFromList(page, examId);
    const attemptId = ((await (await startResponse).json()) as { id: string })
      .id;

    const section = page.getByTestId("take-question-section");
    const editor = section.locator(".ProseMirror");
    await expect(editor).toHaveCount(1);

    // initial = EMPTY; local edit → LOCAL (version 1).
    await editor.click();
    await page.keyboard.type("LOCAL");
    await waitForSaveSaved(page);

    // The server's authoritative answer becomes EMPTY behind the UI's back.
    const candidateToken = await candidateApiToken(request, candidate);
    const emptyDoc = { docVersion: 1, type: "doc", content: [] };
    const apiSave = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/answers/${q}`,
      {
        headers: { Cookie: `auth-token=${candidateToken}` },
        data: {
          attemptId,
          questionId: q,
          answer: emptyDoc,
          clientSeq: 6000 + Number(STAMP.slice(-4)),
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
      },
    );
    expect(apiSave.status()).toBe(200);
    expect(((await apiSave.json()) as { accepted: boolean }).accepted).toBe(
      true,
    );

    // The UI keeps typing — its baseVersion (1) is now stale; STALE_VERSION
    // returns the server's EMPTY authoritative document, which must REPLACE
    // the editor content. The editor becomes EMPTY — never keeps showing LOCAL.
    await editor.click();
    await page.keyboard.type("丙作答");
    await expect(editor).not.toContainText("丙作答");
    await expect(editor).not.toContainText("LOCAL");

    // The next local edit starts from the EMPTY baseline and saves cleanly.
    await editor.click();
    await page.keyboard.type("SERVER-NEXT");
    await waitForSaveSaved(page);

    const take = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    const finalAnswer = (
      (await take.json()) as { questions: Array<{ answerValue: unknown }> }
    ).questions[0]?.answerValue;
    expect(JSON.stringify(finalAnswer)).toContain("SERVER-NEXT");
    expect(JSON.stringify(finalAnswer)).not.toContain("LOCAL");
    expect(JSON.stringify(finalAnswer)).not.toContain("丙作答");
  });
});
