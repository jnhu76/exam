import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerFillBlank,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  adminPost,
} from "../lib/flow";

/**
 * fill_blank is an AUTO-GRADED objective question type (gradingEngine
 * gradeFillBlank): standardAnswer is a non-null string, multiple accepted
 * answers are `|`-separated, and gradingRule.fillBlankMatchMode selects
 * exact vs keyword matching (case-insensitive by default). The `____`
 * placeholder is required in the question content.
 *
 * This spec exercises the canonical supported flow: seed a fill_blank with an
 * exact-mode standard answer, answer it in the take UI, let the answer save
 * protocol persist it, submit, and verify the browser renders the auto-graded
 * result immediately.
 *
 * Wire-level grading receipts (persisted attempt.answers, totalScore/passed
 * on the result endpoint) are owned by
 * routes/attempts/protocol-consistency.test.ts and the scores suites and are
 * deliberately not duplicated here.
 */
test.describe("fill_blank question E2E", () => {
  test("login → start → fill blank answer → save → submit → auto-graded result", async ({
    page,
    request,
  }) => {
    // Scaffold course + candidate only; the fill_blank question and its exam
    // are built locally so the spec owns the question shape (standardAnswer +
    // gradingRule), matching the multi-select spec pattern.
    const seeded = await seedExam(request, "fillblank");
    const adminToken = await adminApiToken(request);

    const fbRes = await adminPost(request, adminToken, "/api/questions", {
      courseId: seeded.courseId,
      type: "fill_blank",
      content: "安全出口的颜色是____",
      standardAnswer: "红色|绿色",
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
    });
    expect(fbRes.ok()).toBeTruthy();
    const fbQuestionId = (await fbRes.json()).id;

    const examRes = await adminPost(request, adminToken, "/api/exams", {
      title: `FillBlank E2E ${Date.now()}`,
      description: "",
      courseId: seeded.courseId,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600_000).toISOString(),
      closeAt: new Date(Date.now() + 86400_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [fbQuestionId],
      resultPublicationMode: "immediate",
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
    });
    expect(examRes.ok()).toBeTruthy();
    const examId = (await examRes.json()).id;

    await adminPost(request, adminToken, `/api/exams/${examId}/publish`, {});
    await adminPost(request, adminToken, `/api/exams/${examId}/enrollments`, {
      candidateIds: [seeded.candidateIds[0]],
    });

    // Browser flow: answer the fill_blank and let the save protocol persist.
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, examId);
    await answerFillBlank(page, "绿色");
    await waitForSaveSaved(page);
    await submitExam(page);

    // Browser truth: submit used the saved answer, and grading matched it
    // against the exact-mode standardAnswer ("红色|绿色") — the result page
    // renders the graded score immediately.
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });
});
