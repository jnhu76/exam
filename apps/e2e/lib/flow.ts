import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import type { SeededCandidate } from "./seed";
import { loginViaUi } from "./login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export async function loginAsCandidate(
  page: Page,
  candidate: SeededCandidate,
): Promise<void> {
  await loginViaUi(page, candidate.username, candidate.password);
}

export const candidateLogin = loginAsCandidate;

export async function clickExamPrimaryAction(
  page: Page,
  examId: string,
  expectedAction: string,
): Promise<void> {
  const card = page.getByTestId(`exam-card-${examId}`);
  await card.waitFor({ state: "visible" });
  const action = card.getByTestId("exam-primary-action");
  await action.waitFor({ state: "visible" });
  await action.evaluate((el, expected) => {
    if (el.getAttribute("data-action") !== expected) {
      throw new Error(
        `Expected primary action ${expected}, got ${el.getAttribute(
          "data-action",
        )}`,
      );
    }
  }, expectedAction);
  await action.click();
}

export async function startAvailableExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  await clickExamPrimaryAction(page, examId, "start");
  await page.waitForURL((url) => /\/exam\/[^/]+\/start$/.test(url.pathname), {
    timeout: 15_000,
  });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
    timeout: 15_000,
  });
  await page.getByTestId("take-question-section").waitFor({ state: "visible" });
}

export async function startExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  await startAvailableExamFromList(page, examId);
}

export async function resumeExamFromList(
  page: Page,
  examId: string,
): Promise<void> {
  const card = page.getByTestId(`exam-card-${examId}`);
  await card.waitFor({ state: "visible" });
  await card.getByTestId("exam-primary-action").click();
  await page.waitForURL(
    (url) => /\/exam\/[^/]+\/(start|take)$/.test(url.pathname),
    {
      timeout: 15_000,
    },
  );
  const currentUrl = new URL(page.url());
  if (/\/start$/.test(currentUrl.pathname)) {
    await page.getByTestId("exam-start-btn").click();
    await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
      timeout: 15_000,
    });
  }
  await page.getByTestId("take-question-section").waitFor({ state: "visible" });
}

export async function answerTrueFalse(
  page: Page,
  value: boolean,
): Promise<void> {
  await page.getByTestId(`true-false-${value}`).check();
}

export async function waitForSaveSaved(page: Page): Promise<void> {
  await page.getByText("已保存").waitFor({ state: "visible", timeout: 10_000 });
}

export async function submitExam(page: Page): Promise<void> {
  await page.getByTestId("take-submit-btn").click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.getByTestId("confirm-submit-btn").click();
  await page.waitForURL("**/result", { timeout: 30_000 });
}

// --- API-level helpers (for E2E specs that assert on response status/body) ---

/**
 * Log in as `candidate` over the API and return the auth-token cookie value.
 * Lighter than the UI login for tests that only need to drive the candidate
 * API (e.g. start + submit an attempt) before asserting on an admin response.
 */
export async function candidateApiToken(
  request: APIRequestContext,
  candidate: SeededCandidate,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: candidate.username, password: candidate.password },
  });
  if (!res.ok()) {
    throw new Error(
      `candidate API login failed: ${res.status()} ${await res.text()}`,
    );
  }
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("candidate API login returned no auth-token");
  return token;
}

/**
 * Start a new attempt for `examId` and immediately submit it (no answers) over
 * the candidate API. Used by admin-flow E2E to reconcile a seeded exam to
 * `open` and resolve the attempt, leaving `open` + zero unresolved attempts.
 * Returns the attempt id.
 */
export async function startAndSubmitAttempt(
  request: APIRequestContext,
  token: string,
  examId: string,
): Promise<string> {
  const auth = { Cookie: `auth-token=${token}` };
  const start = await request.post(`${BASE_URL}/api/attempts/${examId}/start`, {
    headers: auth,
  });
  if (!start.ok()) {
    throw new Error(
      `start attempt failed: ${start.status()} ${await start.text()}`,
    );
  }
  const attemptId = ((await start.json()) as { id: string }).id;
  const submit = await request.post(
    `${BASE_URL}/api/attempts/${attemptId}/submit`,
    { headers: auth },
  );
  if (!submit.ok()) {
    throw new Error(
      `submit attempt failed: ${submit.status()} ${await submit.text()}`,
    );
  }
  return attemptId;
}

/**
 * Close an exam over the admin API (ADR-005 Slice 1). Drives the REAL close
 * route — the deterministic path that replaces the old `endingSoonSec` E2E
 * timing workaround.
 */
export async function closeExamApi(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
  reason?: string,
): Promise<APIResponse> {
  return request.post(`${BASE_URL}/api/exams/${examId}/close`, {
    headers: { Cookie: `auth-token=${adminToken}` },
    data: reason ? { reason } : {},
  });
}

/**
 * Export an exam's graded scores as CSV over the admin API. Returns the raw
 * response (caller asserts status + content-type). Mirrors the ScoreListPage
 * 导出CSV button's GET /api/exams/:id/export/scores call.
 */
export async function exportScoresCsv(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
): Promise<APIResponse> {
  return request.get(`${BASE_URL}/api/exams/${examId}/export/scores`, {
    headers: { Cookie: `auth-token=${adminToken}` },
  });
}
