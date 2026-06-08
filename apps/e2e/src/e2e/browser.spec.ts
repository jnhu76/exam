import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("shows login page at root URL", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /登录/ })).toBeVisible();
  });

  test("login with valid admin credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("wrong-password");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page.getByText(/用户名或密码错误/)).toBeVisible();
  });

  test("login redirects to exam list for candidate role", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("candidate1");
    await page.getByPlaceholder(/密码/).fill("candidate123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/exam\/list/, { timeout: 10_000 });
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });

    await page.getByRole("button", { name: /退出/ }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated access to admin redirects to login", async ({
    page,
  }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test("unauthenticated access to exam redirects to login", async ({
    page,
  }) => {
    await page.goto("/exam/list");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});

test.describe("Admin Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });
  });

  test("dashboard page loads with stats", async ({ page }) => {
    await expect(page.getByText(/仪表盘/)).toBeVisible();
  });

  test("navigate to courses page", async ({ page }) => {
    await page.getByRole("link", { name: /课程管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/courses/);
  });

  test("navigate to questions page", async ({ page }) => {
    await page.getByRole("link", { name: /题目管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/questions/);
  });

  test("navigate to exams page", async ({ page }) => {
    await page.getByRole("link", { name: /考试管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/exams/);
  });

  test("navigate to users page", async ({ page }) => {
    await page.getByRole("link", { name: /用户管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/users/);
  });

  test("navigate to candidates page", async ({ page }) => {
    await page.getByRole("link", { name: /考生管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/candidates/);
  });
});

test.describe("Admin CRUD - Courses", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });
    await page.getByRole("link", { name: /课程管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/courses/);
  });

  test("create a new course", async ({ page }) => {
    await page.getByRole("button", { name: /新建|添加|新增/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const inputs = dialog.locator("input");
    await inputs.first().fill("Playwright Test Course");
    await dialog.getByRole("button", { name: /确定|保存|创建/ }).click();
    await expect(page.getByText("Playwright Test Course")).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("Admin CRUD - Users", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });
    await page.getByRole("link", { name: /用户管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/users/);
  });

  test("users page loads with table", async ({ page }) => {
    await expect(page.locator("table")).toBeVisible();
  });

  test("open create user dialog", async ({ page }) => {
    await page.getByRole("button", { name: /新建|添加|新增/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
  });
});

test.describe("Candidate Exam Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("candidate1");
    await page.getByPlaceholder(/密码/).fill("candidate123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/exam\/list/, { timeout: 10_000 });
  });

  test("exam list page shows available exams", async ({ page }) => {
    await expect(page.locator("table, [data-testid=exam-list]")).toBeVisible();
  });

  test("exam list page has correct heading", async ({ page }) => {
    await expect(page.getByText(/我的考试/)).toBeVisible();
  });

  test("candidate cannot access admin routes", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});

test.describe("Exam Lifecycle - Admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 10_000 });
  });

  test("navigate to exam detail from list", async ({ page }) => {
    await page.getByRole("link", { name: /考试管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/exams/);
    const firstExam = page.locator("table tbody tr").first();
    if ((await firstExam.count()) > 0) {
      await firstExam.getByRole("link").first().click();
      await expect(page).toHaveURL(/\/admin\/exams\/[^/]+/);
    }
  });

  test("create exam page loads form", async ({ page }) => {
    await page.getByRole("link", { name: /考试管理/ }).click();
    await page.getByRole("link", { name: /新建|创建/ }).click();
    await expect(page).toHaveURL(/\/admin\/exams\/new/);
  });

  test("questions page loads", async ({ page }) => {
    await page.getByRole("link", { name: /题目管理/ }).click();
    await expect(page).toHaveURL(/\/admin\/questions/);
    await expect(page.locator("table")).toBeVisible();
  });
});
