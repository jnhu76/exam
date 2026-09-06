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
 *     inside the AdminLayout gutter at a 1440px viewport;
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
    await page.setViewportSize({ width: 1440, height: 900 });
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

    // 1440 viewport − 2×32 (lg:p-8 gutter) = 1376 available; the container
    // caps at the admin-standard ceiling (1280), it does not fill the page.
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

    // The table region sits inside the capped container (p-0 content, so
    // only the shell borders subtract) and needs no document overflow.
    const regionWidth = await page.evaluate(() => {
      const el = document.querySelector('[data-slot="table-scroll-region"]');
      if (!(el instanceof HTMLElement)) throw new Error("no scroll region");
      return el.getBoundingClientRect().width;
    });
    expect(regionWidth).toBeGreaterThan(880);
    expect(regionWidth).toBeLessThanOrEqual(width);
    await assertNoHorizontalOverflow(page);
  });

  test("375px: candidate shell and users page stay overflow-free", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);

    await page.goto("/admin/users");
    await page.locator("main h1").waitFor({ state: "visible" });
    await assertNoHorizontalOverflow(page);

    // Candidate shell: the exam list renders inside the candidate role.
    await page.goto("/exam");
    await page.locator("main").waitFor({ state: "visible" });
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});
    const role = await page
      .locator(PAGE_CONTAINER)
      .first()
      .getAttribute("data-role");
    expect(role).toBe("candidate");
    await assertNoHorizontalOverflow(page);
  });
});
