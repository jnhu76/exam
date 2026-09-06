/**
 * P7-M — Exam Policy Profile management product path E2E.
 *
 * Proves the user-facing Profile CRUD loop through SUPPORTED product
 * interfaces: Admin logs in via the real /login UI, navigates to 策略模板,
 * creates a profile through the rendered editor, sees it in the list, edits
 * it, and deletes it (with the COPY-ON-APPLY safety wording present in the
 * confirmation dialog). API setup is used only for prerequisite data
 * (course); the profile mutations travel through the browser UI.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("P7-M exam profile management product path", () => {
  test("admin creates, edits, and deletes a profile through the UI", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // Navigate to the profile list via the sidebar nav.
    await page.getByRole("link", { name: "策略模板" }).click();
    await expect(page).toHaveURL(/\/admin\/exam-profiles(?:$|[/?#])/);
    await expect(
      page.getByRole("heading", { name: "策略模板", exact: true }),
    ).toBeVisible();

    // Open the create editor. The button appears both in the header actions
    // and in the empty-state action; either one leads to the editor.
    await page.getByRole("button", { name: "新建模板" }).first().click();
    await expect(page).toHaveURL(/\/admin\/exam-profiles\/new(?:$|[/?#])/);

    const profileName = `E2E模板-${Date.now()}`;
    await page.getByLabel("模板名称").fill(profileName);
    await page.getByLabel("考试时长（分钟）").fill("45");

    // Switch retake policy to max_attempts so the maxAttempts input appears.
    await page.getByRole("combobox", { name: "重考策略" }).click();
    await page.getByRole("option", { name: "限制次数" }).click();
    await page.getByLabel("最大尝试次数").fill("3");

    // Switch interruption policy to bounded_grace so grace caps appear.
    await page.getByRole("combobox", { name: "中断恢复策略" }).click();
    await page.getByRole("option", { name: "有限补时" }).click();

    const createResp = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/exam-profiles$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole("button", { name: "保存" }).click();
    const created = await createResp;
    expect(created.ok(), `create profile: ${created.status()}`).toBe(true);

    // Back on the list, the new row is visible with a human-readable summary.
    await expect(page).toHaveURL(/\/admin\/exam-profiles(?:$|[/?#])/);
    await expect(
      page
        .locator('[data-slot="responsive-desktop-region"]')
        .getByText(profileName),
    ).toBeVisible();
    // Summary shows duration + human labels (not raw enum codes).
    const row = page.getByRole("row").filter({ hasText: profileName }).first();
    await expect(row).toContainText("45");
    await expect(row).toContainText("最多");

    // Edit the profile: change the duration.
    await row.getByRole("button", { name: "编辑" }).click();
    await expect(page).toHaveURL(/\/admin\/exam-profiles\/[^/]+\/edit/);
    await page.getByLabel("考试时长（分钟）").fill("90");
    const updateResp = page.waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        /\/api\/exam-profiles\/[^/]+$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole("button", { name: "保存" }).click();
    const updated = await updateResp;
    expect(updated.ok(), `update profile: ${updated.status()}`).toBe(true);

    // The list now reflects 90 minutes.
    await expect(page).toHaveURL(/\/admin\/exam-profiles(?:$|[/?#])/);
    await expect(
      page.getByRole("row").filter({ hasText: profileName }).first(),
    ).toContainText("90");

    // Delete via the row action. The COPY-ON-APPLY safety wording MUST appear.
    await page
      .getByRole("row")
      .filter({ hasText: profileName })
      .first()
      .getByRole("button", { name: "删除" })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(/删除此模板不会影响/);
    const deleteResp = page.waitForResponse(
      (res) =>
        res.request().method() === "DELETE" &&
        /\/api\/exam-profiles\/[^/]+$/.test(new URL(res.url()).pathname),
    );
    await dialog.getByRole("button", { name: "确认删除" }).click();
    const deleted = await deleteResp;
    expect(deleted.ok(), `delete profile: ${deleted.status()}`).toBe(true);

    // Row is gone (desktop region scoping — the frame now wraps both
    // representations under the responsive owner, issue 457 C3).
    await expect(
      page
        .locator('[data-slot="responsive-desktop-region"]')
        .getByText(profileName),
    ).toHaveCount(0);
  });

  test("admin creates a profile from a starter recipe", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/exam-profiles/new`);

    await page.getByRole("button", { name: "从起步模板创建" }).click();
    const dialog = page.getByRole("dialog");
    // Two starter recipes are offered.
    await expect(dialog.getByText("基础测验")).toBeVisible();
    await expect(dialog.getByText("标准在线考试")).toBeVisible();

    // Use standard online → prefills the form.
    await dialog.getByRole("button", { name: "使用此模板" }).nth(1).click();

    // The form is now prefilled: duration 60, bounded_grace grace caps visible.
    await expect(page.getByLabel("考试时长（分钟）")).toHaveValue("60");
    await expect(page.getByLabel("每次中断补时上限（秒）")).toBeVisible();

    // Save it as a normal organization profile.
    const stamp = Date.now();
    await page.getByLabel("模板名称").fill(`E2E起步-${stamp}`);
    const createResp = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/exam-profiles$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole("button", { name: "保存" }).click();
    const created = await createResp;
    expect(created.ok()).toBe(true);
    await expect(page).toHaveURL(/\/admin\/exam-profiles(?:$|[/?#])/);
  });
});
