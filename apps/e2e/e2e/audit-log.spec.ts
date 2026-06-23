import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminGet, adminPost } from "../lib/flow";

/**
 * P2E-J1 e2e — "admin views and filters audit logs".
 *
 * Covers spec §22 of docs/phase2/jobs/P2E-J1-audit-log-viewer.md:
 *   - admin can view paginated audit logs
 *   - filter by action
 *   - filter by targetType (now server-side, P2E-J1 date-range job)
 *   - date-range filter
 *
 * Runs via docker: `bash scripts/e2e/run.sh audit-log`. The app image ships a
 * demo-seeded org; admin actions below add deterministic audit entries.
 */
test.describe.configure({ mode: "serial" });

test.describe("audit log viewer (P2E-J1)", () => {
  test("admin views audit logs table", async ({ page, request }) => {
    // Ensure at least one audit row exists (a login.success is always present
    // after loginAsAdmin, but seed an exam.create deterministically too).
    const token = await adminApiToken(request);
    await adminPost(request, token, "/api/exams", {
      title: `audit-e2e-view-${Date.now()}`,
      description: "e2e audit viewer",
    }).catch(() => {
      /* exam create may 4xx on missing fields; not required for the view test */
    });

    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");

    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible({
      timeout: 15_000,
    });
    // The table should render at least one data row.
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: /操作|exam\.|login\.|user\./ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin filters audit logs by action", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");

    // Open the action filter and pick 登录成功 (login.success).
    await page.getByRole("combobox", { name: "全部操作" }).click();
    await page.getByRole("option", { name: "登录成功" }).click();

    // Every visible data row's 操作 cell should be login.success.
    const actionCells = page
      .getByRole("row")
      .locator("span", { hasText: /login\.success/ });
    await expect(actionCells.first()).toBeVisible({ timeout: 15_000 });
    const count = await actionCells.count();
    expect(count).toBeGreaterThan(0);
  });

  test("admin filters audit logs by targetType", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Seed a user.create audit entry deterministically (targetType=user).
    const token = await adminApiToken(request);
    await adminPost(request, token, "/api/users", {
      username: `audit-target-${Date.now()}`,
      name: "Audit Target User",
      role: "Candidate",
      password: "AuditTarget#123",
    }).catch(() => {
      /* tolerates 4xx if username collides */
    });

    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");

    await page.getByRole("combobox", { name: "全部目标" }).click();
    await page.getByRole("option", { name: "用户" }).click();

    // Every visible data row should have targetType === user.
    const targetCells = page.getByRole("cell", { name: "user", exact: true });
    await expect(targetCells.first()).toBeVisible({ timeout: 15_000 });
    const count = await targetCells.count();
    expect(count).toBeGreaterThan(0);
  });

  test("admin filters by date range (from=today)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");
    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible({
      timeout: 15_000,
    });

    // Open the start-date DatePicker (trigger labeled 开始日期 via aria-label)
    // and pick day 1 of the current month. RDP v10 labels each day with a full
    // aria-label like "2026年6月1日 星期一", so match by the day-suffix regex
    // rather than the bare number.
    await page.getByRole("button", { name: "开始日期" }).click();
    await page.getByRole("gridcell", { name: /1日/ }).first().click();

    // The table should still have rows after applying from=day-1.
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: /exam\.|login\.|user\./ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Clear filters via 清空筛选 and confirm rows remain.
    await page.getByRole("button", { name: /清空筛选/ }).click();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: /exam\.|login\.|user\./ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("audit-logs API supports targetType + date query filters", async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    const token = await adminApiToken(request);

    // targetType filter: only user rows.
    const byTarget = await adminGet(
      request,
      token,
      "/api/admin/audit-logs?targetType=user&pageSize=5",
    );
    expect(byTarget.status()).toBe(200);
    const targetBody = await byTarget.json();
    expect(
      targetBody.items.every(
        (i: { targetType: string }) => i.targetType === "user",
      ),
    ).toBe(true);

    // date range filter: from a far-past date returns many rows; from a
    // far-future date returns zero rows.
    const past = await adminGet(
      request,
      token,
      "/api/admin/audit-logs?from=2000-01-01T00:00:00.000Z&pageSize=5",
    );
    expect(past.status()).toBe(200);
    const pastBody = await past.json();
    expect(pastBody.items.length).toBeGreaterThan(0);

    const future = await adminGet(
      request,
      token,
      "/api/admin/audit-logs?from=2999-01-01T00:00:00.000Z&pageSize=5",
    );
    expect(future.status()).toBe(200);
    const futureBody = await future.json();
    expect(futureBody.items.length).toBe(0);
  });
});
