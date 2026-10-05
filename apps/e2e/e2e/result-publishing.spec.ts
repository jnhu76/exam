import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  publishResultsApi,
  gradeQuestionApi,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Result publishing policy, candidate-facing visibility (real flow).
 * (Origin: P2D-J5 result-publishing workstream.)
 *
 * Each scenario seeds its own exam + unique candidate and proves what the
 * candidate's browser shows across the publish transition:
 *   B. `manual`       — pending state until the admin publishes; the graded
 *                       score leaks through NO candidate UI surface before it.
 *   C. `after_grading` (mixed exam) — hidden until final manual grading,
 *                       auto-released on fully_graded.
 *   D. `manual` (mixed exam) — hidden state SURVIVES full grading until the
 *                       explicit publish.
 *
 * Immediate mode is owned by the kept candidate happy-path smoke; teacher
 * console publication and the Inbox notification are owned by
 * teacher-product-path.spec.ts and the notification component/API tests.
 *
 * Visibility changes are driven by real publish/grade actions, never by
 * timeout or implicit state mutation. Wire-level receipt bodies (getCandidateResult
 * flags/reasons, attempt/list score fields, publish alreadyPublished,
 * notification totals) are owned by apps/api/src/routes/resultPublishing.test.ts,
 * candidateResultVisibility.test.ts and notifications.test.ts and are
 * deliberately not duplicated here.
 */
test.describe("result publishing policy", () => {
  test("Scenario B — manual publish: candidate hidden until admin publishes", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "publish-manual", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "manual",
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;

    // ── Before publish: candidate sees the hidden/pending state ─────────────
    // Manual mode hides the result until resultsPublishedAt is set. The
    // attempt is auto-graded (status=graded), so the UI shows the
    // "成绩尚未公布" pending message and NO score.
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("成绩正在审核中，将在公布后可见"),
    ).toBeVisible();
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Before publish: no score-derived facts on ANY candidate surface ────
    // (#324) The candidate UI must not observe the graded score through the
    // exam list card or the start page summary.
    await page.goto(`${BASE_URL}/exam/list`);
    const beforeCard = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(beforeCard).toBeVisible({ timeout: 15_000 });
    await expect(beforeCard.getByTestId("exam-best-score")).toHaveCount(0);

    await page.goto(`${BASE_URL}/exam/${seeded.examId}/start`);
    await expect(page.getByText("最高成绩")).toHaveCount(0);

    // Return to the result page so the publish step below reloads the result
    // view (the original flow asserts on a reload of THIS page).
    await page.goto(`${BASE_URL}/exam/${attemptId}/result`);

    // ── Admin publishes results (the mutation driver; receipt/idempotency
    // shapes are owned by resultPublishing.test.ts) ─────────────────────────
    const adminToken = await adminApiToken(request);
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);

    // ── After publish: candidate re-opens the result and now sees it ────────
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);

    // (#324) Every candidate UI surface restores consistently: the exam list
    // card and the start page now render the published score.
    await page.goto(`${BASE_URL}/exam/list`);
    const afterCard = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(afterCard).toBeVisible({ timeout: 15_000 });
    await expect(afterCard.getByTestId("exam-best-score")).toHaveText("100");

    await page.goto(`${BASE_URL}/exam/${seeded.examId}/start`);
    await expect(page.getByText("最高成绩: 100/100")).toBeVisible({
      timeout: 15_000,
    });
  });

  // ── P3 result visibility ────────────────────────────────────────
  // Proves resultPublicationMode gates candidate score/pass
  // visibility INDEPENDENTLY of grading completion (INV-R1..R3). Scenarios A
  // and B above already cover immediate + manual(objective-auto). The two
  // tests below close the gaps that need a MIXED exam (objective + manual):
  //   C. after_grading — pending_manual hidden, final manual → auto visible.
  //   D. manual — fully_graded + computed score still hidden until explicit
  //      publish-results (the critical negative assertion INV-R2).

  /**
   * Build a mixed exam (1 objective true_false + 1 text_response), drive the
   * candidate through answering both + submitting, and return the attemptId +
   * the text_response question id for the caller's grading + visibility steps.
   * `resultPublicationMode` is caller-controlled via `mode`.
   */
  async function seedAndSubmitMixedExam(
    page: import("@playwright/test").Page,
    request: import("@playwright/test").APIRequestContext,
    unique: string,
    mode: "immediate" | "after_grading" | "manual",
  ) {
    const essayLine1 = `论述要点 ${unique}`;
    const essayLine2 = `论证结构 ${unique}`;

    const seeded = await seedExam(request, unique, {
      // Objective Q1 (true_false), correct answer true, score 10.
      questionAnswer: true,
      questionScore: 10,
      passingScore: 20,
      resultPublicationMode: mode,
      // Q2: text_response, score 20, non-empty frozen rubric.
      textResponseQuestions: [
        {
          score: 20,
          content: `P3 essay prompt ${unique}`,
          rubric: `评分细则：概念准确\n论证完整（${unique}）`,
        },
      ],
    });
    expect(seeded.textResponseQuestionIds).toHaveLength(1);
    const essayQuestionId = seeded.textResponseQuestionIds[0]!;

    // Candidate: answer Q1 (objective), navigate to Q2, answer, submit.
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerTextResponse(page, `${essayLine1}\n${essayLine2}`);
    await waitForSaveSaved(page);
    await submitExam(page);

    // Attempt id from the result URL (same convention as Scenario A/B).
    await page.waitForURL("**/result", { timeout: 15_000 });
    const attemptId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)[1]!;
    expect(attemptId).toBeTruthy();

    return { seeded, attemptId, essayQuestionId };
  }

  test("P3 result visibility: after_grading releases only after final manual grading", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const { attemptId, essayQuestionId } = await seedAndSubmitMixedExam(
      page,
      request,
      `after-grading-${suffix}`,
      "after_grading",
    );
    const adminToken = await adminApiToken(request);

    // ── Before final manual grading: pending_manual → result page HIDDEN ────
    // INV-R3 browser half: the hidden state renders; the objective partial
    // score (10) leaks nowhere in the candidate UI.
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Admin completes the final manual entry (15/20) via the real grading
    // endpoint. Receipt/visibility shapes are owned by
    // candidateResultVisibility.test.ts and are not re-asserted here.
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptId,
      essayQuestionId,
      15,
      "partial credit",
    );
    expect(gradeRes.status()).toBe(200);

    // ── after_grading AUTO-releases on fully_graded (no publish-results) ────
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("25");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });

  test("P3 result visibility: manual keeps fully graded result hidden until explicit publish", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const { seeded, attemptId, essayQuestionId } = await seedAndSubmitMixedExam(
      page,
      request,
      `manual-mixed-${suffix}`,
      "manual",
    );
    const adminToken = await adminApiToken(request);

    // ── pending_manual: the result page renders the hidden state; the
    // objective partial score (10) leaks nowhere in the candidate UI. ──
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Admin completes final manual grading (15/20) via the real endpoint.
    // INV-R2 (fully_graded + computed score stays hidden until publish) is
    // owned at the API layer by candidateResultVisibility.test.ts; the browser
    // claim below is that the hidden state SURVIVES grading until publish. ──
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptId,
      essayQuestionId,
      15,
      "partial credit",
    );
    expect(gradeRes.status()).toBe(200);

    // The candidate result is still hidden after grading (manual needs
    // explicit publish-results; grading completion does NOT release it).
    await page.reload();
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Explicit publish-results via the real endpoint (mutation driver). ──
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);

    // ── Candidate result now visible with the unchanged score (25). ──
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("25");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });
});
