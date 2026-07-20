import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";
import { loginViaUi } from "../lib/login";
import { seedExam, type SeededExam } from "../lib/seed";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

interface ProctorCredentials {
  username: string;
  password: string;
}

async function createProctor(
  request: APIRequestContext,
  adminToken: string,
): Promise<ProctorCredentials> {
  const stamp = Date.now();
  const username = `e2e-proctor-${stamp}`;
  const password = "proctor123";
  const headers = { Cookie: `auth-token=${adminToken}` };
  // Create the user directly with role "Proctor". The POST /users route
  // creates the user AND its primary active assignment in ONE transaction
  // (RBAC-M10-E), so the resulting user has exactly ONE active assignment
  // (Proctor). Do NOT layer a secondary Teacher assignment on top — under
  // M10-E the runtime authority is the UNION of every active assignment, so
  // a Teacher+Proctor user would inherit Teacher's QuestionView and the
  // forbidden-nav assertion below would correctly fail (题目管理 would
  // appear). A pure Proctor user has only Proctor's preset (ExamRoomView +
  // Attempt*View/Mark/Extend/ForceSubmit), which excludes QuestionView,
  // CourseView, ExamView, ScoreAllView, and every management perm — exactly
  // what the forbidden-nav list asserts.
  const createResponse = await request.post(`${BASE_URL}/api/users`, {
    headers,
    data: {
      username,
      password,
      name: `E2E Proctor ${stamp}`,
      role: "Proctor",
    },
  });
  expect(createResponse.status()).toBe(201);
  return { username, password };
}

test.describe("Proctor landing workspace", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let proctor: ProctorCredentials;

  test.beforeAll(async ({ request }) => {
    seeded = await seedExam(request, `proctor-landing-${Date.now()}`);
    const adminToken = await adminApiToken(request);
    proctor = await createProctor(request, adminToken);
    const token = await candidateLoginApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    await candidateStartAttempt(request, token, seeded.examId);
  });

  test("Proctor logs in, discovers an exam, and opens monitoring with timeline", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const unexpectedResponses: string[] = [];

    const discoveryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/admin/proctor/exams",
    );
    await loginViaUi(
      page,
      proctor.username,
      proctor.password,
      /\/admin\/proctor(?:$|[/?#])/,
    );
    expect((await discoveryResponse).status()).toBe(200);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        unexpectedResponses.push(
          `${response.status()} ${new URL(response.url()).pathname}`,
        );
      }
    });
    await expect(
      page.getByRole("heading", { name: "监考工作台", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(seeded.examTitle)).toBeVisible();
    await expect(page.getByRole("link", { name: "监考工作台" })).toBeVisible();
    for (const forbidden of [
      "题目管理",
      "考试管理",
      "待评分",
      "成绩查询",
      "用户管理",
      "平台设置",
      "审计日志",
      "系统监控",
    ]) {
      await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
    }

    const monitoringResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname ===
          `/api/admin/exams/${seeded.examId}/proctor/attempts`,
    );
    const examRow = page.getByRole("row").filter({ hasText: seeded.examTitle });
    await examRow.getByRole("button", { name: "进入监考" }).click();
    await page.waitForURL(`**/admin/exams/${seeded.examId}/proctor/monitor`);
    expect((await monitoringResponse).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "考试监控", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(seeded.candidate.name)).toBeVisible();

    const timelineResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /\/api\/admin\/attempts\/[^/]+\/proctor-events$/.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "时间线" }).first().click();
    expect((await timelineResponse).status()).toBe(200);
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    const refreshResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname ===
          `/api/admin/exams/${seeded.examId}/proctor/attempts`,
    );
    await page.reload();
    expect((await refreshResponse).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "考试监控", level: 1 }),
    ).toBeVisible();
    expect(consoleErrors).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  });
});
