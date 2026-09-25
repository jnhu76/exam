import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { candidateLoginApi, candidateStartAttempt } from "../lib/flow";

// Admin-persona monitor-page composition. The proctor persona of the same
// page (forbidden-nav absence, role landing) is owned by proctor-landing
// spec; route-level authorization (who may call the proctor attempt reads)
// is owned by apps/api/src/authz/permissionMatrix.proctor.test.ts and
// apps/api/src/routes/proctorAuthorization.e2e.test.ts and is deliberately
// not duplicated here.
test.describe("Proctor Monitoring UI E2E", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: ReturnType<typeof seedExam> extends Promise<infer R> ? R : never;

  test.beforeAll(async ({ request }) => {
    const unique = `monitor-ui-${Date.now()}`;
    seeded = await seedExam(request, unique);

    const candidateToken = await candidateLoginApi(
      request,
      (seeded as any).candidate.username,
      (seeded as any).candidate.password,
    );
    // The live in_progress attempt is what the monitor page renders.
    await candidateStartAttempt(
      request,
      candidateToken,
      (seeded as any).examId,
    );
  });

  test("monitoring page shows active candidate with status and online badge", async ({
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

    await expect(page.getByText("答题中")).toBeVisible();
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
});
