import { createServer } from "node:http";

import { expect, test, type Page } from "@playwright/test";

import { loginViaUi } from "../lib/login";

const CANARY_PASSWORD = "e2e-redaction-canary-7c1f4a9e";

interface LoginPageOptions {
  buttonLabel?: string;
  requestBody?: string;
  contentType?: string;
  hang?: boolean;
}

function loginPageHtml(options: LoginPageOptions = {}): string {
  const buttonLabel = options.buttonLabel ?? "登录";
  const contentType = options.contentType ?? "application/json";
  const bodyExpression =
    options.requestBody === undefined
      ? `JSON.stringify({
          username: document.getElementById("username").value,
          password: document.getElementById("password").value,
        })`
      : JSON.stringify(options.requestBody);
  const submitScript = options.hang
    ? `
      async function submitLogin() {
        for (const element of document.querySelectorAll("input, button")) {
          element.disabled = true;
        }
        await new Promise(() => {});
      }
    `
    : `
      async function submitLogin() {
        for (const element of document.querySelectorAll("input, button")) {
          element.disabled = true;
        }
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": ${JSON.stringify(contentType)} },
          body: ${bodyExpression},
        });
        const alert = document.querySelector("[role=alert]");
        alert.hidden = false;
        alert.textContent =
          response.status === 401 ? "用户名或密码错误" : "unexpected status";
      }
    `;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <div data-testid="login-layout">
      <label>用户名 <input id="username" autocomplete="username" /></label>
      <label>密码 <input id="password" type="password" autocomplete="current-password" /></label>
      <button type="button" onclick="submitLogin()">${buttonLabel}</button>
      <div role="alert" hidden></div>
    </div>
    <script>${submitScript}</script>
  </body>
</html>`;
}

async function installLoginPage(
  page: Page,
  options: LoginPageOptions = {},
): Promise<void> {
  await page.route(
    (url) => url.pathname === "/login",
    async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: loginPageHtml(options),
      });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/auth/login",
    async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "AUTH_INVALID_CREDENTIALS",
            message: "Invalid credentials",
            requestId: "e2e-login-diagnostics",
          },
        }),
      });
    },
  );
}

async function captureDiagnostic(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the login helper to fail");
}

test("failed login diagnostics redact request credentials", async ({
  page,
}) => {
  await installLoginPage(page);

  const diagnostic = await captureDiagnostic(() =>
    loginViaUi(page, "redaction-probe", CANARY_PASSWORD),
  );

  expect(diagnostic).toContain("Login response was 401");
  expect(diagnostic).toContain("POST");
  expect(diagnostic).toContain("/api/auth/login");
  expect(diagnostic).toContain("alert=用户名或密码错误");
  expect(diagnostic).toContain("redaction-probe");
  expect(diagnostic).not.toContain(CANARY_PASSWORD);
  expect(diagnostic).toContain("[redacted]");
  await expect(page.getByLabel(/密码/)).toHaveValue("");
});

test.describe("action failure", () => {
  test.use({ actionTimeout: 1_000 });

  test("clears the password when the submit action fails", async ({ page }) => {
    await installLoginPage(page, { buttonLabel: "Sign in" });

    const diagnostic = await captureDiagnostic(() =>
      loginViaUi(page, "click-probe", CANARY_PASSWORD),
    );

    expect(diagnostic).toContain("locator.click");
    await expect(page.getByLabel(/密码/)).toHaveValue("");
  });
});

test.describe("never-settling submit", () => {
  test.slow();

  test("clears the password when the submit handler never settles", async ({
    page,
  }) => {
    await installLoginPage(page, { hang: true });

    const diagnostic = await captureDiagnostic(() =>
      loginViaUi(page, "hung-probe", CANARY_PASSWORD),
    );

    expect(diagnostic).toContain("Login did not produce an auth response");
    expect(diagnostic).not.toContain(CANARY_PASSWORD);
    await expect(page.getByLabel(/密码/)).toHaveValue("");
  });
});

test("clears the password when the response body stalls", async ({
  browser,
}) => {
  test.setTimeout(10_000);

  const server = createServer((request, response) => {
    if (request.url === "/login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(loginPageHtml());
      return;
    }
    if (request.url === "/api/auth/login") {
      response.writeHead(401, { "content-type": "application/json" });
      response.write('{"error":');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP address for the stalled body");
  }

  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${address.port}`,
  });
  const page = await context.newPage();
  try {
    const diagnostic = await captureDiagnostic(() =>
      loginViaUi(page, "stall-probe", CANARY_PASSWORD),
    );

    expect(diagnostic).toContain("Login response was 401");
    expect(diagnostic).toContain("alert=用户名或密码错误");
    expect(diagnostic).not.toContain(CANARY_PASSWORD);
    await expect(page.getByLabel(/密码/)).toHaveValue("");
  } finally {
    await context.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

for (const testCase of [
  {
    name: "non-JSON",
    body: `raw-${CANARY_PASSWORD}`,
    contentType: "text/plain",
    placeholder: "[unparseable body omitted]",
  },
  {
    name: "non-object JSON",
    body: JSON.stringify([CANARY_PASSWORD]),
    contentType: "application/json",
    placeholder: "[non-object body omitted]",
  },
]) {
  test(`omits ${testCase.name} request bodies from diagnostics`, async ({
    page,
  }) => {
    await installLoginPage(page, {
      requestBody: testCase.body,
      contentType: testCase.contentType,
    });

    const diagnostic = await captureDiagnostic(() =>
      loginViaUi(page, "body-probe", CANARY_PASSWORD),
    );

    expect(diagnostic).toContain(testCase.placeholder);
    expect(diagnostic).not.toContain(CANARY_PASSWORD);
    await expect(page.getByLabel(/密码/)).toHaveValue("");
  });
}
