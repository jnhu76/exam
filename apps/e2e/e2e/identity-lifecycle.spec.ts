import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Staff invitation product loop through the real UI: Admin invites →
 * one-time acceptance link → logout → accept form → new account logs in.
 * The one-time link is surfaced by the InvitationsCard exactly once (the
 * server stores only the token hash), which is what makes the loop drivable
 * without an SMTP server.
 *
 * The full request→email→consume loop and the fail-closed acceptance/reset
 * states are owned by apps/api/src/routes/identityLifecycle.test.ts and the
 * page component tests.
 */

test.describe("staff invitation end to end", () => {
  test("admin invites → accept link → account activates → new staff logs in", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `e2e-invite-${stamp}@example.com`;
    const username = `e2e-invited-${stamp}`;
    const password = "Invited#2026";

    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/users`);

    // Open the invitations panel dialog.
    await page.getByRole("button", { name: "邀请成员" }).click();
    await page.getByLabel("邮箱地址").fill(email);
    await page.getByRole("dialog").getByRole("combobox").click();
    await page.getByRole("option", { name: "教师" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "发送邀请" })
      .click();

    // The one-time acceptance URL appears in the dialog.
    const urlField = page.getByTestId("invite-one-time-url").locator("input");
    await expect(urlField).toBeVisible();
    const acceptUrl = await urlField.inputValue();
    expect(acceptUrl).toContain("/invite/accept?token=");

    // Session is dropped: the token-carrier URL must work while logged out.
    await page.request.delete(`${BASE_URL}/api/auth/logout`).catch(() => {});
    await page.context().clearCookies();
    await page.goto(acceptUrl);

    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("姓名", { exact: true }).fill("受邀教师");
    await page.getByLabel("设置密码", { exact: true }).fill(password);
    await page.getByLabel("确认密码").fill(password);
    await page.getByRole("button", { name: "激活账号" }).click();
    await expect(page.getByTestId("invite-accept-success")).toBeVisible();

    // The new staff account logs in through the real login flow.
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    // A Teacher lands on the capability-driven console surface.
    await page.waitForURL(/\/admin\/exams(?:$|[/?#])/, {
      timeout: 15_000,
    });
  });
});
