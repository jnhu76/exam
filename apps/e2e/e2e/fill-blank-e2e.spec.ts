import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerFillBlank,
  waitForSaveSaved,
  submitExam,
} from "../lib/flow";

// Phase 3 pending: fill-blank runtime, answer protocol, auto-grading, and
// result rendering are NOT part of the Phase 2 baseline. Phase 2 closes the
// objective-question exam loop only (start/resume/save/submit/deadline/
// restore + objective auto-grading). The take page does not render a usable
// fill-blank/subjective input, so this end-to-end flow cannot run. Re-enable
// when fill-blank answering lands in Phase 3.
test.describe("fill_blank question E2E", () => {
  test.skip(
    true,
    "Phase 3 pending: fill-blank runtime/answer-protocol/auto-grading/result rendering are not part of Phase 2 baseline",
  );
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

    // The seeded fill_blank question has no standardAnswer (subjective /
    // manual-graded), so after submit the attempt cannot be fully auto-graded.
    // The score visibility resolver (scores.ts) returns hiddenReason
    // "not_graded" (manual grading pending), which ResultPage renders as
    // "考试尚未完成评分，请等待". This is NOT "pending_publish" (which requires
    // a fully graded attempt under resultPublicationMode "manual").
    await expect(page.getByText("考试尚未完成评分，请等待")).toBeVisible({
      timeout: 15_000,
    });
  });
});
