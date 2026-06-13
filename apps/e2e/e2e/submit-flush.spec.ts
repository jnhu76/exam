import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  submitExam,
} from "../lib/flow";

test.describe("submit-flush path", () => {
  test("select answer then immediately submit — flush preserves answer, score correct", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "flush", {
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Select the correct answer WITHOUT waiting for the auto-save to land.
    await answerTrueFalse(page, true);

    // Immediately open the submit dialog; the pending save is flushed inside
    // the dialog (runSubmitFlush) and the confirm button auto-waits until done.
    await submitExam(page);

    // Correct answer was flushed before submit → full score.
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });
});
