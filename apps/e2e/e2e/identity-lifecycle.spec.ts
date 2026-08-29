import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Issue #297 — identity lifecycle E2E.
 *
 * Spec 1 drives the FULL invitation product loop through the real UI:
 * Admin invites → one-time acceptance link → logout → accept form → new
 * account logs in. The one-time link is surfaced by the InvitationsCard
 * exactly once (the server stores only the token hash), which is what makes
 * the loop drivable without an SMTP server.
 *
 * Spec 2 drives the password-reset pages to their truthful states. The reset
 * token exists ONLY in the delivered email body (durable outbox row); the
 * E2E environment deliberately has no SMTP or database transport (the
 * email fake never produces real mail), so the FULL request→email→consume
 * loop is covered by the API integration suite
 * (apps/api/src/routes/identityLifecycle.test.ts) against real PostgreSQL.
 * Here we prove the two public pages never lie: uniform confirmation for
 * unknown accounts, and one generic failure for an invalid token.
 */

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      username: process.env.E2E_ADMIN_USERNAME ?? "admin",
      password: process.env.E2E_ADMIN_PASSWORD ?? "admin123",
    },
  });
  if (!res.ok()) throw new Error(`admin login failed: ${res.status()}`);
  const raw = res.headers()["set-cookie"] ?? "";
  const match = raw.match(/auth-token=([^;]+)/);
  if (!match) throw new Error("no auth-token cookie in admin login response");
  return match[1] as string;
}

test.describe("staff invitation end to end (#297)", () => {
  test("admin invites → accept link → account activates → new staff logs in", async ({
    page,
    request,
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
    await loginAsTeacherNew(page, username, password);
  });

  async function loginAsTeacherNew(
    page: import("@playwright/test").Page,
    username: string,
    password: string,
  ) {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    // A Teacher lands on the capability-driven console surface.
    await page.waitForURL(/\/admin\/exams(?:$|[/?#])/, {
      timeout: 15_000,
    });
  }

  test("duplicate invitation acceptance fails closed with one generic error", async ({
    page,
    request,
  }) => {
    const token = await adminToken(request);
    const stamp = Date.now();
    const invite = await request.post(`${BASE_URL}/api/invitations`, {
      headers: { Cookie: `auth-token=${token}` },
      data: { email: `e2e-reused-${stamp}@example.com`, role: "Grader" },
    });
    expect(invite.ok()).toBeTruthy();
    const { acceptUrl } = (await invite.json()) as { acceptUrl: string };

    // First acceptance succeeds at the API boundary.
    const accept = await request.post(
      `${BASE_URL}/api/auth/invitations/accept`,
      {
        data: {
          token: new URL(acceptUrl).searchParams.get("token"),
          username: `e2e-reused-${stamp}`,
          name: "重复使用",
          password: "Invited#2026",
        },
      },
    );
    expect(accept.status()).toBe(201);

    // The same link, opened in the browser, now fails closed truthfully.
    await page.goto(acceptUrl);
    await page.getByLabel("用户名").fill(`e2e-reused-2-${stamp}`);
    await page.getByLabel("姓名", { exact: true }).fill("再次使用");
    await page.getByLabel("设置密码", { exact: true }).fill("Invited#2026");
    await page.getByLabel("确认密码").fill("Invited#2026");
    await page.getByRole("button", { name: "激活账号" }).click();
    await expect(page.getByRole("alert")).toContainText("邀请链接无效或已过期");
  });
});

test.describe("password reset pages (#297)", () => {
  test("forgot-password shows the same confirmation for unknown accounts", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByRole("link", { name: "忘记密码？" }).click();

    await page.getByLabel("用户名").fill("e2e-no-such-account");
    await page.getByRole("button", { name: "发送重置链接" }).click();
    await expect(page.getByTestId("forgot-password-sent")).toBeVisible();
    await expect(page.getByTestId("forgot-password-sent")).toContainText(
      "如果该账号存在且已绑定邮箱",
    );
  });

  test("reset-password with an invalid token fails closed truthfully", async ({
    page,
  }) => {
    await page.goto(
      `${BASE_URL}/reset-password?token=definitely-not-a-real-token`,
    );
    await page.getByLabel("新密码", { exact: true }).fill("Whatever#123");
    await page.getByLabel("确认新密码").fill("Whatever#123");
    await page.getByRole("button", { name: "重置密码" }).click();
    await expect(page.getByRole("alert")).toContainText("重置链接无效或已过期");
  });
});
