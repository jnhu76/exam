/**
 * UI-D4-VISUAL-AB-582 — blind A/B evidence generation for D4 (issue #582).
 *
 * STAGE B of the #582 campaign, D4 (table-header typography). This spec
 * generates evidence ONLY — it does not choose a value, does not change any
 * production visual file, and does not adjudicate D5–D7 or re-open D2.
 *
 * Experiment law (single-variable isolation):
 *   - Variant CSS is injected at runtime via addInitScript; no production CSS
 *     is edited. The ONLY cross-arm difference is the `font-size` declaration
 *     on `[data-slot="table-head"]`. Header line-height (20px) and weight
 *     (500) are the product's own fixed values and are never injected.
 *   - COMMON BASELINE (both arms): the frozen upstream D2 decision (15px
 *     body / control tier) is established experimentally, because production
 *     has not implemented D2. Per the D2 freeze this converges UP onto the
 *     existing 15px `text-sm` control tier: body typography recipes and
 *     governed table cells are raised to 0.9375rem. The identical baseline
 *     block is installed in BOTH arms; the style proof re-verifies the
 *     absolute 15px values per capture (EXPERIMENT_INVALID_D2_BASELINE
 *     otherwise) — D4 is judged relative to a 15px body, never relative to
 *     the current mixed production typography.
 *   - Header geometry (th paddings, column widths, white-space, overflow
 *     vocabulary, alignment) is not compensated: natural glyph-geometry
 *     differences caused by the size change are evidence and are recorded by
 *     the structural sweep.
 *
 * Blinding (hardened after D2): which letter (X/Y) carries which px value
 * lives ONLY in
 * docs/research/exam-582-d4-visual-ab-1/validity/variant-map.json. Captures,
 * contact sheets and logs carry letters only. The judge bundle is physically
 * separated from the validity bundle; style-proof.json (computed px per
 * letter) is validity-only and carries a do-not-provide warning header.
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh --keep-server \
 *     -- --config=playwright.patrol.config.ts patrol/ui-d4-visual-ab-582.spec.ts
 */
import {
  test,
  expect,
  type Page,
  type Browser,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loginAsAdmin } from "../lib/login";
import { seedExam, type SeededExam } from "../lib/seed";
import { createTeacherViaApi } from "../lib/teacher";
import { PATROL_BASE_URL, progressLog } from "./patrol-fixtures";

// ── Constants ──
const BASE_URL = PATROL_BASE_URL;
const RUN_ID = `d4-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/d4-ab",
  RUN_ID,
);
const MACRO_DIR = join(OUTPUT_DIR, "artifacts", "D4", "macro");
const MICRO_DIR = join(OUTPUT_DIR, "artifacts", "D4", "micro");
const STYLE_ID = "d4-ab-variant-style";
const MAP_FILE =
  process.env.D4_MAP_FILE ??
  join(
    import.meta.dirname,
    "../../../docs/research/exam-582-d4-visual-ab-1/validity/variant-map.json",
  );

const VP_DESKTOP = { name: "1440x900", width: 1440, height: 900 };
const VP_NARROW = { name: "1100x800", width: 1100, height: 800 };
const VP_BOUNDARY = { name: "1023x800", width: 1023, height: 800 };

// ── Blind variant map ──
type VariantLetter = "X" | "Y";

interface D4VariantMap {
  X?: string;
  Y?: string;
}

function loadVariantMap(): Record<VariantLetter, string> {
  const raw = JSON.parse(readFileSync(MAP_FILE, "utf8")) as D4VariantMap;
  const x = raw.X;
  const y = raw.Y;
  const legal = (v: string | undefined) => v === "13" || v === "14";
  if (!legal(x) || !legal(y) || x === y) {
    throw new Error(
      `invalid D4 variant map at ${MAP_FILE}: X=${String(x)} Y=${String(y)}`,
    );
  }
  return { X: x as string, Y: y as string };
}
const MAP = loadVariantMap();

/** rem value for a header candidate px (product uses rem units). */
const HEADER_REM: Record<string, string> = {
  "13": "0.8125rem",
  "14": "0.875rem",
};

/**
 * Experiment-only CSS per variant letter. The common D2 baseline block is
 * byte-identical in both arms (15px convergence UP: body recipes + governed
 * table cells raised onto the product's existing 15px text-sm control tier).
 * The ONLY line that differs between arms is the table-head font-size.
 * `!important` isolates against cascade order; line-height/weight are never
 * injected — the product's fixed 20px/500 header values are the experiment's
 * frozen constants and are re-proved per capture.
 */
function variantCss(variant: VariantLetter): string {
  const header = HEADER_REM[MAP[variant]];
  if (!header) {
    throw new Error(`no header rem for ${MAP[variant]}px (variant ${variant})`);
  }
  return [
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D2 = 15px ──
    ".type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }",
    '[data-slot="table-cell"] { font-size: 0.9375rem !important; }',
    // ── D4 VARIABLE (the only cross-arm difference) ──
    `[data-slot="table-head"] { font-size: ${header} !important; }`,
  ].join("\n");
}

// ── Style-proof targets ──
// `tier: "d4"` targets carry the experiment variable and MUST differ between
// the arms. `tier: "baseline"` targets are the frozen D2 tier and must equal
// 15px in BOTH arms (absolute check — establishes the common baseline).
// `tier: "external"` targets are untouched context. Any non-d4 target that
// moves between arms is CROSS-VARIABLE CONTAMINATION.
interface StyleTarget {
  name: string;
  selector: string;
  tier: "d4" | "baseline" | "external";
  /** Prefer the first visible match that actually renders text (skips
   * icon-only buttons that share the selector). */
  withText?: boolean;
}

const TABLE_SURFACE_TARGETS: StyleTarget[] = [
  { name: "body", selector: "body", tier: "external" },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "baseline",
  },
  { name: "page-heading", selector: ".type-page-title", tier: "external" },
  {
    name: "page-secondary-text",
    selector: ".type-secondary",
    tier: "baseline",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4",
  },
  { name: "table-td", selector: '[data-slot="table-cell"]', tier: "baseline" },
  { name: "button", selector: "main button", tier: "baseline", withText: true },
  { name: "input", selector: "main input", tier: "baseline" },
];

const STYLE_TARGETS: Record<string, StyleTarget[]> = {
  "exam-list": TABLE_SURFACE_TARGETS,
  questions: TABLE_SURFACE_TARGETS,
  "audit-logs": TABLE_SURFACE_TARGETS,
  users: TABLE_SURFACE_TARGETS,
};

// ── Evidence structures ──
interface StyleRecord {
  target: string;
  selector: string;
  tier: string;
  found: boolean;
  fontSize: string | null;
  lineHeight: string | null;
  fontFamily: string | null;
  fontWeight: string | null;
  color: string | null;
  letterSpacing: string | null;
  backgroundColor: string | null;
  paddingLeft: string | null;
  paddingRight: string | null;
  paddingTop: string | null;
  paddingBottom: string | null;
  height: string | null;
}

interface FontGateRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  bodyFontFamily: string | null;
  harmonyInStack: boolean;
  check400: boolean;
  check500: boolean;
  pass: boolean;
}

interface HeaderCellFacts {
  index: number;
  clientHeight: number;
  /** distinct Range line boxes over the header's text nodes */
  textLines: number;
  wrapped: boolean;
  clipped: boolean;
  textOverflow: string | null;
}

interface StructuralTableRecord {
  archetype: string | null;
  tier: string | null;
  clientWidth: number | null;
  scrollWidth: number | null;
  overflowing: string | null;
  scrollEnd: string | null;
  headerRowHeight: number | null;
  headerCells: HeaderCellFacts[];
  /** max |th.right − td.right| over shared column indexes (px) */
  columnAlignmentMaxDeltaPx: number | null;
  actionColumnReachable: boolean | null;
  firstRowsHeight: number[];
  lastCellRight: number | null;
}

interface StructuralRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  docHorizontalOverflow: boolean;
  docScrollWidth: number;
  docClientWidth: number;
  governedShellCount: number;
  tables: StructuralTableRecord[];
}

interface CaptureRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  screenshot: string;
  styleProof: StyleRecord[];
  structural: StructuralRecord | null;
}

interface RepresentationChangeRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  change: "RESPONSIVE_REPRESENTATION_CHANGE";
  governedShellCount: number;
}

const captures: CaptureRecord[] = [];
const fontGates: FontGateRecord[] = [];
const structuralRecords: StructuralRecord[] = [];
const representationChanges: RepresentationChangeRecord[] = [];

// ── Fixture state ──
let seeded: SeededExam | null = null;

// ── Helpers ──
async function adminApiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()["set-cookie"] ?? "";
  const token = setCookie.match(/auth-token=([^;]+)/)?.[1] ?? "";
  expect(token).toBeTruthy();
  return token;
}

/** One admin POST with retry on 429 (APP_MODE=e2e disables rate limiting). */
async function adminPost(
  request: APIRequestContext,
  path: string,
  token: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await request.post(`${BASE_URL}${path}`, {
      data,
      headers: { Cookie: `auth-token=${token}` },
    });
    if (res.status() === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      continue;
    }
    expect(res.ok(), `POST ${path} -> ${res.status()}`).toBeTruthy();
    return (await res.json()) as Record<string, unknown>;
  }
  throw new Error(`POST ${path} rate-limited after retries`);
}

async function waitForStable(p: Page): Promise<void> {
  await p.waitForLoadState("networkidle").catch(() => undefined);
  await p.evaluate(() => document.fonts.ready.then(() => undefined));
  await p.waitForTimeout(250);
}

function variantContext(
  browser: Browser,
  variant: VariantLetter,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const css = variantCss(variant);
  return browser
    .newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    })
    .then(async (ctx) => {
      await ctx.addInitScript(
        ({ id, cssText }: { id: string; cssText: string }) => {
          // A <style> appended outside <head> (document.head is null at
          // document-start) is ignored by the CSS engine, so install only
          // into head: no-op until head exists, then (re)install on
          // DOMContentLoaded/load. The SPA keeps its head for the session.
          const install = () => {
            if (!document.head) return;
            if (document.getElementById(id)) return;
            const el = document.createElement("style");
            el.id = id;
            el.textContent = cssText;
            document.head.appendChild(el);
          };
          install();
          document.addEventListener("DOMContentLoaded", install);
          window.addEventListener("load", install);
        },
        { id: STYLE_ID, cssText: css },
      );
      return ctx;
    });
}

async function runFontGate(
  p: Page,
  surface: string,
  variant: VariantLetter,
  viewport: string,
): Promise<void> {
  await p.evaluate(() => document.fonts.ready.then(() => undefined));
  const gate = await p.evaluate(() => {
    const stack = getComputedStyle(document.body).fontFamily;
    return {
      bodyFontFamily: stack,
      harmonyInStack: stack.includes("HarmonyOS Sans SC"),
      check400: document.fonts.check('14px "HarmonyOS Sans SC"'),
      check500: document.fonts.check('500 14px "HarmonyOS Sans SC"'),
    };
  });
  const record: FontGateRecord = {
    surface,
    variant,
    viewport,
    ...gate,
    pass: gate.harmonyInStack && gate.check400 && gate.check500,
  };
  fontGates.push(record);
  if (!record.pass) {
    // Fallback invalidates the experiment — stop instead of capturing.
    throw new Error(
      `EXPERIMENT_INVALID: font gate failed on ${surface}/${variant}@${viewport} ` +
        `stack=${gate.bodyFontFamily} check400=${gate.check400} check500=${gate.check500}`,
    );
  }
}

/** Loud gate for the injection itself (silent no-op invalidates evidence). */
async function assertVariantStyleApplied(
  p: Page,
  surface: string,
  variant: VariantLetter,
): Promise<void> {
  const applied = await p.evaluate((id) => {
    const el = document.getElementById(id);
    return (
      el != null &&
      el.parentNode === document.head &&
      /font-size\s*:[^;]*!important/.test(el.textContent ?? "")
    );
  }, STYLE_ID);
  if (!applied) {
    throw new Error(
      `EXPERIMENT_INVALID: variant style not installed in head on ${surface}/${variant}`,
    );
  }
}

async function collectStyleProof(
  p: Page,
  surface: string,
): Promise<StyleRecord[]> {
  const targets = STYLE_TARGETS[surface] ?? [];
  return p.evaluate((defs) => {
    const pick = (el: Element | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        color: s.color,
        letterSpacing: s.letterSpacing,
        backgroundColor: s.backgroundColor,
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        paddingTop: s.paddingTop,
        paddingBottom: s.paddingBottom,
        height: s.height,
      };
    };
    const visible = (el: Element | null): el is Element =>
      el != null &&
      (el as HTMLElement).offsetParent !== null &&
      el.getBoundingClientRect().width > 0;
    return defs.map((d) => {
      const matches = Array.from(document.querySelectorAll(d.selector)).filter(
        visible,
      );
      const el = d.withText
        ? (matches.find((m) => (m.textContent ?? "").trim().length > 0) ??
          matches[0])
        : matches[0];
      const props = el ? pick(el) : null;
      return {
        target: d.name,
        selector: d.selector,
        tier: d.tier,
        found: Boolean(el),
        fontSize: props?.fontSize ?? null,
        lineHeight: props?.lineHeight ?? null,
        fontFamily: props?.fontFamily ?? null,
        fontWeight: props?.fontWeight ?? null,
        color: props?.color ?? null,
        letterSpacing: props?.letterSpacing ?? null,
        backgroundColor: props?.backgroundColor ?? null,
        paddingLeft: props?.paddingLeft ?? null,
        paddingRight: props?.paddingRight ?? null,
        paddingTop: props?.paddingTop ?? null,
        paddingBottom: props?.paddingBottom ?? null,
        height: props?.height ?? null,
      };
    });
  }, targets);
}

/**
 * Structural sweep with D4-specific header guards. Geometry is recorded,
 * never repaired: wrapping/clipping/overflow caused by the header size are
 * evidence. A wrapped header = clientHeight exceeds one 20px line plus the
 * cell's vertical padding; clipped = content wider than the cell box.
 */
async function collectStructural(
  p: Page,
  surface: string,
  variant: VariantLetter,
  viewport: string,
): Promise<StructuralRecord> {
  const facts = await p.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const doc = document.documentElement;
    const tables = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="admin-table-shell"]'),
    ).map((shell) => {
      const scroll = shell.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      const headerRow = shell.querySelector<HTMLElement>("thead tr");
      const heads = Array.from(shell.querySelectorAll<HTMLElement>("thead th"));
      // Header text lines via Range line boxes: the header row height is
      // CSS-fixed (44/42px per archetype) and th cells stretch to it with no
      // vertical padding, so cell-rect metrics cannot see wrapping. Distinct
      // line-box tops over the header's text nodes is the DOM-native count.
      const lineBoxTops = (el: Element): number[] => {
        const tops: number[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!(n.textContent ?? "").trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.height > 0) tops.push(Math.round(rect.top));
          }
        }
        return [...new Set(tops)];
      };
      const headerCells: HeaderCellFacts[] = heads.map((th, index) => {
        const inner = th.querySelector<HTMLElement>(
          ".data-table-overflow-text",
        );
        const box = inner ?? th;
        const lines = lineBoxTops(th).length;
        return {
          index,
          clientHeight: Math.round(th.getBoundingClientRect().height),
          textLines: lines,
          wrapped: lines > 1,
          clipped: box.scrollWidth > box.clientWidth + 1,
          textOverflow: getComputedStyle(box).textOverflow,
        };
      });
      const firstRow = shell.querySelector<HTMLElement>("tbody tr");
      const tds = firstRow ? Array.from(firstRow.children) : [];
      let alignmentMax: number | null = null;
      const shared = Math.min(heads.length, tds.length);
      for (let i = 0; i < shared; i++) {
        const th = heads[i];
        const td = tds[i];
        if (!th || !td) continue;
        const d = Math.abs(
          th.getBoundingClientRect().right - td.getBoundingClientRect().right,
        );
        alignmentMax = alignmentMax === null ? d : Math.max(alignmentMax, d);
      }
      const rows = Array.from(
        shell.querySelectorAll<HTMLElement>("tbody tr"),
      ).slice(0, 5);
      const lastCell = shell.querySelector<HTMLElement>(
        "tbody tr:last-child td:last-child",
      );
      const scrollRegionWidth = scroll?.clientWidth ?? 0;
      const lastHead = heads[heads.length - 1];
      const lastHeadRight = lastHead
        ? lastHead.getBoundingClientRect().right
        : 0;
      const actionReachable =
        scroll && heads.length > 0 && scrollRegionWidth > 0
          ? Math.round(lastHeadRight - scroll.getBoundingClientRect().left) <=
            scrollRegionWidth + 1
          : null;
      return {
        archetype: shell.getAttribute("data-table-archetype"),
        tier: shell.getAttribute("data-table-tier"),
        clientWidth: scroll?.clientWidth ?? null,
        scrollWidth: scroll?.scrollWidth ?? null,
        overflowing: scroll?.getAttribute("data-overflowing") ?? null,
        scrollEnd: scroll?.getAttribute("data-scroll-end") ?? null,
        headerRowHeight: headerRow
          ? Math.round(headerRow.getBoundingClientRect().height)
          : null,
        headerCells,
        columnAlignmentMaxDeltaPx:
          alignmentMax === null ? null : round(alignmentMax),
        actionColumnReachable: actionReachable,
        firstRowsHeight: rows.map((r) =>
          Math.round(r.getBoundingClientRect().height),
        ),
        lastCellRight: lastCell
          ? Math.round(lastCell.getBoundingClientRect().right)
          : null,
      };
    });
    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      tables,
    };
  });
  const record: StructuralRecord = {
    surface,
    variant,
    viewport,
    docHorizontalOverflow: facts.docScrollWidth > facts.docClientWidth + 1,
    docScrollWidth: facts.docScrollWidth,
    docClientWidth: facts.docClientWidth,
    governedShellCount: facts.tables.length,
    tables: facts.tables,
  };
  structuralRecords.push(record);
  return record;
}

/**
 * Below the lg breakpoint (1024px) some governed shells switch to a mobile
 * card representation with a pure-CSS `lg:` switch (DataTableShell `mobile`
 * slot, management-list mechanism) — the desktop table subtree is display:none
 * there. D4 table evidence stays valid only while the GOVERNED TABLE itself
 * renders (shell present AND header row actually laid out); a hidden table
 * behind a card list is a representation change, not table evidence. The
 * log-diagnostic archetype keeps horizontal scroll below lg, so it remains a
 * valid (and maximally dense) D4 boundary surface.
 */
function governedTableRendered(record: StructuralRecord): boolean {
  return (
    record.governedShellCount > 0 &&
    record.tables.every((t) => (t.headerRowHeight ?? 0) > 0)
  );
}

/** Crop constraints that snap clip edges to element boundaries or
 * whitespace, so no glyph is sliced at a crop edge. */
interface CropConstraints {
  grow?: { up?: number; down?: number; left?: number; right?: number };
  /** Clip bottom = bottom of the index-th match + pad (e.g. stop after row 3). */
  bottomOf?: { selector: string; index: number; pad?: number };
}

async function cropLocator(
  p: Page,
  selector: string,
  path: string,
  vp: { width: number; height: number },
  c: CropConstraints = {},
): Promise<boolean> {
  const grow = c.grow;
  const box = await p
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  if (!box) return false;
  // Grow the shrink-wrapped anchor box into a readable region, clamped to
  // the viewport (native pixels; no scaling before storage).
  let x = Math.max(box.x - (grow?.left ?? 0), 0);
  let y = Math.max(box.y - (grow?.up ?? 0), 0);
  let width = Math.min(
    box.width + (grow?.left ?? 0) + (grow?.right ?? 0),
    vp.width - x,
  );
  let height = Math.min(
    box.height + (grow?.up ?? 0) + (grow?.down ?? 0),
    vp.height - y,
  );
  if (c.bottomOf) {
    const b = await p
      .locator(c.bottomOf.selector)
      .nth(c.bottomOf.index)
      .boundingBox()
      .catch(() => null);
    if (b)
      height = Math.min(b.y + b.height - y + (c.bottomOf.pad ?? 6), height);
  }
  await p.screenshot({ path, clip: { x, y, width, height } });
  return true;
}

async function captureSurface(opts: {
  browser: Browser;
  surface: string;
  variant: VariantLetter;
  viewport: { name: string; width: number; height: number };
  prepare: (p: Page) => Promise<void>;
  micro: boolean;
}): Promise<void> {
  const { browser, surface, variant, viewport, prepare, micro } = opts;
  const ctx = await variantContext(browser, variant, viewport);
  const p = await ctx.newPage();
  try {
    await prepare(p);
    await assertVariantStyleApplied(p, surface, variant);
    await runFontGate(p, surface, variant, viewport.name);
    const structural = await collectStructural(
      p,
      surface,
      variant,
      viewport.name,
    );

    // Representation gate FIRST: at the boundary viewport a hidden table
    // behind the <lg card representation is recorded and excluded from the
    // evidence set; at the primary viewports a non-rendering governed table
    // invalidates the experiment.
    if (!governedTableRendered(structural)) {
      if (viewport.name === VP_BOUNDARY.name) {
        representationChanges.push({
          surface,
          variant,
          viewport: viewport.name,
          change: "RESPONSIVE_REPRESENTATION_CHANGE",
          governedShellCount: structural.governedShellCount,
        });
        progressLog(
          OUTPUT_DIR,
          `[d4] representation change, no capture: ${surface} ${variant}@${viewport.name}`,
        );
        return;
      }
      throw new Error(
        `EXPERIMENT_INVALID: governed table not rendered on ${surface}/${variant}@${viewport.name}`,
      );
    }

    const styleProof = await collectStyleProof(p, surface);
    const th = styleProof.find((s) => s.target === "table-th");
    const td = styleProof.find((s) => s.target === "table-td");
    if (!th?.found || !td?.found) {
      throw new Error(
        `EXPERIMENT_INVALID: table head/cell not found on ${surface}/${variant}@${viewport.name}`,
      );
    }
    if (td.fontSize !== "15px") {
      throw new Error(
        `EXPERIMENT_INVALID_D2_BASELINE: table-cell is ${String(td.fontSize)}, not 15px, on ${surface}/${variant}@${viewport.name}`,
      );
    }

    const screenshot = join(
      MACRO_DIR,
      `${surface}-${variant}-${viewport.name}.png`,
    );
    await p.screenshot({ path: screenshot });
    if (micro) {
      const ok = await cropLocator(
        p,
        '[data-slot="admin-table-shell"]',
        join(MICRO_DIR, `${surface}-${variant}-${viewport.name}.png`),
        viewport,
        { bottomOf: { selector: "tbody tr", index: 2, pad: 6 } },
      );
      if (!ok) {
        progressLog(OUTPUT_DIR, `[d4] micro miss: ${surface} ${variant}`);
      }
    }
    captures.push({
      surface,
      variant,
      viewport: viewport.name,
      screenshot,
      styleProof,
      structural,
    });
    progressLog(OUTPUT_DIR, `[d4] captured ${surface} variant=${variant}`);
  } finally {
    await ctx.close();
  }
}

async function adminPrepare(route: string) {
  return async (p: Page) => {
    await loginAsAdmin(p);
    await p.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
    await waitForStable(p);
  };
}

// ── Test suite ──
test.describe.serial("UI-D4-VISUAL-AB-582", () => {
  test.beforeAll(async ({ request }) => {
    mkdirSync(MACRO_DIR, { recursive: true });
    mkdirSync(MICRO_DIR, { recursive: true });

    const token = await adminApiToken(request);
    seeded = await seedExam(request, "d4-ab", {
      timingMode: "timed_window",
      durationMinutes: 60,
    });
    const courseId = seeded.courseId;
    const stamp = Date.now();
    const seeds: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 5; i++) {
      seeds.push({
        courseId,
        type: "true_false",
        content: `判断题-D4-${stamp}-${i}`,
        standardAnswer: i % 2 === 0,
        score: 10,
        tags: [`D4-${stamp}`],
      });
    }
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "single_choice",
        content: `单选题-D4-${stamp}-${i}`,
        options: [
          { id: "a", content: "选项一" },
          { id: "b", content: "选项二", isCorrect: true },
          { id: "c", content: "选项三" },
          { id: "d", content: "选项四" },
        ],
        standardAnswer: "b",
        score: 10,
        tags: [`D4-${stamp}`],
      });
    }
    seeds.push({
      courseId,
      type: "multiple_choice",
      content: `多选题-D4-${stamp}`,
      options: [
        { id: "a", content: "选项甲", isCorrect: true },
        { id: "b", content: "选项乙", isCorrect: true },
        { id: "c", content: "选项丙" },
        { id: "d", content: "选项丁" },
      ],
      standardAnswer: ["a", "b"],
      score: 10,
      tags: [`D4-${stamp}`],
    });
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "fill_blank",
        content: `填空题-D4-${stamp}-${i}：____`,
        standardAnswer: "答案",
        score: 10,
        tags: [`D4-${stamp}`],
      });
    }
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "text_response",
        content: `论述题-D4-${stamp}-${i}`,
        standardAnswer: null,
        rubric: "按逻辑完整性给分",
        score: 20,
        tags: [`D4-${stamp}`],
      });
    }
    for (const s of seeds) {
      await adminPost(request, "/api/questions", token, s);
    }
    progressLog(OUTPUT_DIR, `[d4] seeded exam + ${seeds.length} questions`);

    // Teacher rows give the users table its role-badge + row-actions columns
    // real content (the canonical e2e seed has only the admin); the fixtures
    // themselves are not read further. The first teacher is course-assigned
    // so the audit log also carries an assignment event.
    const teacher = await createTeacherViaApi(request, {
      name: "对照教师",
      usernamePrefix: "d4-ab-teacher",
    });
    await adminPost(
      request,
      `/api/admin/users/${teacher.userId}/course-assignments`,
      token,
      { courseId },
    );
    for (let i = 1; i <= 3; i++) {
      await createTeacherViaApi(request, {
        name: `监考教师${i}`,
        usernamePrefix: `d4-ab-proctor-${i}`,
      });
    }
    progressLog(OUTPUT_DIR, "[d4] fixtures ready");

    writeFileSync(
      join(OUTPUT_DIR, "run-manifest.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE. Mapping: validity/variant-map.json.",
          runId: RUN_ID,
          issue: 582,
          variable: "D4",
          question:
            "table-header font-size, judged against a frozen 15px body/control baseline (upstream D2)",
          variants: ["X", "Y"],
          mapFileRef:
            "docs/research/exam-582-d4-visual-ab-1/validity/variant-map.json",
          frozenConstants: {
            headerLineHeight: "20px (product value, not injected)",
            headerFontWeight: "500 (product value, not injected)",
            bodyControlBaseline: "15px (common D2 block injected in BOTH arms)",
          },
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          viewports: [VP_DESKTOP, VP_NARROW, VP_BOUNDARY],
          surfaces: Object.keys(STYLE_TARGETS),
          injection:
            "addInitScript <style> — D2 baseline block (both arms) + table-head font-size (the only cross-arm difference)",
        },
        null,
        2,
      ),
    );
  });

  test("Dense tables A/B round 1 (exam-list, questions) x3 viewports", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW, VP_BOUNDARY]) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        await captureSurface({
          browser,
          surface: "exam-list",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/exams"),
          micro: true,
        });
        await captureSurface({
          browser,
          surface: "questions",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/questions"),
          micro: true,
        });
      }
    }
  });

  test("Dense tables A/B round 2 (audit-logs, users) x3 viewports", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW, VP_BOUNDARY]) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        await captureSurface({
          browser,
          surface: "audit-logs",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/audit-logs"),
          micro: true,
        });
        await captureSurface({
          browser,
          surface: "users",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/users"),
          micro: true,
        });
      }
    }
  });

  test.afterAll(async () => {
    mkdirSync(join(OUTPUT_DIR, "artifacts", "D4"), { recursive: true });

    // Style proof: raw records + cross-variant pair diffs + tier guards.
    const pairDiffs: Array<{
      key: string;
      complete: boolean;
      tier: string | null;
      xFontSize: string | null;
      yFontSize: string | null;
      fontSizeChanged: boolean;
      lineHeightX: string | null;
      lineHeightY: string | null;
      fontWeightX: string | null;
      fontWeightY: string | null;
      /** cross-arm diffs on properties the experiment must hold constant */
      controlledDiffs: string[];
      /** absolute baseline value check (tier "baseline" only) */
      baselineValueX: string | null;
      baselineValueY: string | null;
    }> = [];
    const keys = new Set(
      captures.flatMap((c) =>
        c.styleProof.map((s) => `${c.surface}@${c.viewport}:${s.target}`),
      ),
    );
    for (const key of keys) {
      const [surfaceAtViewport, target] = key.split(":");
      const pick = (variant: VariantLetter) =>
        captures
          .flatMap((c) => c.styleProof.map((s) => ({ c, s })))
          .find(
            ({ c, s }) =>
              `${c.surface}@${c.viewport}` === surfaceAtViewport &&
              s.target === target &&
              c.variant === variant,
          );
      const xRec = pick("X");
      const yRec = pick("Y");
      if (!xRec || !yRec || !xRec.s.found || !yRec.s.found) {
        pairDiffs.push({
          key,
          complete: false,
          tier: (xRec?.s ?? yRec?.s)?.tier ?? null,
          xFontSize: null,
          yFontSize: null,
          fontSizeChanged: false,
          lineHeightX: null,
          lineHeightY: null,
          fontWeightX: null,
          fontWeightY: null,
          controlledDiffs: [],
          baselineValueX: null,
          baselineValueY: null,
        });
        continue;
      }
      const controlled = [
        "fontFamily",
        "fontWeight",
        "color",
        "letterSpacing",
        "backgroundColor",
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "height",
      ] as const;
      const controlledDiffs = controlled.filter((k) => xRec.s[k] !== yRec.s[k]);
      pairDiffs.push({
        key,
        complete: true,
        tier: xRec.s.tier,
        xFontSize: xRec.s.fontSize,
        yFontSize: yRec.s.fontSize,
        fontSizeChanged: xRec.s.fontSize !== yRec.s.fontSize,
        lineHeightX: xRec.s.lineHeight,
        lineHeightY: yRec.s.lineHeight,
        fontWeightX: xRec.s.fontWeight,
        fontWeightY: yRec.s.fontWeight,
        controlledDiffs,
        baselineValueX: xRec.s.fontSize,
        baselineValueY: yRec.s.fontSize,
      });
    }

    // D4 single-variable guard: the d4 tier moves in font-size ONLY; the
    // product's fixed 20px line-height and 500 weight must hold in both arms.
    const d4Pairs = pairDiffs.filter((d) => d.complete && d.tier === "d4");
    const d4Violations = d4Pairs.filter(
      (d) =>
        !d.fontSizeChanged ||
        d.lineHeightX !== d.lineHeightY ||
        d.lineHeightX !== "20px" ||
        d.fontWeightX !== "500" ||
        d.fontWeightY !== "500" ||
        d.controlledDiffs.length > 0,
    );
    // The d4 tier must move on EVERY governed table surface — a static pair
    // would mean the header override never reached computed style.
    const d4Static = d4Pairs.filter((d) => !d.fontSizeChanged);

    // D2 common-baseline guard (absolute): baseline targets must be 15px in
    // BOTH arms — this is what makes the experiment relative to the frozen
    // D2 decision instead of production's mixed typography.
    const baselinePairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "baseline",
    );
    const baselineViolations = baselinePairs.filter(
      (d) => d.baselineValueX !== "15px" || d.baselineValueY !== "15px",
    );

    // Cross-variable contamination: NO non-d4 target may move in any
    // property (the body tier is identical CSS in both arms, so even
    // text-driven geometry must be constant).
    const nonD4Pairs = pairDiffs.filter((d) => d.complete && d.tier !== "d4");
    const contaminationViolations = nonD4Pairs.filter(
      (d) => d.fontSizeChanged || d.controlledDiffs.length > 0,
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D4", "style-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Records computed px per variant letter and therefore reveals the mapping. Judge-facing: D4/macro, D4/micro, contact sheets, judge/README.md, 04-judge-handoff.md.",
          captures: captures.map((c) => ({
            surface: c.surface,
            variant: c.variant,
            viewport: c.viewport,
            screenshot: c.screenshot,
          })),
          styleProof: captures.map((c) => ({
            surface: c.surface,
            variant: c.variant,
            viewport: c.viewport,
            records: c.styleProof,
          })),
          pairDiffs,
          guards: {
            d4SingleVariablePass:
              d4Violations.length === 0 && d4Pairs.length > 0,
            d4Violations,
            d4StaticPairs: d4Static,
            d2BaselinePass:
              baselineViolations.length === 0 && baselinePairs.length > 0,
            baselineViolations,
            crossVariableContamination:
              contaminationViolations.length === 0 ? "NONE" : "PRESENT",
            contaminationViolations,
            fontGatePass: fontGates.every((g) => g.pass),
            fontGateCount: fontGates.length,
          },
        },
        null,
        2,
      ),
    );

    // Structural: per-variant header/body facts + pairwise deltas.
    interface PairwiseStructural {
      key: string;
      rowHeightsIdentical: boolean;
      headerRowHeightX: number | null;
      headerRowHeightY: number | null;
      headerRowHeightDelta: number | null;
      wrappedHeadersX: number;
      wrappedHeadersY: number;
      maxHeaderTextLinesX: number;
      maxHeaderTextLinesY: number;
      clippedHeadersX: number;
      clippedHeadersY: number;
      alignmentMaxDeltaX: number | null;
      alignmentMaxDeltaY: number | null;
      tableOverflowX: string | null;
      tableOverflowY: string | null;
      docOverflowX: boolean;
      docOverflowY: boolean;
      clientWidthDelta: number | null;
      lastCellRightDelta: number | null;
    }
    const pairwise: PairwiseStructural[] = [];
    const structKeys = new Set(
      structuralRecords.map((r) => `${r.surface}@${r.viewport}`),
    );
    for (const key of structKeys) {
      const [surface, viewport] = key.split("@");
      const x = structuralRecords.find(
        (r) =>
          r.surface === surface && r.viewport === viewport && r.variant === "X",
      );
      const y = structuralRecords.find(
        (r) =>
          r.surface === surface && r.viewport === viewport && r.variant === "Y",
      );
      if (!x || !y) continue;
      const xt = x.tables[0];
      const yt = y.tables[0];
      const wrapped = (r: StructuralRecord) =>
        r.tables.reduce(
          (n, t) => n + t.headerCells.filter((h) => h.wrapped).length,
          0,
        );
      const clipped = (r: StructuralRecord) =>
        r.tables.reduce(
          (n, t) => n + t.headerCells.filter((h) => h.clipped).length,
          0,
        );
      const maxLines = (r: StructuralRecord) =>
        r.tables.reduce(
          (n, t) => Math.max(n, ...t.headerCells.map((h) => h.textLines)),
          0,
        );
      pairwise.push({
        key,
        rowHeightsIdentical:
          JSON.stringify(xt?.firstRowsHeight) ===
          JSON.stringify(yt?.firstRowsHeight),
        headerRowHeightX: xt?.headerRowHeight ?? null,
        headerRowHeightY: yt?.headerRowHeight ?? null,
        headerRowHeightDelta:
          xt?.headerRowHeight != null && yt?.headerRowHeight != null
            ? yt.headerRowHeight - xt.headerRowHeight
            : null,
        wrappedHeadersX: wrapped(x),
        wrappedHeadersY: wrapped(y),
        maxHeaderTextLinesX: maxLines(x),
        maxHeaderTextLinesY: maxLines(y),
        clippedHeadersX: clipped(x),
        clippedHeadersY: clipped(y),
        alignmentMaxDeltaX: xt?.columnAlignmentMaxDeltaPx ?? null,
        alignmentMaxDeltaY: yt?.columnAlignmentMaxDeltaPx ?? null,
        tableOverflowX: xt?.overflowing ?? null,
        tableOverflowY: yt?.overflowing ?? null,
        docOverflowX: x.docHorizontalOverflow,
        docOverflowY: y.docHorizontalOverflow,
        clientWidthDelta:
          xt?.clientWidth != null && yt?.clientWidth != null
            ? yt.clientWidth - xt.clientWidth
            : null,
        lastCellRightDelta:
          xt?.lastCellRight != null && yt?.lastCellRight != null
            ? yt.lastCellRight - xt.lastCellRight
            : null,
      });
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D4", "structural.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Letters only; no px mapping. Header geometry is recorded evidence, never repaired mid-experiment.",
          perVariant: structuralRecords,
          pairwise,
          representationChanges,
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "font-gate.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          gates: fontGates,
        },
        null,
        2,
      ),
    );

    progressLog(
      OUTPUT_DIR,
      `[d4] DONE: ${captures.length} captures, ` +
        `d4Pairs=${d4Pairs.length} baselinePairs=${baselinePairs.length}`,
    );
  });
});
