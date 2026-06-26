import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Proctor Monitoring UI E2E", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: ReturnType<typeof seedExam> extends Promise<infer R> ? R : never;
  let adminToken: string;
  let candidateToken: string;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    const unique = `monitor-ui-${Date.now()}`;
    seeded = await seedExam(request, unique);

    adminToken = await adminApiToken(request);
    candidateToken = await candidateLoginApi(
      request,
      (seeded as any).candidate.username,
      (seeded as any).candidate.password,
    );
    attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      (seeded as any).examId,
    );
  });

  test("admin can navigate to monitoring page and see candidate status", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${(seeded as any).examId}/proctor/monitor`);
    await page.waitForURL("**/proctor/monitor**", { timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "考试监控", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText((seeded as any).candidate.name)).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText("考试中")).toBeVisible();
  });

  test("monitoring page shows online status badge for active candidate", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${(seeded as any).examId}/proctor/monitor`);
    await page.waitForURL("**/proctor/monitor**", { timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "考试监控", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    const statusBadge = page.getByText("在线");
    await expect(statusBadge.first()).toBeVisible({ timeout: 15_000 });
  });

  test("monitoring page shows heartbeat and save time columns", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${(seeded as any).examId}/proctor/monitor`);
    await page.waitForURL("**/proctor/monitor**", { timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "考试监控", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("最近心跳")).toBeVisible();
    await expect(page.getByText("最近保存")).toBeVisible();
    await expect(page.getByText("页面不可见")).toBeVisible();
    await expect(page.getByText("网络离线")).toBeVisible();
    await expect(page.getByText("保存失败")).toBeVisible();
  });

  test("timeline dialog opens when clicking the timeline button", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${(seeded as any).examId}/proctor/monitor`);
    await page.waitForURL("**/proctor/monitor**", { timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "考试监控", level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    const timelineBtn = page.getByRole("button", { name: "时间线" });
    await expect(timelineBtn.first()).toBeVisible({ timeout: 15_000 });
    await timelineBtn.first().click();

    await expect(page.getByText("事件时间线")).toBeVisible({ timeout: 10_000 });
  });

  test("non-admin candidate cannot access monitoring page", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/admin/exams/${(seeded as any).examId}/proctor/attempts`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(res.status()).toBe(403);
  });
});
