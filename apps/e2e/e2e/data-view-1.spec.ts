import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminGet, adminPost } from "../lib/flow";
import { assertNoHorizontalOverflow } from "../lib/responsive";
import { seedExam } from "../lib/seed";

/**
 * UI-DATA-VIEW-1 (#601 Phase F) — the canonical data-view fixture matrix.
 *
 * This is the runtime owner for the FOUR allocation regimes the visual
 * foundation issue names, and for the defects Phase F closed while
 * establishing them:
 *
 *   A OVERFLOW    A < Σfloor  — the hard floors do not fit: every column
 *                 renders at exactly its floor and the region scrolls locally
 *                 with its affordance. (/admin/recovery at 1024.)
 *   B COMPRESSED  Σfloor ≤ A < Σbasis — the table fits: columns interpolate
 *                 between floor and basis and NOTHING scrolls. This is the
 *                 regime the Data View Geometry Census proved missing: the
 *                 pre-Phase-F rule used a *preferred* width as the scroll
 *                 trigger, so /admin/recovery scrolled at every viewport with
 *                 438px of its region unused and the exam-edit inline picker
 *                 scrolled with its actions column off-screen.
 *   C PREFERRED   Σbasis ≤ A ≤ cap·Σbasis — every column renders at
 *                 basis × one shared scale (semantic geometry first +
 *                 proportional residual, never a single lucky width:auto
 *                 column — measured pre-Phase-F as /admin/exams 考试名称 626px
 *                 while 及格分 stayed at 80px and clipped `60/100`).
 *   D EXPANDED    A > cap·Σbasis — the table stops at ONE table-level cap
 *                 (EXPANSION_CAP × Σbasis, no per-role maxWidth, no per-page
 *                 tuning) and the region's remainder is carried by one empty
 *                 trailing cell, so the header band, row separators and hover
 *                 states stay continuous across the full surface instead of
 *                 stopping mid-card.
 *
 * Two further Phase F closures are pinned here because only a browser can
 * prove them:
 *
 *   - HEADER CAPACITY: header copy is a first-class geometry channel. Basis is
 *     the larger of the role's value token and its declared header capacity
 *     (table/headerCapacity.ts, gated by the i18n fixture in
 *     table-contract-guards.test.ts), so a supported header label is never
 *     clipped at preferred geometry. This spec proves it on the rendered pages.
 *   - SUB-PIXEL FIT: under border-collapse the outer half of the last column's
 *     1px right border lies outside the table's content edge, so a table sized
 *     to the region's content box reported scrollWidth = clientWidth + 1 — a
 *     fitted region with 1px of scrollable overflow, which classic scrollbars
 *     (Windows Chrome) answer with a painted horizontal scrollbar. A filled
 *     table's grid therefore ends at the region edge (recipes.css).
 *
 * Measurement is DOM geometry (getBoundingClientRect / clientWidth /
 * scrollWidth / computed style) and per-frame rAF sampling — screenshots are
 * never the proof. Numeric floors and bases are NOT duplicated here: the
 * allocation publishes Σfloor / Σbasis / state / spacer as DOM facts
 * (`data-geometry-*`), and this spec asserts the RENDERED consequences of the
 * rule against those facts. The numbers themselves are owned by
 * table/columnAllocation.ts + columnAllocation.test.ts +
 * table-contract-guards.test.ts.
 */

const NARROW = { width: 1024, height: 900 };
const NORMAL = { width: 1440, height: 900 };
const WIDE = { width: 1920, height: 1000 };

/** Half-px slack for sub-pixel rounding; borders stay excluded. */
const PX = 0.5;

/** The one table-level expansion cap (table/columnAllocation.ts). */
const EXPANSION_CAP = 1.33;

interface DataViewGeometry {
  archetype: string | null;
  tier: string | null;
  state: string | null;
  /** Σ of the role floors — the overflow trigger. */
  floor: number;
  /** Σ of the role bases — the preferred table width. */
  basis: number;
  /** The empty trailing cell's width (0 outside the expanded regime). */
  spacer: number;
  /** Per-column `floor:basis` bands, in declaration order. */
  bands: { floor: number; basis: number }[];
  regionBox: number;
  clientWidth: number;
  scrollWidth: number;
  overflowing: boolean;
  /** Painted horizontal scrollbar height on the region (0 = none). */
  paintedScrollbar: number;
  tableWidth: number;
  colSum: number;
  columns: { role: string | null; width: number }[];
  headerWidths: number[];
  /** Header labels whose box cannot hold their text. */
  clippedHeaders: string[];
  /** The rendered header row's own width (the band, spacer cell included). */
  headerRowWidth: number;
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
    const headCells = Array.from(
      table.querySelectorAll<HTMLElement>('[data-slot="table-head"]'),
    );
    const headerRow = table.querySelector<HTMLElement>(
      '[data-slot="table-header"] [data-slot="table-row"]',
    );
    return {
      archetype: region.getAttribute("data-table-archetype"),
      tier: region.getAttribute("data-table-tier"),
      state: table.getAttribute("data-geometry-state"),
      floor: Number(table.getAttribute("data-geometry-floor")),
      basis: Number(table.getAttribute("data-geometry-basis")),
      spacer: Number(table.getAttribute("data-geometry-spacer")),
      bands: (table.getAttribute("data-geometry-roles") ?? "")
        .split(",")
        .filter(Boolean)
        .map((pair) => {
          const [floor, basis] = pair.split(":").map(Number);
          return { floor: floor ?? 0, basis: basis ?? 0 };
        }),
      regionBox: region.getBoundingClientRect().width,
      clientWidth: region.clientWidth,
      scrollWidth: region.scrollWidth,
      overflowing: region.getAttribute("data-overflowing") === "true",
      paintedScrollbar: region.offsetHeight - region.clientHeight,
      tableWidth: table.getBoundingClientRect().width,
      colSum: columns.reduce((sum, c) => sum + c.width, 0),
      columns,
      headerWidths: headCells.map((th) => th.getBoundingClientRect().width),
      clippedHeaders: headCells
        .filter((th) => {
          const style = getComputedStyle(th);
          return (
            th.scrollWidth > th.clientWidth + 1 &&
            (style.overflow === "hidden" || style.textOverflow === "ellipsis")
          );
        })
        .map((th) => (th.textContent ?? "").trim()),
      headerRowWidth: headerRow
        ? headerRow.getBoundingClientRect().width
        : Number.NaN,
    };
  });
}

/** The one geometry claim every fixture shares: the allocation is what paints. */
function expectAllocationIsRendered(g: DataViewGeometry): void {
  expect(g.columns.length).toBeGreaterThan(0);
  expect(g.bands.length).toBe(g.columns.length);
  expect(g.headerWidths.length).toBe(g.columns.length);
  for (const [index, column] of g.columns.entries()) {
    expect(
      Math.abs(column.width - (g.headerWidths[index] ?? Number.NaN)),
      `column ${index} (${column.role}): rendered width must equal its allocated width`,
    ).toBeLessThanOrEqual(PX);
  }
  // The declared columns and the element agree exactly — no rounding waste.
  // In the expanded regime the difference IS the empty trailing cell.
  const elementColumnWidth = g.colSum + (g.state === "expanded" ? g.spacer : 0);
  expect(
    Math.abs(elementColumnWidth - g.tableWidth),
    "the colgroup (plus the expanded regime's trailing cell) must cover the table element",
  ).toBeLessThanOrEqual(PX + 1);
}

/** Every column inside its own declared [floor, basis] band. */
function expectColumnsInsideTheirBands(g: DataViewGeometry): void {
  for (const [index, column] of g.columns.entries()) {
    const band = g.bands[index];
    expect(band, `column ${index} has no declared band`).toBeTruthy();
    expect(
      column.width,
      `column ${index} (${column.role}) must not be squeezed below its floor`,
    ).toBeGreaterThanOrEqual((band?.floor ?? 0) - PX);
    expect(
      column.width,
      `column ${index} (${column.role}) must not exceed its basis outside the expanded regime`,
    ).toBeLessThanOrEqual((band?.basis ?? 0) + PX);
  }
}

/**
 * A fitted region paints no scrollbar AND has no scrollable pixel at all: the
 * collapsed half-border of a filled table used to leave exactly 1px of scroll
 * range, which classic scrollbars turn into a painted scrollbar on a table
 * that visibly fits.
 */
function expectFittedRegion(g: DataViewGeometry): void {
  expect(g.overflowing).toBe(false);
  expect(
    g.paintedScrollbar,
    "a region that reports data-overflowing=false must not paint a horizontal scrollbar",
  ).toBe(0);
  expect(
    g.scrollWidth,
    "a fitted region must have no scrollable pixel (sub-pixel table overflow)",
  ).toBeLessThanOrEqual(g.clientWidth);
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
    "the document content box must not change width across the transition",
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

/** Opens the first shell of a route and returns its allocation geometry. */
async function openShell(
  page: Page,
  route: string,
  which: "first" | "last" = "first",
): Promise<{ shell: Locator; geometry: DataViewGeometry }> {
  await page.goto(route);
  const shells = page.locator('[data-slot="admin-table-shell"]');
  const shell = which === "first" ? shells.first() : shells.last();
  await shell.waitFor({ state: "visible" });
  await expect(
    shell.locator('[data-column-allocation="computed"]'),
  ).toBeAttached();
  return { shell, geometry: await probeDataView(shell) };
}

/**
 * Probes every shell on the current route that actually renders an allocated
 * table. A shell may legitimately carry an empty state instead (the
 * invitations card, or a page whose dataset is empty) — such a shell has no
 * columns, so there is nothing to measure and nothing that could clip.
 */
async function probeAllocatedShells(
  page: Page,
): Promise<{ index: number; geometry: DataViewGeometry }[]> {
  const shells = page.locator(
    '[data-slot="admin-table-shell"], [data-slot="data-workbench"]',
  );
  await shells
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
  const found: { index: number; geometry: DataViewGeometry }[] = [];
  for (let index = 0; index < (await shells.count()); index++) {
    const shell = shells.nth(index);
    if (
      (await shell.locator('[data-column-allocation="computed"]').count()) === 0
    ) {
      continue;
    }
    await shell
      .locator('[data-column-allocation="computed"]')
      .first()
      .waitFor({ state: "attached", timeout: 15_000 });
    found.push({ index, geometry: await probeDataView(shell) });
  }
  return found;
}

test.describe("data view fixtures (UI-DATA-VIEW-1, #601 Phase F)", () => {
  test("A overflow: a container below Σfloor scrolls locally at the hard floors", async ({
    page,
  }) => {
    // /admin/recovery is the census page for this regime: log-diagnostic (never
    // card-replaced), 8 columns, Σfloor > the 1024 viewport's region.
    await page.setViewportSize({ ...NARROW });
    await loginAsAdmin(page);
    const { shell, geometry: g } = await openShell(page, "/admin/recovery");

    expect(g.archetype).toBe("log-diagnostic");
    expect(g.state).toBe("overflow");
    expect(g.floor).toBeGreaterThan(g.clientWidth);
    expect(g.basis).toBeGreaterThan(g.floor);

    // The table keeps its floors instead of being squeezed into the region:
    // Σ rendered === Σ floor, and every column is exactly at its own floor.
    // (The ELEMENT's box carries the collapsed outer half-border here — this
    // regime draws the last column's right border because the table genuinely
    // scrolls — so the element is allowed to be 0.5px wider than Σfloor.)
    expect(g.colSum).toBe(g.floor);
    expect(g.tableWidth).toBeGreaterThanOrEqual(g.floor);
    expect(g.tableWidth).toBeLessThanOrEqual(g.floor + PX);
    for (const [index, column] of g.columns.entries()) {
      expect(
        column.width,
        `column ${index} (${column.role}) renders at exactly its floor`,
      ).toBe(g.bands[index]?.floor);
    }

    // Real local scroll with the container-gated affordance.
    expect(g.overflowing).toBe(true);
    expect(g.scrollWidth).toBeGreaterThan(g.clientWidth + 1);
    await expect(
      shell.locator('[data-slot="table-scroll-hint"]'),
    ).toBeVisible();
    expect(g.clippedHeaders).toEqual([]);

    // The narrow fixture never becomes a page-level horizontal scroll.
    await assertNoHorizontalOverflow(page);
  });

  test("B compressed: a fitting container interpolates floor→basis and never scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsAdmin(page);

    // /admin/exams is the census page for the compressed regime at 1280.
    const { geometry: g } = await openShell(page, "/admin/exams");
    expect(g.state).toBe("compressed");
    expect(g.floor).toBeLessThanOrEqual(g.clientWidth);
    expect(g.basis).toBeGreaterThan(g.clientWidth);

    // The table fills the region exactly and every column sits inside its own
    // [floor, basis] band.
    expect(g.tableWidth).toBeGreaterThanOrEqual(g.clientWidth);
    expect(g.tableWidth).toBeLessThanOrEqual(g.clientWidth + PX);
    expect(g.colSum).toBe(g.clientWidth);
    expectAllocationIsRendered(g);
    expectColumnsInsideTheirBands(g);
    // The interpolation is real: at least one column moved off its floor (the
    // regime would otherwise be indistinguishable from overflow) and no
    // atomic column (floor === basis) moved at all.
    expect(
      g.columns.filter((c, i) => c.width > (g.bands[i]?.floor ?? 0) + PX)
        .length,
      "compressed geometry must interpolate at least one column off its floor",
    ).toBeGreaterThan(0);
    for (const [index, column] of g.columns.entries()) {
      const band = g.bands[index];
      if (band && band.floor === band.basis) {
        expect(
          column.width,
          `atomic column ${index} (${column.role}) keeps its token exactly`,
        ).toBe(band.floor);
      }
    }
    expectFittedRegion(g);
    await expect(page.locator('[data-slot="table-scroll-hint"]')).toHaveCount(
      0,
    );
    await assertNoHorizontalOverflow(page);
  });

  test("B compressed (canonical census page): /admin/recovery compresses instead of scrolling", async ({
    page,
  }) => {
    // The Data View Geometry Census measured this page scrolling at every
    // viewport while 438px of its region went unused — the defect the floor/
    // basis split exists for. It must now be compressed at 1280 and 1440, with
    // every atomic role exactly at its token and the compressible ones strictly
    // inside their band.
    await loginAsAdmin(page);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const { geometry: g } = await openShell(page, "/admin/recovery");
      expect(g.state, `at ${width}px`).toBe("compressed");
      expect(g.colSum, `at ${width}px`).toBe(g.clientWidth);
      expect(g.overflowing, `at ${width}px`).toBe(false);
      expectColumnsInsideTheirBands(g);
      expectFittedRegion(g);
      // The compressible roles are the ones that move; the bounded-vocabulary
      // roles (status / type / date) are atomic and stay exactly at their
      // tokens in every regime.
      expect(
        g.columns.filter((c, i) => c.width > (g.bands[i]?.floor ?? 0)).length,
        `at ${width}px: the compressible roles absorb the fit`,
      ).toBeGreaterThan(0);
      for (const [index, column] of g.columns.entries()) {
        const band = g.bands[index];
        if (band && band.floor === band.basis) {
          expect(column.width, `at ${width}px: ${column.role} is atomic`).toBe(
            band.floor,
          );
        }
      }
    }
  });

  test("B compressed (canonical census fixture): the exam-edit inline panel keeps its actions column on screen", async ({
    page,
    request,
  }) => {
    // The census' second forced-overflow fixture: the inline selected-question
    // panel is ~438px wide, so pre-Phase-F the actions column was entirely
    // off-screen behind a scroll. It must now compress and stay scroll-free.
    const seeded = await seedExam(request, "data-view-inline", {
      questionAnswer: true,
    });
    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${seeded.examId}/edit`);
    // The inline panel renders once the exam's own questions have resolved —
    // wait for the ROW (the data), not just for a shell to exist, so a slow
    // question fetch on a loaded host cannot be mistaken for a geometry result.
    const shell = page.locator('[data-slot="admin-table-shell"]').first();
    await expect(
      shell.locator('[data-slot="table-body"] [data-slot="table-row"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    const g = await probeDataView(shell);

    expect(g.archetype).toBe("embedded-picker");
    expect(g.state).toBe("compressed");
    expect(g.clientWidth).toBeLessThan(600);
    expect(g.colSum).toBe(g.clientWidth);
    expect(g.overflowing).toBe(false);
    expectFittedRegion(g);

    // The actions column is INSIDE the frame — the census defect.
    const actionsCell = shell
      .locator('[data-slot="table-cell"][data-column-role="actions"]')
      .first();
    await expect(actionsCell).toBeVisible();
    const cellBox = (await actionsCell.boundingBox())!;
    const regionBox = (await shell
      .locator("[data-table-archetype]")
      .boundingBox())!;
    expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(
      regionBox.x + regionBox.width + PX,
    );
    expect(g.clippedHeaders).toEqual([]);
  });

  test("C preferred: a container between Σbasis and the cap renders every column at basis × scale", async ({
    page,
  }) => {
    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);
    const { geometry: g } = await openShell(page, "/admin/exams");

    expect(g.state).toBe("preferred");
    expect(g.clientWidth).toBeGreaterThanOrEqual(g.basis);
    expect(g.clientWidth).toBeLessThanOrEqual(
      Math.floor(g.basis * EXPANSION_CAP),
    );
    expect(g.colSum).toBe(g.clientWidth);
    expectAllocationIsRendered(g);
    expectFittedRegion(g);

    // ONE shared scale over the whole declaration set — not a single lucky
    // width:auto column absorbing the residual while its neighbours clip
    // (measured pre-Phase-F: 考试名称 626px while 及格分 stayed at 80px).
    const scale = g.clientWidth / g.basis;
    expect(scale).toBeGreaterThan(1);
    for (const [index, column] of g.columns.entries()) {
      const band = g.bands[index];
      expect(band, `column ${index} has no declared band`).toBeTruthy();
      expect(
        column.width,
        `column ${index} (${column.role}) must render at basis × scale`,
      ).toBeGreaterThanOrEqual(Math.floor((band?.basis ?? 0) * scale) - 1);
      expect(
        column.width,
        `column ${index} (${column.role}) must render at basis × scale`,
      ).toBeLessThanOrEqual(Math.ceil((band?.basis ?? 0) * scale) + 1);
      expect(
        column.width,
        `column ${index} (${column.role}) must grow past its floor here`,
      ).toBeGreaterThanOrEqual((band?.floor ?? 0) - PX);
    }
    // The mixed-role declaration set is what makes this page the canonical
    // fixture: at least one atomic role and one compressible role are present.
    expect(
      g.bands.filter((b) => b.floor === b.basis).length,
      "the exams declaration set mixes atomic and compressible roles",
    ).toBeGreaterThan(0);
    expect(
      g.bands.filter((b) => b.floor < b.basis).length,
      "the exams declaration set mixes atomic and compressible roles",
    ).toBeGreaterThan(0);

    await expect(page.locator('[data-slot="table-scroll-hint"]')).toHaveCount(
      0,
    );
    await assertNoHorizontalOverflow(page);
  });

  test("D expanded: a container past the cap stops the columns and completes the surface", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsAdmin(page);
    // The users table is the sparse fixture: Σbasis 732, so 1280's region is
    // already past cap × Σbasis.
    const { geometry: g } = await openShell(page, "/admin/users", "last");

    expect(g.state).toBe("expanded");
    expect(g.clientWidth).toBeGreaterThan(Math.floor(g.basis * EXPANSION_CAP));

    // The declared columns stop at the cap...
    const capWidth = Math.floor(g.basis * EXPANSION_CAP);
    expect(g.colSum).toBe(capWidth);
    // ...the table element keeps the region's full width, and the remainder is
    // carried by the empty trailing cell.
    expect(g.tableWidth).toBeGreaterThanOrEqual(g.clientWidth - 1);
    expect(g.tableWidth).toBeLessThanOrEqual(g.clientWidth + PX);
    expect(g.spacer).toBeGreaterThan(0);
    expect(
      Math.abs(g.spacer - (g.clientWidth - g.colSum)),
      "the spacer is exactly the region's remainder",
    ).toBeLessThanOrEqual(1);
    // The grid stays complete: the header band spans the surface, not just the
    // capped columns (measured pre-spacer: the tinted band stopped 430px short
    // of the card edge on /admin/dashboard).
    expect(g.headerRowWidth).toBeGreaterThanOrEqual(g.clientWidth - 1);
    expect(g.headerRowWidth).toBeLessThanOrEqual(g.clientWidth + PX);

    // Every column is basis × the cap scale — the bound is uniform, not a
    // per-role maxWidth.
    const capScale = capWidth / g.basis;
    for (const [index, column] of g.columns.entries()) {
      const basis = g.bands[index]?.basis ?? 0;
      expect(
        column.width,
        `column ${index} (${column.role}) must stop at basis × cap`,
      ).toBeGreaterThanOrEqual(Math.floor(basis * capScale) - 1);
      expect(
        column.width,
        `column ${index} (${column.role}) must stop at basis × cap`,
      ).toBeLessThanOrEqual(Math.ceil(basis * capScale) + 1);
    }

    expectAllocationIsRendered(g);
    expectFittedRegion(g);
    await assertNoHorizontalOverflow(page);
  });

  test("Header capacity: no supported header label is clipped on any production data view", async ({
    page,
  }) => {
    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);
    // Header copy is a geometry channel, not decoration: the basis of every
    // role is at least its declared header capacity (table/headerCapacity.ts),
    // so at preferred geometry every supported label fits. This sweep proves
    // the rendered consequence across the production surfaces that carry the
    // widest header vocabulary. A route whose dataset is empty renders its own
    // empty state (no table, nothing to measure) — the checked-shell count
    // below keeps that from silently turning the gate into a no-op.
    const ROUTES = [
      "/admin/exams",
      "/admin/questions",
      "/admin/users",
      "/admin/courses",
      "/admin/results",
      "/admin/grading-queue",
      "/admin/audit-logs",
      "/admin/recovery",
      "/admin/candidates",
      "/admin/candidate-fields",
      "/admin/dashboard",
    ];
    let checked = 0;
    for (const route of ROUTES) {
      await page.goto(route);
      for (const { index, geometry: g } of await probeAllocatedShells(page)) {
        expect(
          g.clippedHeaders,
          `${route} shell ${index}: header labels must fit their column`,
        ).toEqual([]);
        checked += 1;
      }
    }
    expect(
      checked,
      "the header-capacity sweep must actually reach the production tables",
    ).toBeGreaterThanOrEqual(8);
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
    expectFittedRegion(g);
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
    // it, and the count in the shared footer region.
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
      workbench.locator('[data-slot="data-view-footer"]'),
    ).toBeVisible();
    // The count lives in ONE place — the shared footer — and never in the
    // toolbar (DataToolbar.summary was retired by Phase F).
    await expect(
      workbench.locator('[data-slot="data-view-footer"]'),
    ).toContainText(/\d/);
    await expect(
      workbench.locator(
        '[data-slot="workbench-toolbar"] [data-slot="data-view-footer"]',
      ),
    ).toHaveCount(0);
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

  test("Composition: a governed table never sits inside a second bordered surface", async ({
    page,
  }) => {
    // The PageSection nesting accident: a shell wrapped in another
    // `surface-content` section lost 44px to the second border + padding and
    // painted a double edge. The fix is composition (the shell IS the data
    // surface: its own title band carries the section heading), never a
    // defensive prop — so the gate is structural: no governed shell may have a
    // surface ancestor.
    await page.setViewportSize({ ...NORMAL });
    await loginAsAdmin(page);
    const ROUTES = [
      "/admin/exams",
      "/admin/questions",
      "/admin/users",
      "/admin/courses",
      "/admin/results",
      "/admin/recovery",
      "/admin/audit-logs",
      "/admin/dashboard",
      "/admin/candidate-fields",
    ];
    let checked = 0;
    for (const route of ROUTES) {
      await page.goto(route);
      const shells = page.locator(
        '[data-slot="admin-table-shell"], [data-slot="data-workbench"]',
      );
      await shells
        .first()
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => {});
      const count = await shells.count();
      if (count === 0) continue; // empty dataset → the page's own empty state
      const nested = await shells.evaluateAll((els) =>
        els.map((el) => {
          // The element's own surface (a DataTableShell IS a surface) is fine;
          // an ANCESTOR surface is the nesting accident. The workbench is the
          // one legal case: its region lives inside the workbench's own
          // continuous surface.
          const ancestor =
            el.parentElement?.closest(".surface-content") ?? null;
          if (ancestor === null) return null;
          const legalWorkbenchRegion =
            el.getAttribute("data-slot") === "admin-table-shell" &&
            ancestor.getAttribute("data-slot") === "data-workbench";
          return legalWorkbenchRegion
            ? null
            : `${ancestor.getAttribute("data-slot") ?? "section"}:${ancestor.className}`;
        }),
      );
      expect(
        nested.filter(Boolean),
        `${route}: a data surface must not be nested inside another surface-content`,
      ).toEqual([]);
      checked += count;
    }
    expect(
      checked,
      "the composition sweep must actually reach the production surfaces",
    ).toBeGreaterThanOrEqual(8);
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
