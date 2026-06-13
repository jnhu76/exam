import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

test.describe("resume active attempt path", () => {
  test("answer → reload → resume same attempt → submit → graded", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "resume", {
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Answer and let it save, then reload (simulating a disconnect/reopen).
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await page.reload();

    // Back on the take page after reload (attempt is still in_progress).
    await page
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });
    // The previously-saved answer is restored from the server.
    await expect(page.getByTestId("true-false-true")).toBeChecked();

    // Submit the resumed attempt.
    await submitExam(page);

    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });
});
