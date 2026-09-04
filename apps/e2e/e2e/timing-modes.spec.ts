import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

// #291 Phase A — representative candidate-runtime E2E for the `deadline` and
// `untimed` timing modes over the SAME engine as timed_window (which keeps its
// own coverage in candidate-happy-path / deadline-crash / refresh-during-exam).
//
// deadline mode: the attempt has NO personal countdown — the topbar shows the
// static server-authoritative cutoff (data-testid="deadline-static", derived
// from exam.closeAt). Manual submit before the cutoff grades normally.
// (closeAt-driven scanner auto-submit is proven at the engine/API layer by
// deadline-scanner.test.ts and at the browser/runtime layer by
// deadline-crash.spec.ts — not duplicated here with a wall-clock wait.)
//
// untimed mode: no deadline exists at all — the topbar shows the untimed badge
// (不限时), no countdown, no cutoff; the attempt never deadline-expires and
// submits manually at any time.

test.describe("Phase A timing modes — candidate runtime", () => {
  test("untimed exam: 不限时 badge, no countdown/cutoff; manual submit grades", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "timing-untimed", {
      timingMode: "untimed",
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Mode rendering: untimed badge only — no personal countdown (剩余时间)
    // and no static cutoff (截止时间).
    await expect(page.getByTestId("untimed-badge")).toHaveText(/不限时/);
    await expect(page.getByText("剩余时间")).toHaveCount(0);
    await expect(page.getByTestId("deadline-static")).toHaveCount(0);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });

  test("deadline exam: static cutoff from closeAt, no countdown; manual submit before cutoff grades", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "timing-deadline", {
      timingMode: "deadline",
      closeAt: new Date(Date.now() + 2 * 3600_000),
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Mode rendering: static server cutoff — no personal countdown, no untimed
    // badge.
    const cutoff = page.getByTestId("deadline-static");
    await expect(cutoff).toBeVisible();
    await expect(cutoff).toContainText("截止时间");
    await expect(page.getByText("剩余时间")).toHaveCount(0);
    await expect(page.getByTestId("untimed-badge")).toHaveCount(0);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });
});
