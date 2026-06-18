import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
} from "../lib/flow";

// P2A-J6 — deadline-crash (P2A-J2 server-side deadline auto-submit)
//
// Candidate starts a 1-minute exam, answers, saves, then the browser
// "crashes" (page closed). The server-side deadline scanner must:
//   - detect deadlineAt <= now on the still-in_progress attempt
//   - submit + grade automatically (audit: attempt.autoSubmit)
// When the candidate reopens, ResultPage shows the graded result.
//
// Timing: durationMinutes=1 → deadlineAt = start + 60s.
// DEADLINE_SCAN_INTERVAL_MS=5s → picked up within ~5s of expiry.
// We poll candidate summary up to 150s.

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function candidateLoginByApi(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password },
  });
  if (!res.ok())
    throw new Error(
      `candidate login failed: ${res.status()} ${await res.text()}`,
    );
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("no auth-token cookie");
  return token;
}

interface CandidateSummary {
  examId: string;
  availabilityStatus: string;
  primaryAction: string;
  bestScore?: number;
}

async function fetchCandidateSummaries(
  request: APIRequestContext,
  token: string,
): Promise<CandidateSummary[]> {
  const res = await request.get(`${BASE_URL}/api/candidate/exams`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  if (!res.ok())
    throw new Error(
      `GET /api/candidate/exams failed: ${res.status()} ${await res.text()}`,
    );
  return (await res.json()) as CandidateSummary[];
}

async function waitForGraded(
  request: APIRequestContext,
  token: string,
  examId: string,
  timeoutMs = 150_000,
): Promise<CandidateSummary> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const summaries = await fetchCandidateSummaries(request, token);
    const s = summaries.find((x) => x.examId === examId);
    if (s && s.availabilityStatus === "graded") return s;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`exam ${examId} did not reach graded within ${timeoutMs}ms`);
}

test.describe("deadline crash → server auto-submit (P2A-J2/J3)", () => {
  test("browser closed at deadline → scanner auto-submits and grades; candidate sees result on reopen", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000); // deadline scanner needs ~65s (60s duration + 5s scan interval)
    const seeded: SeededExam = await seedExam(request, "deadline-crash", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 1,
      passingScore: 60,
      totalScore: 100,
    });

    // Phase 1 — start exam, answer correctly, save.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    // Phase 2 — crash: close browser so client deadline handler can't run.
    await page.close();
    await ctx.close();

    // Phase 3 — wait for server-side auto-submit + grade.
    const token = await candidateLoginByApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    const summary = await waitForGraded(request, token, seeded.examId);
    expect(summary.availabilityStatus).toBe("graded");
    expect(summary.primaryAction).toBe("view_result");
    expect(summary.bestScore).toBe(100);

    // Phase 4 — reopen: ResultPage shows the graded result.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await candidateLogin(page2, seeded.candidate);

    const card = page2.getByTestId(`exam-card-${seeded.examId}`);
    await card.waitFor({ state: "visible" });
    await expect(card.getByTestId("exam-primary-action")).toHaveAttribute(
      "data-action",
      "view_result",
    );
    await card.getByTestId("exam-primary-action").click();

    await expect(page2.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page2.getByTestId("result-total-score")).toHaveText("100");

    await page2.close();
    await ctx2.close();
  });
});
