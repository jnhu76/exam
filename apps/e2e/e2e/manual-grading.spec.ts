import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

/**
 * P3-MOD-P1-2 — Subjective grading end-to-end (browser loop).
 *
 * Proves the real product loop for a text_response question at the browser
 * level:
 *   candidate starts exam
 *     → answers a real text_response (multiline plain text) + objective
 *     → submits
 *     → admin grading queue page lists the attempt (durable pending-manual
 *       row; queue → detail discovery through the real page, not a known-id
 *       jump)
 *     → admin grading detail renders the frozen candidate answer, frozen
 *       rubric and applicable frozen standardAnswer (P1-1 projection)
 *     → admin completes the pending manual entry through the confirmation
 *       dialog → "评分已完成" toast
 *     → reload → the terminal score/comment persist
 *
 * Wire-level receipts are owned at the API layer and deliberately not
 * duplicated here: take attemptStatus/gradingStatus by
 * routes/attempts/candidate-take-text-response.test.ts, queue composition by
 * gradingQueue.test.ts, terminal closure by
 * routes/attempts/manualGradingClosure.test.ts, score identity and the
 * regrade-409 immutability by scores.test.ts.
 *
 * P1 boundary (preserved): P1 proves "score becomes computed / attempt grading
 * completes" at the UI level; candidate result visibility is not a P1
 * acceptance gate and is owned by result-publishing.spec.ts.
 */
test.describe("manual grading (P3-MOD-P1-2)", () => {
  test("candidate submits text_response → admin grades via the queue UI → terminal entry persists", async ({
    page,
    request,
  }) => {
    // Objective: true_false, score 40, correct answer true.
    // Subjective: text_response, score 60, with a non-empty frozen rubric and a
    //   non-null frozen reference answer (proves the P1-1 projection through
    //   the real UI). Passing line 50 → reconciled total (40 + 50 = 90) passes.
    const FROZEN_RUBRIC = "评分细则：\n1. 逻辑清晰\n2. 概念准确";
    const FROZEN_REF = "参考答案：从光合作用的光反应与暗反应两方面论述";
    const essayLine1 =
      "光合作用是植物利用光能将二氧化碳和水转化为有机物的过程。";
    const essayLine2 = "它分为光反应与暗反应两个阶段。";
    const essay = `${essayLine1}\n${essayLine2}`;

    const seeded = await seedExam(request, "p1-essay", {
      questionAnswer: true,
      questionScore: 40,
      passingScore: 50,
      totalScore: 100,
      resultPublicationMode: "immediate",
      textResponseQuestions: [
        {
          score: 60,
          content: "请论述光合作用的两个阶段",
          standardAnswer: FROZEN_REF,
          rubric: FROZEN_RUBRIC,
        },
      ],
    });
    expect(seeded.textResponseQuestionIds).toHaveLength(1);
    const essayQuestionId = seeded.textResponseQuestionIds[0]!;

    // ── Candidate: answer objective, navigate to text_response, answer, submit ──
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Q1 (objective true_false) renders first.
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    // Navigate to Q2 (text_response) and type the multiline essay.
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerTextResponse(page, essay);
    await waitForSaveSaved(page);

    await submitExam(page);

    // Capture the attemptId from the result URL to target the queue row.
    await page.waitForURL("**/result", { timeout: 15_000 });
    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;
    expect(attemptId).toBeTruthy();

    // ── Admin: grading queue page shows the pending-manual row ───────────
    await loginAsAdmin(page);
    await page.goto("/admin/grading-queue");

    // #439 V5: the AdminLayout topbar (the <header> without an <h1>;
    // the page's PageHeader owns one) must resolve the pageMeta title,
    // not the "页面" fallback, and document.title must agree.
    const topbar = page
      .getByTestId("admin-layout")
      .locator("header:not(:has(h1))");
    await expect(topbar).toHaveText("待评分");
    await expect(page).toHaveTitle(/^待评分 - /);

    const row = page.getByTestId(`grading-queue-row-${attemptId}`);
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.click();
    await page.waitForURL(
      (url) => /\/admin\/grading-queue\/[^/]+$/.test(url.pathname),
      { timeout: 15_000 },
    );

    // #490: the grading-detail route must resolve its own pageMeta title in
    // the AdminLayout topbar (not the "页面" fallback) and in document.title.
    await expect(topbar).toHaveText("手动评分");
    await expect(page).toHaveTitle(/^手动评分 - /);

    // Candidate answer preserves both submitted lines (whitespace-pre-wrap).
    const answerEl = page.getByTestId(
      `grading-candidate-answer-${essayQuestionId}`,
    );
    await expect(answerEl).toContainText(essayLine1);
    await expect(answerEl).toContainText(essayLine2);

    // Frozen rubric + frozen reference answer from QuestionSnapshot (P1-1).
    await expect(
      page.getByTestId(`grading-rubric-${essayQuestionId}`),
    ).toContainText("评分细则");
    await expect(
      page.getByTestId(`grading-rubric-${essayQuestionId}`),
    ).toContainText("概念准确");
    await expect(
      page.getByTestId(`grading-standard-answer-${essayQuestionId}`),
    ).toContainText("参考答案");

    // Score/comment inputs are present for the pending manual entry.
    await expect(
      page.getByTestId(`grading-score-input-${essayQuestionId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`grading-comment-input-${essayQuestionId}`),
    ).toBeVisible();

    // ── Admin: complete the pending manual entry (score 50/60) ──────────
    await page.getByTestId(`grading-score-input-${essayQuestionId}`).fill("50");
    await page
      .getByTestId(`grading-comment-input-${essayQuestionId}`)
      .fill("good effort");
    // Slice 2: submission now goes through a confirmation dialog before the
    // irrevocable POST (button label is 提交评分, not 保存).
    await page.getByTestId(`grading-submit-btn-${essayQuestionId}`).click();
    await page.getByRole("button", { name: "确认提交" }).click();
    // "评分已完成" (exact) is the finalized toast — the last pending-manual
    // entry is now completed_manual and finalizeTerminalGrading ran.
    await expect(page.getByText("评分已完成", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Reload detail → score + comment persist (terminal entry saved).
    await page.reload();
    await expect(
      page.getByTestId(`grading-score-input-${essayQuestionId}`),
    ).toHaveValue("50");
  });
});
