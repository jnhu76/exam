import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  answerTextResponse,
  waitForSaveSaved,
  submitExam,
  adminApiToken,
  publishResultsApi,
  gradeQuestionApi,
} from "../lib/flow";
import { loginAsTeacher } from "../lib/login";
import { assignTeacherToCourse, createTeacherViaApi } from "../lib/teacher";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * P2D-J5 — Result publishing policy, candidate-facing visibility (real flow).
 *
 * Each scenario seeds its own exam + unique candidate and proves what the
 * candidate's browser shows across the publish transition:
 *   A. `immediate`    — result renders right after submit, no admin action.
 *   B. `manual`       — pending state until the admin publishes; the graded
 *                       score leaks through NO candidate UI surface before it.
 *   C. `after_grading` (mixed exam) — hidden until final manual grading,
 *                       auto-released on fully_graded.
 *   D. `manual` (mixed exam) — hidden state SURVIVES full grading until the
 *                       explicit publish.
 *   M12 — a Teacher publishes through the capability-gated ExamDetailPage
 *                       control (mutation travels through the browser UI).
 *   P5-N1 — the publication surfaces an Inbox notification whose click-through
 *                       lands on the result page.
 *
 * Visibility changes are driven by real publish/grade actions, never by
 * timeout or implicit state mutation. Wire-level receipt bodies (getCandidateResult
 * flags/reasons, attempt/list score fields, publish alreadyPublished,
 * notification totals) are owned by apps/api/src/routes/resultPublishing.test.ts,
 * candidateResultVisibility.test.ts and notifications.test.ts and are
 * deliberately not duplicated here.
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

    // ── Before publish: no score-derived facts on ANY candidate surface ────
    // (#324) The candidate UI must not observe the graded score through the
    // exam list card or the start page summary.
    await page.goto(`${BASE_URL}/exam/list`);
    const beforeCard = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(beforeCard).toBeVisible({ timeout: 15_000 });
    await expect(beforeCard.getByTestId("exam-best-score")).toHaveCount(0);

    await page.goto(`${BASE_URL}/exam/${seeded.examId}/start`);
    await expect(page.getByText("最高成绩")).toHaveCount(0);

    // Return to the result page so the publish step below reloads the result
    // view (the original flow asserts on a reload of THIS page).
    await page.goto(`${BASE_URL}/exam/${attemptId}/result`);

    // ── Admin publishes results (the mutation driver; receipt/idempotency
    // shapes are owned by resultPublishing.test.ts) ─────────────────────────
    const adminToken = await adminApiToken(request);
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);

    // ── After publish: candidate re-opens the result and now sees it ────────
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);

    // (#324) Every candidate UI surface restores consistently: the exam list
    // card and the start page now render the published score.
    await page.goto(`${BASE_URL}/exam/list`);
    const afterCard = page.getByTestId(`exam-card-${seeded.examId}`);
    await expect(afterCard).toBeVisible({ timeout: 15_000 });
    await expect(afterCard.getByTestId("exam-best-score")).toHaveText("100");

    await page.goto(`${BASE_URL}/exam/${seeded.examId}/start`);
    await expect(page.getByText("最高成绩: 100/100")).toBeVisible({
      timeout: 15_000,
    });
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
    const { attemptId, essayQuestionId } = await seedAndSubmitMixedExam(
      page,
      request,
      `after-grading-${suffix}`,
      "after_grading",
    );
    const adminToken = await adminApiToken(request);

    // ── Before final manual grading: pending_manual → result page HIDDEN ────
    // INV-R3 browser half: the hidden state renders; the objective partial
    // score (10) leaks nowhere in the candidate UI.
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Admin completes the final manual entry (15/20) via the real grading
    // endpoint. Receipt/visibility shapes are owned by
    // candidateResultVisibility.test.ts and are not re-asserted here.
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptId,
      essayQuestionId,
      15,
      "partial credit",
    );
    expect(gradeRes.status()).toBe(200);

    // ── after_grading AUTO-releases on fully_graded (no publish-results) ────
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
    const adminToken = await adminApiToken(request);

    // ── pending_manual: the result page renders the hidden state; the
    // objective partial score (10) leaks nowhere in the candidate UI. ──
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Admin completes final manual grading (15/20) via the real endpoint.
    // INV-R2 (fully_graded + computed score stays hidden until publish) is
    // owned at the API layer by candidateResultVisibility.test.ts; the browser
    // claim below is that the hidden state SURVIVES grading until publish. ──
    const gradeRes = await gradeQuestionApi(
      request,
      adminToken,
      attemptId,
      essayQuestionId,
      15,
      "partial credit",
    );
    expect(gradeRes.status()).toBe(200);

    // The candidate result is still hidden after grading (manual needs
    // explicit publish-results; grading completion does NOT release it).
    await page.reload();
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── Explicit publish-results via the real endpoint (mutation driver). ──
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);

    // ── Candidate result now visible with the unchanged score (25). ──
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("25");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });
});

/**
 * M12 — Teacher browser publication E2E.
 *
 * Proves the real Teacher product path for result publication through the
 * browser UI: a manual-mode exam's candidate result stays hidden until a
 * Teacher (created via the supported POST /api/users { role: "Teacher" }
 * product interface, then logged in through the real /login UI) clicks the
 * capability-gated Publish Results control on ExamDetailPage. The publication
 * mutation MUST travel through the browser UI — the publish-results API is NOT
 * called for the publication step.
 *
 * API use is allowed here only for fixture setup (seedExam). The publication
 * itself is performed through the rendered ExamDetailPage control + its
 * confirmation dialog; publish receipt/idempotency shapes are owned by
 * resultPublishing.test.ts and are not re-verified over the wire here.
 */
test.describe("M12: Teacher browser publication E2E", () => {
  test("Teacher publishes results through the ExamDetailPage UI; candidate sees the frozen score only after", async ({
    page,
    request,
  }) => {
    // ── 1. Create a manual-mode exam + enroll a Candidate (API setup) ──
    const seeded = await seedExam(request, "teacher-publish", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "manual",
    });

    // ── 2-3. Candidate completes the attempt + auto-grading ──
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    const resultUrl = new URL(page.url());
    const attemptId = resultUrl.pathname.split("/").filter(Boolean)[1]!;

    // ── 4. Candidate sees pending_publish and no score ──
    await expect(page.getByTestId("result-status-message")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("成绩正在审核中，将在公布后可见"),
    ).toBeVisible();
    await expect(page.getByTestId("result-total-score")).toHaveCount(0);

    // ── 5. Log in through the browser as Teacher ──
    // Teacher created via the SUPPORTED product interface (POST /api/users),
    // NOT direct DB insertion or a demo seed.
    const teacher = await createTeacherViaApi(request, {
      name: "M12教师-发布",
      usernamePrefix: "m12-tpublish",
    });
    // Issue 286: Teacher authority is course-assignment-scoped. The Teacher
    // must hold an active assignment on the seeded exam's course before the
    // detail surface (and its Publish Results action) resolves; the assignment
    // is minted through the supported Admin API, not direct DB insertion.
    await assignTeacherToCourse(request, teacher, seeded.courseId);
    await loginAsTeacher(page, teacher.username, teacher.password);
    await expect(page).toHaveURL(/\/admin\/exams(?:$|[/?#])/);

    // ── 6. Navigate to the Exam Detail publication surface ──
    await page.goto(`${BASE_URL}/admin/exams/${seeded.examId}`);
    await expect(page).toHaveURL(
      new RegExp(`/admin/exams/${seeded.examId}(?:$|[/?#])`),
    );

    // ── 7. Publish Results action is visible through capability gating ──
    const publishBtn = page.getByTestId("exam-detail-publish-results-btn");
    await expect(
      publishBtn,
      "Teacher must see the capability-gated Publish Results action",
    ).toBeVisible({ timeout: 15_000 });

    // ── 8. Click the real UI control ──
    // The button opens a confirmation dialog; confirm the publication.
    await publishBtn.click();
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "确认" }).click();

    // ── 9. Wait for the production success state (locators, not sleeps) ──
    // On success handlePublishResults refetches the exam; the Publish Results
    // button re-renders only when resultsPublishedAt is null, so its
    // disappearance is the observable publication-success signal.
    await expect(
      publishBtn,
      "Publish Results action disappears after successful publication",
    ).toHaveCount(0, { timeout: 15_000 });

    // ── 10-11. Candidate re-enters the result surface → sees frozen score ──
    // The browser is currently the Teacher's session; log back in as the
    // Candidate to verify the candidate-facing result UI (the publication
    // must flip candidate visibility, not just the admin view).
    await candidateLogin(page, seeded.candidate);
    await expect(page).toHaveURL(/\/exam\/list(?:$|[/?#])/);
    await page.goto(`${BASE_URL}/exam/${attemptId}/result`);
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
    await expect(page.getByText("已通过")).toBeVisible();
    await expect(page.getByTestId("result-status-message")).toHaveCount(0);
  });
});

/**
 * P5-N1: result_published Inbox notification E2E.
 *
 * Extends the M12 publication flow with the Inbox steps:
 *   Admin manual publish (API, the mutation driver)
 *     -> candidate browser sees unread badge
 *     -> opens panel, clicks the notification
 *     -> navigates to the authoritative result page
 *
 * This proves the P5-N1 browser composition (P5-N1-R0 §25.8 / §21 DoD): a real
 * product event — authorized result publication — surfaces in the candidate's
 * Inbox and its click-through lands on the result. Notification row shape,
 * totals and idempotent re-publish are owned by
 * apps/api/src/routes/notifications.test.ts and resultPublishing.test.ts and
 * are deliberately not re-verified over the wire here.
 */
test.describe("P5-N1: result_published Inbox notification", () => {
  test("manual publish surfaces the Inbox notification; candidate reads it and navigates", async ({
    page,
    request,
  }) => {
    // ── 1. Seed a manual-mode exam + complete a graded attempt (API) ──
    const seeded = await seedExam(request, "p5n1-notif", {
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
    const attemptId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)[1]!;

    // ── 2. Publish results via the Admin API (the mutation driver) ──
    const adminToken = await adminApiToken(request);
    const publishRes = await publishResultsApi(
      request,
      adminToken,
      seeded.examId,
    );
    expect(publishRes.status()).toBe(200);

    // ── 3. Candidate browser shows the unread badge ──
    // The candidate is still on the result page from the submit flow;
    // navigate to the exam list to see the notification bell.
    await page.goto(`${BASE_URL}/exam/list`);
    await expect(page).toHaveURL(/\/exam\/list(?:$|[/?#])/);
    await expect(page.getByTestId("notification-unread-badge")).toBeVisible({
      timeout: 15_000,
    });

    // ── 4. Open the panel, mark read by clicking the notification ──
    await page.getByTestId("notification-bell").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    // The first notification item navigates to the result page on click.
    const item = page.locator('[data-testid^="notification-item-"]').first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();

    // ── 5. Navigation lands on the authoritative result page ──
    await expect(page).toHaveURL(
      new RegExp(`/exam/${attemptId}/result(?:$|[/?#])`),
    );
    await expect(page.getByTestId("result-total-score")).toBeVisible({
      timeout: 15_000,
    });
  });
});
