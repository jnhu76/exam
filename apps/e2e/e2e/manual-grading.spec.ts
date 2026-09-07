import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  candidateLogin,
  candidateApiToken,
  startExamFromList,
  answerTrueFalse,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  getCandidateResult,
} from "../lib/flow";

/**
 * P3-MOD-P1-2 — Subjective grading end-to-end (real HTTP + browser flow).
 *
 * Proves the real product loop for a text_response question:
 *   candidate starts exam
 *     → answers a real text_response (multiline plain text) + objective
 *     → submits
 *     → submitted + pending_manual (authoritative take API)
 *     → durable manual grading queue (backed by pending-manual entry;
 *       objective work absent)
 *     → admin opens grading detail → sees frozen candidate answer, frozen
 *       rubric, and applicable frozen standardAnswer (P1-1 projection)
 *     → admin completes the pending manual entry
 *     → graded + fully_graded; queue item disappears
 *     → final score identity (attempt total == grading-result earned sum)
 *
 * The prior `test.skip` was justified by a Phase 2 baseline premise
 * ("subjective answer runtime / candidate-answer visibility / manual grading
 * workflow are not part of Phase 2 baseline"). That premise is stale: P0
 * CLOSED shipped the text_response runtime, and P3-MOD-P1-1 landed the frozen
 * grading-metadata projection. The skip is removed; the real flow now runs.
 *
 * P1 boundary (preserved): P1 proves "score becomes computed / attempt grading
 * completes". Candidate result visibility is exercised only because the seed
 * uses `immediate` publication — it is NOT a P1 acceptance gate.
 */
test.describe("manual grading (P3-MOD-P1-2)", () => {
  test("candidate submits text_response → admin grades → graded + fully_graded with score identity", async ({
    page,
    request,
  }) => {
    // Objective: true_false, score 40, correct answer true.
    // Subjective: text_response, score 60, with a non-empty frozen rubric and a
    //   non-null frozen reference answer (proves the P1-1 projection through
    //   the real UI). Passing line 50 → reconciled total (40 + 50 = 90) passes.
    const FROZEN_RUBRIC = "评分细则：\n1. 逻辑清晰\n2. 概念准确";
    const FROZEN_REF = "参考答案：从光合作用的光反应与暗反应两方面论述";
    const essayLine1 =
      "光合作用是植物利用光能将二氧化碳和水转化为有机物的过程。";
    const essayLine2 = "它分为光反应与暗反应两个阶段。";
    const essay = `${essayLine1}\n${essayLine2}`;

    const seeded = await seedExam(request, "p1-essay", {
      questionAnswer: true,
      questionScore: 40,
      passingScore: 50,
      totalScore: 100,
      resultPublicationMode: "immediate",
      textResponseQuestions: [
        {
          score: 60,
          content: "请论述光合作用的两个阶段",
          standardAnswer: FROZEN_REF,
          rubric: FROZEN_RUBRIC,
        },
      ],
    });
    expect(seeded.textResponseQuestionIds).toHaveLength(1);
    const essayQuestionId = seeded.textResponseQuestionIds[0]!;

    // ── Candidate: answer objective, navigate to text_response, answer, submit ──
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Q1 (objective true_false) renders first.
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    // Navigate to Q2 (text_response) and type the multiline essay.
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerTextResponse(page, essay);
    await waitForSaveSaved(page);

    await submitExam(page);

    // Capture the attemptId from the result URL for API checks.
    await page.waitForURL("**/result", { timeout: 15_000 });
    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;
    expect(attemptId).toBeTruthy();

    const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
    const candidateToken = await candidateApiToken(request, seeded.candidate);

    // ── Authoritative take API: submitted + pending_manual ───────────────
    const takeRes = await request.get(
      `${baseURL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeRes.status()).toBe(200);
    const take = await takeRes.json();
    expect(take.attemptStatus).toBe("submitted");
    expect(take.gradingStatus).toBe("pending_manual");

    // ── Admin: grading queue shows durable pending-manual work ───────────
    const adminToken = await adminApiToken(request);
    const queueRes = await request.get(`${baseURL}/api/admin/grading-queue`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });
    expect(queueRes.status()).toBe(200);
    const queueBody = await queueRes.json();
    const queueItem = queueBody.items.find(
      (i: { attemptId: string }) => i.attemptId === attemptId,
    );
    expect(queueItem).toBeDefined();
    expect(queueItem.gradingStatus).toBe("pending_manual");
    // Only the single text_response is pending-manual work; the objective
    // question is completed_auto and must NOT inflate the pending count.
    expect(queueItem.pendingQuestionCount).toBe(1);

    // ── Admin: grading detail shows frozen answer + rubric + reference ──
    // This is the P1-1 projection proven through the real UI. Navigate via the
    // queue row (same path a human admin takes).
    await loginAsAdmin(page);
    await page.goto("/admin/grading-queue");

    // #439 V5: the AdminLayout topbar (the <header> without an <h1>;
    // the page's PageHeader owns one) must resolve the pageMeta title,
    // not the "页面" fallback, and document.title must agree.
    const topbar = page
      .getByTestId("admin-layout")
      .locator("header:not(:has(h1))");
    await expect(topbar).toHaveText("待评分");
    await expect(page).toHaveTitle(/^待评分 - /);

    const row = page.getByTestId(`grading-queue-row-${attemptId}`);
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.click();
    await page.waitForURL(
      (url) => /\/admin\/grading-queue\/[^/]+$/.test(url.pathname),
      { timeout: 15_000 },
    );

    // Candidate answer preserves both submitted lines (whitespace-pre-wrap).
    const answerEl = page.getByTestId(
      `grading-candidate-answer-${essayQuestionId}`,
    );
    await expect(answerEl).toContainText(essayLine1);
    await expect(answerEl).toContainText(essayLine2);

    // Frozen rubric + frozen reference answer from QuestionSnapshot (P1-1).
    await expect(
      page.getByTestId(`grading-rubric-${essayQuestionId}`),
    ).toContainText("评分细则");
    await expect(
      page.getByTestId(`grading-rubric-${essayQuestionId}`),
    ).toContainText("概念准确");
    await expect(
      page.getByTestId(`grading-standard-answer-${essayQuestionId}`),
    ).toContainText("参考答案");

    // Score/comment inputs are present for the pending manual entry.
    await expect(
      page.getByTestId(`grading-score-input-${essayQuestionId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`grading-comment-input-${essayQuestionId}`),
    ).toBeVisible();

    // ── Admin: complete the pending manual entry (score 50/60) ──────────
    await page.getByTestId(`grading-score-input-${essayQuestionId}`).fill("50");
    await page
      .getByTestId(`grading-comment-input-${essayQuestionId}`)
      .fill("good effort");
    // Slice 2: submission now goes through a confirmation dialog before the
    // irrevocable POST (button label is 提交评分, not 保存).
    await page.getByTestId(`grading-submit-btn-${essayQuestionId}`).click();
    await page.getByRole("button", { name: "确认提交" }).click();
    // "评分已完成" (exact) is the finalized toast — the last pending-manual
    // entry is now completed_manual and finalizeTerminalGrading ran.
    await expect(page.getByText("评分已完成", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Reload detail → score + comment persist (terminal entry saved).
    await page.reload();
    await expect(
      page.getByTestId(`grading-score-input-${essayQuestionId}`),
    ).toHaveValue("50");

    // ── Terminal: attempt graded + fully_graded; queue item gone ────────
    const takeAfter = await request.get(
      `${baseURL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeAfter.status()).toBe(200);
    const takeAfterBody = await takeAfter.json();
    expect(takeAfterBody.attemptStatus).toBe("graded");
    expect(takeAfterBody.gradingStatus).toBe("fully_graded");

    const queueAfter = await request.get(`${baseURL}/api/admin/grading-queue`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });
    expect(queueAfter.status()).toBe(200);
    const queueAfterBody = await queueAfter.json();
    const queueItemAfter = queueAfterBody.items.find(
      (i: { attemptId: string }) => i.attemptId === attemptId,
    );
    expect(queueItemAfter).toBeUndefined();

    // ── Score identity: objective (40) + manual (50) = 90 ───────────────
    const result = await getCandidateResult(request, candidateToken, attemptId);
    expect(result.showResultImmediately).toBe(true);
    expect(result.totalScore).toBe(90);
    expect(result.passed).toBe(true); // 90 >= 50

    // Score identity (Job Card §8): the admin result view exposes the
    // per-question earned scores (admin bypasses the publication gate).
    // Assert attempt.totalScore == SUM(gradingResult question earned) == 90.
    const adminResultRes = await request.get(
      `${baseURL}/api/scores/attempts/${attemptId}`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(adminResultRes.status()).toBe(200);
    const adminResult = await adminResultRes.json();
    expect(adminResult.showResultImmediately).toBe(true);
    expect(adminResult.totalScore).toBe(90);
    const earnedSum = (
      adminResult.questionResults as Array<{ score: number }>
    ).reduce((sum, q) => sum + (q.score ?? 0), 0);
    expect(earnedSum).toBe(90);

    // ── Strict terminal: ordinary grade-question is rejected (409) ──────
    // gradeQuestion is one-way; completed_manual / graded+fully_graded are
    // immutable under the current protocol. Post-terminal revision is not in
    // scope.
    const regrade = await request.post(
      `${baseURL}/api/admin/attempts/${attemptId}/grade-question`,
      {
        headers: { Cookie: `auth-token=${adminToken}` },
        data: {
          questionId: essayQuestionId,
          score: 45,
          comment: "re-grade",
        },
      },
    );
    expect(regrade.status()).toBe(409);

    // Terminal truth persists — total stays 90, not recomputed to 85.
    const resultAfterRegrade = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(resultAfterRegrade.totalScore).toBe(90);
    expect(resultAfterRegrade.passed).toBe(true);
  });
});
