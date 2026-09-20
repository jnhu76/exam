/**
 * UI-D5-VISUAL-AB-582 — blind A/B evidence generation for D5 (issue #582).
 *
 * STAGE B of the #582 campaign, D5 (StatusBadge physical height). This spec
 * generates evidence ONLY — it does not choose a value, does not change any
 * production visual file, and does not adjudicate D3/D6/D7 or re-open D2/D4.
 *
 * Experiment law (single-variable isolation):
 *   - Variant CSS is injected at runtime via addInitScript; no production CSS
 *     is edited. The ONLY cross-arm difference is the `height` declaration on
 *     `[data-slot="status-badge"]`. Badge typography (12px/500/16px), padding,
 *     gap, 6px radius, 1px border, colors and icon policy are the product's
 *     own frozen values and are never injected.
 *   - COMMON BASELINE (both arms): the frozen upstream D2 decision (15px
 *     body / control tier) is established experimentally via the same
 *     convergence-up block proven in the D2/D4 campaign, byte-identical in
 *     both arms. The frozen upstream D4 decision (13px/20px/500 governed
 *     table header) is production as-built and is re-verified absolutely per
 *     capture — D5 is judged relative to that baseline, never relative to
 *     production's mixed typography.
 *   - Badge height may naturally change row height (that IS D5 evidence and
 *     is recorded, never compensated). Everything else — cell padding, row
 *     CSS, column widths, table layout — is the product's.
 *
 * Blinding: which letter (X/Y) carries which px value lives ONLY in
 * docs/research/exam-582-d5-visual-ab-1/validity/variant-map.json (independent
 * crypto coin flip). Captures, contact sheets and logs carry letters only.
 * The judge bundle is physically separated from the validity bundle.
 *
 * Non-contamination guards specific to D5:
 *   - TagBadge (`[data-slot="tag-badge"]`, currently also 22px) is probed on
 *     the questions workbench and must be identical across arms (D6 owns it).
 *   - Status-badge WIDTH and status-column width must be identical across
 *     arms (height-only change).
 *   - Icon-bearing coverage: the recovery queue renders `incidentOpen`
 *     badges (iconPolicy "show") next to text-only badges in the same rows,
 *     so both semantic forms are captured from real product data.
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh --keep-server \
 *     -- --config=playwright.patrol.config.ts patrol/ui-d5-visual-ab-582.spec.ts
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
import {
  adminApiToken,
  candidateApiToken,
  startAndSubmitAttempt,
  closeExamApi,
} from "../lib/flow";
import { PATROL_BASE_URL, progressLog } from "./patrol-fixtures";

// ── Constants ──
const BASE_URL = PATROL_BASE_URL;
const RUN_ID = `d5-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/d5-ab",
  RUN_ID,
);
const MACRO_DIR = join(OUTPUT_DIR, "artifacts", "D5", "macro");
const MICRO_DIR = join(OUTPUT_DIR, "artifacts", "D5", "micro");
const STYLE_ID = "d5-ab-variant-style";
const MAP_FILE =
  process.env.D5_MAP_FILE ??
  join(
    import.meta.dirname,
    "../../../docs/research/exam-582-d5-visual-ab-1/validity/variant-map.json",
  );

const VP_DESKTOP = { name: "1440x900", width: 1440, height: 900 };
const VP_NARROW = { name: "1100x800", width: 1100, height: 800 };
const VP_BOUNDARY = { name: "1023x800", width: 1023, height: 800 };

// ── Blind variant map ──
type VariantLetter = "X" | "Y";

interface D5VariantMap {
  X?: string;
  Y?: string;
}

function loadVariantMap(): Record<VariantLetter, string> {
  const raw = JSON.parse(readFileSync(MAP_FILE, "utf8")) as D5VariantMap;
  const x = raw.X;
  const y = raw.Y;
  const legal = (v: string | undefined) => v === "22" || v === "24";
  if (!legal(x) || !legal(y) || x === y) {
    throw new Error(
      `invalid D5 variant map at ${MAP_FILE}: X=${String(x)} Y=${String(y)}`,
    );
  }
  return { X: x as string, Y: y as string };
}
const MAP = loadVariantMap();

/** rem value for a badge height candidate (product recipe uses rem units). */
const BADGE_HEIGHT_REM: Record<string, string> = {
  "22": "1.375rem",
  "24": "1.5rem",
};

/**
 * Experiment-only CSS per variant letter. The common D2 baseline block is
 * byte-identical to the one proven in the D2/D4 campaign and installed in
 * BOTH arms. The ONLY line that differs between arms is the status-badge
 * height. `!important` isolates against cascade order; typography, padding,
 * gap, radius, border, colors and icon policy are never injected — they are
 * the experiment's frozen constants and are re-proved per capture.
 */
function variantCss(variant: VariantLetter): string {
  const height = BADGE_HEIGHT_REM[MAP[variant]];
  if (!height) {
    throw new Error(
      `no badge height rem for ${MAP[variant]}px (variant ${variant})`,
    );
  }
  return [
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D2 = 15px ──
    ".type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }",
    '[data-slot="table-cell"] { font-size: 0.9375rem !important; }',
    // ── D5 VARIABLE (the only cross-arm difference) ──
    `[data-slot="status-badge"] { height: ${height} !important; }`,
  ].join("\n");
}

// ── Style-proof targets ──
// `tier: "d5"` targets carry the experiment variable and MUST differ between
// the arms in height ONLY. `tier: "d4frozen"` is the upstream D4 authority
// (as-built product values 13px/20px/500) and must equal those absolutes in
// BOTH arms. `tier: "baseline"` targets are the frozen D2 tier and must equal
// 15px in BOTH arms. `tier: "tagprobe"` is the D6-owned TagBadge and must be
// identical across arms at its product values. `tier: "external"` targets are
// untouched context. Any non-d5 target that moves between arms is
// CROSS-VARIABLE CONTAMINATION.
interface StyleTarget {
  name: string;
  selector: string;
  tier: "d5" | "d4frozen" | "baseline" | "tagprobe" | "external";
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
    name: "page-description",
    selector: ".type-page-description",
    tier: "baseline",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
  },
  { name: "table-td", selector: '[data-slot="table-cell"]', tier: "baseline" },
  {
    name: "status-badge",
    selector: '[data-slot="status-badge"]',
    tier: "d5",
  },
  { name: "button", selector: "main button", tier: "baseline", withText: true },
  { name: "input", selector: "main input", tier: "baseline" },
];

const TAG_PROBE_TARGETS: StyleTarget[] = [
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "baseline",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
  },
  { name: "table-td", selector: '[data-slot="table-cell"]', tier: "baseline" },
  { name: "tag-badge", selector: '[data-slot="tag-badge"]', tier: "tagprobe" },
];

const STYLE_TARGETS: Record<string, StyleTarget[]> = {
  "exam-list": TABLE_SURFACE_TARGETS,
  "grading-queue": TABLE_SURFACE_TARGETS,
  "recovery-queue": TABLE_SURFACE_TARGETS,
  users: TABLE_SURFACE_TARGETS,
  scores: TABLE_SURFACE_TARGETS,
  questions: TAG_PROBE_TARGETS,
};

/** Surfaces whose captures are judged evidence (the probe produces no
 * screenshots and never enters the judge bundle). */
const JUDGED_SURFACES = [
  "exam-list",
  "grading-queue",
  "recovery-queue",
  "users",
  "scores",
];

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
  borderRadius: string | null;
  borderWidth: string | null;
  gap: string | null;
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

/** §14 computed-style + §15 geometry oracle for one rendered badge. */
interface BadgeOracle {
  index: number;
  tone: string | null;
  geometry: string | null;
  text: string;
  hasIcon: boolean;
  computedHeight: string | null;
  boundingHeight: number;
  boundingWidth: number;
  fontSize: string | null;
  fontWeight: string | null;
  lineHeight: string | null;
  paddingInline: string | null;
  gap: string | null;
  borderRadius: string | null;
  borderWidth: string | null;
  rowRect: { y: number; height: number } | null;
  cellRect: { y: number; height: number; width: number } | null;
  badgeCenterY: number;
  rowCenterY: number | null;
  cellCenterY: number | null;
  topGapInRow: number | null;
  bottomGapInRow: number | null;
  badgeCenterOffsetFromRowCenter: number | null;
  clippedByCell: boolean;
  iconTextCenterDeltaY: number | null;
}

interface HeaderCellFacts {
  index: number;
  clientHeight: number;
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
  columnAlignmentMaxDeltaPx: number | null;
  actionColumnReachable: boolean | null;
  firstRowsHeight: number[];
  visibleRowCount: number;
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
  renderedBadgeCount: number;
  tables: StructuralTableRecord[];
}

interface CaptureRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  screenshot: string;
  styleProof: StyleRecord[];
  badges: BadgeOracle[];
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
let anyIconBearingBadge = false;
let anyTextOnlyBadge = false;

// ── Fixture state ──
let objectiveExamId: string | null = null;

// ── Helpers ──
async function adminPostJson(
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
      /height\s*:[^;]*!important/.test(el.textContent ?? "")
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
        borderRadius: s.borderRadius,
        borderWidth: s.borderTopWidth,
        gap: s.gap,
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
        borderRadius: props?.borderRadius ?? null,
        borderWidth: props?.borderWidth ?? null,
        gap: props?.gap ?? null,
      };
    });
  }, targets);
}

/**
 * D5 badge oracle (§14 computed style + §15 geometry + §17 width inputs) for
 * the first `limit` visible governed badges. Every property the experiment
 * must hold constant is recorded per badge so the cross-arm diff can prove
 * height-only isolation at the instance level, not just at the style-target
 * level.
 */
async function collectBadgeOracle(p: Page, limit = 3): Promise<BadgeOracle[]> {
  return p.evaluate((max) => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const visible = (el: Element) =>
      (el as HTMLElement).offsetParent !== null &&
      el.getBoundingClientRect().width > 0;
    const badges = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="status-badge"]'),
    )
      .filter(visible)
      .slice(0, max);
    return badges.map((badge, index) => {
      const s = getComputedStyle(badge);
      const bRect = badge.getBoundingClientRect();
      const row = badge.closest("tr");
      const cell = badge.closest("td");
      const rowRect = row?.getBoundingClientRect() ?? null;
      const cellRect = cell?.getBoundingClientRect() ?? null;
      const icon = badge.querySelector("svg");
      const iconRect = icon?.getBoundingClientRect() ?? null;
      const textNode = Array.from(badge.childNodes).filter(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim(),
      )[0];
      let textRect: DOMRect | null = null;
      if (textNode) {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rects = Array.from(range.getClientRects()).filter(
          (r) => r.height > 0,
        );
        const first = rects[0];
        const last = rects[rects.length - 1];
        if (first && last) {
          textRect = new DOMRect(
            first.x,
            first.y,
            last.right - first.x,
            last.bottom - first.y,
          );
        }
      }
      const iconCenterY = iconRect ? iconRect.y + iconRect.height / 2 : null;
      const textCenterY = textRect ? textRect.y + textRect.height / 2 : null;
      return {
        index,
        tone: badge.getAttribute("data-status-tone"),
        geometry: badge.getAttribute("data-status-geometry"),
        text: (badge.textContent ?? "").trim(),
        hasIcon: icon != null,
        computedHeight: s.height,
        boundingHeight: round(bRect.height),
        boundingWidth: round(bRect.width),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        paddingInline: s.paddingLeft,
        gap: s.gap,
        borderRadius: s.borderRadius,
        borderWidth: s.borderTopWidth,
        rowRect: rowRect
          ? { y: round(rowRect.y), height: round(rowRect.height) }
          : null,
        cellRect: cellRect
          ? {
              y: round(cellRect.y),
              height: round(cellRect.height),
              width: round(cellRect.width),
            }
          : null,
        badgeCenterY: round(bRect.y + bRect.height / 2),
        rowCenterY: rowRect ? round(rowRect.y + rowRect.height / 2) : null,
        cellCenterY: cellRect ? round(cellRect.y + cellRect.height / 2) : null,
        topGapInRow: rowRect ? round(bRect.y - rowRect.y) : null,
        bottomGapInRow: rowRect ? round(rowRect.bottom - bRect.bottom) : null,
        badgeCenterOffsetFromRowCenter: rowRect
          ? round(bRect.y + bRect.height / 2 - (rowRect.y + rowRect.height / 2))
          : null,
        clippedByCell: cellRect
          ? bRect.y < cellRect.y - 0.5 || bRect.bottom > cellRect.bottom + 0.5
          : false,
        iconTextCenterDeltaY:
          iconCenterY != null && textCenterY != null
            ? round(textCenterY - iconCenterY)
            : null,
      };
    });
  }, limit);
}

/**
 * Structural sweep (§16 row-height/density guard). Geometry is recorded,
 * never repaired: row growth caused by the badge height is D5 evidence.
 * Reuses the D4 Range line-box header-wrap detector as a contamination
 * guard (the header is untouched in D5, so wrapping there would be a defect).
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
      const allRows = Array.from(
        shell.querySelectorAll<HTMLElement>("tbody tr"),
      );
      const rowRects = allRows.map((r) => r.getBoundingClientRect());
      const visibleRows = rowRects.filter((r) => r.height > 0);
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
        firstRowsHeight: visibleRows
          .slice(0, 5)
          .map((r) => Math.round(r.height)),
        visibleRowCount: visibleRows.length,
        lastCellRight: lastCell
          ? Math.round(lastCell.getBoundingClientRect().right)
          : null,
      };
    });
    const badgeCount = Array.from(
      document.querySelectorAll('[data-slot="status-badge"]'),
    ).filter(
      (el) =>
        (el as HTMLElement).offsetParent !== null &&
        el.getBoundingClientRect().width > 0,
    ).length;
    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      tables,
      badgeCount,
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
    renderedBadgeCount: facts.badgeCount,
    tables: facts.tables,
  };
  structuralRecords.push(record);
  return record;
}

/** Same governed-table predicate as the D4 harness: the shell must be
 * present AND its header row actually laid out (below-lg card switches hide
 * the desktop subtree). */
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

    // Representation gate FIRST (D4 mechanism): at the boundary viewport a
    // hidden table behind the <lg card representation is recorded and
    // excluded; at the primary viewports a non-rendering governed table
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
          `[d5] representation change, no capture: ${surface} ${variant}@${viewport.name}`,
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
    const badge = styleProof.find((s) => s.target === "status-badge");
    if (!th?.found || !td?.found || !badge?.found) {
      throw new Error(
        `EXPERIMENT_INVALID: table head/cell/status-badge not found on ${surface}/${variant}@${viewport.name}`,
      );
    }
    if (td.fontSize !== "15px") {
      throw new Error(
        `EXPERIMENT_INVALID_D2_BASELINE: table-cell is ${String(td.fontSize)}, not 15px, on ${surface}/${variant}@${viewport.name}`,
      );
    }
    if (
      th.fontSize !== "13px" ||
      th.lineHeight !== "20px" ||
      th.fontWeight !== "500"
    ) {
      throw new Error(
        `EXPERIMENT_INVALID_D4_FROZEN: table-head is ${String(th.fontSize)}/${String(th.lineHeight)}/${String(th.fontWeight)}, not 13px/20px/500, on ${surface}/${variant}@${viewport.name}`,
      );
    }

    const badges = await collectBadgeOracle(p);
    if (badges.length === 0) {
      throw new Error(
        `EXPERIMENT_INVALID: no visible status badge on ${surface}/${variant}@${viewport.name}`,
      );
    }
    if (badges.some((b) => b.hasIcon)) anyIconBearingBadge = true;
    if (badges.some((b) => !b.hasIcon)) anyTextOnlyBadge = true;

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
        progressLog(OUTPUT_DIR, `[d5] micro miss: ${surface} ${variant}`);
      }
      // Tight context crop (§20): body text | status badge | adjacent
      // column, native pixels. Anchored on the first body-row badge.
      const tightOk = await cropLocator(
        p,
        'tbody [data-slot="status-badge"]',
        join(MICRO_DIR, `${surface}-tight-${variant}-${viewport.name}.png`),
        viewport,
        { grow: { left: 170, right: 170, up: 28, down: 28 } },
      );
      if (!tightOk) {
        progressLog(OUTPUT_DIR, `[d5] tight micro miss: ${surface} ${variant}`);
      }
    }
    captures.push({
      surface,
      variant,
      viewport: viewport.name,
      screenshot,
      styleProof,
      badges,
      structural,
    });
    progressLog(OUTPUT_DIR, `[d5] captured ${surface} variant=${variant}`);
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
test.describe.serial("UI-D5-VISUAL-AB-582", () => {
  test.beforeAll(async ({ request }) => {
    mkdirSync(MACRO_DIR, { recursive: true });
    mkdirSync(MICRO_DIR, { recursive: true });

    const token = await adminApiToken(request);
    const stamp = Date.now();

    // Scores exam: submitted by 3 candidates, then FINISHED. INVARIANT: the
    // scores API rejects an open exam (EXAM_NOT_FINISHED), so this exam is
    // closed after its submissions — the score list then renders not_passed
    // (destructive, text-only) rows.
    const scoreExam = await seedExam(request, "d5-score", {
      timingMode: "timed_window",
      durationMinutes: 60,
      additionalCandidates: 2,
    });
    objectiveExamId = scoreExam.examId;
    for (const candidate of [
      scoreExam.candidate,
      ...scoreExam.extraCandidates,
    ]) {
      const candidateToken = await candidateApiToken(request, candidate);
      await startAndSubmitAttempt(request, candidateToken, scoreExam.examId);
    }
    const scoreCloseRes = await closeExamApi(request, token, scoreExam.examId);
    expect(
      scoreCloseRes.ok(),
      `close scores exam -> ${scoreCloseRes.status()}`,
    ).toBeTruthy();
    progressLog(OUTPUT_DIR, "[d5] scores exam submitted + closed");

    // Manual-grading exam: pending_manual (warning, text-only) rows.
    // INVARIANT (as-built): the grading queue lists only attempts awaiting
    // manual grading — auto-graded attempts never appear — so three
    // candidates each submit once to give the surface 3+ body rows of micro
    // evidence context.
    const man = await seedExam(request, "d5-man", {
      timingMode: "timed_window",
      durationMinutes: 60,
      additionalCandidates: 2,
      textResponseQuestions: [
        { score: 10, content: `论述题-D5-man-1` },
        { score: 10, content: `论述题-D5-man-2` },
      ],
    });
    for (const candidate of [man.candidate, ...man.extraCandidates]) {
      const candidateToken = await candidateApiToken(request, candidate);
      await startAndSubmitAttempt(request, candidateToken, man.examId);
    }
    progressLog(OUTPUT_DIR, "[d5] manual-grading exam + 3 pending attempts");

    // Recovery incidents: three UNLINKED incidents (no attempt), so the
    // queue renders three icon-bearing incidentOpen (待处理) badges.
    // INVARIANT: no live attempt is seeded on purpose — the E2E heartbeat
    // disruption scanner converts an API-started, heartbeat-less attempt
    // into NEW system incidents every 15s cycle for ~45s, which would keep
    // the queue growing between the back-to-back X/Y captures. Unlinked
    // incidents give the scanner nothing to react to and leave the queue
    // DOM static for the whole run; §4 icon-bearing coverage is carried by
    // the incidentOpen badges themselves.
    const live = await seedExam(request, "d5-live", {
      timingMode: "timed_window",
      durationMinutes: 60,
    });
    await adminPostJson(
      request,
      `/api/admin/exams/${live.examId}/incidents`,
      token,
      {
        operationId: crypto.randomUUID(),
        type: "network_interruption",
        severity: "critical",
        description: "D5 icon-bearing evidence — critical incident",
      },
    );
    // Two more unlinked incidents so the queue carries 3+ body rows for
    // micro evidence (all render the same icon-bearing open badge).
    for (let i = 1; i <= 2; i++) {
      await adminPostJson(
        request,
        `/api/admin/exams/${live.examId}/incidents`,
        token,
        {
          operationId: crypto.randomUUID(),
          type: "network_interruption",
          severity: "major",
          description: `D5 queue rows — unlinked incident ${i}`,
        },
      );
    }
    progressLog(OUTPUT_DIR, "[d5] 3 unlinked incidents (no live attempt)");

    // Closed exam (secondary tone) for the exam lifecycle vocabulary.
    const closed = await seedExam(request, "d5-closed", {
      timingMode: "timed_window",
      durationMinutes: 60,
    });
    const closeRes = await closeExamApi(request, token, closed.examId);
    expect(closeRes.ok(), `close exam -> ${closeRes.status()}`).toBeTruthy();

    // Draft exam (muted tone): created through the real exam API but never
    // published, so the exam list carries the full non-destructive lifecycle
    // vocabulary (draft / published / closed) in real rows.
    await adminPostJson(request, "/api/exams", token, {
      title: `E2E-d5-draft-${stamp}`,
      description: "",
      courseId: closed.courseId,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600_000).toISOString(),
      closeAt: new Date(Date.now() + 86400_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [closed.questionId],
      resultPublicationMode: "immediate",
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      interruptionTimePolicy: "strict",
    });
    progressLog(OUTPUT_DIR, "[d5] closed + draft exams");

    // Teachers give the users table its active/inactive status badges real
    // row content beyond the canonical admin (success + muted, text-only).
    for (let i = 1; i <= 4; i++) {
      await createTeacherViaApi(request, {
        name: `状态教师${i}`,
        usernamePrefix: `d5-ab-teacher-${i}`,
      });
    }

    // Tagged questions so the questions workbench renders [data-slot=
    // "tag-badge"] for the D6 non-contamination probe (§18). Probe-only:
    // no screenshots are taken on this surface.
    for (let i = 1; i <= 2; i++) {
      await adminPostJson(request, "/api/questions", token, {
        courseId: man.courseId,
        type: "true_false",
        content: `判断题-D5-tag-${stamp}-${i}`,
        standardAnswer: i % 2 === 0,
        score: 5,
        tags: [`D5-${stamp}`],
      });
    }
    progressLog(OUTPUT_DIR, "[d5] fixtures ready");

    // Static-DOM reconciliation (§6 same-DOM-state discipline). The
    // canonical E2E demo seed leaves live candidate attempts on the books,
    // and the environment's fast heartbeat disruption scanner re-alerts
    // them on an escalating cadence, APPENDING new incidents to the
    // recovery queue while captures run — which desynchronizes the X/Y
    // arms on that surface. Terminate every live attempt the queue exposes
    // through the real recovery force-submit command (idempotent,
    // operationId-keyed), then require two consecutive scanner periods
    // (16s) with zero live attempts before any capture. The incidents
    // already raised stay in the queue as static rows.
    let quietCycles = 0;
    for (let cycle = 0; cycle < 4 && quietCycles < 2; cycle++) {
      const res = await request.get(
        `${BASE_URL}/api/admin/recovery/incidents?page=1&pageSize=50`,
        { headers: { Cookie: `auth-token=${token}` } },
      );
      expect(res.ok(), `recovery queue fetch -> ${res.status()}`).toBeTruthy();
      const items = (
        (await res.json()) as {
          items: Array<{
            primaryAttempt?: { id: string; status: string } | null;
          }>;
        }
      ).items;
      const liveAttempts = items
        .map((it) => it.primaryAttempt)
        .filter(
          (a): a is { id: string; status: string } =>
            a != null &&
            (a.status === "in_progress" || a.status === "disrupted"),
        );
      for (const attempt of liveAttempts) {
        const fs = await request.post(
          `${BASE_URL}/api/admin/attempts/${attempt.id}/force-submit`,
          {
            headers: { Cookie: `auth-token=${token}` },
            data: {
              operationId: crypto.randomUUID(),
              reason:
                "E2E D5 static-DOM reconciliation: terminate leftover demo live attempts before blind A/B captures",
            },
          },
        );
        expect(
          fs.ok(),
          `force-submit ${attempt.id} -> ${fs.status()}`,
        ).toBeTruthy();
      }
      quietCycles = liveAttempts.length === 0 ? quietCycles + 1 : 0;
      if (quietCycles < 2) {
        await new Promise((resolve) => setTimeout(resolve, 16_000));
      }
    }
    if (quietCycles < 2) {
      throw new Error(
        "EXPERIMENT_INVALID: recovery queue not reconciled — live attempts persist",
      );
    }
    progressLog(
      OUTPUT_DIR,
      "[d5] static-DOM reconciliation: two quiet scanner cycles",
    );

    writeFileSync(
      join(OUTPUT_DIR, "run-manifest.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE. Mapping: validity/variant-map.json.",
          runId: RUN_ID,
          issue: 582,
          variable: "D5",
          question:
            "StatusBadge physical height, judged against the frozen upstream D2 (15px body/control) and D4 (13px/20px/500 table header) baselines",
          variants: ["X", "Y"],
          mapFileRef:
            "docs/research/exam-582-d5-visual-ab-1/validity/variant-map.json",
          frozenConstants: {
            badgeTypography:
              "12px / 500 / 16px line-height (product values, not injected)",
            badgePaddingGap:
              "8px inline padding, 6px gap (product values, not injected)",
            badgeRadiusBorder:
              "6px radius, 1px border (product values, not injected)",
            bodyControlBaseline: "15px (common D2 block injected in BOTH arms)",
            tableHeaderBaseline:
              "13px/20px/500 (upstream D4 as-built, verified per capture)",
          },
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          viewports: [VP_DESKTOP, VP_NARROW, VP_BOUNDARY],
          surfaces: Object.keys(STYLE_TARGETS),
          judgedSurfaces: JUDGED_SURFACES,
          injection:
            "addInitScript <style> — D2 baseline block (both arms) + status-badge height (the only cross-arm difference)",
        },
        null,
        2,
      ),
    );
  });

  test("D5 A/B round 1 (exam-list, grading-queue) x2 viewports", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW]) {
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
          surface: "grading-queue",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/grading-queue"),
          micro: true,
        });
      }
    }
  });

  test("D5 A/B round 2 (recovery-queue x3 viewports, users, scores)", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      // log-diagnostic archetype: the governed table (with horizontal
      // scroll) survives below lg, so the boundary viewport is valid here.
      for (const viewport of [VP_DESKTOP, VP_NARROW, VP_BOUNDARY]) {
        await captureSurface({
          browser,
          surface: "recovery-queue",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/recovery"),
          micro: true,
        });
      }
      await captureSurface({
        browser,
        surface: "users",
        variant,
        viewport: VP_DESKTOP,
        prepare: await adminPrepare("/admin/users"),
        micro: true,
      });
      await captureSurface({
        browser,
        surface: "users",
        variant,
        viewport: VP_NARROW,
        prepare: await adminPrepare("/admin/users"),
        micro: true,
      });
      await captureSurface({
        browser,
        surface: "scores",
        variant,
        viewport: VP_DESKTOP,
        prepare: await adminPrepare(
          `/admin/exams/${String(objectiveExamId)}/scores`,
        ),
        micro: true,
      });
      await captureSurface({
        browser,
        surface: "scores",
        variant,
        viewport: VP_NARROW,
        prepare: await adminPrepare(
          `/admin/exams/${String(objectiveExamId)}/scores`,
        ),
        micro: true,
      });
    }
  });

  test("TagBadge non-contamination probe (§18, validity-only)", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW]) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        const ctx = await variantContext(browser, variant, viewport);
        const p = await ctx.newPage();
        try {
          await loginAsAdmin(p);
          await p.goto(`${BASE_URL}/admin/questions`, {
            waitUntil: "domcontentloaded",
          });
          await waitForStable(p);
          await assertVariantStyleApplied(p, "questions", variant);
          const proof = await collectStyleProof(p, "questions");
          const tag = proof.find((s) => s.target === "tag-badge");
          if (!tag?.found) {
            throw new Error(
              `EXPERIMENT_INVALID: no visible tag-badge on questions/${variant}@${viewport.name}`,
            );
          }
          captures.push({
            surface: "questions",
            variant,
            viewport: viewport.name,
            screenshot: "",
            styleProof: proof,
            badges: [],
            structural: null,
          });
          progressLog(
            OUTPUT_DIR,
            `[d5] tag probe captured questions variant=${variant}@${viewport.name}`,
          );
        } finally {
          await ctx.close();
        }
      }
    }
  });

  test.afterAll(async () => {
    mkdirSync(join(OUTPUT_DIR, "artifacts", "D5"), { recursive: true });

    // ── Style proof: raw records + cross-variant pair diffs + tier guards ──
    interface PairDiff {
      key: string;
      complete: boolean;
      tier: string | null;
      xHeight: string | null;
      yHeight: string | null;
      heightChanged: boolean;
      controlledDiffs: string[];
      xValues: Record<string, string | null>;
      yValues: Record<string, string | null>;
    }
    const controlled = [
      "fontSize",
      "fontWeight",
      "fontFamily",
      "lineHeight",
      "color",
      "letterSpacing",
      "backgroundColor",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
      "paddingBottom",
      "height",
      "borderRadius",
      "borderWidth",
      "gap",
    ] as const;
    const pairDiffs: PairDiff[] = [];
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
          xHeight: null,
          yHeight: null,
          heightChanged: false,
          controlledDiffs: [],
          xValues: {},
          yValues: {},
        });
        continue;
      }
      const controlledDiffs = controlled.filter((k) => xRec.s[k] !== yRec.s[k]);
      const xValues: Record<string, string | null> = {};
      const yValues: Record<string, string | null> = {};
      for (const k of controlled) {
        xValues[k] = xRec.s[k];
        yValues[k] = yRec.s[k];
      }
      pairDiffs.push({
        key,
        complete: true,
        tier: xRec.s.tier,
        xHeight: xRec.s.height,
        yHeight: yRec.s.height,
        heightChanged: xRec.s.height !== yRec.s.height,
        controlledDiffs,
        xValues,
        yValues,
      });
    }

    const absolute = (d: PairDiff, prop: string, want: string): boolean =>
      d.xValues[prop] === want && d.yValues[prop] === want;

    // D5 single-variable guard: the d5 tier moves in height ONLY and holds
    // the product's frozen badge constants in both arms.
    const d5Pairs = pairDiffs.filter((d) => d.complete && d.tier === "d5");
    const d5Violations = d5Pairs.filter(
      (d) =>
        !d.heightChanged ||
        !absolute(d, "fontSize", "12px") ||
        !absolute(d, "fontWeight", "500") ||
        !absolute(d, "lineHeight", "16px") ||
        !absolute(d, "paddingLeft", "8px") ||
        !absolute(d, "paddingRight", "8px") ||
        !absolute(d, "gap", "6px") ||
        !absolute(d, "borderRadius", "6px") ||
        !absolute(d, "borderWidth", "1px") ||
        d.controlledDiffs.some((k) => k !== "height"),
    );
    const d5Static = d5Pairs.filter((d) => !d.heightChanged);

    // D2 common-baseline guard (absolute): 15px in BOTH arms.
    const baselinePairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "baseline",
    );
    const baselineViolations = baselinePairs.filter(
      (d) => !absolute(d, "fontSize", "15px") || d.controlledDiffs.length > 0,
    );

    // D4 frozen-upstream guard (absolute): 13px/20px/500 in BOTH arms.
    const d4Pairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "d4frozen",
    );
    const d4Violations = d4Pairs.filter(
      (d) =>
        !absolute(d, "fontSize", "13px") ||
        !absolute(d, "lineHeight", "20px") ||
        !absolute(d, "fontWeight", "500") ||
        d.controlledDiffs.length > 0,
    );

    // TagBadge non-contamination guard (§18): identical across arms at the
    // product's own values (22px height / 400 weight). The probe target is
    // the questions workbench tag column, whose compact-table variant recipe
    // carries a 3px radius (0.1875rem) — the default variant's 4px does not
    // apply there.
    const tagPairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "tagprobe",
    );
    const tagViolations = tagPairs.filter(
      (d) =>
        d.controlledDiffs.length > 0 ||
        !absolute(d, "height", "22px") ||
        !absolute(d, "fontWeight", "400") ||
        !absolute(d, "borderRadius", "3px"),
    );

    // Cross-variable contamination: no tier other than d5 may move at all.
    const nonD5Pairs = pairDiffs.filter((d) => d.complete && d.tier !== "d5");
    const contaminationViolations = nonD5Pairs.filter(
      (d) => d.heightChanged || d.controlledDiffs.length > 0,
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D5", "style-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Records computed px per variant letter and therefore reveals the mapping. Judge-facing: D5/macro, D5/micro, contact sheets, judge/README.md, 04-judge-handoff.md.",
          captures: captures
            .filter((c) => JUDGED_SURFACES.includes(c.surface))
            .map((c) => ({
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
          badgeOracle: captures
            .filter((c) => JUDGED_SURFACES.includes(c.surface))
            .map((c) => ({
              surface: c.surface,
              variant: c.variant,
              viewport: c.viewport,
              badges: c.badges,
            })),
          pairDiffs,
          guards: {
            d5SingleVariablePass:
              d5Violations.length === 0 && d5Pairs.length > 0,
            d5Violations,
            d5StaticPairs: d5Static,
            d2BaselinePass:
              baselineViolations.length === 0 && baselinePairs.length > 0,
            baselineViolations,
            d4FrozenPass: d4Violations.length === 0 && d4Pairs.length > 0,
            d4Violations,
            tagBadgeNonContaminationPass:
              tagViolations.length === 0 && tagPairs.length > 0,
            tagViolations,
            crossVariableContamination:
              contaminationViolations.length === 0 ? "NONE" : "PRESENT",
            contaminationViolations,
            fontGatePass: fontGates.every((g) => g.pass),
            fontGateCount: fontGates.length,
            iconBearingCoverage: anyIconBearingBadge
              ? "PASS"
              : "COVERAGE_GAP_ICON_VARIANT",
            textOnlyCoverage: anyTextOnlyBadge
              ? "PASS"
              : "COVERAGE_GAP_TEXT_ONLY",
          },
        },
        null,
        2,
      ),
    );

    // ── Geometry proof (§15/§17): per-badge pairwise deltas ──
    interface GeometryPair {
      key: string;
      badgeWidthX: number | null;
      badgeWidthY: number | null;
      badgeWidthDelta: number | null;
      statusCellWidthX: number | null;
      statusCellWidthY: number | null;
      statusCellWidthDelta: number | null;
      rowHeightX: number | null;
      rowHeightY: number | null;
      rowHeightDelta: number | null;
      centerOffsetFromRowCenterX: number | null;
      centerOffsetFromRowCenterY: number | null;
      topGapInRowX: number | null;
      topGapInRowY: number | null;
      bottomGapInRowX: number | null;
      bottomGapInRowY: number | null;
      clippedByCellX: boolean[];
      clippedByCellY: boolean[];
      iconTextCenterDeltaYX: (number | null)[];
      iconTextCenterDeltaYY: (number | null)[];
      tonesX: (string | null)[];
      tonesY: (string | null)[];
      textsX: string[];
      textsY: string[];
      hasIconX: boolean[];
      hasIconY: boolean[];
    }
    const geometryPairs: GeometryPair[] = [];
    const geoKeys = new Set(
      captures
        .filter((c) => JUDGED_SURFACES.includes(c.surface))
        .map((c) => `${c.surface}@${c.viewport}`),
    );
    for (const key of geoKeys) {
      const [surface, viewport] = key.split("@");
      const x = captures.find(
        (c) =>
          c.surface === surface && c.viewport === viewport && c.variant === "X",
      );
      const y = captures.find(
        (c) =>
          c.surface === surface && c.viewport === viewport && c.variant === "Y",
      );
      if (!x || !y) continue;
      const xb = x.badges[0];
      const yb = y.badges[0];
      if (!xb || !yb) continue;
      geometryPairs.push({
        key,
        badgeWidthX: xb.boundingWidth,
        badgeWidthY: yb.boundingWidth,
        badgeWidthDelta:
          xb.boundingWidth != null && yb.boundingWidth != null
            ? Math.round((yb.boundingWidth - xb.boundingWidth) * 10) / 10
            : null,
        statusCellWidthX: xb.cellRect?.width ?? null,
        statusCellWidthY: yb.cellRect?.width ?? null,
        statusCellWidthDelta:
          xb.cellRect?.width != null && yb.cellRect?.width != null
            ? Math.round((yb.cellRect.width - xb.cellRect.width) * 10) / 10
            : null,
        rowHeightX: xb.rowRect?.height ?? null,
        rowHeightY: yb.rowRect?.height ?? null,
        rowHeightDelta:
          xb.rowRect?.height != null && yb.rowRect?.height != null
            ? yb.rowRect.height - xb.rowRect.height
            : null,
        centerOffsetFromRowCenterX: xb.badgeCenterOffsetFromRowCenter,
        centerOffsetFromRowCenterY: yb.badgeCenterOffsetFromRowCenter,
        topGapInRowX: xb.topGapInRow,
        topGapInRowY: yb.topGapInRow,
        bottomGapInRowX: xb.bottomGapInRow,
        bottomGapInRowY: yb.bottomGapInRow,
        clippedByCellX: x.badges.map((b) => b.clippedByCell),
        clippedByCellY: y.badges.map((b) => b.clippedByCell),
        iconTextCenterDeltaYX: x.badges.map((b) => b.iconTextCenterDeltaY),
        iconTextCenterDeltaYY: y.badges.map((b) => b.iconTextCenterDeltaY),
        tonesX: x.badges.map((b) => b.tone),
        tonesY: y.badges.map((b) => b.tone),
        textsX: x.badges.map((b) => b.text),
        textsY: y.badges.map((b) => b.text),
        hasIconX: x.badges.map((b) => b.hasIcon),
        hasIconY: y.badges.map((b) => b.hasIcon),
      });
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D5", "geometry.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Per-badge geometry pairs (letters only, no px mapping). Width deltas are contamination inputs; row-height deltas are D5 evidence.",
          perCapture: captures
            .filter((c) => JUDGED_SURFACES.includes(c.surface))
            .map((c) => ({
              surface: c.surface,
              variant: c.variant,
              viewport: c.viewport,
              badges: c.badges,
            })),
          pairs: geometryPairs,
        },
        null,
        2,
      ),
    );

    // ── Structural: per-variant facts + pairwise deltas ──
    interface PairwiseStructural {
      key: string;
      rowHeightsIdentical: boolean;
      rowHeightDeltas: (number | null)[];
      headerRowHeightX: number | null;
      headerRowHeightY: number | null;
      wrappedHeadersX: number;
      wrappedHeadersY: number;
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
      visibleRowCountX: number | null;
      visibleRowCountY: number | null;
      renderedBadgeCountX: number | null;
      renderedBadgeCountY: number | null;
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
      const rowDeltas = (xt?.firstRowsHeight ?? []).map((h, i) => {
        const yh = yt?.firstRowsHeight[i];
        return yh == null ? null : yh - h;
      });
      pairwise.push({
        key,
        rowHeightsIdentical:
          JSON.stringify(xt?.firstRowsHeight) ===
          JSON.stringify(yt?.firstRowsHeight),
        rowHeightDeltas: rowDeltas,
        headerRowHeightX: xt?.headerRowHeight ?? null,
        headerRowHeightY: yt?.headerRowHeight ?? null,
        wrappedHeadersX: wrapped(x),
        wrappedHeadersY: wrapped(y),
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
        visibleRowCountX: xt?.visibleRowCount ?? null,
        visibleRowCountY: yt?.visibleRowCount ?? null,
        renderedBadgeCountX: x.renderedBadgeCount,
        renderedBadgeCountY: y.renderedBadgeCount,
      });
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D5", "structural.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Letters only; no px mapping. Row growth from the badge height is recorded evidence, never repaired.",
          perVariant: structuralRecords,
          pairwise,
          representationChanges,
        },
        null,
        2,
      ),
    );

    // ── Upstream baseline proof (mapping-neutral absolutes) ──
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "upstream-baseline.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          d2CommonBaseline: {
            declared:
              "15px body/control tier in BOTH arms (upstream D2 freeze)",
            pass: baselineViolations.length === 0 && baselinePairs.length > 0,
            completePairs: baselinePairs.length,
            violations: baselineViolations.map((d) => d.key),
          },
          d4FrozenUpstream: {
            declared:
              "13px/20px/500 governed table header in BOTH arms (upstream D4 freeze, as-built)",
            pass: d4Violations.length === 0 && d4Pairs.length > 0,
            completePairs: d4Pairs.length,
            violations: d4Violations.map((d) => d.key),
          },
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
      `[d5] DONE: ${captures.length} captures, ` +
        `d5Pairs=${d5Pairs.length} baselinePairs=${baselinePairs.length} ` +
        `d4Pairs=${d4Pairs.length} tagPairs=${tagPairs.length} ` +
        `d5Violations=${d5Violations.length} baselineViolations=${baselineViolations.length} ` +
        `d4Violations=${d4Violations.length} tagViolations=${tagViolations.length} ` +
        `contamination=${contaminationViolations.length}`,
    );
  });
});
