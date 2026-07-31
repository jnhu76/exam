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
 * P1-MANUAL-GRADING-OPERATOR-CLOSEOUT — partial manual grading recovery E2E.
 *
 * Proves the two-subjective-question partial-completion + refresh recovery loop
 * at the browser level, which the single-question manual-grading.spec.ts does
 * not cover (audit P2-3):
 *
 *   candidate submits (1 objective + 2 text_response)
 *     → queue pendingQuestionCount = 2
 *     → admin opens detail → BOTH subjective inputs empty (Slice 1: not 0)
 *     → admin grades the first (positive score, confirm dialog) → first becomes
 *       read-only, second stays editable
 *     → attempt still submitted + pending_manual; queue count = 1
 *     → page reload → first score/comment restored and read-only, second still
 *       empty and editable
 *     → admin explicitly grades the second 0 (Slice 1: empty != 0; explicit 0
 *       is a legal grade) → graded + fully_graded
 *     → queue item gone
 *     → score identity (objective + manual sum == attempt total)
 *
 * The second question is deliberately scored 0 to prove from the browser that
 * an explicit zero is a valid, distinct operation — the Slice 1 fix guarantees
 * the empty input is never silently submitted as 0.
 */
test.describe("manual grading partial recovery (P1 closeout)", () => {
  test("two subjective questions: grade one, reload, grade the other (explicit 0) → fully graded", async ({
    page,
    request,
  }) => {
    const RUBRIC_1 = "按逻辑完整性给分";
    const RUBRIC_2 = "按关键概念给分";
    const ANS_1 = "光合作用分为光反应与暗反应。";
    const ANS_2 = "DNA双螺旋由碱基互补配对构成。";

    // Objective true_false (score 30, correct = true) + two text_response
    // (score 35 each). Total = 100, passing 50. Grading 35 + 0 = 35; with the
    // objective 30 the final total is 65.
    const seeded = await seedExam(request, "p1-partial", {
      questionAnswer: true,
      questionScore: 30,
      passingScore: 50,
      totalScore: 100,
      resultPublicationMode: "immediate",
      textResponseQuestions: [
        {
          score: 35,
          content: "论述光合作用的两个阶段",
          standardAnswer: "参考答案：从光反应与暗反应论述",
          rubric: RUBRIC_1,
        },
        {
          score: 35,
          content: "论述DNA双螺旋结构",
          standardAnswer: "参考答案：碱基互补配对",
          rubric: RUBRIC_2,
        },
      ],
    });
    expect(seeded.textResponseQuestionIds).toHaveLength(2);
    const [q1Id, q2Id] = seeded.textResponseQuestionIds;

    // ── Candidate: answer objective, then both text_response, submit ──────
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Q1 (objective true_false) first.
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    // Q2 (first text_response).
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerTextResponse(page, ANS_1);
    await waitForSaveSaved(page);

    // Q3 (second text_response).
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerTextResponse(page, ANS_2);
    await waitForSaveSaved(page);

    await submitExam(page);
    await page.waitForURL("**/result", { timeout: 15_000 });
    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;
    expect(attemptId).toBeTruthy();

    const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const adminToken = await adminApiToken(request);

    // ── Queue: 2 pending manual entries ───────────────────────────────────
    const queueRes = await request.get(`${baseURL}/api/admin/grading-queue`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });
    expect(queueRes.status()).toBe(200);
    const queueBody = await queueRes.json();
    const queueItem = queueBody.items.find(
      (i: { attemptId: string }) => i.attemptId === attemptId,
    );
    expect(queueItem).toBeDefined();
    expect(queueItem.pendingQuestionCount).toBe(2);

    // ── Admin opens grading detail; both subjective inputs are EMPTY ──────
    await loginAsAdmin(page);
    await page.goto("/admin/grading-queue");
    const row = page.getByTestId(`grading-queue-row-${attemptId}`);
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await row.click();
    await page.waitForURL(
      (url) => /\/admin\/grading-queue\/[^/]+$/.test(url.pathname),
      { timeout: 15_000 },
    );

    const q1ScoreInput = page.getByTestId(`grading-score-input-${q1Id}`);
    const q2ScoreInput = page.getByTestId(`grading-score-input-${q2Id}`);
    // Slice 1: pending questions render EMPTY, not 0.
    await expect(q1ScoreInput).toHaveValue("");
    await expect(q2ScoreInput).toHaveValue("");
    // Both are editable and have a submit button.
    await expect(q1ScoreInput).not.toBeDisabled();
    await expect(q2ScoreInput).not.toBeDisabled();
    await expect(page.getByTestId(`grading-submit-btn-${q1Id}`)).toBeVisible();
    await expect(page.getByTestId(`grading-submit-btn-${q2Id}`)).toBeVisible();

    // ── Grade the FIRST (positive score, via confirmation) ────────────────
    await q1ScoreInput.fill("35");
    await page.getByTestId(`grading-comment-input-${q1Id}`).fill("论述完整");
    await page.getByTestId(`grading-submit-btn-${q1Id}`).click();
    // Slice 2: confirmation dialog gates the irrevocable POST.
    await page.getByRole("button", { name: "确认提交" }).click();
    await expect(page.getByText("评分已保存", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // First question is now read-only (Slice 2: post-submit authoritative
    // refresh). Second question is still editable.
    await expect(q1ScoreInput).toBeDisabled();
    await expect(
      page.getByTestId(`grading-comment-input-${q1Id}`),
    ).toBeDisabled();
    await expect(q2ScoreInput).not.toBeDisabled();
    // No submit button for the completed first question; second still has one.
    await expect(
      page.getByTestId(`grading-submit-btn-${q1Id}`),
    ).not.toBeVisible();
    await expect(page.getByTestId(`grading-submit-btn-${q2Id}`)).toBeVisible();

    // ── Attempt still submitted + pending_manual; queue count = 1 ─────────
    const takeMid = await request.get(
      `${baseURL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    const takeMidBody = await takeMid.json();
    expect(takeMidBody.attemptStatus).toBe("submitted");
    expect(takeMidBody.gradingStatus).toBe("pending_manual");

    const queueMid = await request.get(`${baseURL}/api/admin/grading-queue`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });
    const queueMidBody = await queueMid.json();
    const queueMidItem = queueMidBody.items.find(
      (i: { attemptId: string }) => i.attemptId === attemptId,
    );
    expect(queueMidItem).toBeDefined();
    expect(queueMidItem.pendingQuestionCount).toBe(1);

    // ── Reload: first score/comment restored + read-only; second empty ────
    await page.reload();
    await expect(page.getByTestId(`grading-score-input-${q1Id}`)).toHaveValue(
      "35",
    );
    await expect(
      page.getByTestId(`grading-score-input-${q1Id}`),
    ).toBeDisabled();
    await expect(
      page.getByTestId(`grading-comment-input-${q1Id}`),
    ).toBeDisabled();
    // The committed comment is shown in the read-only metadata block.
    await expect(
      page.getByTestId(`grading-submitted-comment-${q1Id}`),
    ).toContainText("论述完整");
    // Second question still empty and editable.
    await expect(q2ScoreInput).toHaveValue("");
    await expect(q2ScoreInput).not.toBeDisabled();
    await expect(page.getByTestId(`grading-submit-btn-${q2Id}`)).toBeVisible();

    // ── Grade the SECOND with an explicit 0 → graded + fully_graded ───────
    await q2ScoreInput.fill("0");
    await page.getByTestId(`grading-submit-btn-${q2Id}`).click();
    await page.getByRole("button", { name: "确认提交" }).click();
    await expect(page.getByText("评分已完成", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // ── Terminal: graded + fully_graded; queue item gone ──────────────────
    const takeFinal = await request.get(
      `${baseURL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    const takeFinalBody = await takeFinal.json();
    expect(takeFinalBody.attemptStatus).toBe("graded");
    expect(takeFinalBody.gradingStatus).toBe("fully_graded");

    const queueFinal = await request.get(`${baseURL}/api/admin/grading-queue`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });
    const queueFinalBody = await queueFinal.json();
    expect(
      queueFinalBody.items.find(
        (i: { attemptId: string }) => i.attemptId === attemptId,
      ),
    ).toBeUndefined();

    // ── Score identity: objective (30) + manual (35 + 0) = 65 ─────────────
    const result = await getCandidateResult(request, candidateToken, attemptId);
    expect(result.totalScore).toBe(65);
    expect(result.passed).toBe(true); // 65 >= 50
  });
});
