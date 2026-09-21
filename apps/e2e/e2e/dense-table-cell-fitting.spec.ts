import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { seedExam } from "../lib/seed";
import { adminApiToken, adminPost } from "../lib/flow";
import { loginAsAdmin } from "../lib/login";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminPatch(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
) {
  const res = await request.patch(`${BASE_URL}${path}`, {
    data,
    headers: { Cookie: `auth-token=${token}` },
  });
  expect(res.ok(), `PATCH ${path} → ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  return res.json();
}

/**
 * Dense-table cell-fitting geometry regression (issue #590).
 *
 * Contract: no visual paint may cross a shared cell boundary. For every
 * locked nowrap column the rendered content box must fit inside its owning
 * cell's border box; a presenter that intentionally truncates keeps the full
 * value accessible (that case does not occur here — every asserted role is
 * nowrap-atomic and renders its full value).
 *
 * Real Chromium, real pages, real product CSS/font. Geometry is asserted with
 * getBoundingClientRect / Range content rects — screenshots are never the
 * proof. Negative controls (relation count, long datetime, 2-tag cluster)
 * pin the CROWDED_BUT_CONTAINED / NO_DEFECT classifications from the #582
 * final runtime baseline so a width fix for one role cannot break another.
 *
 * Frozen #582 values asserted on the same surfaces (D2 cell 15px, D4 head
 * 13/20/500, D5 StatusBadge 22px, D6 TagBadge weight 500) must not regress
 * as collateral damage of any width change.
 */

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
] as const;

/** Half-px slack for sub-pixel rect rounding; borders stay excluded. */
const PX = 0.5;

/**
 * The DOM content rect is the LINE BOX: its right edge includes the trailing
 * glyph's advance side-bearing, which for CJK overshoots the painted ink by
 * up to ~2.5px (measured on the `1 条关联` relation cell — ink ends flush at
 * the border while the line box ends 2.5px past it). Contained negative
 * controls may therefore sit within this documented advance artifact without
 * counting as a crossing; any real regression (wrap, width shrink, font
 * change) moves the rect by more than this bound.
 */
const INK_TOLERANCE_PX = 3;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function right(r: Rect): number {
  return r.x + r.width;
}

function bottom(r: Rect): number {
  return r.y + r.height;
}

async function rectOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  expect(box, "element must have a layout box").not.toBeNull();
  return box as Rect;
}

/**
 * Painted-content rect of a cell: the union of its inline content (text
 * nodes and child elements), measured through a DOM Range. This is exactly
 * the geometry that must stay inside the cell's border box.
 */
async function contentRectOf(cell: Locator): Promise<Rect> {
  return cell.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

async function documentOverflowClean(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    "document must not gain horizontal overflow",
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

/**
 * Header/body column-edge alignment: for every column index the header and
 * the first body cell must share the same edges (border-collapse contract).
 */
async function headerBodyAligned(page: Page): Promise<void> {
  const drift = await page.evaluate(() => {
    const head = document.querySelectorAll('[data-slot="table-head"]');
    const bodyRow = document.querySelector(
      '[data-slot="table-body"] [data-slot="table-row"]',
    );
    if (!bodyRow) return 0;
    const cells = bodyRow.querySelectorAll('[data-slot="table-cell"]');
    let maxDrift = 0;
    head.forEach((th, i) => {
      const td = cells[i];
      if (!td) return;
      maxDrift = Math.max(
        maxDrift,
        Math.abs(
          th.getBoundingClientRect().right - td.getBoundingClientRect().right,
        ),
        Math.abs(
          th.getBoundingClientRect().left - td.getBoundingClientRect().left,
        ),
      );
    });
    return maxDrift;
  });
  expect(drift, "header/body column edges must align").toBeLessThanOrEqual(1);
}

/** Single-line row rhythm for the asserted nowrap roles: a contained,
 * nowrap content rect cannot grow its row — assert the content stayed on one
 * line (height ≤ 26px at the 22px cell line-height) so a wrap regression is
 * caught exactly, while legitimate primary-text wraps elsewhere stay out of
 * scope. */
async function expectSingleLine(cells: Locator, label: string): Promise<void> {
  const count = await cells.count();
  for (let i = 0; i < count; i++) {
    const content = await contentRectOf(cells.nth(i));
    expect(
      content.height,
      `${label} cell ${i}: nowrap content must stay on one line`,
    ).toBeLessThanOrEqual(26);
  }
}

/**
 * RowActions stay reachable: the actions column's last cell must end inside
 * the scroll region, and the region itself must not overflow locally.
 */
async function expectActionsReachable(shell: Locator): Promise<void> {
  const region = shell.locator('[data-slot="table-scroll-region"]');
  const metrics = await region.evaluate((el) => ({
    overflowing:
      el.getAttribute("data-overflowing") === "true" ||
      el.scrollWidth > el.clientWidth + 1,
    regionRight: el.getBoundingClientRect().right,
  }));
  expect(
    metrics.overflowing,
    "table must fit its container without local scroll",
  ).toBe(false);
  const actions = shell
    .locator('[data-slot="table-body"] [data-column-role="actions"]')
    .last();
  if ((await actions.count()) === 0) return;
  const box = (await actions.boundingBox())!;
  expect(
    box.x + box.width,
    "RowActions must not be clipped by the scroll frame",
  ).toBeLessThanOrEqual(metrics.regionRight + 1);
}

async function fontMetricsSettled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The core #590 invariant for a set of nowrap cells: every painted content
 * rect stays inside its owning cell's border box (the shared border itself
 * excluded), for EVERY matched cell — not just the first row. Fixed defects
 * assert at strict tolerance; contained negative controls pass
 * `tolerancePx = INK_TOLERANCE_PX` for the documented advance artifact.
 */
async function expectCellsContainContent(
  cells: Locator,
  label: string,
  tolerancePx: number = PX,
): Promise<void> {
  const count = await cells.count();
  expect(count, `${label}: expected at least one cell`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const cell = cells.nth(i);
    const cellRect = await rectOf(cell);
    const content = await contentRectOf(cell);
    expect(
      content.x,
      `${label} cell ${i}: content must not paint past the cell's left border`,
    ).toBeGreaterThanOrEqual(cellRect.x - tolerancePx);
    expect(
      right(content),
      `${label} cell ${i}: content must not paint past the cell's right border`,
    ).toBeLessThanOrEqual(right(cellRect) + tolerancePx);
  }
}

test.describe("dense table cell fitting (issue #590)", () => {
  for (const viewport of VIEWPORTS) {
    test(`users role pill stays inside the type column @${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ ...viewport });
      await loginAsAdmin(page);
      await page.goto("/admin/users");
      await fontMetricsSettled(page);

      // The role pill family: every type-role body cell that renders a badge
      // (staff table + invitations card role columns).
      const pillCells = page
        .locator('[data-slot="table-cell"][data-column-role="type"]')
        .filter({ has: page.locator('[data-slot="badge"]') });
      await pillCells.first().waitFor({ state: "visible" });

      // The shared 角色/状态 boundary: the pill must not overlap the neighbor
      // status cell, and the neighbor must begin at the shared border.
      const firstPillCell = pillCells.first();
      const cellRect = await rectOf(firstPillCell);
      const pill = await rectOf(
        firstPillCell.locator('[data-slot="badge"]').first(),
      );
      const row = page
        .locator('[data-slot="table-body"] [data-slot="table-row"]')
        .filter({ has: firstPillCell })
        .first();
      const statusCell = row
        .locator('[data-slot="table-cell"][data-column-role="status"]')
        .first();
      const statusRect = await rectOf(statusCell);

      expect(
        pill.x,
        "pill must start inside its owning cell",
      ).toBeGreaterThanOrEqual(cellRect.x - PX);
      expect(
        right(pill),
        "pill must not paint across the shared cell border",
      ).toBeLessThanOrEqual(right(cellRect) - 1 + PX);
      expect(
        Math.abs(right(cellRect) - statusRect.x),
        "status neighbor must begin at the shared boundary",
      ).toBeLessThanOrEqual(1);
      expect(
        right(pill),
        "pill must not overlap the neighbor status cell",
      ).toBeLessThanOrEqual(statusRect.x + PX);

      await expectCellsContainContent(pillCells, "role pill");
      await expectSingleLine(pillCells, "role pill");
      await documentOverflowClean(page);
      await headerBodyAligned(page);

      // RowActions stay reachable: the shell owns local scroll, and on this
      // surface the table must fit without local scroll or clipped actions.
      const shell = page.locator('[data-slot="admin-table-shell"]').last();
      await expectActionsReachable(shell);

      // Frozen #582 values on this surface (D2/D4/D5). Hidden mobile-card
      // duplicates stay mounted at desktop widths (issue 457 C3), so the D5
      // badge is taken from a VISIBLE instance.
      const frozen = await page.evaluate(() => {
        const cell = document.querySelector(
          '[data-slot="table-cell"][data-column-role="type"]',
        );
        const head = document.querySelector('[data-slot="table-head"]');
        const badge = Array.from(
          document.querySelectorAll('[data-slot="status-badge"]'),
        ).find((el) => el.getBoundingClientRect().height > 0);
        const cellStyle = cell ? getComputedStyle(cell) : null;
        const headStyle = head ? getComputedStyle(head) : null;
        return {
          cellFontSize: cellStyle?.fontSize,
          headFontSize: headStyle?.fontSize,
          headLineHeight: headStyle?.lineHeight,
          headFontWeight: headStyle?.fontWeight,
          badgeHeight: badge?.getBoundingClientRect().height,
        };
      });
      expect(frozen.cellFontSize, "D2 cell typography frozen").toBe("15px");
      expect(frozen.headFontSize, "D4 header typography frozen").toBe("13px");
      expect(frozen.headLineHeight, "D4 header typography frozen").toBe("20px");
      expect(frozen.headFontWeight, "D4 header typography frozen").toBe("500");
      expect(frozen.badgeHeight, "D5 StatusBadge height frozen").toBe(22);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`exam date range stays inside its cell on every row @${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ ...viewport });
      await loginAsAdmin(page);
      await page.goto("/admin/exams");
      await fontMetricsSettled(page);

      const rangeCells = page
        .locator('[data-slot="table-cell"][data-column-role="date-range"]')
        .filter({ hasText: "—" });
      await rangeCells.first().waitFor({ state: "visible" });

      await expectCellsContainContent(rangeCells, "date range");
      await expectSingleLine(rangeCells, "date range");
      await documentOverflowClean(page);
      await headerBodyAligned(page);

      // The range must not intersect the neighbor duration (时长) cell.
      const rows = page
        .locator('[data-slot="table-body"] [data-slot="table-row"]')
        .filter({ has: page.locator('[data-column-role="date-range"]') });
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const rangeCell = row
          .locator('[data-column-role="date-range"]')
          .first();
        const durationCell = row
          .locator('[data-column-role="duration"]')
          .first();
        const content = await contentRectOf(rangeCell);
        const durationRect = await rectOf(durationCell);
        expect(
          right(content),
          `row ${i}: date range must not intersect the duration cell`,
        ).toBeLessThanOrEqual(durationRect.x + PX);
      }

      const shell = page.locator('[data-slot="admin-table-shell"]').first();
      await expectActionsReachable(shell);
    });
  }

  test("width-band guard: exams local scroll stays an owned affordance inside the new locked-width band @1065x800", async ({
    page,
  }) => {
    // The derived date-range token (12.5 → 14.5rem) raises the exams table's
    // content minimum (928 → 960px), so viewports ≈1050–1081 — which
    // previously fit — now enter the shell's designed local-scroll band.
    // Inside the band the contract is: the LOCAL region may scroll with its
    // affordance, but document-level overflow stays clean and the range cells
    // stay contained.
    await page.setViewportSize({ width: 1065, height: 800 });
    await loginAsAdmin(page);
    await page.goto("/admin/exams");
    await fontMetricsSettled(page);

    const rangeCells = page
      .locator('[data-slot="table-cell"][data-column-role="date-range"]')
      .filter({ hasText: "—" });
    await rangeCells.first().waitFor({ state: "visible" });
    await expectCellsContainContent(rangeCells, "date range");
    await documentOverflowClean(page);

    const shell = page.locator('[data-slot="admin-table-shell"]').first();
    const overflowing =
      (await shell.getAttribute("data-overflowing")) === "true";
    if (overflowing) {
      await expect(
        shell.locator('[data-slot="table-scroll-hint"]'),
        "in-band local scroll must surface the owned affordance",
      ).toBeVisible();
    }
  });

  test("negative control: relation count stays contained — /admin/recovery", async ({
    page,
    request,
  }) => {
    // Deterministic incident via the real Admin API (the canonical seed does
    // not create recovery incidents).
    const seeded = await seedExam(request, `fitting-recovery-${Date.now()}`);
    const token = await adminApiToken(request);
    const incidentRes = await adminPost(
      request,
      token,
      `/api/admin/exams/${seeded.examId}/incidents`,
      {
        operationId: crypto.randomUUID(),
        type: "network_interruption",
        severity: "major",
        description: "E2E #590 cell-fitting negative control",
      },
    );
    expect(
      incidentRes.ok(),
      `incident creation → ${incidentRes.status()}`,
    ).toBe(true);

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    await page.goto("/admin/recovery");
    await fontMetricsSettled(page);

    const relationCells = page
      .locator('[data-slot="table-cell"][data-column-role="number"]')
      .filter({ hasText: "条关联" });
    await relationCells.first().waitFor({ state: "visible" });

    // CROWDED_BUT_CONTAINED: near-capacity geometry is legal; crossing the
    // shared border is not. The ink-level bound carries the documented
    // advance-vs-ink tolerance.
    await expectCellsContainContent(
      relationCells,
      "relation count",
      INK_TOLERANCE_PX,
    );
    await expectSingleLine(relationCells, "relation count");
    await documentOverflowClean(page);
  });

  test("negative control: long datetime stays contained — /admin/audit-logs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");
    await fontMetricsSettled(page);

    const datetimeCells = page
      .locator('[data-slot="table-cell"][data-column-role="date"]')
      .filter({ hasText: ":" });
    await datetimeCells.first().waitFor({ state: "visible" });

    await expectCellsContainContent(
      datetimeCells,
      "long datetime",
      INK_TOLERANCE_PX,
    );
    await expectSingleLine(datetimeCells, "long datetime");
    await documentOverflowClean(page);
  });

  test("negative control: 2-tag cluster wraps and stays contained — /admin/questions", async ({
    page,
    request,
  }) => {
    // Deterministic tagged question via the real Admin API (the canonical
    // seed writes no tags — the #582 baseline recorded this as a coverage
    // gap; this test closes it for the 2-tag case).
    const seeded = await seedExam(request, `fitting-tags-${Date.now()}`);
    const token = await adminApiToken(request);
    await adminPatch(request, token, `/api/questions/${seeded.questionId}`, {
      tags: ["安全", "设备"],
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    await fontMetricsSettled(page);

    const tagCells = page
      .locator('[data-slot="table-cell"][data-column-role="tag-list"]')
      .filter({ has: page.locator('[data-slot="tag-badge"]') });
    await tagCells.first().waitFor({ state: "visible" });

    await expectCellsContainContent(tagCells, "2-tag cluster");
    await expectSingleLine(tagCells, "2-tag cluster");

    // D6 frozen value: compact-table TagBadge keeps weight 500.
    const tagWeight = await tagCells
      .first()
      .locator('[data-slot="tag-badge"]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(tagWeight, "D6 TagBadge weight frozen").toBe("500");
    await documentOverflowClean(page);
  });
});
