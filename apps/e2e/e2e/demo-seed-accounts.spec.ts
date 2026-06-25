import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { loginViaUi } from "../lib/login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const CANDIDATE_PASSWORD = "candidate123";

type AvailabilityStatus =
  | "available"
  | "in_progress"
  | "resumable"
  | "submitted_pending_grade"
  | "graded"
  | "max_attempts_exhausted"
  | "not_started_yet"
  | "expired"
  | "unavailable";

type PrimaryAction =
  | "start"
  | "resume"
  | "view_result"
  | "view_history"
  | "none";

interface CandidateExamSummary {
  examId: string;
  title: string;
  availabilityStatus: AvailabilityStatus;
  primaryAction: PrimaryAction;
  attemptsUsed: number;
  maxAttempts: number;
  latestAttemptId?: string;
  bestScore?: number;
}

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  text: string;
}

interface ExpectedSeedState {
  username: string;
  availabilityStatus: AvailabilityStatus;
  primaryAction: PrimaryAction;
  statusLabel: string;
  actionLabel: string;
  requiresBestScore?: boolean;
}

const SEED_STATES: ExpectedSeedState[] = [
  {
    username: "candidate1",
    availabilityStatus: "in_progress",
    primaryAction: "resume",
    statusLabel: "进行中",
    actionLabel: "继续考试",
  },
  {
    username: "candidate2",
    availabilityStatus: "available",
    primaryAction: "start",
    statusLabel: "可参加",
    actionLabel: "开始考试",
  },
  {
    username: "candidate3",
    availabilityStatus: "resumable",
    primaryAction: "resume",
    statusLabel: "可恢复",
    actionLabel: "继续考试",
  },
  {
    username: "candidate4",
    availabilityStatus: "graded",
    primaryAction: "view_result",
    statusLabel: "已评分",
    actionLabel: "查看成绩",
    requiresBestScore: true,
  },
];

function tokenFromSetCookie(setCookie: string | undefined): string {
  const token = setCookie?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) {
    throw new Error(
      `auth-token cookie not found in set-cookie=${setCookie ?? ""}`,
    );
  }
  return token;
}

async function readApiResult(
  response: Awaited<ReturnType<APIRequestContext["fetch"]>>,
): Promise<ApiResult> {
  const text = await response.text();
  return {
    status: response.status(),
    text,
    body: text ? ((JSON.parse(text) as Record<string, unknown>) ?? {}) : {},
  };
}

async function loginByApi(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password },
  });
  const text = await res.text();
  if (res.status() !== 200) {
    throw new Error(
      `API login failed for ${username}: ${res.status()} ${text}`,
    );
  }
  return tokenFromSetCookie(res.headers()["set-cookie"]);
}

async function adminLogin(request: APIRequestContext): Promise<string> {
  return loginByApi(request, "admin", "admin123");
}

async function apiCall(
  request: APIRequestContext,
  method: string,
  path: string,
  data: Record<string, unknown> | undefined,
  auth: string,
): Promise<ApiResult> {
  const res = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `auth-token=${auth}`,
    },
    data,
  });
  return readApiResult(res);
}

function assertOk(result: ApiResult, label: string): void {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label} failed: ${result.status} ${result.text}`);
  }
}

function stringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Expected response field ${field}, got ${JSON.stringify(body)}`,
    );
  }
  return value;
}

async function createCandidate(
  request: APIRequestContext,
  adminToken: string,
  unique: string,
): Promise<{ username: string; password: string; profileId: string }> {
  const stamp = Date.now();
  const username = `e2e-${unique}-${stamp}`;
  const result = await apiCall(
    request,
    "POST",
    "/api/candidates",
    {
      username,
      password: CANDIDATE_PASSWORD,
      name: `E2E ${unique}`,
      // demo-seed declares `candidateNo` required+unique; supply a unique value.
      fields: { candidateNo: `E2E-${unique}-${stamp}` },
    },
    adminToken,
  );
  assertOk(result, "create candidate");
  return {
    username,
    password: CANDIDATE_PASSWORD,
    profileId: stringField(result.body, "id"),
  };
}

async function createExamForTest(
  request: APIRequestContext,
  adminToken: string,
  opts: { title: string; maxAttempts: number },
): Promise<string> {
  const course = await apiCall(
    request,
    "POST",
    "/api/courses",
    {
      name: `C-${opts.title}-${Date.now()}`,
      code: `c-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      description: "",
    },
    adminToken,
  );
  assertOk(course, "create course");

  const question = await apiCall(
    request,
    "POST",
    "/api/questions",
    {
      courseId: stringField(course.body, "id"),
      type: "true_false",
      content: `Q-${opts.title}`,
      standardAnswer: true,
      score: 100,
    },
    adminToken,
  );
  assertOk(question, "create question");

  const exam = await apiCall(
    request,
    "POST",
    "/api/exams",
    {
      title: opts.title,
      description: "",
      courseId: stringField(course.body, "id"),
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3_600_000).toISOString(),
      closeAt: new Date(Date.now() + 86_400_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [stringField(question.body, "id")],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 60,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "max_attempts",
      scoreStrategy: "highest",
      maxAttempts: opts.maxAttempts,
    },
    adminToken,
  );
  assertOk(exam, "create exam");
  const examId = stringField(exam.body, "id");

  const publish = await apiCall(
    request,
    "POST",
    `/api/exams/${examId}/publish`,
    {},
    adminToken,
  );
  assertOk(publish, "publish exam");
  return examId;
}

async function getCandidateSummariesByApi(
  request: APIRequestContext,
  token: string,
): Promise<CandidateExamSummary[]> {
  const res = await request.get(`${BASE_URL}/api/candidate/exams`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  const text = await res.text();
  if (res.status() !== 200) {
    throw new Error(`candidate summaries failed: ${res.status()} ${text}`);
  }
  return JSON.parse(text) as CandidateExamSummary[];
}

/**
 * Ensures a candidate whose demo-seed contract is `in_progress/resume` reads
 * as `in_progress` regardless of the accelerated heartbeat scanner's timing.
 *
 * The demo seed plants candidate1's attempt as `in_progress` with
 * `lastActivityAt = seedTime`. docker-compose.test.yml accelerates the
 * heartbeat scanner (HEARTBEAT_TIMEOUT_MS=15000) for the disconnect/restore
 * specs, so by the time this test runs that attempt may already have been
 * auto-marked `disrupted` — surfacing as `resumable/resume` instead of the
 * contracted `in_progress/resume`.
 *
 * This helper detects either state (`in_progress` or `resumable`), restores
 * the attempt to `in_progress` if needed, then pings the heartbeat endpoint to
 * re-stamp `lastActivityAt` to "now". The candidate is then guaranteed to read
 * `in_progress/resume`, independent of scanner timing.
 *
 * No-op when the candidate has neither an in_progress nor resumable attempt
 * (their seed contract is neither), so it is safe to call for every candidate.
 */
async function ensureInProgressAttempt(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const summaries = await getCandidateSummariesByApi(request, token);
  const live = summaries.find(
    (s) =>
      s.availabilityStatus === "in_progress" ||
      s.availabilityStatus === "resumable",
  );
  const attemptId = live?.latestAttemptId;
  if (!attemptId) return;
  // Restore flips disrupted → in_progress (no-op if already in_progress).
  const restoreRes = await apiCall(
    request,
    "POST",
    `/api/attempts/${attemptId}/restore`,
    undefined,
    token,
  );
  assertOk(restoreRes, "restore attempt");
  // Heartbeat re-stamps lastActivityAt to "now", keeping it in_progress
  // past the next scanner tick.
  const heartbeatRes = await apiCall(
    request,
    "POST",
    `/api/attempts/${attemptId}/heartbeat`,
    undefined,
    token,
  );
  assertOk(heartbeatRes, "heartbeat attempt");
}

function findExpectedSummary(
  summaries: CandidateExamSummary[],
  expected: Pick<ExpectedSeedState, "availabilityStatus" | "primaryAction">,
): CandidateExamSummary {
  const found = summaries.find(
    (summary) =>
      summary.availabilityStatus === expected.availabilityStatus &&
      summary.primaryAction === expected.primaryAction,
  );
  if (!found) {
    throw new Error(
      `Expected summary ${expected.availabilityStatus}/${expected.primaryAction}, got ${JSON.stringify(
        summaries.map((summary) => ({
          examId: summary.examId,
          title: summary.title,
          availabilityStatus: summary.availabilityStatus,
          primaryAction: summary.primaryAction,
          attemptsUsed: summary.attemptsUsed,
          maxAttempts: summary.maxAttempts,
          bestScore: summary.bestScore,
        })),
      )}`,
    );
  }
  return found;
}

async function expectUiSummary(
  page: Page,
  summary: CandidateExamSummary,
  expected: ExpectedSeedState,
): Promise<void> {
  const card = page.getByTestId(`exam-card-${summary.examId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(expected.statusLabel)).toBeVisible();
  const action = card.getByTestId("exam-primary-action");
  await expect(action).toHaveAttribute("data-action", expected.primaryAction);
  await expect(action).toContainText(expected.actionLabel);
  if (expected.requiresBestScore) {
    expect(summary.bestScore).toBeDefined();
    const scoreBadge = card.getByTestId("exam-best-score");
    await expect(scoreBadge).toBeVisible();
    await expect(scoreBadge).toContainText(String(summary.bestScore));
  }
}

async function startAndSubmit(
  request: APIRequestContext,
  cToken: string,
  examId: string,
): Promise<string> {
  const start = await apiCall(
    request,
    "POST",
    `/api/attempts/${examId}/start`,
    undefined,
    cToken,
  );
  assertOk(start, "start attempt");
  const attemptId = stringField(start.body, "id");
  const submit = await apiCall(
    request,
    "POST",
    `/api/attempts/${attemptId}/submit`,
    undefined,
    cToken,
  );
  assertOk(submit, "submit attempt");
  return attemptId;
}

test.describe("demo seed candidate accounts", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  for (const expected of SEED_STATES) {
    test(`${expected.username} has ${expected.availabilityStatus}/${expected.primaryAction}`, async ({
      page,
      request,
    }) => {
      const token = await loginByApi(
        request,
        expected.username,
        CANDIDATE_PASSWORD,
      );
      // Keep a seeded in_progress attempt from being auto-disrupted by the
      // accelerated heartbeat scanner before we assert the seed contract.
      // Only candidates whose contract IS in_progress need this — e.g.
      // candidate3's contract is `resumable` (disrupted) and must NOT be
      // restored, so guard on the expected status.
      if (expected.availabilityStatus === "in_progress") {
        await ensureInProgressAttempt(request, token);
      }
      const summaries = await getCandidateSummariesByApi(request, token);
      const summary = findExpectedSummary(summaries, expected);
      expect(summary.availabilityStatus).toBe(expected.availabilityStatus);
      expect(summary.primaryAction).toBe(expected.primaryAction);

      await loginViaUi(page, expected.username, CANDIDATE_PASSWORD);
      await expectUiSummary(page, summary, expected);
    });
  }

  test("exhausted 2/2 returns 409 and has no start action", async ({
    page,
    request,
  }) => {
    const adminToken = await adminLogin(request);
    const candidate = await createCandidate(request, adminToken, "exhausted");
    const examId = await createExamForTest(request, adminToken, {
      title: "Exhausted",
      maxAttempts: 2,
    });

    const enroll = await apiCall(
      request,
      "POST",
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [candidate.profileId] },
      adminToken,
    );
    assertOk(enroll, "enroll candidate");

    const candidateToken = await loginByApi(
      request,
      candidate.username,
      candidate.password,
    );
    await startAndSubmit(request, candidateToken, examId);
    await startAndSubmit(request, candidateToken, examId);

    const summaries = await getCandidateSummariesByApi(request, candidateToken);
    const summary = summaries.find((item) => item.examId === examId);
    expect(summary).toEqual(
      expect.objectContaining({
        availabilityStatus: "max_attempts_exhausted",
        primaryAction: "view_result",
        attemptsUsed: 2,
        maxAttempts: 2,
      }),
    );

    const reject = await apiCall(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      candidateToken,
    );
    expect(reject.status).toBe(409);
    expect(reject.body.error).toEqual(
      expect.objectContaining({ code: "MAX_ATTEMPTS_REACHED" }),
    );

    await loginViaUi(page, candidate.username, candidate.password);
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("次数已用完")).toBeVisible();
    const action = card.getByTestId("exam-primary-action");
    await expect(action).toHaveAttribute("data-action", "view_result");
    await expect(action).not.toHaveAttribute("data-action", "start");
  });
});
