import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";

/**
 * Production-mode LAN HTTP transport regression — BROWSER-VISIBLE.
 *
 * The original defect (production forced `Secure` on the auth cookie, so
 * browsers discarded it on plain-HTTP non-localhost origins and every
 * login bounced back to /login) was invisible to config assertions,
 * header checks, and the host-native E2E stack: `http://localhost` is a
 * browser secure context where `Secure` cookies are accepted anyway. This
 * spec therefore runs ONLY against a real production-mode HTTP deployment
 * (the production Compose stack rehearsed from this checkout), reached
 * through a NON-localhost hostname mapped to 127.0.0.1 via the browser's
 * host-resolver-rules (E2E_HOST_MAP in playwright.config.ts).
 *
 * Invocation (docs/deployment runbook §11 "Production transport
 * rehearsal"):
 *
 *   E2E_BASE_URL=http://exam.test:<EXAM_PORT> \
 *   E2E_HOST_MAP=exam.test=127.0.0.1 \
 *   E2E_PROD_LAUNCHPAD_TOKEN=<the stack's LAUNCHPAD_SETUP_TOKEN> \
 *   pnpm --filter @exam/e2e exec playwright test production-lan-http
 *
 * Skipped unless E2E_PROD_LAUNCHPAD_TOKEN is set — the host-native E2E
 * stack (APP_MODE=e2e) cannot exercise this contract by construction.
 */
const setupToken = process.env.E2E_PROD_LAUNCHPAD_TOKEN ?? "";

test.skip(
  !setupToken,
  "production-transport rehearsal only: requires a production-mode HTTP deployment (E2E_PROD_LAUNCHPAD_TOKEN + E2E_BASE_URL + E2E_HOST_MAP)",
);

const ADMIN_USERNAME = "transport-admin";
const ADMIN_PASSWORD = "transport-lan-http-2026";

test("production LAN HTTP: browser persists the non-Secure auth cookie and authenticated requests succeed", async ({
  page,
  request,
}) => {
  const publicOrigin = process.env.E2E_BASE_URL;
  expect(
    publicOrigin,
    "E2E_BASE_URL must name the deployment's canonical public origin (non-localhost for this rehearsal)",
  ).toBeDefined();
  expect(new URL(publicOrigin!).protocol).toBe("http:");
  expect(new URL(publicOrigin!).hostname).not.toBe("localhost");
  expect(new URL(publicOrigin!).hostname).not.toBe("127.0.0.1");

  // First-Admin bootstrap (idempotent across re-runs: a completed
  // installation answers 409 LAUNCHPAD_ALREADY_INITIALIZED). Server-side
  // requests bypass the browser's host-resolver-rules mapping, so target
  // the published loopback port directly; the Origin must still be the
  // CANONICAL public origin — production CSRF enforcement rejects
  // anything else.
  const parsed = new URL(publicOrigin!);
  const loopbackBase = `http://127.0.0.1${parsed.port ? `:${parsed.port}` : ""}`;
  const bootstrap = await request.post(
    `${loopbackBase}/api/launchpad/bootstrap`,
    {
      headers: { origin: publicOrigin! },
      data: {
        organizationName: "Transport Rehearsal Organization",
        adminUsername: ADMIN_USERNAME,
        adminPassword: ADMIN_PASSWORD,
        adminName: "Transport Admin",
        setupToken,
      },
    },
  );
  expect(
    [200, 409],
    `bootstrap failed: ${bootstrap.status()} ${await bootstrap.text()}`,
  ).toContain(bootstrap.status());

  // Real browser login over the plain-HTTP non-localhost origin. The
  // original defect strands the flow on /login here: the browser discards
  // a Secure auth cookie, the SPA never obtains a session, and the
  // /admin/dashboard navigation never happens.
  await loginAsAdmin(page, ADMIN_USERNAME, ADMIN_PASSWORD);

  // The cookie state the browser actually persisted.
  const cookies = await page.context().cookies();
  const authCookie = cookies.find((cookie) => cookie.name === "auth-token");
  expect(
    authCookie,
    "auth-token cookie must be persisted by the browser",
  ).toBeDefined();
  expect(authCookie!.secure).toBe(false);
  expect(authCookie!.httpOnly).toBe(true);
  expect(authCookie!.sameSite).toBe("Strict");

  // Authenticated roundtrip from the page origin: the persisted cookie is
  // sent, accepted, and resolves the profile — not merely "Set-Cookie
  // existed".
  const me = await page.evaluate(async () => {
    const res = await fetch("/api/auth/me");
    return { status: res.status, body: (await res.json()) as unknown };
  });
  expect(me.status).toBe(200);
  expect(me.body).toMatchObject({ username: ADMIN_USERNAME });
});
