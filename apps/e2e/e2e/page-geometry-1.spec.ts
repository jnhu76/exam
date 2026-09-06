import { expect, test, type Page } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  answerTrueFalse,
  candidateLogin,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";
import { assertNoHorizontalOverflow } from "../lib/responsive";

/**
 * UI-PAGE-GEOMETRY-1 runtime evidence (issue 455) — the six-role page
 * vocabulary measured in real Chromium with the built app CSS. Pages
 * DECLARE their role on <PageContainer role>; layouts own only the gutter.
 *
 *   - UsersPage (admin-standard): page container caps at 1280 (max-w-7xl)
 *     inside the AdminLayout gutter at a 1920px viewport (the xl sidebar
 *     leaves 1624px of content width, so the role ceiling — not the
 *     viewport — is what stops the container);
 *   - ResultPage (candidate): the container caps at 896 (max-w-4xl) inside
 *     the ExamLayout p-4 sm:p-6 gutter, and the detail-comparison table
 *     region absorbs the shell borders (≈894) with no horizontal overflow;
 *   - 375px: the candidate shell (exam list) and the admin-standard users
 *     page produce no document-level horizontal overflow.
 *
 * Geometry is asserted via getBoundingClientRect — screenshots are evidence
 * artifacts, never the gate.
 */

const PAGE_CONTAINER = '[data-slot="page-container"]';

async function containerWidth(page: Page): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) throw new Error(`no element: ${sel}`);
    return el.getBoundingClientRect().width;
  }, PAGE_CONTAINER);
}

test.describe("page geometry runtime evidence (issue 455)", () => {
  test.describe.configure({ mode: "serial" });

  test("UsersPage declares admin-standard: container caps at 1280 in the AdminLayout gutter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await page.locator("main h1").waitFor({ state: "visible" });
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    const role = await page
      .locator(PAGE_CONTAINER)
      .first()
      .getAttribute("data-role");
    expect(role).toBe("admin-standard");

    // 1920 viewport − 232 (expanded xl sidebar) − 2×32 (lg:p-8 gutter) =
    // 1624 available; the container stops at the admin-standard ceiling
    // (1280) instead of filling the page.
    const width = await containerWidth(page);
    expect(width).toBeGreaterThan(1278);
    expect(width).toBeLessThanOrEqual(1281);
    await assertNoHorizontalOverflow(page);
  });

  test("ResultPage declares candidate: container caps at 896; table region absorbs shell borders", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "geometry-cand-result", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "immediate",
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await page.waitForURL("**/result", { timeout: 15_000 });
    await page
      .locator('[data-slot="admin-table-shell"]')
      .waitFor({ state: "visible" });

    const role = await page
      .locator(PAGE_CONTAINER)
      .first()
      .getAttribute("data-role");
    expect(role).toBe("candidate");

    // 1440 viewport − 2×24 (sm:p-6 gutter) = 1392 available; the candidate
    // ceiling (896) binds — the old max-w-5xl (1024) root is gone.
    const width = await containerWidth(page);
    expect(width).toBeGreaterThan(894);
    expect(width).toBeLessThanOrEqual(897);

    // The table region sits inside the capped container: PageSection
    // padding (2×20) and shell borders (2×2) subtract from 896 → 852
    // measured. Floor 800 keeps the assertion at the issue's V2 scenario
    // magnitude (~808) instead of pinning section internals, and the
    // ceiling proves the region never leaves the container.
    const regionWidth = await page.evaluate(() => {
      const el = document.querySelector('[data-slot="table-scroll-region"]');
      if (!(el instanceof HTMLElement)) throw new Error("no scroll region");
      return el.getBoundingClientRect().width;
    });
    expect(regionWidth).toBeGreaterThan(800);
    expect(regionWidth).toBeLessThanOrEqual(width);
    await assertNoHorizontalOverflow(page);
  });

  test("375px: candidate shell and users page stay overflow-free", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "geometry-cand-375", {
      questionAnswer: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);

    await page.goto("/admin/users");
    await page.locator("main h1").waitFor({ state: "visible" });
    await assertNoHorizontalOverflow(page);

    // Candidate shell: ExamLayout redirects an admin session to the admin
    // landing, so the candidate role is exercised with a candidate session.
    await candidateLogin(page, seeded.candidate);
    await page.goto("/exam/list");
    // The candidate exam list header is an h2 (not a PageHeader h1); the
    // page container plus the seeded exam card are the render anchors.
    await page.locator(PAGE_CONTAINER).waitFor({ state: "visible" });
    await page
      .getByText(/E2E-geometry-cand-375/)
      .first()
      .waitFor({ state: "visible" });
    const role = await page
      .locator(PAGE_CONTAINER)
      .first()
      .getAttribute("data-role");
    expect(role).toBe("candidate");
    await assertNoHorizontalOverflow(page);
  });
});
