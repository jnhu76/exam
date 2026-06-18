import {
  test,
  expect,
  type APIRequestContext,
  type Response,
} from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  submitExam,
} from "../lib/flow";

// P2A-J6 — refresh-during-exam
//
// Two-round answer persistence across browser reloads.
// Regression for the clientSeqsRef hydration bug:
//   answer true → reload → clientSeqsRef restored → flip to false →
//   clientSeq=2 (not 1) → server accepts → reload → false survives →
//   submit → correct score

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function apiToken(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const r = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password },
  });
  if (!r.ok()) throw new Error(`login failed: ${r.status()}`);
  const t = r.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!t) throw new Error("no auth-token cookie");
  return t;
}

async function getAnswer(
  request: APIRequestContext,
  token: string,
  attemptId: string,
): Promise<unknown> {
  const r = await request.get(`${BASE_URL}/api/attempts/${attemptId}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  if (!r.ok()) throw new Error(`GET attempt failed: ${await r.text()}`);
  const b = (await r.json()) as { answers: Array<{ answer: unknown }> };
  return b.answers[0]?.answer;
}

interface SaveResult {
  clientSeq: number;
  answer: unknown;
  serverVersion: number;
}

/**
 * Registers a response waiter for a POST /answers/ request and returns a
 * function that, when called after the response arrives, extracts the
 * clientSeq, answer, and serverVersion from the matched pair.
 *
 * Usage:
 *   const getSaveResult = captureAnswerSave(page);
 *   await answerTrueFalse(page, false);      // triggers the save
 *   const result = await getSaveResult();     // extracts the matched result
 */
function captureAnswerSave(
  page: import("@playwright/test").Page,
): () => Promise<SaveResult> {
  const resPromise = page.waitForResponse(
    (res: Response) => {
      if (res.request().method() !== "POST") return false;
      if (!res.url().includes("/answers/")) return false;
      return true;
    },
    { timeout: 15_000 },
  );

  return async () => {
    const res = await resPromise;
    await res.finished();
    const payload = JSON.parse(res.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    const body = (await res.json()) as Record<string, unknown>;
    return {
      clientSeq: payload.clientSeq as number,
      answer: payload.answer,
      serverVersion: body.serverVersion as number,
    };
  };
}

test.describe("refresh during exam", () => {
  test("answer → reload → flip answer → reload → latest answer persisted, submit succeeds", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "refresh", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 30,
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    const token = await apiToken(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );

    const detailRes = await request.get(
      `${BASE_URL}/api/candidate/exams/${seeded.examId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    const attemptId = ((await detailRes.json()) as { activeAttemptId?: string })
      .activeAttemptId;
    if (!attemptId) throw new Error("no activeAttemptId");

    // ── Round 1: answer true ──────────────────────────────────────
    const getFirstSave = captureAnswerSave(page);
    await answerTrueFalse(page, true);
    const firstSave = await getFirstSave();

    expect(firstSave.answer).toBe(true);
    expect(firstSave.clientSeq).toBeGreaterThanOrEqual(1);
    expect(firstSave.serverVersion).toBe(1);

    await page.reload();
    await page
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });
    expect(await getAnswer(request, token, attemptId)).toBe(true);

    // ── Round 2: flip to false ────────────────────────────────────
    const getSecondSave = captureAnswerSave(page);
    await answerTrueFalse(page, false);
    const secondSave = await getSecondSave();

    expect(secondSave.answer).toBe(false);
    // CRITICAL REGRESSION LOCK: after reload, clientSeqsRef was restored
    // from persisted answer version (1), so the next save must use
    // clientSeq ≥ 2. A clientSeq ≤ firstSave.clientSeq would mean the
    // idempotency bug is still present.
    expect(secondSave.clientSeq).toBeGreaterThan(firstSave.clientSeq);
    expect(secondSave.serverVersion).toBeGreaterThan(firstSave.serverVersion);

    // Verify persisted via API before and after second reload.
    expect(await getAnswer(request, token, attemptId)).toBe(false);

    await page.reload();
    await page
      .getByTestId("take-question-section")
      .waitFor({ state: "visible" });
    expect(await getAnswer(request, token, attemptId)).toBe(false);

    // Still on /take.
    await expect(page).toHaveURL(/\/exam\/[^/]+\/take$/);

    // Submit. standardAnswer is true, our answer is false → score 0.
    await submitExam(page);
    await expect(page.getByText("未通过")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-total-score")).toHaveText("0");
  });
});
