import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";

/**
 * Dense-table cell-fitting regression (issue #590) — the two historical
 * defects, and nothing more:
 *   1. the users role pill (考试管理员) painted across the shared 角色/状态
 *      cell border;
 *   2. the exams date range painted into the duration column on every row.
 *
 * Division of ownership for the #590 mechanism:
 *   - the locked-width derivations (widest type-role badge; the fixed
 *     23-character date-range grammar) are guarded at the semantic width
 *     owner by typeFixture.ts + table-contract-guards.test.ts (unit);
 *   - local-scroll ownership, the scroll affordance, and document-level
 *     cleanliness are the shell's generic contract, owned by shared.test.tsx
 *     and useOverflowObservation.test.tsx;
 *   - this spec is the runtime half for the RENDERED defect: under the real
 *     production CSS and font, painted content must stay inside its owning
 *     cell. Containment is asserted with DOM range rects — screenshots are
 *     never the proof.
 *
 * One desktop viewport (1440x900, the #582/#590 evidence-anchored
 * representative): locked columns never reflow under table-layout:fixed, so
 * the mechanism is viewport-independent; the local-scroll band is owned
 * generically (see above). Shared-border visual integrity is re-verified
 * from the evidence pack in docs/research/exam-590-table-cell-fitting/,
 * not from pixel assertions. One-off negative-control evidence (recovery
 * relation, long datetime, tag clusters) also lives there.
 */

const VIEWPORT = { width: 1440, height: 900 };

/** Half-px slack for sub-pixel rect rounding; borders stay excluded. */
const PX = 0.5;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function right(r: Rect): number {
  return r.x + r.width;
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

async function fontMetricsSettled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}

/** The core #590 invariant: every matched cell's painted content rect stays
 * inside its owning cell's border box (the shared border itself excluded),
 * not just the first row. */
async function expectCellsContainContent(
  cells: Locator,
  label: string,
): Promise<void> {
  const count = await cells.count();
  expect(count, `${label}: expected at least one cell`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const cellRect = await rectOf(cells.nth(i));
    const content = await contentRectOf(cells.nth(i));
    expect(
      content.x,
      `${label} cell ${i}: content must not paint past the cell's left border`,
    ).toBeGreaterThanOrEqual(cellRect.x - PX);
    expect(
      right(content),
      `${label} cell ${i}: content must not paint past the cell's right border`,
    ).toBeLessThanOrEqual(right(cellRect) + PX);
  }
}

test.describe("dense table cell fitting (issue #590)", () => {
  test("role pill stays inside its table cell — /admin/users", async ({
    page,
  }) => {
    await page.setViewportSize({ ...VIEWPORT });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await fontMetricsSettled(page);

    // The role pill family: every type-role body cell that renders a badge
    // (staff table + invitations card role columns).
    const pillCells = page
      .locator('[data-slot="table-cell"][data-column-role="type"]')
      .filter({ has: page.locator('[data-slot="badge"]') });
    await pillCells.first().waitFor({ state: "visible" });
    await expectCellsContainContent(pillCells, "role pill");

    // The historical defect instance — the widest pill against the shared
    // 角色/状态 border: it must not even paint the 1px border band, and the
    // status neighbor must begin exactly at that shared boundary (guards
    // against the measurement being fooled by a degenerate layout).
    let widestCell = pillCells.first();
    let widestBadge = 0;
    const cellCount = await pillCells.count();
    for (let i = 0; i < cellCount; i++) {
      const cell = pillCells.nth(i);
      const badge = await rectOf(cell.locator('[data-slot="badge"]').first());
      if (badge.width > widestBadge) {
        widestBadge = badge.width;
        widestCell = cell;
      }
    }
    const cellRect = await rectOf(widestCell);
    const badgeRect = await rectOf(
      widestCell.locator('[data-slot="badge"]').first(),
    );
    expect(
      badgeRect.x,
      "pill must start inside its owning cell",
    ).toBeGreaterThanOrEqual(cellRect.x - PX);
    expect(
      right(badgeRect),
      "pill must not paint across the shared cell border",
    ).toBeLessThanOrEqual(right(cellRect) - 1 + PX);
    const row = page
      .locator('[data-slot="table-body"] [data-slot="table-row"]')
      .filter({ has: widestCell })
      .first();
    const statusRect = await rectOf(
      row
        .locator('[data-slot="table-cell"][data-column-role="status"]')
        .first(),
    );
    expect(
      Math.abs(right(cellRect) - statusRect.x),
      "status neighbor must begin at the shared boundary",
    ).toBeLessThanOrEqual(1);
    expect(
      right(badgeRect),
      "pill must not overlap the neighbor status cell",
    ).toBeLessThanOrEqual(statusRect.x + PX);
  });

  test("date range stays inside its table cell — /admin/exams", async ({
    page,
  }) => {
    await page.setViewportSize({ ...VIEWPORT });
    await loginAsAdmin(page);
    await page.goto("/admin/exams");
    await fontMetricsSettled(page);

    // The historical defect spilled into the duration column on EVERY row,
    // so the containment contract is asserted per row, not on a sample.
    const rangeCells = page
      .locator('[data-slot="table-cell"][data-column-role="date-range"]')
      .filter({ hasText: "—" });
    await rangeCells.first().waitFor({ state: "visible" });
    await expectCellsContainContent(rangeCells, "date range");
  });
});
