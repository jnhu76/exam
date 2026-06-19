import {
  expect,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

const LOGIN_TIMEOUT_MS = 15_000;

function isObservedAuthUrl(url: string): boolean {
  return url.includes("auth") || url.includes("login");
}

async function buildLoginError(
  page: Page,
  username: string,
  title: string,
  observed: string[],
  pendingLogs: Promise<void>[],
): Promise<Error> {
  await Promise.allSettled(pendingLogs);
  const alertText = await page
    .getByRole("alert")
    .textContent()
    .catch(() => "");
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  return new Error(
    [
      `${title} for ${username}`,
      `currentUrl=${page.url()}`,
      `alert=${alertText ?? ""}`,
      `observed=${observed.join("\n")}`,
      `body=${bodyText.slice(0, 1000)}`,
    ].join("\n"),
  );
}

/**
 * Default post-login URL each role lands on. Candidates go to /exam/list;
 * admins (and any non-Candidate role) go to /admin/dashboard
 * (apps/web/src/contexts/AuthContext.tsx: redirectAfterLogin).
 */
const CANDIDATE_LANDING = /\/exam\/list(?:$|[/?#])/;
const ADMIN_LANDING = /\/admin\/dashboard(?:$|[/?#])/;

export async function loginViaUi(
  page: Page,
  username: string,
  password: string,
  expectedUrl: RegExp = CANDIDATE_LANDING,
): Promise<void> {
  const observed: string[] = [];
  const pendingLogs: Promise<void>[] = [];

  const onRequest = (req: Request) => {
    if (!isObservedAuthUrl(req.url())) return;
    observed.push(
      `[request] ${req.method()} ${req.url()} body=${req.postData() ?? ""}`,
    );
  };

  const onResponse = (res: Response) => {
    if (!isObservedAuthUrl(res.url())) return;
    pendingLogs.push(
      (async () => {
        const text = await res.text().catch(() => "");
        observed.push(
          `[response] ${res.status()} ${res.url()} body=${text.slice(0, 500)}`,
        );
      })(),
    );
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  try {
    await page.context().clearCookies();
    await page.goto("/login");
    await page
      .evaluate("localStorage.clear(); sessionStorage.clear();")
      .catch(() => {});
    await page.goto("/login");
    await expect(page.getByTestId("login-layout")).toBeVisible({
      timeout: LOGIN_TIMEOUT_MS,
    });

    const loginResponsePromise = page
      .waitForResponse(
        (res) =>
          res.request().method() === "POST" && isObservedAuthUrl(res.url()),
        { timeout: LOGIN_TIMEOUT_MS },
      )
      .catch(() => null);

    const navigationPromise = page
      .waitForURL(expectedUrl, { timeout: LOGIN_TIMEOUT_MS })
      .then(() => "navigation" as const)
      .catch(() => null);

    const alertPromise = page
      .getByRole("alert")
      .waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS })
      .then(() => "alert" as const)
      .catch(() => null);

    await page.getByLabel(/用户名/).fill(username);
    await page.getByLabel(/密码/).fill(password);
    await page.getByRole("button", { name: /^登录$/ }).click();

    const firstSignal = await Promise.race([
      loginResponsePromise.then((res) => (res ? "response" : null)),
      navigationPromise,
      alertPromise,
    ]);

    if (!firstSignal) {
      throw await buildLoginError(
        page,
        username,
        `Login did not produce an auth response, alert, or ${expectedUrl} navigation`,
        observed,
        pendingLogs,
      );
    }

    const loginResponse = await loginResponsePromise;
    if (loginResponse && loginResponse.status() !== 200) {
      throw await buildLoginError(
        page,
        username,
        `Login response was ${loginResponse.status()}`,
        observed,
        pendingLogs,
      );
    }

    if (!expectedUrl.test(new URL(page.url()).pathname)) {
      await page.waitForURL(expectedUrl, { timeout: 5_000 }).catch(() => {});
    }

    if (!expectedUrl.test(new URL(page.url()).pathname)) {
      throw await buildLoginError(
        page,
        username,
        `Login failed to reach ${expectedUrl}`,
        observed,
        pendingLogs,
      );
    }
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}

/**
 * Log in as the demo-seed admin (admin/admin123 by default) and land on the
 * admin dashboard. Used by admin-flow E2E specs that drive the admin UI.
 */
export async function loginAsAdmin(
  page: Page,
  username: string = process.env.E2E_ADMIN_USERNAME ?? "admin",
  password: string = process.env.E2E_ADMIN_PASSWORD ?? "admin123",
): Promise<void> {
  await loginViaUi(page, username, password, ADMIN_LANDING);
}
