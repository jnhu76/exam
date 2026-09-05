import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  clickExamPrimaryAction,
  answerTrueFalse,
  waitForSaveSaved,
} from "../lib/flow";
import { assertNoHorizontalOverflow, assertReachable } from "../lib/responsive";

/**
 * Candidate-first responsive baseline (Issue #306, UI-STABILIZATION-GOAL-1
 * G2). Deterministic geometry assertions at the 390x844 baseline viewport —
 * not screenshots, no visual-regression dependency:
 *
 *   - no document-level horizontal overflow on any critical candidate route;
 *   - primary controls stay visible and horizontally reachable;
 *   - the submit dialog fits the viewport;
 *   - timer / save state / submit never disappear at 390px;
 *   - desktop (1280x720) sanity on the same flow (non-regression).
 *
 * Geometry helpers live in lib/responsive.ts (shared with the Admin
 * responsive baseline).
 */

test.describe("candidate responsive baseline 390x844", () => {
  test("login → list → start → take → submit dialog → result", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "responsive", {
      questionAnswer: true,
      questionScore: 100,
    });
    await page.setViewportSize({ width: 390, height: 844 });

    // --- login ---
    await page.goto("/login");
    await expect(page.getByTestId("login-layout")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await candidateLogin(page, seeded.candidate);

    // --- exam list ---
    await page.waitForURL(/\/exam\/list/);
    await assertNoHorizontalOverflow(page);
    const card = page.getByTestId(`exam-card-${seeded.examId}`);
    await assertReachable(page, card);
    await assertReachable(page, card.getByTestId("exam-primary-action"));

    // --- start page ---
    await clickExamPrimaryAction(page, seeded.examId, "start");
    await page.waitForURL(/\/exam\/[^/]+\/start$/);
    await assertNoHorizontalOverflow(page);
    const startBtn = page.getByTestId("exam-start-btn");
    await assertReachable(page, startBtn);
    await startBtn.click();
    await page.waitForURL(/\/exam\/[^/]+\/take$/);
    await page.getByTestId("take-question-section").waitFor({
      state: "visible",
    });

    // --- take page: timer, save state and submit all stay on-screen ---
    const submitBtn = page.getByTestId("take-submit-btn");
    await assertReachable(page, submitBtn);
    // seeded exams are timed_window (60min) → the personal countdown renders.
    await expect(page.getByText("剩余时间")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    // Single-question exam: the sticky footer's primary is 提交考试 (last
    // question), not 下一题.
    await assertReachable(page, page.getByRole("button", { name: "提交考试" }));
    await assertNoHorizontalOverflow(page);

    // --- submit dialog fits the viewport and confirms ---
    await submitBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.width).toBeLessThanOrEqual(390 + 1);
    const confirm = page.getByTestId("confirm-submit-btn");
    await assertReachable(page, confirm);
    await confirm.click();
    await page.waitForURL("**/result", { timeout: 30_000 });

    // --- result page ---
    await assertNoHorizontalOverflow(page);
    await expect(page.getByTestId("result-total-score")).toBeVisible();
    await assertReachable(
      page,
      page.getByRole("button", { name: "返回考试列表" }),
    );
  });

  test("exam list card tolerates a long mixed-script title", async ({
    page,
    request,
  }) => {
    // `unique` also feeds the seeded username, so the mixed-script stress
    // title goes through titleOverride instead: CJK (wraps per-glyph) plus a
    // single ~80-char unbroken Latin token (the case that requires
    // break-words, not just normal wrapping).
    const longTitle = [
      "E2E-responsive-long-title",
      "这是一个非常长的中文考试标题用于验证窄视口下卡片标题的换行行为",
      "PneumonoultramicroscopicsilicovolcanoconiosisSupercalifragilisticexpialidocious",
      Date.now(),
    ].join("-");
    const seeded = await seedExam(request, "responsive-long-title", {
      questionAnswer: true,
      questionScore: 100,
      titleOverride: longTitle,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await candidateLogin(page, seeded.candidate);
    await page.waitForURL(/\/exam\/list/);

    await assertNoHorizontalOverflow(page);
    const titleCard = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(titleCard).toBeVisible();
    // The stress title really rendered — a silently dropped title would make
    // the overflow assertions vacuous.
    await expect(
      titleCard.getByText("Pneumonoultramicroscopicsilicovolcanoconiosis"),
    ).toBeVisible();
    await assertReachable(
      page,
      page
        .getByTestId(`exam-card-${seeded.examId}`)
        .getByTestId("exam-primary-action"),
    );
  });
});

test.describe("candidate desktop non-regression", () => {
  test("list → take → save stay overflow-free at 1280x720", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "responsive-desktop", {
      questionAnswer: true,
      questionScore: 100,
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    await candidateLogin(page, seeded.candidate);
    await page.waitForURL(/\/exam\/list/);
    await assertNoHorizontalOverflow(page);

    await clickExamPrimaryAction(page, seeded.examId, "start");
    await page.waitForURL(/\/exam\/[^/]+\/start$/);
    await page.getByTestId("exam-start-btn").click();
    await page.waitForURL(/\/exam\/[^/]+\/take$/);
    await page.getByTestId("take-question-section").waitFor({
      state: "visible",
    });
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await assertNoHorizontalOverflow(page);
  });
});
