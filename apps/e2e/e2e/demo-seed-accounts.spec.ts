import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

async function adminLogin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  const cookie = res.headers()["set-cookie"] ?? "";
  const match = cookie.match(/auth-token=([^;]+)/);
  return match?.[1] ?? "";
}

async function api(
  request: import("@playwright/test").APIRequestContext,
  method: string,
  path: string,
  data?: Record<string, unknown>,
  auth?: string,
): Promise<ApiResult> {
  const res = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Cookie: `auth-token=${auth}` } : {}),
    },
    data: data != null ? JSON.stringify(data) : undefined,
  });
  return {
    status: res.status(),
    body: (await res.json()) as Record<string, unknown>,
  };
}

interface TestCandidate {
  username: string;
  password: string;
  profileId: string;
}

async function createCandidate(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  unique: string,
): Promise<TestCandidate> {
  const r = await api(
    request,
    "POST",
    "/api/candidates",
    {
      username: `e2e-${unique}-${Date.now()}`,
      password: "candidate123",
      name: `E2E ${unique}`,
      fields: {},
    },
    adminToken,
  );
  return {
    username: String(r.body.username ?? ""),
    password: "candidate123",
    profileId: String(r.body.id ?? ""),
  };
}

async function createExamForTest(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  opts: { title: string; maxAttempts: number; retakePolicy?: string },
): Promise<string> {
  const course = await api(
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

  const q = await api(
    request,
    "POST",
    "/api/questions",
    {
      courseId: String(course.body.id ?? ""),
      type: "true_false",
      content: `Q-${opts.title}`,
      standardAnswer: true,
      score: 100,
    },
    adminToken,
  );

  const exam = await api(
    request,
    "POST",
    "/api/exams",
    {
      title: opts.title,
      description: "",
      courseId: String(course.body.id ?? ""),
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600000).toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [String(q.body.id ?? "")],
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
      retakePolicy: opts.retakePolicy ?? "max_attempts",
      scoreStrategy: "highest",
      maxAttempts: opts.maxAttempts,
    },
    adminToken,
  );

  await api(
    request,
    "POST",
    `/api/exams/${String(exam.body.id ?? "")}/publish`,
    {},
    adminToken,
  );

  return String(exam.body.id ?? "");
}

async function loginAs(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-layout").waitFor({ state: "visible" });
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/exam/list", { timeout: 15_000 });
}

async function getCandidateToken(
  request: import("@playwright/test").APIRequestContext,
  c: TestCandidate,
): Promise<string> {
  const r = await api(request, "POST", "/api/auth/login", {
    username: c.username,
    password: c.password,
  });
  const cookie = String(r.body.token ?? "");
  return cookie;
}

async function startAndSubmit(
  request: import("@playwright/test").APIRequestContext,
  cToken: string,
  examId: string,
): Promise<string> {
  const start = await api(
    request,
    "POST",
    `/api/attempts/${examId}/start`,
    undefined,
    cToken,
  );
  const attemptId = String(start.body.id ?? "");
  await api(
    request,
    "POST",
    `/api/attempts/${attemptId}/submit`,
    undefined,
    cToken,
  );
  return attemptId;
}

test.describe("candidate exam state E2E", () => {
  test("candidate with in_progress attempt sees 进行中/继续考试", async ({
    page,
    request,
  }) => {
    const adminToken = await adminLogin(request);
    const c = await createCandidate(request, adminToken, "inprog");
    const examId = await createExamForTest(request, adminToken, {
      title: "InProg",
      maxAttempts: 3,
    });
    await api(
      request,
      "POST",
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [c.profileId] },
      adminToken,
    );

    const cToken = await getCandidateToken(request, c);
    await api(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      cToken,
    );

    await loginAs(page, c.username, c.password);
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("进行中")).toBeVisible();
    await expect(card.getByText("继续考试")).toBeVisible();
  });

  test("candidate with no attempts sees 可参加/开始考试", async ({
    page,
    request,
  }) => {
    const adminToken = await adminLogin(request);
    const c = await createCandidate(request, adminToken, "avail");
    const examId = await createExamForTest(request, adminToken, {
      title: "Avail",
      maxAttempts: 2,
    });
    await api(
      request,
      "POST",
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [c.profileId] },
      adminToken,
    );

    await loginAs(page, c.username, c.password);
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("可参加")).toBeVisible();
    await expect(card.getByText("开始考试")).toBeVisible();
  });

  test("candidate with graded exam sees 已评分/开始考试 + bestScore on start page", async ({
    page,
    request,
  }) => {
    const adminToken = await adminLogin(request);
    const c = await createCandidate(request, adminToken, "graded");
    const examId = await createExamForTest(request, adminToken, {
      title: "Graded",
      maxAttempts: 3,
    });
    await api(
      request,
      "POST",
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [c.profileId] },
      adminToken,
    );

    const cToken = await getCandidateToken(request, c);
    await startAndSubmit(request, cToken, examId);

    await loginAs(page, c.username, c.password);
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("已评分")).toBeVisible();
    await expect(card.getByText("开始考试")).toBeVisible();

    await page.goto(`/exam/${examId}/start`);
    await expect(page.getByText("已考 1/3 次")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("最高成绩")).toBeVisible();
  });

  test("exhausted 2/2: not in 可参加, start API returns 409", async ({
    page,
    request,
  }) => {
    const adminToken = await adminLogin(request);
    const c = await createCandidate(request, adminToken, "exh");
    const examId = await createExamForTest(request, adminToken, {
      title: "Exhaust",
      maxAttempts: 2,
    });
    await api(
      request,
      "POST",
      `/api/exams/${examId}/enrollments`,
      { candidateIds: [c.profileId] },
      adminToken,
    );

    const cToken = await getCandidateToken(request, c);
    await startAndSubmit(request, cToken, examId);
    await startAndSubmit(request, cToken, examId);

    const reject = await api(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      cToken,
    );
    expect(reject.status).toBe(409);
    const errBody = reject.body as Record<string, unknown>;
    const err = errBody.error as Record<string, unknown> | undefined;
    expect(String(err?.code ?? "")).toBe("MAX_ATTEMPTS_REACHED");

    await loginAs(page, c.username, c.password);
    await page.waitForTimeout(2000);
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).not.toBeVisible();
    await expect(page.getByText("次数已用完")).toBeVisible();
  });
});
