import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  candidateApiToken,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  publishResultsApi,
  getCandidateResult,
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
});
