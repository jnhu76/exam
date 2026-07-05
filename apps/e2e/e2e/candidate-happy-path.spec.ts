import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
  candidateApiToken,
} from "../lib/flow";

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

  test("text_response answer is entered via textarea, saved, and submitted; attempt becomes pending_manual", async ({
    page,
    request,
  }) => {
    // Seed: objective true_false + a text_response question. Per the approved
    // protocol (exam-protocol.md §1.1), text_response is an independent
    // QuestionType — NOT fill_blank + standardAnswer=null.
    const seeded = await seedExam(request, "happy-text", {
      questionAnswer: true,
      questionScore: 50,
      // The text_response question makes the exam mixed (auto + manual);
      // the submitted attempt must land in gradingStatus=pending_manual.
      textResponseQuestions: [
        { score: 50, content: "请阐述 LAN 考试系统的核心安全要求" },
      ],
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // 1) Objective true_false answer.
    await answerTrueFalse(page, true);

    // 2) Navigate to the text_response question (it is appended after the
    //    objective question by seedExam).
    const nextBtn = page.getByRole("button", { name: "下一题" });
    await nextBtn.click();

    // 3) Verify the textarea is rendered for text_response.
    const textarea = page
      .getByTestId("take-question-section")
      .locator("textarea")
      .first();
    await expect(textarea).toBeVisible();

    // 4) Answer the text_response with free text (newline preserved).
    await answerTextResponse(page, "答案第一行\n答案第二行");
    await waitForSaveSaved(page);

    // 5) Submit.
    await submitExam(page);

    // 6) Verify the attempt entered the manual-grading path. The
    //    authoritative signal is gradingStatus=pending_manual on the
    //    submitted attempt (CONTEXT.md GradingStatus). Read the attemptId
    //    from the result-page URL after submit (the result route is
    //    /exam/:attemptId/result), then GET the authoritative snapshot.
    await page.waitForURL(/\/exam\/[^/]+\/result$/, { timeout: 15_000 });
    const attemptId = page.url().match(/\/exam\/([^/]+)\/result$/)?.[1];
    expect(attemptId).toBeTruthy();

    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const takeRes = await request.get(
      `${
        process.env.E2E_BASE_URL ?? "http://localhost:3000"
      }/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeRes.ok()).toBe(true);
    const takeBody = await takeRes.json();
    expect(takeBody.gradingStatus).toBe("pending_manual");
    expect(takeBody.attemptStatus).toBe("submitted");
  });
});
