import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

/**
 * The candidate application smoke: one real login → list → start → answer →
 * save → submit → graded result journey over the live server. Grading-status
 * variants (text_response pending_manual) are owned by manual-grading.spec.ts
 * and the API route suites.
 */

test.describe("candidate happy path", () => {
  test("login → list → start → answer → save → submit → graded result", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "happy", {
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    await submitExam(page);

    // ResultPage shows graded score (correct answer → full score 100)
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });
});
