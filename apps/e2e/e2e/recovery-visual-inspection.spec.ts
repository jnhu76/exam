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
import { IncidentResponseSchema } from "@exam/contracts";
import { IncidentSeverity, IncidentType } from "@exam/domain";
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
    type?: IncidentType;
    severity?: IncidentSeverity;
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
      type: opts.type ?? IncidentType.NetworkInterruption,
      severity: opts.severity ?? IncidentSeverity.Critical,
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
      type: IncidentType.NetworkInterruption,
      severity: IncidentSeverity.Critical,
      description:
        "Candidate experienced a prolonged network disruption during the examination period. " +
        "The candidate's connection to the examination server was lost for approximately 45 seconds, " +
        "resulting in potential loss of unsaved answers and disruption of the timed examination flow.",
      attemptId,
      candidateId,
    });
    incidentId = inc1.incident.id;

    const inc2 = await createIncident(request, adminToken, examId, {
      type: IncidentType.DeviceFailure,
      severity: IncidentSeverity.Minor,
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
      if (!inc2Detail.ok()) {
        throw new Error(`incident detail fetch failed: ${inc2Detail.status()}`);
      }
      // Validate the wire response against the canonical incident contract
      // before reading `version` (never trust an unvalidated response body).
      const inc2Incident = IncidentResponseSchema.parse(
        (await inc2Detail.json()).incident,
      );
      await adminPost(
        request,
        adminToken,
        `/api/admin/incidents/${incidentId2}/investigate`,
        {
          operationId: crypto.randomUUID(),
          expectedVersion: inc2Incident.version,
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
        // Require the seeded incident row — an error/empty queue must NOT pass
        // as a successful queue screenshot (error/empty live in their own
        // dedicated tests).
        await expect(
          page
            .locator(
              `a[href="/admin/recovery/incidents/${incidentId}"]:visible`,
            )
            .first(),
        ).toBeVisible({ timeout: 15_000 });
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

      // 1. Queue → Incident detail. Every step below is a hard assertion:
      //    the link must exist and be visible, then the URL must match
      //    EXACTLY (no `/admin/recovery` prefix-matching that would let an
      //    earlier page pass). The queue is (createdAt DESC, id DESC), so the
      //    newer incident (incidentId2) is the first row; targeting it by
      //    href keeps the step independent of row order.
      await page.goto("/admin/recovery");
      const incidentLink = page
        .locator(`a[href="/admin/recovery/incidents/${incidentId2}"]:visible`)
        .first();
      await expect(incidentLink).toBeVisible({ timeout: 15_000 });
      await incidentLink.click();
      await expect(page).toHaveURL(`/admin/recovery/incidents/${incidentId2}`);

      // 2. Incident detail → Attempt detail (anchor attempt link)
      const attemptLink = page
        .locator(`a[href="/admin/recovery/attempts/${attemptId}"]:visible`)
        .first();
      await expect(attemptLink).toBeVisible({ timeout: 15_000 });
      await attemptLink.click();
      await expect(page).toHaveURL(`/admin/recovery/attempts/${attemptId}`);

      // 3. Attempt detail → Exam detail
      const examLink = page
        .locator(`a[href="/admin/recovery/exams/${examId}"]:visible`)
        .first();
      await expect(examLink).toBeVisible({ timeout: 15_000 });
      await examLink.click();
      await expect(page).toHaveURL(`/admin/recovery/exams/${examId}`);

      // 4. Exam detail → filtered Queue ("在队列中查看" carries ?examId=)
      const queueLink = page
        .locator(`a[href="/admin/recovery?examId=${examId}"]:visible`)
        .first();
      await expect(queueLink).toBeVisible({ timeout: 15_000 });
      await queueLink.click();
      await expect(page).toHaveURL(`/admin/recovery?examId=${examId}`);

      // Final: exactly the queue page, filtered to the seeded exam
      const finalUrl = new URL(page.url());
      expect(finalUrl.pathname).toBe("/admin/recovery");
      expect(finalUrl.searchParams.get("examId")).toBe(examId);

      // No error surface on the final page
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
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
