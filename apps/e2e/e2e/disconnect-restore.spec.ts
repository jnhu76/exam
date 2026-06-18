import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  resumeExamFromList,
  submitExam,
} from "../lib/flow";

// P2A-J6 — disconnect-restore (P2A-J5 restore runtime semantics)
//
// When the heartbeat scanner marks an in_progress attempt as disrupted (no
// client heartbeats), restoreAttempt must:
//   1. transition disrupted → in_progress
//   2. preserve previously-saved answers
//   3. extend deadlineAt forward by the disconnected duration (capped at closeAt)
//
// Approach: start + answer via UI, close page (stops heartbeats), wait for
// heartbeat scanner (HEARTBEAT_TIMEOUT_MS=15s, scan every 5s) to mark
// disrupted, then resume via list and assert deadlineAt forward adjustment.

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

interface AttemptJson {
  id: string;
  status: string;
  deadlineAt?: string;
  answers: Array<{ questionId: string; answer: unknown; version: number }>;
}

async function fetchAttempt(
  request: APIRequestContext,
  token: string,
  attemptId: string,
): Promise<AttemptJson> {
  const res = await request.get(`${BASE_URL}/api/attempts/${attemptId}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  if (!res.ok())
    throw new Error(
      `GET /api/attempts/${attemptId} failed: ${res.status()} ${await res.text()}`,
    );
  return (await res.json()) as AttemptJson;
}

interface CandidateSummary {
  examId: string;
  availabilityStatus: string;
  primaryAction: string;
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

async function waitForResumable(
  request: APIRequestContext,
  token: string,
  examId: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const summaries = await fetchCandidateSummaries(request, token);
    const s = summaries.find((x) => x.examId === examId);
    if (
      s &&
      s.availabilityStatus === "resumable" &&
      s.primaryAction === "resume"
    )
      return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `attempt for exam ${examId} did not become resumable within ${timeoutMs}ms`,
  );
}

async function findAttemptIdForExam(
  request: APIRequestContext,
  token: string,
  examId: string,
): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/candidate/exams/${examId}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  if (!res.ok())
    throw new Error(
      `GET /api/candidate/exams/${examId} failed: ${res.status()} ${await res.text()}`,
    );
  const body = (await res.json()) as { activeAttemptId?: string };
  if (!body.activeAttemptId)
    throw new Error(`no activeAttemptId for exam ${examId}`);
  return body.activeAttemptId;
}

test.describe("disconnect → disrupted → restore (P2A-J5)", () => {
  test("saved answer preserved and deadlineAt extended after disconnect/restore", async ({
    browser,
    request,
  }) => {
    const seeded: SeededExam = await seedExam(request, "disc-restore", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 5,
    });

    // Phase 1 — candidate takes exam, answers, saves.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);

    const tokenV1 = await candidateLoginByApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    const attemptId = await findAttemptIdForExam(
      request,
      tokenV1,
      seeded.examId,
    );
    const before = await fetchAttempt(request, tokenV1, attemptId);
    expect(before.status).toBe("in_progress");
    expect(before.deadlineAt).toBeTruthy();
    const deadlineBeforeMs = new Date(before.deadlineAt!).getTime();

    // Phase 2 — crash: close page+context, wait for heartbeat scanner.
    const disconnectStart = Date.now();
    await page.close();
    await ctx.close();
    await waitForResumable(request, tokenV1, seeded.examId);

    // Phase 3 — resume via list triggers restoreAttempt.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await candidateLogin(page2, seeded.candidate);
    await resumeExamFromList(page2, seeded.examId);
    await page2
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });
    await expect(page2.getByTestId("true-false-true")).toBeChecked();

    // Phase 4 — deadlineAt must have been extended forward.
    const tokenV2 = await candidateLoginByApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    const after = await fetchAttempt(request, tokenV2, attemptId);
    expect(after.status).toBe("in_progress");
    expect(after.deadlineAt).toBeTruthy();
    const deadlineAfterMs = new Date(after.deadlineAt!).getTime();
    const disconnectedMs = Date.now() - disconnectStart;

    expect(deadlineAfterMs).toBeGreaterThan(deadlineBeforeMs);
    const slackMs = 15_000;
    expect(deadlineAfterMs - deadlineBeforeMs).toBeLessThanOrEqual(
      disconnectedMs + slackMs,
    );

    expect(after.answers.length).toBe(1);
    expect(after.answers[0]!.answer).toBe(true);

    // Phase 5 — restored attempt must be submittable and graded.
    await submitExam(page2);
    await expect(page2.getByText("已通过")).toBeVisible({ timeout: 15_000 });
    await expect(page2.getByTestId("result-total-score")).toHaveText("100");

    await page2.close();
    await ctx2.close();
  });
});
