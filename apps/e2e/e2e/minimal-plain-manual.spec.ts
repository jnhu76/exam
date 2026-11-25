import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  answerTrueFalse,
  candidateLogin,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";
import { loginAsAdmin } from "../lib/login";

/**
 * #678 W3.3 — Minimal deployment (PRODUCT_PRESET=minimal), Plain 简答 +
 * basic manual grading, browser-level.
 *
 * Minimal contains Plain text_response + basic manual grading (ADR-022 D2):
 * this spec proves the subjective path is a FIRST-CLASS Minimal flow on the
 * same kernel — no fake rubric, no second grading path (§16 stop condition 4).
 *
 * Material invariants owned here (testing.md §4.0):
 *  1. the Plain text_response authoring path seeds and renders under the
 *     Minimal ceiling (rubric required at publish — the real publish
 *     contract, not a relaxed Minimal variant);
 *  2. the candidate journey covers the subjective input (plain textarea),
 *     submission confirmation with the result HIDDEN (已交卷，等待评分完成 —
 *     manual publication gate), then grading → unified publication → the
 *     SAME result page turns visible with the final score;
 *  3. the obligation faces stay reachable under Minimal in the real shell:
 *     the 待评分 nav entry and the grading queue/detail (pending manual
 *     worklist) render and drive the manual completion — §4.4's red line
 *     exercised on a Minimal deployment;
 *  4. per-exam publication policy (manual) drives visibility, NOT the
 *     deployment preset — the exam's frozen policy owns the gate.
 *
 * Browser mechanism that requires the browser: candidate subjective input,
 * the admin grading workbench interaction (score input → irrevocable
 * confirm dialog → submission), and the publication-gated result flip are
 * end-user-visible behaviors on the deployed Minimal topology.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SUBMITTED_HIDDEN_TEXT = "已交卷，等待评分完成";

test.describe("Minimal deployment — Plain 简答 + manual grading (#678 W3.3)", () => {
  test("candidate subjective journey, admin grading workbench, publication flip", async ({
    page,
    request,
  }) => {
    // Deployment precondition: this shard MUST boot Minimal.
    const config = await request.get(`${BASE_URL}/api/system/public-config`);
    expect(config.ok()).toBeTruthy();
    expect((await config.json()).product.presentation).toBe("minimal");

    const seeded = await seedExam(request, "min-manual", {
      objectiveQuestionCount: 1,
      questionScore: 100,
      textResponseQuestions: [{ score: 10, rubric: "内容完整、表达清晰" }],
      resultPublicationMode: "manual",
      passingScore: 60,
      titleOverride: `MINMANUAL-${Date.now()}`,
    });

    // ── Candidate: objective first, then the plain 简答 textarea; the
    // submission confirms while the manual publication keeps the score
    // hidden.
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await page.getByRole("button", { name: "下一题" }).click();
    await page
      .getByTestId("take-question-section")
      .getByRole("textbox")
      .fill("简答内容：因式分解 (x-1)(x+1)，逻辑完整。");
    await waitForSaveSaved(page);
    await submitExam(page);

    const resultUrl = page.url();
    const attemptIdFromResult = resultUrl.match(/\/exam\/([^/]+)\/result/)?.[1];
    expect(
      attemptIdFromResult,
      "submit navigates to the attempt result",
    ).toBeTruthy();
    await expect(page.getByText(SUBMITTED_HIDDEN_TEXT)).toBeVisible();

    // ── Admin: the obligation face (待评分) is reachable under Minimal and
    // the grading queue lists the pending attempt for THIS exam.
    await loginAsAdmin(page);
    await expect(page.getByText("待评分")).toBeVisible();
    await page.goto(`${BASE_URL}/admin/grading-queue`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("cell", { name: seeded.examTitle, exact: true }),
    ).toBeVisible();

    // ── Grading workbench: score the plain 简答 through the real UI flow
    // (input → 提交评分 → irrevocable confirm dialog).
    await page.goto(`${BASE_URL}/admin/grading-queue/${attemptIdFromResult}`, {
      waitUntil: "networkidle",
    });
    const scoreInput = page.getByTestId(
      `grading-score-input-${seeded.textResponseQuestionIds?.[0]}`,
    );
    await expect(scoreInput).toBeVisible();
    await scoreInput.fill("10");
    await page.getByRole("button", { name: "提交评分" }).click();
    // Radix AlertDialogContent exposes role="alertdialog" (not "dialog").
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "确认提交" }).click();
    // The manual item is graded; terminal aggregation flips the attempt to
    // fully_graded in the same transaction (EXSEM-009/010).
    await expect(confirmDialog).toBeHidden();

    // ── Unified publication (the exam's frozen manual policy gate).
    const token = await adminApiToken(request);
    const publish = await adminPost(
      request,
      token,
      `/api/exams/${seeded.examId}/publish-results`,
    );
    expect(publish.ok()).toBeTruthy();

    // ── Candidate: the SAME result page flips visible with the final score
    // (objective 100 + graded 简答 10 = 110) — the kernel-owned flip, driven
    // by the exam's publication policy rather than the deployment preset.
    await candidateLogin(page, seeded.candidate);
    await page.goto(`${BASE_URL}/exam/${attemptIdFromResult}/result`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("110");
    await expect(page.getByText("已通过")).toBeVisible();
  });
});
