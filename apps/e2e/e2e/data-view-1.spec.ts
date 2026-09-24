import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminGet, adminPost } from "../lib/flow";
import { assertNoHorizontalOverflow } from "../lib/responsive";

/**
 * UI-DATA-VIEW-1 (#601 Phase F) — the canonical data-view fixture matrix.
 *
 * This is the runtime owner for the five fixtures the visual foundation issue
 * names for tables (Narrow / Normal / Wide / Long content / Search+toolbar),
 * and for the three defects Phase F closed while establishing them:
 *
 *   1. a table whose columns fit was still stretched to a static tier floor
 *      (the #454 contract), so a narrow container clipped columns instead of
 *      scrolling — Narrow asserts the table stops at its semantic minimum and
 *      the region scrolls for real;
 *   2. a fractional region box (1394.667px) round-tripped through the document
 *      scrollbar on every page change, which re-allocated the table and left
 *      Chromium painting a stale horizontal scrollbar for two frames while
 *      `scrollWidth === clientWidth` — Normal asserts the painted-scrollbar
 *      fact (`offsetHeight === clientHeight`) and the gutter invariant
 *      (`document.scrollingElement.clientWidth` constant) across a real
 *      pagination transition, sampled per frame;
 *   3. an over-wide single-line value painted outside its column (a 19-digit
 *      score crossed the difficulty and tag columns by 98.79px) — Long content
 *      asserts the policy per column role: wrap, clip + hover reveal, or the
 *      presenter, and that no neighbour is ever overlapped.
 *
 * Measurement is DOM geometry (getBoundingClientRect / clientWidth /
 * scrollWidth / computed style) and per-frame rAF sampling — screenshots are
 * never the proof.
 *
 * Ownership boundary: the semantic floor table and the distribution rule are
 * unit-gated at their owner (table/columnAllocation.ts +
 * columnAllocation.test.ts, table-contract-guards.test.ts). This spec pins the
 * RENDERED consequences — the allocation is what paints (every column at
 * floor × one shared scale on a fitting container), the container is never
 * overflowed, the document never scrolls sideways, and each column role's
 * overflow policy holds under real production CSS and font.
 */

const NARROW = { width: 1024, height: 900 };
const NORMAL = { width: 1440, height: 900 };
const WIDE = { width: 1920, height: 1000 };

/** Half-px slack for sub-pixel rounding; borders stay excluded. */
const PX = 0.5;

interface DataViewGeometry {
  archetype: string | null;
  tier: string | null;
  regionBox: number;
  clientWidth: number;
  scrollWidth: number;
  overflowing: boolean;
  /** Painted horizontal scrollbar height on the region (0 = none). */
  paintedScrollbar: number;
  tableWidth: number;
  colSum: number;
  columns: { role: string | null; width: number }[];
  cellWidths: number[];
}

/**
 * The scroll region is the single carrier of the geometry vocabulary
 * (#601 Phase F). The two shell compositions differ in which element carries
 * it: DataTableShell nests a `table-scroll-region` inside its
 * `admin-table-shell` section, while DataWorkbench marks the region itself as
 * `admin-table-shell` — so the probe resolves the region by its vocabulary
 * attribute, never by a fixed ancestor depth.
 */
async function probeDataView(shell: Locator): Promise<DataViewGeometry> {
  return shell.evaluate((el) => {
    const region = el.matches("[data-table-archetype]")
      ? el
      : el.querySelector(
          '[data-table-archetype], [data-slot="table-scroll-region"]',
        );
    if (!(region instanceof HTMLElement)) {
      throw new Error("no scroll region inside the shell");
    }
    const table = region.querySelector('[data-slot="table"]');
    if (!(table instanceof HTMLElement)) {
      throw new Error("no table inside the scroll region");
    }
    const columns = Array.from(
      table.querySelectorAll<HTMLElement>("colgroup col"),
    ).map((c) => ({
      role: c.getAttribute("data-column-role"),
      width: Number.parseFloat(c.style.width || "0"),
    }));
    return {
      archetype: region.getAttribute("data-table-archetype"),
      tier: region.getAttribute("data-table-tier"),
      regionBox: region.getBoundingClientRect().width,
      clientWidth: region.clientWidth,
      scrollWidth: region.scrollWidth,
      overflowing: region.getAttribute("data-overflowing") === "true",
      paintedScrollbar: region.offsetHeight - region.clientHeight,
      tableWidth: table.getBoundingClientRect().width,
      colSum: columns.reduce((sum, c) => sum + c.width, 0),
      columns,
      cellWidths: Array.from(
        table.querySelectorAll<HTMLElement>("[data-slot='table-head']"),
      ).map((th) => th.getBoundingClientRect().width),
    };
  });
}

/** The one geometry claim every fixture shares: the allocation is what paints. */
function expectAllocationIsRendered(g: DataViewGeometry): void {
  expect(g.columns.length).toBeGreaterThan(0);
  expect(g.cellWidths.length).toBe(g.columns.length);
  for (const [index, column] of g.columns.entries()) {
    expect(
      Math.abs(column.width - (g.cellWidths[index] ?? Number.NaN)),
      `column ${index} (${column.role}): rendered width must equal its allocated width`,
    ).toBeLessThanOrEqual(PX);
  }
  // Columns cover the table exactly — no rounding waste, no phantom column.
  expect(Math.abs(g.colSum - g.tableWidth)).toBeLessThanOrEqual(PX);
}

/** A fitted region paints no scrollbar; a fitted table paints no bleed. */
function expectNoPaintedScrollbar(g: DataViewGeometry): void {
  expect(g.overflowing).toBe(false);
  expect(
    g.paintedScrollbar,
    "a region that reports data-overflowing=false must not paint a horizontal scrollbar",
  ).toBe(0);
}

/** One animation frame's rendered facts for a data-view region. */
interface TransitionFrame {
  paintedScrollbar: number;
  overflowing: string | null;
  docClientWidth: number;
  docScrollWidth: number;
  regionBox: number;
  rows: number;
  /** The loading/empty placeholder row (a span cell) is in the body. */
  placeholder: boolean;
}

/**
 * Samples the region's rendered facts on EVERY animation frame while the page
 * runs one transition — a debounced search commit, or a page change. Both the
 * sampler and the trigger run inside the page, so no cross-context timing can
 * be lost between them, and the sampling covers the frames a user would see.
 */
async function sampleTransition(
  workbench: Locator,
  trigger: { search: string } | { page: number },
): Promise<TransitionFrame[]> {
  return workbench.evaluate(async (el, action) => {
    const found = el.querySelector("[data-table-archetype]");
    const region: HTMLElement =
      found instanceof HTMLElement ? found : (el as HTMLElement);
    const frames: TransitionFrame[] = [];
    const sample = () => {
      frames.push({
        paintedScrollbar: region.offsetHeight - region.clientHeight,
        overflowing: region.getAttribute("data-overflowing"),
        docClientWidth: document.scrollingElement!.clientWidth,
        docScrollWidth: document.scrollingElement!.scrollWidth,
        regionBox: region.getBoundingClientRect().width,
        rows: region.querySelectorAll(
          '[data-slot="table-body"] [data-slot="table-row"]',
        ).length,
        placeholder:
          region.querySelector(
            '[data-slot="table-body"] [data-column-role="span"]',
          ) !== null,
      });
    };
    let running = true;
    const tick = () => {
      sample();
      if (running) requestAnimationFrame(tick);
    };
    sample();
    requestAnimationFrame(tick);

    if ("search" in action) {
      const input = el.querySelector('[data-slot="toolbar-search"] input');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("no toolbar search input");
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, action.search);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const link = Array.from(
        el.querySelectorAll<HTMLElement>('[data-slot="pagination-link"]'),
      ).find((a) => a.textContent?.trim() === String(action.page));
      if (!link) throw new Error(`no pagination link for page ${action.page}`);
      link.click();
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    running = false;
    return frames;
  }, trigger);
}

/** The invariants every sampled transition must hold, frame by frame. */
function expectCleanTransition(frames: TransitionFrame[]): void {
  expect(frames.length).toBeGreaterThan(10);
  expect(
    frames.filter((f) => f.paintedScrollbar > 0),
    "no frame may paint a horizontal scrollbar on a region that does not overflow",
  ).toHaveLength(0);
  expect(
    frames.filter((f) => f.overflowing !== "false"),
    "no frame may report overflow while the table fits",
  ).toHaveLength(0);
  expect(
    frames.filter((f) => f.docScrollWidth > f.docClientWidth),
    "the document must never scroll sideways",
  ).toHaveLength(0);
  expect(
    new Set(frames.map((f) => f.docClientWidth)).size,
    "the document content box must not change width across the transition (scrollbar-gutter: stable)",
  ).toBe(1);
  expect(
    new Set(frames.map((f) => Math.round(f.regionBox))).size,
    "the region must not re-allocate its width across the transition",
  ).toBe(1);
  expect(
    frames.filter((f) => f.placeholder),
    "a reload that already has rows must never swap the body for the placeholder row",
  ).toHaveLength(0);
}

/**
 * The /admin/exams declaration set's semantic floors — the rendered column
 * roles in order (authoritative table: apps/web/src/table/columnAllocation.ts
 * ROLE_GEOMETRY). The fixture pins the ALGORITHM on this page (every column
 * renders at floor × one shared scale), never exact px.
 */
const EXAMS_FLOORS = [192, 136, 232, 80, 72, 72, 80, 96] as const;

test.describe("data view fixtures (UI-DATA-VIEW-1, #601 Phase F)", () => {
  test("Narrow: a table wider than its region scrolls locally instead of compressing columns", async ({
    page,
  }) => {
    await page.setViewportSize({ ...NARROW });
    await loginAsAdmin(page);
    await page.goto("/admin/exams");
    const shell = page.locator('[data-slot="admin-table-shell"]').first();
    await shell.waitFor({ state: "visible" });
    const g = await probeDataView(shell);

    // The container is below the table's semantic minimum: the tier floors at
    // compact and the table keeps its allocated width (Σ roleMin) rather than
    // being squeezed into the container.
    expect(g.tier).toBe("compact");
    expect(g.tableWidth).toBeGreaterThan(g.clientWidth);
    expectAllocationIsRendered(g);

    // Real local scroll with the container-gated affordance: the scrollbar is
    // legitimate here (the region genuinely overflows).
    expect(g.overflowing).toBe(true);
    expect(g.scrollWidth).toBeGreaterThan(g.clientWidth + 1);
    await expect(
      shell.locator('[data-slot="table-scroll-hint"]'),
    ).toBeVisible();

    // The narrow fixture never becomes a page-level horizontal scroll.
    await assertNoHorizontalOverflow(page);
  });

  test("Normal: the table fills its measured container exactly, with no painted scrollbar", async ({
    page,
  }) => {
    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);
    await page.goto("/admin/exams");
    const shell = page.locator('[data-slot="admin-table-shell"]').first();
    await shell.waitFor({ state: "visible" });
    const g = await probeDataView(shell);

    expect(g.archetype).toBe("management-list");
    expect(g.tier).toBe("standard");
    // Fills the region's exact content box (fractional), and the integer
    // column widths cover the region's client box exactly.
    expect(Math.abs(g.tableWidth - g.regionBox)).toBeLessThanOrEqual(PX);
    expect(g.colSum).toBe(g.clientWidth);
    expectAllocationIsRendered(g);
    expectNoPaintedScrollbar(g);

    // The canonical proportional-allocation gate (#601 Phase F, user-ratified
    // rule B): with Σ floors = 960 and the container above it, EVERY column —
    // not a flexible subset — renders at its floor × one shared scale. The
    // pre-proportional rule poured the whole residual into the single
    // primary-text column (626px) while 及格分 stayed at 80px and clipped
    // `60/100`; this gate locks that defect out permanently.
    expect(g.columns.length).toBe(EXAMS_FLOORS.length);
    const scale =
      g.tableWidth / EXAMS_FLOORS.reduce((sum, min) => sum + min, 0);
    expect(scale).toBeGreaterThan(1);
    for (const [index, min] of EXAMS_FLOORS.entries()) {
      const rendered = g.columns[index]?.width ?? Number.NaN;
      expect(
        rendered,
        `column ${index} (${g.columns[index]?.role}) must keep its floor`,
      ).toBeGreaterThanOrEqual(min);
      expect(
        Math.abs(rendered - min * scale),
        `column ${index} (${g.columns[index]?.role}) must render at floor × scale`,
      ).toBeLessThanOrEqual(1.5);
    }

    await expect(shell.locator('[data-slot="table-scroll-hint"]')).toHaveCount(
      0,
    );
    await assertNoHorizontalOverflow(page);
  });

  test("Wide: the archetype ceiling holds and the allocation still covers the container", async ({
    page,
  }) => {
    await page.setViewportSize({ ...WIDE });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    // UsersPage hosts the invitations shell first; the users table is last.
    const shell = page.locator('[data-slot="admin-table-shell"]').last();
    await shell.waitFor({ state: "visible" });
    const g = await probeDataView(shell);

    // management-list can never upgrade beyond standard, however wide the
    // container is (V4/S6 rule) — the ceiling is a tier fact, not a width cap.
    expect(g.archetype).toBe("management-list");
    expect(g.tier).toBe("standard");
    expect(g.regionBox).toBeGreaterThan(1200);
    expect(g.colSum).toBe(g.clientWidth);
    expectAllocationIsRendered(g);
    expectNoPaintedScrollbar(g);
    await assertNoHorizontalOverflow(page);
  });

  test("Long content: every column role keeps its overflow policy and no neighbour is overlapped", async ({
    page,
    request,
  }) => {
    // A score is contract-legal at any positive finite value (#438: no upper
    // bound is a numeric invariant), so the fixture is created through the
    // real authoring API rather than assumed to exist in the seed.
    const token = await adminApiToken(request);
    const courses = (await (
      await adminGet(request, token, "/api/courses")
    ).json()) as { items: { id: string }[] };
    const courseId = courses.items[0]?.id;
    expect(courseId, "the seed must expose at least one course").toBeTruthy();
    const stamp = Date.now();
    const created = await adminPost(request, token, "/api/questions", {
      courseId,
      type: "true_false",
      content: `溢出策略夹具 ${stamp}`,
      standardAnswer: true,
      score: 1_000_000_000_000_000_000,
    });
    expect(created.ok()).toBeTruthy();

    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    const shell = page.locator('[data-slot="data-workbench"]');
    await shell.waitFor({ state: "visible" });
    // The search control is the only way to reach one specific row in the
    // bank (the list is paginated and the fixture is the newest question).
    await page
      .locator('[data-slot="toolbar-search"] input')
      .fill(String(stamp));
    const row = page
      .locator('[data-slot="table-body"] [data-slot="table-row"]')
      .filter({ hasText: String(stamp) })
      .first();
    await row.waitFor({ state: "visible", timeout: 15_000 });

    // nowrap (score): clipped at the cell, full value revealed on hover — the
    // Element Plus `show-overflow-tooltip` pairing.
    const scoreCell = row
      .locator('[data-slot="table-cell"][data-column-role="score"]')
      .first();
    const clip = await scoreCell.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        text: (el.textContent ?? "").trim(),
      };
    });
    expect(clip.text).toBe("1000000000000000000");
    expect(clip.overflow).toBe("hidden");
    expect(clip.textOverflow).toBe("ellipsis");
    expect(clip.whiteSpace).toBe("nowrap");
    expect(
      clip.scrollWidth,
      "the pathological value is wider than its column, so the cell must clip",
    ).toBeGreaterThan(clip.clientWidth);

    // Hover via the locator (actionable, resolved against the settled DOM),
    // then leave and re-enter: the annotation is written on the mouseover of
    // the CURRENT node, so a re-enter guarantees it fires after any search
    // re-render settles.
    await scoreCell.hover();
    await page.mouse.move(0, 0);
    await scoreCell.hover();
    await expect(scoreCell).toHaveAttribute("title", clip.text);
    // The full value is never only in the tooltip: it stays in the DOM.
    expect(await scoreCell.textContent()).toContain(clip.text);

    // A value that fits stays silent (no tooltip noise on every cell). The
    // fitting cell is chosen from the row's own layout facts, so the assertion
    // does not depend on which column happens to hold a short value.
    const fittingIndex = await row.evaluate((el) => {
      const cells = Array.from(
        el.querySelectorAll(
          '[data-slot="table-cell"][data-column-overflow="nowrap"]',
        ),
      );
      return cells.findIndex(
        (cell) =>
          cell.scrollWidth <= cell.clientWidth &&
          cell.getAttribute("data-column-role") !== "actions",
      );
    });
    expect(
      fittingIndex,
      "the fixture row must contain a nowrap cell whose value fits",
    ).toBeGreaterThanOrEqual(0);
    const fitting = row
      .locator('[data-slot="table-cell"][data-column-overflow="nowrap"]')
      .nth(fittingIndex);
    await fitting.hover();
    await page.mouse.move(0, 0);
    await fitting.hover();
    await expect(fitting).not.toHaveAttribute("title", /.+/);

    // wrap (primary-text / tag-list) is covered by the row-wide policy gate
    // below: those cells do not clip, so their content must reflow inside the
    // column.

    // No cell paints outside its own column. A DOM Range reports the content's
    // LAYOUT extent, which a clipped cell legitimately exceeds — so the policy
    // gate is per cell: either the content reflows inside its column, or the
    // cell clips it (`overflow: hidden` + ellipsis, the Element Plus rule that
    // bounds the paint). A cell that does neither would bleed over its
    // neighbours, which is the defect this fixture exists for.
    const rowCells = row.locator('[data-slot="table-cell"]');
    const rowCellCount = await rowCells.count();
    expect(rowCellCount).toBeGreaterThan(1);
    for (let i = 0; i < rowCellCount; i++) {
      const cell = rowCells.nth(i);
      const facts = await cell.evaluate((el) => {
        const style = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = range.getBoundingClientRect();
        return {
          role: el.getAttribute("data-column-role"),
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          contentRight: rect.x + rect.width,
          boxRight:
            el.getBoundingClientRect().x + el.getBoundingClientRect().width,
        };
      });
      const clips =
        facts.overflow === "hidden" && facts.textOverflow === "ellipsis";
      if (!clips) {
        expect(
          facts.contentRight,
          `cell ${i} (${facts.role}): a cell that does not clip must contain its content`,
        ).toBeLessThanOrEqual(facts.boxRight + PX);
      }
      expect(
        facts.scrollWidth <= facts.clientWidth + 1 || clips,
        `cell ${i} (${facts.role}): content wider than its column must be clipped`,
      ).toBe(true);
    }

    const g = await probeDataView(shell);
    expectNoPaintedScrollbar(g);
    await assertNoHorizontalOverflow(page);
  });

  test("Search + toolbar: one toolbar band inside the shell, and the search transition repaints nothing", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);

    // A lone count is not a toolbar: the exams shell keeps its summary in the
    // title band and opens no controls band of its own (frozen baseline).
    await page.goto("/admin/exams");
    const examsShell = page.locator('[data-slot="admin-table-shell"]').first();
    await examsShell.waitFor({ state: "visible" });
    await expect(
      examsShell.locator('[data-slot="data-table-title-meta"]'),
    ).toBeVisible();
    await expect(
      examsShell.locator('[data-slot="data-table-toolbar-band"]'),
    ).toHaveCount(0);

    // A unique fixture so the search result is deterministic.
    const token = await adminApiToken(request);
    const courses = (await (
      await adminGet(request, token, "/api/courses")
    ).json()) as { items: { id: string }[] };
    const stamp = Date.now();
    const created = await adminPost(request, token, "/api/questions", {
      courseId: courses.items[0]?.id,
      type: "true_false",
      content: `搜索夹具 ${stamp}`,
      standardAnswer: true,
      score: 5,
    });
    expect(created.ok()).toBeTruthy();

    // The workbench composition: ONE toolbar region of the same continuous
    // shell as the table, with the search slot and the filter controls inside
    // it, and the count in the shell's footer region.
    await page.goto("/admin/questions");
    const workbench = page.locator('[data-slot="data-workbench"]');
    await workbench.waitFor({ state: "visible" });
    await expect(
      workbench.locator('[data-slot="workbench-toolbar"]'),
    ).toHaveCount(1);
    await expect(
      workbench.locator('[data-slot="toolbar-search"] input'),
    ).toBeVisible();
    expect(
      await workbench.locator('[data-slot="toolbar-filter"]').count(),
    ).toBeGreaterThan(0);
    await expect(
      workbench.locator('[data-slot="workbench-footer"]'),
    ).toBeVisible();
    await expect(
      workbench
        .locator('[data-slot="table-body"] [data-slot="table-row"]')
        .first(),
    ).toBeVisible();

    const frames = await sampleTransition(workbench, { search: String(stamp) });
    expectCleanTransition(frames);
    // The transition was a real re-query, not a no-op.
    await expect(
      workbench
        .locator('[data-slot="table-body"] [data-slot="table-row"]')
        .filter({ hasText: String(stamp) })
        .first(),
    ).toBeVisible();
  });

  test("Pagination: a page change repaints no scrollbar and keeps the table's footprint", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ ...NORMAL });
    // The question list pages at 20 rows; the seed holds fewer than that, so
    // the fixture fills a second page through the real authoring API.
    const token = await adminApiToken(request);
    const courses = (await (
      await adminGet(request, token, "/api/courses")
    ).json()) as { items: { id: string }[] };
    const courseId = courses.items[0]?.id;
    expect(courseId, "the seed must expose at least one course").toBeTruthy();
    const stamp = Date.now();
    for (let i = 0; i < 10; i++) {
      const res = await adminPost(request, token, "/api/questions", {
        courseId,
        type: "true_false",
        content: `分页夹具 ${stamp}-${i}`,
        standardAnswer: true,
        score: 5,
      });
      expect(res.ok()).toBeTruthy();
    }

    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    const workbench = page.locator('[data-slot="data-workbench"]');
    await workbench.waitFor({ state: "visible" });
    const firstRow = workbench
      .locator('[data-slot="table-body"] [data-slot="table-row"]')
      .first();
    await firstRow.waitFor({ state: "visible" });
    const before = await firstRow.textContent();
    await expect(
      workbench.locator('[data-slot="pagination-link"]').filter({
        hasText: /^2$/,
      }),
    ).toBeVisible();

    const frames = await sampleTransition(workbench, { page: 2 });
    expectCleanTransition(frames);
    // A full body was rendered on every sampled frame (the loading state keeps
    // the previous page's rows until the next page arrives).
    expect(Math.min(...frames.map((f) => f.rows))).toBeGreaterThan(0);
    await expect(firstRow).not.toHaveText(before ?? "");
    await assertNoHorizontalOverflow(page);
  });
});
