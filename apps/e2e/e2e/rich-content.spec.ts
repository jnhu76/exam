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

/** Assembles + publishes + enrolls a one-question exam. */
async function assembleExam(
  request: APIRequestContext,
  adminToken: string,
  courseId: string,
  title: string,
  questionId: string,
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
      questionId,
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
      questionId,
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
