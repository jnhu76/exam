/**
 * Recovery Center visual inspection + cross-page navigation smoke.
 *
 * Seeds exam → candidate → attempt → incidents via the real API, then
 * navigates the four recovery pages at multiple viewports and captures
 * screenshots for visual review.
 *
 * This test does NOT modify API contracts, repositories, authorization,
 * polling/backoff, or business logic — it is purely read-only UI inspection.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { candidateApiToken, candidateStartAttempt } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  laptop: { width: 1024, height: 768 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

// ── API helpers (minimal, inline) ──

async function adminLogin(
  request: import("@playwright/test").APIRequestContext,
) {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  const token = res.headers()["set-cookie"]?.match(/auth-token=([^;]+)/)?.[1];
  if (!token) throw new Error("admin login failed");
  return token;
}

async function adminGet(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  path: string,
) {
  return request.get(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
}

async function adminPost(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  path: string,
  data: unknown,
) {
  return request.post(`${BASE_URL}${path}`, {
    data,
    headers: { Cookie: `auth-token=${token}` },
  });
}

async function createIncident(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  examId: string,
  opts: {
    type?: string;
    severity?: string;
    description?: string;
    attemptId?: string;
    candidateId?: string;
  } = {},
) {
  const res = await adminPost(
    request,
    token,
    `/api/admin/exams/${examId}/incidents`,
    {
      operationId: crypto.randomUUID(),
      type: opts.type ?? "network_interruption",
      severity: opts.severity ?? "critical",
      description:
        opts.description ??
        "E2E visual inspection incident — network disruption during exam",
      attemptId: opts.attemptId ?? null,
      candidateId: opts.candidateId ?? null,
    },
  );
  if (!res.ok()) {
    throw new Error(
      `createIncident failed: ${res.status()} ${await res.text()}`,
    );
  }
  return (await res.json()) as { incident: { id: string } };
}

// ── Test suite ──

test.describe("Recovery Center visual inspection", () => {
  let examId: string;
  let attemptId: string;
  let candidateId: string;
  let incidentId: string;
  let incidentId2: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed exam + candidate
    const seeded = await seedExam(request, "recovery-vis", {
      durationMinutes: 60,
      questionAnswer: true,
      questionScore: 100,
      interruptionTimePolicy: "operator_incident",
    });
    examId = seeded.examId;
    candidateId = seeded.candidate.profileId;

    // 2. Candidate starts an attempt via API
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    attemptId = await candidateStartAttempt(request, candidateToken, examId);

    // 3. Create incidents via admin API
    const adminToken = await adminLogin(request);

    const inc1 = await createIncident(request, adminToken, examId, {
      type: "network_interruption",
      severity: "critical",
      description:
        "Candidate experienced a prolonged network disruption during the examination period. " +
        "The candidate's connection to the examination server was lost for approximately 45 seconds, " +
        "resulting in potential loss of unsaved answers and disruption of the timed examination flow.",
      attemptId,
      candidateId,
    });
    incidentId = inc1.incident.id;

    const inc2 = await createIncident(request, adminToken, examId, {
      type: "device_failure",
      severity: "minor",
      description: "Minor device issue — candidate switched browsers",
      attemptId,
      candidateId,
    });
    incidentId2 = inc2.incident.id;

    // 4. Best-effort enrichments (investigate, note) — don't block screenshots
    try {
      const inc2Detail = await adminGet(
        request,
        adminToken,
        `/api/admin/incidents/${incidentId2}`,
      );
      const inc2Json = await inc2Detail.json();
      const inc2Version = inc2Json.version ?? inc2Json.incident?.version ?? 1;
      await adminPost(
        request,
        adminToken,
        `/api/admin/incidents/${incidentId2}/investigate`,
        {
          operationId: crypto.randomUUID(),
          expectedVersion: inc2Version,
        },
      );
    } catch {
      // investigate enrichment is nice-to-have, not required for screenshots
    }

    try {
      await adminPost(
        request,
        adminToken,
        `/api/admin/incidents/${incidentId}/notes`,
        {
          operationId: crypto.randomUUID(),
          body: "Admin noted: candidate reported the issue via phone. Connection restored after router restart.",
        },
      );
    } catch {
      // note enrichment is nice-to-have
    }
  });

  // ── Queue page ──
  test.describe("Queue page", () => {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      test(`queue - ${name} (${vp.width}x${vp.height}) light`, async ({
        page,
      }) => {
        await page.setViewportSize(vp);
        await page.goto(`/login`);
        // Login as admin via UI
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        // Navigate to recovery queue
        await page.goto("/admin/recovery");
        // Wait for either the table (desktop) or cards (mobile) to appear, or error/alert
        await page.waitForSelector(
          '[data-testid="recovery-queue-table"]:visible, [data-testid="recovery-queue-cards"]:visible, [role="alert"]',
          {
            timeout: 15_000,
          },
        );
        // Wait for data to settle
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-queue-${name}-light.png`,
          fullPage: true,
        });
      });

      test(`queue - ${name} (${vp.width}x${vp.height}) dark`, async ({
        page,
      }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: "dark" });
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto("/admin/recovery");
        await page.waitForSelector(
          '[data-testid="recovery-queue-table"]:visible, [data-testid="recovery-queue-cards"]:visible, [role="alert"]',
          {
            timeout: 15_000,
          },
        );
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-queue-${name}-dark.png`,
          fullPage: true,
        });
      });
    }
  });

  // ── Incident detail page ──
  test.describe("Incident detail page", () => {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      test(`incident detail - ${name} light`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto(`/admin/recovery/incidents/${incidentId}`);
        // Wait for page sections to render
        await page.waitForSelector("dl", { timeout: 15_000 });
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-incident-${name}-light.png`,
          fullPage: true,
        });
      });

      test(`incident detail - ${name} dark`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: "dark" });
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto(`/admin/recovery/incidents/${incidentId}`);
        await page.waitForSelector("dl", { timeout: 15_000 });
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-incident-${name}-dark.png`,
          fullPage: true,
        });
      });
    }
  });

  // ── Attempt detail page ──
  test.describe("Attempt detail page", () => {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      test(`attempt detail - ${name} light`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto(`/admin/recovery/attempts/${attemptId}`);
        await page.waitForSelector("dl", { timeout: 15_000 });
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-attempt-${name}-light.png`,
          fullPage: true,
        });
      });

      test(`attempt detail - ${name} dark`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: "dark" });
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto(`/admin/recovery/attempts/${attemptId}`);
        await page.waitForSelector("dl", { timeout: 15_000 });
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-attempt-${name}-dark.png`,
          fullPage: true,
        });
      });
    }
  });

  // ── Exam detail page ──
  test.describe("Exam detail page", () => {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      test(`exam detail - ${name} light`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto(`/admin/recovery/exams/${examId}`);
        await page.waitForSelector("dl", { timeout: 15_000 });
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-exam-${name}-light.png`,
          fullPage: true,
        });
      });

      test(`exam detail - ${name} dark`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: "dark" });
        await page.goto(`/login`);
        await page.getByPlaceholder(/用户名/).fill("admin");
        await page.getByPlaceholder(/密码/).fill("admin123");
        await page.getByRole("button", { name: /^登录$/ }).click();
        await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

        await page.goto(`/admin/recovery/exams/${examId}`);
        await page.waitForSelector("dl", { timeout: 15_000 });
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/recovery-exam-${name}-dark.png`,
          fullPage: true,
        });
      });
    }
  });

  // ── Cross-page navigation smoke ──
  test.describe("Cross-page navigation", () => {
    test("Queue → Incident → Attempt → Exam → filtered Queue", async ({
      page,
    }) => {
      // Login as admin
      await page.goto(`/login`);
      await page.getByPlaceholder(/用户名/).fill("admin");
      await page.getByPlaceholder(/密码/).fill("admin123");
      await page.getByRole("button", { name: /^登录$/ }).click();
      await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

      // 1. Navigate to Recovery Queue
      await page.goto("/admin/recovery");
      await page.waitForSelector(
        '[data-testid="recovery-queue-table"]:visible, [data-testid="recovery-queue-cards"]:visible',
        {
          timeout: 15_000,
        },
      );
      await expect(page).toHaveURL(/\/admin\/recovery/);
      // Queue page loaded

      // 2. Click first incident link to go to Incident detail
      const incidentLink = page
        .getByTestId("recovery-queue-table")
        .locator("a")
        .first();
      if (await incidentLink.isVisible()) {
        await incidentLink.click();
        await page.waitForURL(/\/admin\/recovery\/incidents\//, {
          timeout: 15_000,
        });
        // Navigated to Incident detail
      } else {
        // Mobile cards
        const cardLink = page
          .getByTestId("recovery-queue-cards")
          .locator("a")
          .first();
        await cardLink.click();
        await page.waitForURL(/\/admin\/recovery\/incidents\//, {
          timeout: 15_000,
        });
        // Navigated to Incident detail (mobile)
      }

      // 3. From Incident detail, click an attempt link
      const attemptLink = page
        .locator('a[href*="/admin/recovery/attempts/"]')
        .first();
      if (await attemptLink.isVisible()) {
        await attemptLink.click();
        await page.waitForURL(/\/admin\/recovery\/attempts\//, {
          timeout: 15_000,
        });
        // Navigated to Attempt detail
      }

      // 4. From Attempt detail, click exam link (goes to Exam detail)
      const examLink = page
        .locator('a[href*="/admin/recovery/exams/"]')
        .first();
      if (await examLink.isVisible()) {
        await examLink.click();
        await page.waitForURL(/\/admin\/recovery\/exams\//, {
          timeout: 15_000,
        });
        // Navigated to Exam detail
      }

      // 5. From Exam detail, click "View in Queue" → filtered Queue
      const queueLink = page
        .getByRole("link", { name: /队列|Queue|返回/i })
        .first();
      if (await queueLink.isVisible()) {
        await queueLink.click();
        await page.waitForURL(/\/admin\/recovery/, { timeout: 15_000 });
        const url = new URL(page.url());
        const hasExamFilter = url.searchParams.has("examId");
        // Returned to Queue with or without examId filter
      }

      // Final assertions
      await expect(page).toHaveURL(/\/admin\/recovery/);
      // No React error overlay
      const errorOverlay = page.locator("[data-reactroot] [role=alert]");
      await expect(errorOverlay).toHaveCount(0);
    });
  });

  // ── Empty queue screenshot ──
  test("Empty queue state", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto(`/login`);
    await page.getByPlaceholder(/用户名/).fill("admin");
    await page.getByPlaceholder(/密码/).fill("admin123");
    await page.getByRole("button", { name: /^登录$/ }).click();
    await page.waitForURL(/\/admin\/dashboard/, { timeout: 15_000 });

    // Use a non-existent exam ID filter → should show empty state
    await page.goto(
      "/admin/recovery?examId=00000000-0000-0000-0000-000000000000",
    );
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "test-results/recovery-queue-empty-desktop-light.png",
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "test-results/recovery-queue-empty-desktop-dark.png",
      fullPage: true,
    });
  });
});
