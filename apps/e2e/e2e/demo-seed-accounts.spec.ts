import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminLogin(
  request: import("@playwright/test").APIRequestContext,
) {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  return res.headers()["set-cookie"]!.match(/auth-token=([^;]+)/)![1];
}

async function api(
  request: import("@playwright/test").APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
  auth?: string,
) {
  const res = await request.fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Cookie: `auth-token=${auth}` } : {}),
    },
    data: data != null ? JSON.stringify(data) : undefined,
  });
  return { status: res.status(), body: await res.json() };
}

async function createCandidate(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  unique: string,
) {
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
    username: r.body.username as string,
    password: "candidate123",
    profileId: r.body.id as string,
    userId: r.body.userId as string,
  };
}

async function createExamForTest(
  request: import("@playwright/test").APIRequestContext,
  adminToken: string,
  opts: { title: string; maxAttempts: number; retakePolicy?: string },
) {
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
      courseId: course.body.id,
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
      courseId: course.body.id,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600000).toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [q.body.id],
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
    `/api/exams/${exam.body.id}/publish`,
    {},
    adminToken,
  );
  return exam.body.id as string;
}

async function loginAs(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
) {
  await page.goto("/login");
  await page.getByTestId("login-layout").waitFor({ state: "visible" });
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/exam/list", { timeout: 15_000 });
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
      {
        candidateIds: [c.profileId],
      },
      adminToken,
    );

    const cToken = (
      await api(request, "POST", "/api/auth/login", {
        username: c.username,
        password: c.password,
      })
    ).body.token;
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
      {
        candidateIds: [c.profileId],
      },
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
      {
        candidateIds: [c.profileId],
      },
      adminToken,
    );

    const cToken = (
      await api(request, "POST", "/api/auth/login", {
        username: c.username,
        password: c.password,
      })
    ).body.token;
    const startRes = await api(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      cToken,
    );
    await api(
      request,
      "POST",
      `/api/attempts/${startRes.body.id}/submit`,
      undefined,
      cToken,
    );

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
      {
        candidateIds: [c.profileId],
      },
      adminToken,
    );

    const cToken = (
      await api(request, "POST", "/api/auth/login", {
        username: c.username,
        password: c.password,
      })
    ).body.token;

    const a1 = await api(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      cToken,
    );
    await api(
      request,
      "POST",
      `/api/attempts/${a1.body.id}/submit`,
      undefined,
      cToken,
    );
    const a2 = await api(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      cToken,
    );
    await api(
      request,
      "POST",
      `/api/attempts/${a2.body.id}/submit`,
      undefined,
      cToken,
    );

    const reject = await api(
      request,
      "POST",
      `/api/attempts/${examId}/start`,
      undefined,
      cToken,
    );
    expect(reject.status).toBe(409);
    expect(reject.body.error.code).toBe("MAX_ATTEMPTS_REACHED");

    await loginAs(page, c.username, c.password);
    await page.waitForTimeout(2000);
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).not.toBeVisible();
    await expect(page.getByText("次数已用完")).toBeVisible();
  });
});
