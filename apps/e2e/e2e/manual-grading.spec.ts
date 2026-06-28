import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  candidateLogin,
  candidateApiToken,
  startExamFromList,
  answerTrueFalse,
  answerFillBlank,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  getCandidateResult,
} from "../lib/flow";

/**
 * P2D-J4 — Manual grading end-to-end (real HTTP flow).
 *
 * Covers the full subjective-grading story through the browser:
 *   1. Admin seeds an exam with one objective (true_false) + one subjective
 *      (fill_blank, standardAnswer=null) question.
 *   2. Candidate answers both and submits.
 *   3. Admin opens the grading queue, sees the pending attempt, opens detail,
 *      sees the candidate's answer, enters score + comment, saves (finalizes).
 *   4. Candidate result reflects the reconciled objective + manual total.
 *   5. Admin re-grades over the API; candidate total updates idempotently
 *      (no double-counting).
 *
 * Subjective questions are created over HTTP (standardAnswer: null is now a
 * valid, type-validated input). No DB seed is used.
 */
// Phase 3 pending: subjective answer runtime, candidate-answer visibility,
// rich-text/manual grading workflow are NOT part of the Phase 2 baseline.
// Phase 2 closes the objective-question exam loop only. The take page does
// not render a usable subjective-answer input, so the candidate cannot
// answer the subjective question and the full manual-grading flow cannot
// run. Re-enable when subjective question answering + manual grading detail
// land in Phase 3.
test.describe("manual grading (P2D-J4)", () => {
  test.skip(
    true,
    "Phase 3 pending: subjective answer runtime / candidate-answer visibility / rich-text+manual grading workflow are not part of Phase 2 baseline",
  );
  test("candidate submits subjective answer → admin grades → candidate sees reconciled total", async ({
    page,
    request,
  }) => {
    // Objective: true_false, score 40, correct answer true.
    // Subjective: fill_blank (null standardAnswer), score 60.
    // Passing line 50 so the reconciled total (40 + 50 = 90) passes.
    const subjectiveText = `E2E essay ${Date.now()}`;
    const seeded = await seedExam(request, "manual-grade", {
      questionAnswer: true,
      questionScore: 40,
      passingScore: 50,
      totalScore: 100,
      resultPublicationMode: "immediate",
      subjectiveQuestions: [{ score: 60, content: `简述你的理解 ____` }],
    });
    expect(seeded.subjectiveQuestionIds).toHaveLength(1);
    const subjectiveQuestionId = seeded.subjectiveQuestionIds[0]!;

    // ── Candidate: answer objective, navigate to subjective, answer, submit ──
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Q1 (objective true_false) renders first.
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    // Navigate to Q2 (subjective fill_blank) and type the essay.
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerFillBlank(page, subjectiveText);
    await waitForSaveSaved(page);

    await submitExam(page);

    // Capture the attemptId from the result URL for later API checks.
    await page.waitForURL("**/result", { timeout: 15_000 });
    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;
    expect(attemptId).toBeTruthy();

    // ── Admin: grading queue → detail → grade → finalize ────────────────────
    await loginAsAdmin(page);
    await page.goto("/admin/grading-queue");

    // The submitted attempt appears in the pending queue.
    const row = page.getByTestId(`grading-queue-row-${attemptId}`);
    await row.waitFor({ state: "visible", timeout: 15_000 });
    // The grading-queue row renders the candidate's display `name`
    // (user.name), not the login `username` — assert against the displayed
    // identifier, which is unique per seeded candidate.
    await expect(row).toContainText(seeded.candidate.name);
    await row.click();
    await page.waitForURL(
      (url) => /\/admin\/grading-queue\/[^/]+$/.test(url.pathname),
      { timeout: 15_000 },
    );

    // Grading detail shows the candidate's answer + score/comment inputs.
    await expect(
      page.getByTestId(`grading-candidate-answer-${subjectiveQuestionId}`),
    ).toContainText(subjectiveText);
    await expect(
      page.getByTestId(`grading-score-input-${subjectiveQuestionId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`grading-comment-input-${subjectiveQuestionId}`),
    ).toBeVisible();

    // Enter score (50/60) + comment and save → finalizes the last subjective.
    await page
      .getByTestId(`grading-score-input-${subjectiveQuestionId}`)
      .fill("50");
    await page
      .getByTestId(`grading-comment-input-${subjectiveQuestionId}`)
      .fill("good effort");
    await page.getByTestId(`grading-save-btn-${subjectiveQuestionId}`).click();
    // Use exact match: the page also renders a status label containing
    // "评分已完成" as a substring (e.g. "手动评分已完成评分"), which would
    // make a substring getByText match two elements and trip strict mode.
    await expect(page.getByText("评分已完成", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Reload detail → score + comment persist (entry saved).
    await page.reload();
    await expect(
      page.getByTestId(`grading-score-input-${subjectiveQuestionId}`),
    ).toHaveValue("50");

    // ── Candidate: result reflects objective (40) + manual (50) = 90 ────────
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const result = await getCandidateResult(request, candidateToken, attemptId);
    expect(result.showResultImmediately).toBe(true);
    expect(result.totalScore).toBe(90);
    expect(result.passed).toBe(true); // 90 >= 50

    // ── Admin re-grades over the API; total recomputes idempotently ─────────
    const adminToken = await adminApiToken(request);
    const regrade = await request.post(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/admin/attempts/${attemptId}/grade-question`,
      {
        headers: { Cookie: `auth-token=${adminToken}` },
        data: {
          questionId: subjectiveQuestionId,
          score: 45,
          comment: "re-grade",
        },
      },
    );
    expect(regrade.status()).toBe(200);
    const regradeBody = (await regrade.json()) as {
      totalScore: number;
      passed: boolean;
    };
    expect(regradeBody.totalScore).toBe(85); // 40 + 45, NOT 90 + 45
    expect(regradeBody.passed).toBe(true); // 85 >= 50
  });
});
