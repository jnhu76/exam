import { test as setup } from "@playwright/test";

const adminAuthFile = "src/e2e/.auth/admin.json";
const candidateAuthFile = "src/e2e/.auth/candidate.json";

setup("authenticate as admin", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder(/用户名/).fill("admin");
  await page.getByPlaceholder(/密码/).fill("admin123");
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });
  await page.context().storageState({ path: adminAuthFile });
});

setup("authenticate as candidate", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder(/用户名/).fill("candidate1");
  await page.getByPlaceholder(/密码/).fill("candidate123");
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/exam\/list/, { timeout: 15_000 });
  await page.context().storageState({ path: candidateAuthFile });
});
