import { test, expect } from "@playwright/test";

test.describe("Admin Navigation", () => {
  test("dashboard page loads with heading", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 10_000 });
    await expect(page.locator("h1", { hasText: /仪表盘/ })).toBeVisible();
  });

  test("navigate to courses page", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /课程管理/ }).click();
    await page.waitForURL(/\/admin\/courses/, { timeout: 5_000 });
  });

  test("navigate to questions page", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /题目管理/ }).click();
    await page.waitForURL(/\/admin\/questions/, { timeout: 5_000 });
  });

  test("navigate to exams page", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /考试管理/ }).click();
    await page.waitForURL(/\/admin\/exams/, { timeout: 5_000 });
  });

  test("navigate to users page", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /用户管理/ }).click();
    await page.waitForURL(/\/admin\/users/, { timeout: 5_000 });
  });

  test("navigate to candidates page", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /考生管理/ }).click();
    await page.waitForURL(/\/admin\/candidates/, { timeout: 5_000 });
  });
});

test.describe("Admin Page Content", () => {
  test("questions page shows data table", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /题目管理/ }).click();
    await page.waitForURL(/\/admin\/questions/, { timeout: 5_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });
  });

  test("exams page shows data table", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /考试管理/ }).click();
    await page.waitForURL(/\/admin\/exams/, { timeout: 5_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table")).toBeVisible({ timeout: 10_000 });
  });

  test("users page renders", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /用户管理/ }).click();
    await page.waitForURL(/\/admin\/users/, { timeout: 5_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1", { hasText: /用户/ })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Candidate Exam Flow", () => {
  test.use({ storageState: "e2e/.auth/candidate.json" });

  test("candidate cannot access admin routes", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});
