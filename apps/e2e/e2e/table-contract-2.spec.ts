import { expect, test } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  adminApiToken,
  adminPost,
  answerTrueFalse,
  candidateApiToken,
  candidateLogin,
  startAndSubmitAttempt,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";
import { loginAsAdmin } from "../lib/login";

/**
 * issue 445 V2/V3/V4 + S1–S6 runtime geometry regression — UI-TABLE-CONTRACT-2
 * (issue 454).
 *
 * Real Chromium, real pages, real product CSS/font (Playwright bundles its own
 * Chromium; the built app serves the self-hosted Noto Sans CJK SC stack).
 * Geometry is asserted with getBoundingClientRect / clientWidth / scrollWidth
 * — screenshots are never the proof.
 *
 * Contract under test (P3-Corrective §5):
 *   effectiveTier = largest tier in [minTier, maxTier] with tierMin ≤
 *   containerWidth, floored at minTier; renderedTableMin = max(tierMin,
 *   contentMin) is a CSS physical fact (no runtime Σmin channel). Detail-
 *   comparison stays compact with a sticky first column; management-list can
 *   never upgrade beyond standard; status columns are 8.5rem (V4).
 */

function right(box: { x: number; width: number }): number {
  return box.x + box.width;
}

interface TableGeometry {
  archetype: string;
  tier: string | null;
  containerWidth: number;
  clientWidth: number;
  scrollWidth: number;
  overflowing: boolean;
  tableWidth: number;
}

async function probeTable(
  shell: import("@playwright/test").Locator,
): Promise<TableGeometry> {
  return shell.evaluate((el) => {
    const region = el.querySelector('[data-slot="table-scroll-region"]');
    const table = el.querySelector('[data-slot="table"]');
    return {
      archetype: el.getAttribute("data-table-archetype") ?? "",
      tier: el.getAttribute("data-table-tier"),
      containerWidth: region ? region.getBoundingClientRect().width : 0,
      clientWidth: region ? region.clientWidth : 0,
      scrollWidth: region ? region.scrollWidth : 0,
      overflowing: region
        ? region.getAttribute("data-overflowing") === "true"
        : false,
      tableWidth: table ? table.getBoundingClientRect().width : 0,
    };
  });
}

test.describe("table contract v2 runtime geometry (issue 454)", () => {
  test("V2 desktop: ResultPage score fully visible without horizontal scroll", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "contract-v2-desktop", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "immediate",
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await page.waitForURL("**/result", { timeout: 15_000 });

    const shell = page.locator('[data-slot="admin-table-shell"]');
    await shell.waitFor({ state: "visible" });
    const g = await probeTable(shell);

    // detail-comparison is pinned to compact regardless of container.
    expect(g.archetype).toBe("detail-comparison");
    expect(g.tier).toBe("compact");

    // Score is the LAST column and must be fully inside the scroll frame.
    const scoreCell = page
      .locator('[data-slot="table-cell"][data-column-role="score"]')
      .last();
    await expect(scoreCell).toBeVisible();
    const frame = shell.locator('[data-slot="table-scroll-region"]');
    const box = await frame.boundingBox();
    const score = await scoreCell.boundingBox();
    expect(box).not.toBeNull();
    expect(score).not.toBeNull();
    expect(right(score!)).toBeLessThanOrEqual(right(box!) + 1);

    // The rendered table fits the container: no horizontal scroll needed.
    expect(g.overflowing).toBe(false);
    expect(g.scrollWidth).toBeLessThanOrEqual(g.clientWidth + 1);

    // S1 evidence: rendered table = contentMin (~784.5), not the old static
    // standard floor (980) that produced V2's 44px clip.
    expect(g.tableWidth).toBeGreaterThan(700);
    expect(g.tableWidth).toBeLessThanOrEqual(g.clientWidth + 1);
    expect(g.containerWidth).toBeGreaterThan(850);
  });

  test("V2 narrow: local scroll + affordance + sticky first column, score reachable", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    const seeded = await seedExam(request, "contract-v2-narrow", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "immediate",
    });

    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await page.waitForURL("**/result", { timeout: 15_000 });

    const shell = page.locator('[data-slot="admin-table-shell"]');
    await shell.waitFor({ state: "visible" });
    const g = await probeTable(shell);

    // S2/S3 evidence: narrower than contentMin → real physical scroll with
    // container-gated affordance; the table is never silently compressed.
    expect(g.tier).toBe("compact");
    expect(g.scrollWidth).toBeGreaterThan(g.clientWidth + 1);
    expect(g.overflowing).toBe(true);
    await expect(
      shell.locator('[data-slot="table-scroll-hint"]'),
    ).toBeVisible();

    // Sticky first column: after scrolling to the end, the question-number
    // column stays pinned at the frame's left edge.
    const frame = shell.locator('[data-slot="table-scroll-region"]');
    const firstCell = page
      .locator('[data-slot="table-body"] [data-slot="table-cell"]')
      .first();
    const before = (await firstCell.boundingBox())!;
    await frame.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(100);
    const after = (await firstCell.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);

    // Score is reachable: scrolling to the end puts the score column inside
    // the frame.
    const scoreCell = page
      .locator('[data-slot="table-cell"][data-column-role="score"]')
      .last();
    await scoreCell.scrollIntoViewIfNeeded();
    const score = (await scoreCell.boundingBox())!;
    const frameBox = (await frame.boundingBox())!;
    expect(score.x).toBeGreaterThanOrEqual(frameBox.x - 1);
    expect(right(score)).toBeLessThanOrEqual(right(frameBox) + 1);
  });

  test("V4: GradingQueue status badge fully inside column, no 6px false overflow", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "contract-v4-queue", {
      textResponseQuestions: [{ score: 40, content: "作文题 ____" }],
      resultPublicationMode: "manual",
    });
    // Candidate starts + submits via API → attempt lands in the queue as
    // pending_manual (same authoritative path manual-grading.spec.ts uses).
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    await startAndSubmitAttempt(request, candidateToken, seeded.examId);

    await loginAsAdmin(page);
    await page.goto("/admin/grading-queue");
    const shell = page.locator('[data-slot="admin-table-shell"]');
    await shell.waitFor({ state: "visible" });

    // V4 measured scenario: the real GradingQueue container at 1280×900 is
    // 982px (measured, not forced) — comfortably above the compact floor, so
    // the status col 8.5rem must not protrude 6px.
    const g = await probeTable(shell);
    expect(g.containerWidth).toBeGreaterThan(850);
    expect(g.overflowing).toBe(false);
    expect(g.scrollWidth).toBeLessThanOrEqual(g.clientWidth + 1);

    // The worst in-table badge (待手动评分) must sit fully inside its cell.
    const badgeCell = page
      .locator('[data-slot="table-cell"][data-column-role="status"]')
      .filter({ hasText: "待手动评分" })
      .first();
    await expect(badgeCell).toBeVisible();
    const cellBox = (await badgeCell.boundingBox())!;
    const badge = (await badgeCell
      .locator('[data-slot="status-badge"]')
      .boundingBox())!;
    expect(right(badge)).toBeLessThanOrEqual(right(cellBox) + 1);
    expect(badge.x).toBeGreaterThanOrEqual(cellBox.x - 1);
  });

  test("V3: long unbroken username wraps in a primary-text cell (no collision)", async ({
    page,
    request,
  }) => {
    const token = await adminApiToken(request);
    const stamp = Date.now();
    // Username contract max = 50; 32 unbroken X's force overflow-wrap to do
    // real work inside a 12rem primary-text column.
    const longUsername = `e2e-${stamp}-${"X".repeat(32)}`;
    const created = await adminPost(request, token, "/api/users", {
      username: longUsername,
      password: "teacher123",
      name: `E2E Long Name ${stamp}`,
      role: "Teacher",
    });
    expect(created.ok()).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page
      .getByRole("row")
      .filter({ hasText: `E2E Long Name ${stamp}` })
      .first();
    await row.waitFor({ state: "visible", timeout: 15_000 });

    // Human identity (username) is primary-text → wrap/break, never clipped:
    // the cell's content width must not exceed its box.
    const usernameCell = row
      .locator('[data-slot="table-cell"][data-column-role="primary-text"]')
      .first();
    const metrics = await usernameCell.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      role: el.getAttribute("data-column-role"),
      overflow: el.getAttribute("data-column-overflow"),
    }));
    expect(metrics.role).toBe("primary-text");
    expect(metrics.overflow).toBe("wrap");
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  });

  test("V3: AuditLog machine identifier middle-truncates with full value accessible", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");
    const presenter = page.locator(
      '[data-slot="table-cell"] [data-overflow-policy="truncate-middle"]',
    );
    await expect(presenter.first()).toBeVisible({ timeout: 15_000 });
    const first = presenter.first();
    const aria = await first.getAttribute("aria-label");
    const title = await first.getAttribute("title");
    const visible = (await first.textContent()) ?? "";
    expect(aria).toBeTruthy();
    expect(title).toBe(aria);
    // The visible form is shortened (head…tail) and the full value is longer.
    expect(visible).toContain("…");
    expect(visible.length).toBeLessThan(aria!.length);
  });

  test("S6: management-list never upgrades beyond standard even on a huge container", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    // UsersPage hosts two shells (InvitationsCard first, then the users
    // table) — the users table is the last one.
    const shell = page.locator('[data-slot="admin-table-shell"]').last();
    await shell.waitFor({ state: "visible" });
    const g = await probeTable(shell);
    expect(g.archetype).toBe("management-list");
    // maxTier=standard: even a >1200px container must NOT reach wide.
    expect(g.tier).toBe("standard");
    expect(g.tableWidth).toBeLessThanOrEqual(1200 - 1);
  });

  test("S6: management-list degrades to compact + scroll on a narrow container", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    // Same two-shell page as the S6-huge case: users table is the last shell.
    const shell = page.locator('[data-slot="admin-table-shell"]').last();
    await shell.waitFor({ state: "visible" });
    const g = await probeTable(shell);
    expect(g.tier).toBe("compact");
    // The compact floor (720px) is a hard floor; content wider than the
    // container scrolls instead of compressing.
    expect(g.tableWidth).toBeGreaterThanOrEqual(716);
  });
});
