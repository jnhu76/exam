import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
  candidateApiToken,
} from "../lib/flow";

// #291 Phase A — representative candidate-runtime E2E for the `deadline` and
// `untimed` timing modes over the SAME engine as timed_window (which keeps its
// own coverage in candidate-happy-path / deadline-crash / refresh-during-exam).
//
// deadline mode: the attempt has NO personal countdown — the topbar shows the
// static server-authoritative cutoff (data-testid="deadline-static", derived
// from exam.closeAt). Manual submit before the cutoff grades normally; an
// attempt still in flight past the cutoff is auto-submitted by the deadline
// scanner with the browser closed (server authority — same proof shape as
// deadline-crash, but expiry is the GLOBAL closeAt, not start+duration).
//
// untimed mode: no deadline exists at all — the topbar shows the untimed badge
// (不限时), no countdown, no cutoff; the attempt never deadline-expires and
// submits manually at any time.

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

interface CandidateSummary {
  examId: string;
  availabilityStatus: string;
  latestAttemptId?: string;
  latestAttemptStatus?: string;
}

/**
 * Polls the candidate list until the exam's latest attempt reaches the
 * expected authoritative attempt status (e.g. "graded"). Mode-aware note: a
 * deadline-mode exam past its closeAt projects availabilityStatus "expired"
 * (with view_result), NOT "graded" — the attempt-level status is the
 * mode-independent convergence signal for scanner auto-submit + grading.
 */
async function waitForAttemptStatus(
  request: APIRequestContext,
  token: string,
  examId: string,
  expected: string,
  timeoutMs = 150_000,
): Promise<CandidateSummary> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${BASE_URL}/api/candidate/exams`, {
      headers: { Cookie: `auth-token=${token}` },
    });
    if (!res.ok())
      throw new Error(
        `GET /api/candidate/exams failed: ${res.status()} ${await res.text()}`,
      );
    const summaries = (await res.json()) as CandidateSummary[];
    const s = summaries.find((x) => x.examId === examId);
    if (s && s.latestAttemptStatus === expected) return s;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(
    `exam ${examId} did not reach latestAttemptStatus=${expected} within ${timeoutMs}ms`,
  );
}

test.describe("Phase A timing modes — candidate runtime", () => {
  test("untimed exam: 不限时 badge, no countdown/cutoff; manual submit grades", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "timing-untimed", {
      timingMode: "untimed",
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Mode rendering: untimed badge only — no personal countdown (剩余时间)
    // and no static cutoff (截止时间).
    await expect(page.getByTestId("untimed-badge")).toHaveText(/不限时/);
    await expect(page.getByText("剩余时间")).toHaveCount(0);
    await expect(page.getByTestId("deadline-static")).toHaveCount(0);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });

  test("deadline exam: static cutoff from closeAt, no countdown; manual submit before cutoff grades", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "timing-deadline", {
      timingMode: "deadline",
      closeAt: new Date(Date.now() + 2 * 3600_000),
      questionAnswer: true,
      questionScore: 100,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    // Mode rendering: static server cutoff — no personal countdown, no untimed
    // badge.
    const cutoff = page.getByTestId("deadline-static");
    await expect(cutoff).toBeVisible();
    await expect(cutoff).toContainText("截止时间");
    await expect(page.getByText("剩余时间")).toHaveCount(0);
    await expect(page.getByTestId("untimed-badge")).toHaveCount(0);

    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);

    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("100");
  });

  test("deadline exam: browser closed past closeAt → scanner auto-submits and grades at the global cutoff", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    // closeAt ≈ 65s out: with DEADLINE_SCAN_INTERVAL_MS=5s the scanner picks
    // the attempt up soon after the global cutoff. Seed → login → start →
    // answer leaves ample time before closeAt.
    const seeded = await seedExam(request, "timing-deadline-exp", {
      timingMode: "deadline",
      closeAt: new Date(Date.now() + 65_000),
      questionAnswer: true,
      questionScore: 100,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    // "Crash": close the browser so no client submit can run.
    await context.close();

    const token = await candidateApiToken(request, seeded.candidate);
    const summary = await waitForAttemptStatus(
      request,
      token,
      seeded.examId,
      "graded",
    );
    // Past closeAt the closed exam projects "expired" with the graded result
    // still viewable (deriveCandidateExamState: afterWindow precedes graded).
    expect(summary.availabilityStatus).toBe("expired");
    expect(summary.examId).toBe(seeded.examId);
  });
});
