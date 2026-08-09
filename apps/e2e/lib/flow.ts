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

/**
 * Type free-text into the first fill_blank input on the take page.
 * FillBlankInput renders a text input for both auto-graded (string
 * standardAnswer) and legacy subjective (null standardAnswer) fill_blank
 * questions.
 */
export async function answerFillBlank(page: Page, text: string): Promise<void> {
  const input = page
    .getByTestId("take-question-section")
    .locator("input[type='text']");
  await input.first().waitFor({ state: "visible" });
  await input.first().fill(text);
}

/**
 * Type free-text into the text_response textarea on the take page
 * (P3-MOD-P0-4). text_response is an independent QuestionType rendered as a
 * textarea via TextResponseInput.
 */
export async function answerTextResponse(
  page: Page,
  text: string,
): Promise<void> {
  const textarea = page
    .getByTestId("take-question-section")
    .locator("textarea");
  await textarea.first().waitFor({ state: "visible" });
  await textarea.first().fill(text);
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

const MAX_LOGIN_RETRIES = 5;

async function apiLogin(
  request: APIRequestContext,
  username: string,
  password: string,
  label: string,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_LOGIN_RETRIES; attempt++) {
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { username, password },
    });
    if (res.status() === 429) {
      if (attempt === MAX_LOGIN_RETRIES) {
        throw new Error(
          `${label} login rate-limited after ${MAX_LOGIN_RETRIES} attempts`,
        );
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    if (!res.ok()) {
      throw new Error(
        `${label} API login failed: ${res.status()} ${await res.text()}`,
      );
    }
    const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
    if (!token) throw new Error(`${label} API login returned no auth-token`);
    return token;
  }
  throw new Error(`${label} login exhausted retries`);
}

/**
 * Log in as admin over the API and return the auth-token cookie value.
 * Retries on 429 (rate-limit) to tolerate rapid sequential E2E seeds.
 */
export async function adminApiToken(
  request: APIRequestContext,
): Promise<string> {
  return apiLogin(
    request,
    process.env.E2E_ADMIN_USERNAME ?? "admin",
    process.env.E2E_ADMIN_PASSWORD ?? "admin123",
    "admin",
  );
}

/**
 * Log in as `candidate` over the API and return the auth-token cookie value.
 * Lighter than the UI login for tests that only need to drive the candidate
 * API (e.g. start + submit an attempt) before asserting on an admin response.
 */
export async function candidateApiToken(
  request: APIRequestContext,
  candidate: SeededCandidate,
): Promise<string> {
  return apiLogin(request, candidate.username, candidate.password, "candidate");
}

/**
 * Log in as a candidate by username/password over the API. Unlike
 * `candidateApiToken` (which takes a SeededCandidate), this accepts raw
 * credentials — useful when the caller creates candidates outside seedExam().
 */
export async function candidateLoginApi(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  return apiLogin(request, username, password, "candidate");
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
 * POST as admin. Returns the raw response — caller asserts status.
 */
export async function adminPost(
  request: APIRequestContext,
  token: string,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  return request.post(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
    data: data ?? {},
  });
}

/**
 * GET as admin. Returns the raw response — caller asserts status.
 */
export async function adminGet(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<APIResponse> {
  return request.get(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
}

/**
 * Start a new attempt for `examId` as a candidate. Returns the attempt id.
 * Throws on non-2xx (unlike adminPost/adminGet which return raw response).
 */
export async function candidateStartAttempt(
  request: APIRequestContext,
  candidateToken: string,
  examId: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/attempts/${examId}/start`, {
    headers: { Cookie: `auth-token=${candidateToken}` },
  });
  if (!res.ok()) {
    throw new Error(
      `candidate start attempt failed: ${res.status()} ${await res.text()}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
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

/**
 * Save one manual grading entry (Admin API). Mirrors the GradingDetailPage
 * 保存 button → POST /api/admin/attempts/:attemptId/grade-question.
 */
export async function gradeQuestionApi(
  request: APIRequestContext,
  adminToken: string,
  attemptId: string,
  questionId: string,
  score: number,
  comment = "",
): Promise<APIResponse> {
  return adminPost(
    request,
    adminToken,
    `/api/admin/attempts/${attemptId}/grade-question`,
    {
      questionId,
      score,
      comment,
    },
  );
}

/**
 * Publish an exam's results (Admin API) — flips manual-mode result visibility
 * from hidden → visible. Mirrors the (future) ScoreListPage publish action.
 */
export async function publishResultsApi(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
): Promise<APIResponse> {
  return adminPost(
    request,
    adminToken,
    `/api/exams/${examId}/publish-results`,
    {},
  );
}

/**
 * Fetch a candidate's attempt result as the parsed AttemptResultResponse.
 * Branches on `showResultImmediately`: visible results carry totalScore/passed;
 * hidden results carry a status + hiddenReason.
 */
export async function getCandidateResult(
  request: APIRequestContext,
  candidateToken: string,
  attemptId: string,
): Promise<{
  showResultImmediately: boolean;
  totalScore?: number;
  passed?: boolean;
  status?: string;
  hiddenReason?: string;
}> {
  const res = await request.get(
    `${BASE_URL}/api/scores/attempts/${attemptId}`,
    {
      headers: { Cookie: `auth-token=${candidateToken}` },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `get candidate result failed: ${res.status()} ${await res.text()}`,
    );
  }
  return (await res.json()) as {
    showResultImmediately: boolean;
    totalScore?: number;
    passed?: boolean;
    status?: string;
    hiddenReason?: string;
  };
}
