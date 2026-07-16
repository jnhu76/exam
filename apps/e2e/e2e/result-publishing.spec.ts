import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  candidateApiToken,
  startExamFromList,
  answerTrueFalse,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  publishResultsApi,
  getCandidateResult,
  gradeQuestionApi,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * P2D-J5 — Result publishing policy, candidate-facing visibility (real flow).
 *
 * Two scenarios, each isolated with its own seeded exam + unique candidate:
 *   A. `immediate` — candidate sees the result right after submit, no admin action.
 *   B. `manual`    — candidate sees a pending state until the admin publishes;
 *      after publish the candidate sees the result.
 *
 * Visibility changes are driven by the publish action, never by timeout or
 * implicit state mutation. Both scenarios use objective true_false questions
 * (auto-graded on submit), so no manual grading is involved.
 */
test.describe("result publishing policy (P2D-J5)", () => {
  test("Scenario A — immediate publish: candidate sees result after submit", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "publish-immediate", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "immediate",
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    // No admin action: candidate can see the result immediately.
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    // The pending/hidden state must NOT render.
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);

    // Confirm the result belongs to the correct exam/attempt over the API.
    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const result = await getCandidateResult(request, candidateToken, attemptId);
    expect(result.showResultImmediately).toBe(true);
    expect(result.totalScore).toBe(100);
  });

  test("Scenario B — manual publish: candidate hidden until admin publishes", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "publish-manual", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "manual",
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;

    // ── Before publish: candidate sees the hidden/pending state ─────────────
    // Manual mode hides the result until resultsPublishedAt is set. The
    // attempt is auto-graded (status=graded), so the UI shows the
    // "成绩尚未公布" pending message and NO score.
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("成绩正在审核中，将在公布后可见"),
    ).toBeVisible();
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // Confirm via API: hidden with the pending_publish reason.
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const beforePublish = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(beforePublish.showResultImmediately).toBe(false);
    expect(beforePublish.hiddenReason).toBe("pending_publish");

    // ── Admin publishes results ─────────────────────────────────────────────
    const adminToken = await adminApiToken(request);
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);
    const publishBody = (await publishRes.json()) as {
      ok: boolean;
      alreadyPublished: boolean;
    };
    expect(publishBody.ok).toBe(true);
    expect(publishBody.alreadyPublished).toBe(false);

    // ── After publish: candidate re-opens the result and now sees it ────────
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);

    // Confirm via API: now visible with the full score.
    const afterPublish = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(afterPublish.showResultImmediately).toBe(true);
    expect(afterPublish.totalScore).toBe(100);

    // Idempotent re-publish is a no-op (visibility already flipped).
    const rePublishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(rePublishRes.status()).toBe(200);
    const rePublishBody = (await rePublishRes.json()) as {
      alreadyPublished: boolean;
    };
    expect(rePublishBody.alreadyPublished).toBe(true);
  });

  // ── P3 result visibility ────────────────────────────────────────
  // P3-MOD-P3-1. Proves resultPublicationMode gates candidate score/pass
  // visibility INDEPENDENTLY of grading completion (INV-R1..R3). Scenarios A
  // and B above already cover immediate + manual(objective-auto). The two
  // tests below close the gaps that need a MIXED exam (objective + manual):
  //   C. after_grading — pending_manual hidden, final manual → auto visible.
  //   D. manual — fully_graded + computed score still hidden until explicit
  //      publish-results (the critical negative assertion INV-R2).

  /**
   * Build a mixed exam (1 objective true_false + 1 text_response), drive the
   * candidate through answering both + submitting, and return the attemptId +
   * the text_response question id for the caller's grading + visibility steps.
   * `resultPublicationMode` is caller-controlled via `mode`.
   */
  async function seedAndSubmitMixedExam(
    page: import("@playwright/test").Page,
    request: import("@playwright/test").APIRequestContext,
    unique: string,
    mode: "immediate" | "after_grading" | "manual",
  ) {
    const essayLine1 = `论述要点 ${unique}`;
    const essayLine2 = `论证结构 ${unique}`;

    const seeded = await seedExam(request, unique, {
      // Objective Q1 (true_false), correct answer true, score 10.
      questionAnswer: true,
      questionScore: 10,
      passingScore: 20,
      resultPublicationMode: mode,
      // Q2: text_response, score 20, non-empty frozen rubric.
      textResponseQuestions: [
        {
          score: 20,
          content: `P3 essay prompt ${unique}`,
          rubric: `评分细则：概念准确\n论证完整（${unique}）`,
        },
      ],
    });
    expect(seeded.textResponseQuestionIds).toHaveLength(1);
    const essayQuestionId = seeded.textResponseQuestionIds[0]!;

    // Candidate: answer Q1 (objective), navigate to Q2, answer, submit.
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await page.getByRole("button", { name: /下一题/ }).click();
    await answerTextResponse(page, `${essayLine1}\n${essayLine2}`);
    await waitForSaveSaved(page);
    await submitExam(page);

    // Attempt id from the result URL (same convention as Scenario A/B).
    await page.waitForURL("**/result", { timeout: 15_000 });
    const attemptId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)[1]!;
    expect(attemptId).toBeTruthy();

    return { seeded, attemptId, essayQuestionId };
  }

  test("P3 result visibility: after_grading releases only after final manual grading", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const { seeded, attemptId, essayQuestionId } = await seedAndSubmitMixedExam(
      page,
      request,
      `after-grading-${suffix}`,
      "after_grading",
    );
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const adminToken = await adminApiToken(request);

    // ── Before final manual grading: pending_manual → result hidden ────────
    // INV-R3: the objective partial score (10) must NOT leak.
    const takeSubmitted = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeSubmitted.status()).toBe(200);
    const takeSubmittedBody = await takeSubmitted.json();
    expect(takeSubmittedBody.attemptStatus).toBe("submitted");
    expect(takeSubmittedBody.gradingStatus).toBe("pending_manual");

    const beforeGrade = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(beforeGrade.showResultImmediately).toBe(false);
    // The attempt is still 'submitted' (not yet 'graded'), so the result is not
    // yet computable and the contract labels it 'not_started' (the historical
    // label covering any pre-graded lifecycle state — see scores.ts
    // computeResultVisibility). The invariant that matters: result HIDDEN, no
    // partial score leaked while manual grading is pending.
    expect(beforeGrade.hiddenReason).toBe("not_started");
    // No score/pass leaked while manual grading is pending.
    expect(beforeGrade.totalScore).toBeUndefined();
    expect(beforeGrade.passed).toBeUndefined();

    // ── Admin completes the final manual entry (15/20) ─────────────────────
    // Real grading endpoint; no helper hides the transition.
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptId,
      essayQuestionId,
      15,
      "partial credit",
    );
    expect(gradeRes.status()).toBe(200);
    const gradeBody = (await gradeRes.json()) as {
      gradingStatus: string;
      fullyGraded: boolean;
      totalScore?: number;
      passed?: boolean;
    };
    // Authoritative internal state: graded + fully_graded, score 10+15=25.
    expect(gradeBody.gradingStatus).toBe("fully_graded");
    expect(gradeBody.fullyGraded).toBe(true);
    expect(gradeBody.totalScore).toBe(25);
    expect(gradeBody.passed).toBe(true);

    // ── after_grading AUTO-releases on fully_graded (no publish-results) ────
    const afterGrade = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(afterGrade.showResultImmediately).toBe(true);
    expect(afterGrade.totalScore).toBe(25);
    expect(afterGrade.passed).toBe(true);

    // Candidate UI reflects the same released result.
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("25");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });

  test("P3 result visibility: manual keeps fully graded result hidden until explicit publish", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const { seeded, attemptId, essayQuestionId } = await seedAndSubmitMixedExam(
      page,
      request,
      `manual-mixed-${suffix}`,
      "manual",
    );
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const adminToken = await adminApiToken(request);

    // ── pending_manual: hidden (objective partial score 10 must not leak) ──
    const beforeGrade = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(beforeGrade.showResultImmediately).toBe(false);
    expect(beforeGrade.totalScore).toBeUndefined();
    expect(beforeGrade.passed).toBeUndefined();

    // ── Admin completes final manual grading (15/20) ───────────────────────
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptId,
      essayQuestionId,
      15,
      "partial credit",
    );
    expect(gradeRes.status()).toBe(200);
    const gradeBody = (await gradeRes.json()) as {
      gradingStatus: string;
      fullyGraded: boolean;
      totalScore?: number;
      passed?: boolean;
    };
    // INV-R2 core: fully_graded + score computed internally...
    expect(gradeBody.gradingStatus).toBe("fully_graded");
    expect(gradeBody.fullyGraded).toBe(true);
    expect(gradeBody.totalScore).toBe(25);
    expect(gradeBody.passed).toBe(true);

    // ...but the CANDIDATE result is still hidden (manual needs explicit
    // publish-results; grading completion does NOT release the result).
    const afterGradeHidden = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(afterGradeHidden.showResultImmediately).toBe(false);
    expect(afterGradeHidden.hiddenReason).toBe("pending_publish");
    expect(afterGradeHidden.totalScore).toBeUndefined();
    expect(afterGradeHidden.passed).toBeUndefined();

    // Candidate UI still shows the hidden/pending state, no score.
    await page.reload();
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Explicit publish-results via the real endpoint ─────────────────────
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);
    expect((await publishRes.json()).ok).toBe(true);

    // ── Candidate result now visible; score identity unchanged (25) ────────
    const afterPublish = await getCandidateResult(
      request,
      candidateToken,
      attemptId,
    );
    expect(afterPublish.showResultImmediately).toBe(true);
    expect(afterPublish.totalScore).toBe(25);
    expect(afterPublish.passed).toBe(true);

    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("25");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });
});
