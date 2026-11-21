import {
  expect,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

const LOGIN_TIMEOUT_MS = 15_000;
const DIAGNOSTIC_READ_TIMEOUT_MS = 1_000;
const REDACTED = "[redacted]";
const SENSITIVE_AUTH_BODY_KEY =
  /password|token|cookie|authorization|auth|secret/i;

function isObservedAuthUrl(url: string): boolean {
  return url.includes("auth") || url.includes("login");
}

/** Recursively redacts credential-named fields in a parsed request body. */
function redactAuthBodyValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= 5) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((item) => redactAuthBodyValue(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_AUTH_BODY_KEY.test(key)
      ? REDACTED
      : redactAuthBodyValue(item, depth + 1);
  }
  return result;
}

/**
 * Returns a diagnostic-safe rendering of an observed auth request body.
 *
 * INVARIANT: the raw bytes never reach the error message. Credential-named
 * fields are redacted recursively; bodies whose shape is unknown are omitted
 * instead of risking a credential under an unrecognized key.
 *
 * This does not import the canonical client-event sanitizer: the production
 * transport rehearsal runs Playwright from the source checkout without
 * building workspace package dists, so a runtime `@exam/contracts` import
 * fails there. The denylist mirrors that sanitizer's credential-key subset;
 * keep the two aligned.
 */
function redactAuthRequestBody(postData: string | null): string {
  if (!postData) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(postData);
  } catch {
    return "[unparseable body omitted]";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "[non-object body omitted]";
  }
  return JSON.stringify(redactAuthBodyValue(parsed));
}

/**
 * Clears every password input without Playwright actionability checks.
 *
 * Playwright's automatic failure artifact includes a page snapshot; a filled
 * password field would be serialized there. `fill("")` waits for an enabled,
 * visible element and would hang when the app disables the form while a login
 * request is in flight, so use the native value setter and dispatch `input`
 * (React's controlled-input contract) instead.
 */
async function clearPasswordInputs(page: Page): Promise<void> {
  await page
    .locator('input[type="password"]')
    .evaluateAll((inputs) => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      for (const input of inputs) {
        valueSetter?.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    })
    .catch(() => {});
}

async function buildLoginError(
  page: Page,
  username: string,
  title: string,
  observed: string[],
  pendingLogs: Promise<void>[],
): Promise<Error> {
  // Clear before awaiting response-log promises: a response can send headers
  // and then stall its body, which would otherwise keep the password in the
  // DOM until Playwright's test timeout snapshot.
  await clearPasswordInputs(page);
  await Promise.allSettled(pendingLogs);
  const alertText = await page
    .getByRole("alert")
    .textContent({ timeout: DIAGNOSTIC_READ_TIMEOUT_MS })
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
 * Shared post-login URL patterns used by the role-specific login helpers.
 * The application resolves each staff role through the centralized
 * capability-backed landing helper.
 */
const CANDIDATE_LANDING = /\/exam\/list(?:$|[/?#])/;
const ADMIN_LANDING = /\/admin\/dashboard(?:$|[/?#])/;
/**
 * Teacher lands on its first permitted console surface. Per `adminLandingPath`
 * (capabilities.ts): Teacher lacks SystemHealthView (dashboard), ExamRoomView
 * (proctor), GradingQueueView (grading); its first match is `canSeeExams`
 * (ExamView) → /admin/exams. This is the capability-union landing, not a
 * role-string shortcut.
 */

export async function loginViaUi(
  page: Page,
  username: string,
  password: string,
  expectedUrl: RegExp = CANDIDATE_LANDING,
): Promise<void> {
  const observed: string[] = [];
  const pendingLogs: Promise<void>[] = [];
  let succeeded = false;

  const onRequest = (req: Request) => {
    if (!isObservedAuthUrl(req.url())) return;
    observed.push(
      `[request] ${req.method()} ${req.url()} body=${redactAuthRequestBody(
        req.postData(),
      )}`,
    );
  };

  const onResponse = (res: Response) => {
    if (!isObservedAuthUrl(res.url())) return;
    pendingLogs.push(
      (async () => {
        const text = await Promise.race([
          res.text(),
          new Promise<string>((resolve) =>
            setTimeout(
              () => resolve("[response body unavailable]"),
              DIAGNOSTIC_READ_TIMEOUT_MS,
            ),
          ),
        ]).catch(() => "");
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

    succeeded = true;
  } finally {
    // A failed login can leave the filled password in the DOM; Playwright's
    // failure artifact snapshots that value. Clear on every non-success exit,
    // including action failures that bypass buildLoginError.
    if (!succeeded) await clearPasswordInputs(page);
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}

/**
 * Log in as the demo-seed admin (admin/admin123 by default) and land on the
 * admin dashboard. Used by E2E specs that drive the admin UI.
 */
export async function loginAsAdmin(
  page: Page,
  username: string = process.env.E2E_ADMIN_USERNAME ?? "admin",
  password: string = process.env.E2E_ADMIN_PASSWORD ?? "admin123",
): Promise<void> {
  await loginViaUi(page, username, password, ADMIN_LANDING);
}
