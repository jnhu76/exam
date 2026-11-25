import { test, expect, type Page } from "@playwright/test";
import { createExamProfileFromRecipe, seedExam } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  answerTrueFalse,
  candidateApiToken,
  clickExamPrimaryAction,
  loginAsCandidate,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";

/**
 * #678 W1.2 — same-deployment A/B interleaved visibility, browser-level.
 *
 * ONE deployment hosts two exams that both carry 4 objective questions and
 * one plain text_response (manual item):
 *
 *   - Exam A applies the basic_quiz recipe profile with NO profile-owned
 *     field sent → immediate publication materializes (copy-on-apply);
 *     no queue, no proctoring.
 *   - Exam B applies the standard_online recipe profile with explicit
 *     overrides (after_grading → manual; minSubmit/latestStart → explicit
 *     null) and the frozen admission queue (batchSize 1, interval 10s).
 *
 * Interleaved stages on the same server:
 *   ① every candidate submits with the manual item pending → the result page
 *      shows the submitted state (已交卷，等待评分完成), never a score;
 *   ② staff grades all three attempts through the real grading route → A's
 *      candidate sees the score immediately while B's candidate still sees
 *      评分已完成，成绩尚未公布;
 *   ③ staff publishes ONLY exam B → B's candidate sees the score and A's
 *      result stays exactly as visible as before.
 *
 * The queue release is witnessed IN THE BROWSER on exam B: candidate B1's
 * queue join is driven through the API first (deterministic batch-1 anchor),
 * then candidate B2 clicks start in the browser — the waiting panel
 * (排队等待入场中) renders while the demand-driven release has not yet
 * elapsed, and the page auto-enters the exam at the next poll after the
 * batch interval. All waiting is product poll behavior — no sleeps.
 */

const SUBMITTED_HIDDEN_TEXT = "已交卷，等待评分完成";
const PENDING_PUBLISH_TEXT = "评分已完成，成绩尚未公布";
const QUEUE_WAITING_TEXT = "排队等待入场中";
const TOTAL_SCORE = "20";

function attemptIdFromResultPage(page: Page): string {
  const segments = new URL(page.url()).pathname.split("/");
  const index = segments.indexOf("exam");
  const id = segments[index + 1];
  if (!id) {
    throw new Error(`cannot read attempt id from ${page.url()}`);
  }
  return id;
}

test.describe("A/B interleaved visibility (#678)", () => {
  test("immediate exam A vs manual+queue exam B on one deployment", async ({
    page,
    browser,
    request,
  }) => {
    const adminToken = await adminApiToken(request);

    // Profiles from the shipped starter recipes, then two exams through the
    // copy-on-apply chain. Exam B overrides manual + null timing gates.
    const profileA = await createExamProfileFromRecipe(
      request,
      "aba",
      "basic_quiz",
    );
    const profileB = await createExamProfileFromRecipe(
      request,
      "abb",
      "standard_online",
    );
    const examA = await seedExam(request, "ab-A", {
      profile: { id: profileA.id },
      objectiveQuestionCount: 4,
      questionScore: 10,
      textResponseQuestions: [{ score: 10 }],
      passingScore: 10,
      totalScore: 50,
    });
    const examB = await seedExam(request, "ab-B", {
      profile: {
        id: profileB.id,
        overrides: {
          resultPublicationMode: "manual",
          minSubmitAfterStartMinutes: null,
          latestStartOffsetMinutes: null,
        },
      },
      objectiveQuestionCount: 4,
      questionScore: 10,
      textResponseQuestions: [{ score: 10 }],
      passingScore: 10,
      totalScore: 50,
      requireQueue: { batchSize: 1, batchInterval: 10 },
      additionalCandidates: 1,
    });
    const [b1, b2] = [examB.candidate, examB.extraCandidates[0]!];

    // ── Exam A: the plain browser journey ────────────────────────────
    await loginAsCandidate(page, examA.candidate);
    await startExamFromList(page, examA.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    // ① A submitted, manual item pending → hidden submitted state.
    await expect(page.getByTestId("result-status-message")).toHaveText(
      SUBMITTED_HIDDEN_TEXT,
    );
    const attemptA = attemptIdFromResultPage(page);

    // ── Exam B: B1 anchors the batch through the API (deterministic), B2
    // witnesses the waiting → released transition in the browser ──────
    const b1Token = await candidateApiToken(request, b1);
    const b1Join = await request.post(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/attempts/${examB.examId}/queue`,
      { headers: { Cookie: `auth-token=${b1Token}` } },
    );
    expect(b1Join.status()).toBe(200);
    expect(((await b1Join.json()) as { status: string }).status).toBe("ready");
    const b1Start = await request.post(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/attempts/${examB.examId}/start`,
      { headers: { Cookie: `auth-token=${b1Token}` } },
    );
    expect(b1Start.status()).toBe(201);
    const attemptB1 = ((await b1Start.json()) as { id: string }).id;
    const b1Submit = await request.post(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/attempts/${attemptB1}/submit`,
      { headers: { Cookie: `auth-token=${b1Token}` } },
    );
    expect(b1Submit.status()).toBe(200);
    const b1Score = await request.get(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/scores/attempts/${attemptB1}`,
      { headers: { Cookie: `auth-token=${b1Token}` } },
    );
    const b1ScoreBody = (await b1Score.json()) as {
      showResultImmediately: boolean;
      hiddenReason?: string;
    };
    // ① B1 submitted with pending manual item → hidden.
    expect(b1ScoreBody.showResultImmediately).toBe(false);
    expect(b1ScoreBody.hiddenReason).toBe("not_started");

    // B2 pre-positions on the exam start page BEFORE clicking: the click
    // must land right after B1's committed join so B2 is batch 2.
    const contextB2 = await browser.newContext();
    const page2 = await contextB2.newPage();
    await loginAsCandidate(page2, b2);
    await clickExamPrimaryAction(page2, examB.examId, "start");

    // B2 joins the queue in the browser: batch 2 → the waiting panel renders
    // (放行前), then the demand-driven release admits B2 at the next poll
    // after the batch interval and the page enters the exam (放行后).
    await page2.getByTestId("exam-start-btn").click();
    await expect(page2.getByTestId("exam-queue-panel")).toBeVisible();
    await expect(page2.getByTestId("exam-queue-panel")).toContainText(
      QUEUE_WAITING_TEXT,
    );
    await page2.waitForURL(/\/exam\/[^/]+\/take$/, { timeout: 30_000 });
    await page2
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });
    await answerTrueFalse(page2, true);
    await waitForSaveSaved(page2);
    await submitExam(page2);
    await expect(page2.getByTestId("result-status-message")).toHaveText(
      SUBMITTED_HIDDEN_TEXT,
    );
    const attemptB2 = attemptIdFromResultPage(page2);

    // ── ② staff grades all three attempts (real grading route) ───────
    // Each attempt grades ITS OWN exam's text_response question — the frozen
    // grading workset fails closed (404) on a question outside the attempt.
    const grade = (attemptId: string, textQuestionId: string) =>
      adminPost(
        request,
        adminToken,
        `/api/admin/attempts/${attemptId}/grade-question`,
        {
          questionId: textQuestionId,
          score: 10,
        },
      ).then(async (res) => {
        expect(res.status()).toBe(200);
      });
    await grade(attemptA, examA.textResponseQuestionIds[0]!);
    await grade(attemptB1, examB.textResponseQuestionIds[0]!);
    await grade(attemptB2, examB.textResponseQuestionIds[0]!);

    // A (immediate): the score appears right after grading.
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toHaveText(
      TOTAL_SCORE,
    );
    // B2 (manual): grading done but still behind the publish gate.
    await page2.reload();
    await expect(page2.getByTestId("result-status-message")).toHaveText(
      PENDING_PUBLISH_TEXT,
    );
    // B1 (manual, API view): same publication gate on the actual response.
    const b1AfterGrading = await request.get(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/scores/attempts/${attemptB1}`,
      { headers: { Cookie: `auth-token=${b1Token}` } },
    );
    const b1AfterGradingBody = (await b1AfterGrading.json()) as {
      showResultImmediately: boolean;
      hiddenReason?: string;
    };
    expect(b1AfterGradingBody.showResultImmediately).toBe(false);
    expect(b1AfterGradingBody.hiddenReason).toBe("pending_publish");

    // ── ③ staff publishes ONLY exam B ────────────────────────────────
    const publishB = await adminPost(
      request,
      adminToken,
      `/api/exams/${examB.examId}/publish-results`,
    );
    expect(publishB.status()).toBe(200);

    // B candidates now see the score (browser + API views).
    await page2.reload();
    await expect(page2.getByTestId("result-total-score")).toHaveText(
      TOTAL_SCORE,
    );
    const b1AfterPublish = await request.get(
      `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/scores/attempts/${attemptB1}`,
      { headers: { Cookie: `auth-token=${b1Token}` } },
    );
    const b1AfterPublishBody = (await b1AfterPublish.json()) as {
      showResultImmediately: boolean;
      totalScore?: number;
    };
    expect(b1AfterPublishBody.showResultImmediately).toBe(true);
    // B1's journey is deliberately API-minimal (no objective answers): its
    // terminal score is the graded manual item alone.
    expect(b1AfterPublishBody.totalScore).toBe(10);

    // Interleave witness: exam A was never published, yet its already
    // visible result is untouched by B's publish.
    await page.reload();
    await expect(page.getByTestId("result-total-score")).toHaveText(
      TOTAL_SCORE,
    );

    await contextB2.close();
  });
});
