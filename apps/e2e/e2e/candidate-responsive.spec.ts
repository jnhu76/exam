import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  clickExamPrimaryAction,
  answerTrueFalse,
  waitForSaveSaved,
} from "../lib/flow";

/**
 * Candidate narrow-viewport operability journey (390x844): at phone width the
 * candidate can still log in, read the list card, start, answer, save, reach
 * and confirm the submit dialog, and land on the result. Operability only —
 * rendered layout geometry is owned by component/CSS tests, so no pixel or
 * overflow assertions live here.
 *
 * The seed title mixes CJK with one ~80-char unbroken Latin token: the case
 * that most easily traps narrow-width card layouts. A silently dropped title
 * would leave the card unfindable, so the stress token itself is asserted.
 */

test.describe("candidate narrow-viewport operability", () => {
  test("login → list → start → take → submit dialog → result", async ({
    page,
    request,
  }) => {
    const longTitle = [
      "E2E-responsive-long-title",
      "这是一个非常长的中文考试标题用于验证窄视口下卡片标题的换行行为",
      "PneumonoultramicroscopicsilicovolcanoconiosisSupercalifragilisticexpialidocious",
      Date.now(),
    ].join("-");
    const seeded = await seedExam(request, "responsive", {
      questionAnswer: true,
      questionScore: 100,
      titleOverride: longTitle,
    });
    await page.setViewportSize({ width: 390, height: 844 });

    // --- login → list ---
    await page.goto("/login");
    await expect(page.getByTestId("login-layout")).toBeVisible();
    await candidateLogin(page, seeded.candidate);
    await page.waitForURL(/\/exam\/list/);

    // --- list card with the stress title: title rendered, action operable ---
    const card = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(card).toBeVisible();
    await expect(
      card.getByText("Pneumonoultramicroscopicsilicovolcanoconiosis"),
    ).toBeVisible();
    await clickExamPrimaryAction(page, seeded.examId, "start");
    await page.waitForURL(/\/exam\/[^/]+\/start$/);

    // --- start page operable ---
    const startBtn = page.getByTestId("exam-start-btn");
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    await page.waitForURL(/\/exam\/[^/]+\/take$/);
    await page.getByTestId("take-question-section").waitFor({
      state: "visible",
    });

    // --- take page: timer, answer editor and submit stay operable ---
    // seeded exams are timed_window (60min) → the personal countdown renders.
    await expect(page.getByText("剩余时间")).toBeVisible();
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    const submitBtn = page.getByTestId("take-submit-btn");
    await expect(submitBtn).toBeVisible();

    // --- submit dialog reachable and confirmable ---
    await submitBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirm = page.getByTestId("confirm-submit-btn");
    await expect(confirm).toBeVisible();
    await confirm.click();
    await page.waitForURL("**/result", { timeout: 30_000 });

    // --- result page operable ---
    await expect(page.getByTestId("result-total-score")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "返回考试列表" }),
    ).toBeVisible();
  });
});
