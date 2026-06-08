import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("shows login page at root URL", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /登录/ })).toBeVisible();
  });

  test("login with valid admin credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("wrong-password");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  });

  test("login redirects to exam list for candidate role", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("candidate1");
    await page.getByPlaceholder(/密码/).fill("candidate123");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await page.waitForURL(/\/exam\/list/, { timeout: 15_000 });
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });
    await page.getByRole("button", { name: /退出/ }).click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated access to admin redirects to login", async ({
    page,
  }) => {
    await page.goto("/admin/dashboard");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated access to exam redirects to login", async ({
    page,
  }) => {
    await page.goto("/exam/list");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});
