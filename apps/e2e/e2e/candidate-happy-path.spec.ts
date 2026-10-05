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
 * The candidate application smoke, run at the narrow 390x844 viewport so the
 * representative journey also proves phone-width operability: one real
 * login → list → start → answer → save → submit → graded result journey over
 * the live server. Rendered layout geometry is owned by component/CSS tests —
 * the only narrow-width check is that the list card still renders its title
 * and its primary action stays operable. Grading-status variants
 * (text_response pending_manual) are owned by the API grading-route suites
 * (manualGradingClosure, candidate-take-text-response).
 *
 * The seed title mixes CJK with one ~80-char unbroken Latin token: the case
 * that most easily traps narrow-width card layouts. A silently dropped title
 * would leave the card unfindable, so the stress token itself is asserted.
 */

test.use({ viewport: { width: 390, height: 844 } });

test.describe("candidate happy path", () => {
  test("login → list → start → answer → save → submit → graded result", async ({
    page,
    request,
  }) => {
    const longTitle = [
      "E2E-long-title",
      "这是一个非常长的中文考试标题用于验证窄视口下卡片标题的换行行为",
      "PneumonoultramicroscopicsilicovolcanoconiosisSupercalifragilisticexpialidocious",
      Date.now(),
    ].join("-");
    const seeded = await seedExam(request, "happy", {
      questionAnswer: true,
      questionScore: 100,
      titleOverride: longTitle,
    });

    await candidateLogin(page, seeded.candidate);

    // Narrow-width list card: the stress title renders, the action is usable.
    const card = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(card).toBeVisible();
    await expect(
      card.getByText("Pneumonoultramicroscopicsilicovolcanoconiosis"),
    ).toBeVisible();

    await startExamFromList(page, seeded.examId);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    await submitExam(page);

    // ResultPage shows graded score (correct answer → full score 100)
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });
});
