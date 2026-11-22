import { expect, test, type Page } from "@playwright/test";

import { loginViaUi } from "../lib/login";

/**
 * #1079 WP-01 — logout revocation fail-closed, browser↔server composition.
 *
 * Material invariant owned here: when the server cannot durably revoke the
 * credential epoch (503 AUTHZ_UNAVAILABLE), the browser must NOT be driven
 * into the logged-out state — the session stays, the failure is visible as
 * a code-keyed toast, and the auth-token cookie survives so the retry can
 * complete the revocation. Route interception of the single POST models the
 * PG outage; the login, cookie lifecycle, SPA navigation, and the recovery
 * retry all run against the real API.
 */

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin123";

// The mock server message is deliberately DISTINCT from the zh-CN i18n
// copy asserted below, so the visible toast proves the browser resolved
// the copy through the error code (message contract Zone A), not through
// server-prose passthrough.
const FAILING_LOGOUT_BODY = JSON.stringify({
  error: {
    code: "AUTHZ_UNAVAILABLE",
    message: "server compatibility prose - not user copy",
    requestId: "e2e-logout-revocation-failure",
  },
});

async function logoutViaSidebar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "退出登录" }).first().click();
}

test("failed logout keeps the session visible and the retry completes it", async ({
  page,
}) => {
  await loginViaUi(page, "admin", ADMIN_PASSWORD, /\/admin\/dashboard/);

  // Model the revocation-store outage: only the logout POST fails.
  await page.route(
    (url) => url.pathname === "/api/auth/logout",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: FAILING_LOGOUT_BODY,
      }),
  );

  await logoutViaSidebar(page);

  // The failure is visible where logout was triggered (code-keyed i18n copy).
  await expect(
    page.getByText("授权服务暂不可用，请稍后重试").first(),
  ).toBeVisible();

  // No fake success: the admin surface survives (no redirect to /login) and
  // the auth-token cookie was not cleared by the client.
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  const cookiesAfterFailure = await page.context().cookies();
  const authToken = cookiesAfterFailure.find(
    (cookie) => cookie.name === "auth-token",
  );
  expect(authToken).toBeDefined();

  // Store recovers: the user-initiated retry now completes the revocation
  // and lands on /login with the cookie cleared by the server.
  await page.unrouteAll({ behavior: "wait" });
  await logoutViaSidebar(page);

  await expect(page).toHaveURL(/\/login/);
  const cookiesAfterRetry = await page.context().cookies();
  expect(
    cookiesAfterRetry.find((cookie) => cookie.name === "auth-token"),
  ).toBeUndefined();
});
