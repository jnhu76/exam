import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerFillBlank,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

test.describe("fill_blank question E2E", () => {
  test("login → start → fill blank answer → save → submit → graded result", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "fillblank", {
      subjectiveQuestions: [{ score: 100, content: "安全出口的颜色是____" }],
      resultPublicationMode: "immediate",
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    const input = page
      .getByTestId("take-question-section")
      .locator("input[type='text']");
    await input.first().waitFor({ state: "visible" });
    await input.first().fill("绿色");

    await waitForSaveSaved(page);

    await submitExam(page);

    await expect(page.getByText("成绩正在审核中，将在公布后可见")).toBeVisible({
      timeout: 15_000,
    });
  });
});
