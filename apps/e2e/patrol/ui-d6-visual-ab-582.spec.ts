/**
 * UI-D6-VISUAL-AB-582 — blind A/B evidence generation for D6 (issue #582).
 *
 * STAGE B of the #582 campaign, D6 (TagBadge font weight 400 vs 500). This
 * spec generates evidence ONLY — it does not choose a value, does not change
 * any production visual file, and does not adjudicate D3/D7 or re-open
 * D2/D4/D5. #590 (dense-table cell fitting) is a separate defect family and
 * is not exercised here beyond recording natural geometry.
 *
 * Experiment law (single-variable isolation):
 *   - Variant CSS is injected at runtime via addInitScript; no production CSS
 *     is edited. The ONLY cross-arm difference is the `font-weight`
 *     declaration, applied to the WHOLE TagBadge owner (the weight lives in
 *     both the base block and the compact-table block of badge/recipes.css,
 *     so the candidate must authoritative both — D6 §7).
 *   - COMMON BASELINE (both arms): the frozen upstream D2 decision (15px
 *     body / control tier) via the same convergence-up block proven in the
 *     D2/D4/D5 campaign, byte-identical in both arms. The frozen upstream D4
 *     decision (13px/20px/500 governed table header) and the frozen D5
 *     decision (22px StatusBadge) are production as-built and re-verified
 *     per capture.
 *   - Weight may naturally change glyph metrics and therefore badge width,
 *     cluster wrapping, +N position and row height. These are CAUSAL
 *     GEOMETRY EFFECTS — recorded evidence, never compensated and never
 *     classified as contamination (only a direct non-weight CSS property
 *     moving would be).
 *
 * Evidence surface: Question Management (/admin/questions) is the ONLY real
 * production TagBadge consumer (variant="compact-table" tag columns; the
 * default variant has no runtime instance). The server-side search filters
 * the table to the 8 fixture rows so the header band and every micro target
 * fit one viewport — the identical filter is applied in BOTH arms.
 *
 * Blinding: which letter (X/Y) carries which weight lives ONLY in
 * docs/research/exam-582-d6-visual-ab-1/validity/variant-map.json (independent
 * crypto coin flip). Captures, contact sheets and logs carry letters only.
 * The judge bundle is physically separated from the validity bundle.
 *
 * Non-contamination guards specific to D6:
 *   - `[data-slot="tag-overflow"]` (+N chip) is a local Question Management
 *     indicator, NOT a TagBadge — its computed typography must stay at the
 *     product's own values (400 weight) in both arms; position shifts caused
 *     by wider/narrower badges are causal geometry.
 *   - StatusBadge (`[data-slot="status-badge"]`, frozen D5) is probed on
 *     /admin/exams with the D6 injection active — identical across arms.
 *   - shadcn Badge (question type), role pills, audit-log pills are NOT
 *     TagBadge and are covered by the cross-variable contamination guard.
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh --keep-server \
 *     -- --config=playwright.patrol.config.ts patrol/ui-d6-visual-ab-582.spec.ts
 */
import {
  test,
  expect,
  type Page,
  type Browser,
  type BrowserContext,
  type Locator,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loginAsAdmin } from "../lib/login";
import { adminApiToken } from "../lib/flow";
import { PATROL_BASE_URL, progressLog } from "./patrol-fixtures";

// ── Constants ──
const BASE_URL = PATROL_BASE_URL;
const RUN_ID = `d6-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/d6-ab",
  RUN_ID,
);
const MACRO_DIR = join(OUTPUT_DIR, "artifacts", "D6", "macro");
const MICRO_DIR = join(OUTPUT_DIR, "artifacts", "D6", "micro");
const STYLE_ID = "d6-ab-variant-style";
const MAP_FILE =
  process.env.D6_MAP_FILE ??
  join(
    import.meta.dirname,
    "../../../docs/research/exam-582-d6-visual-ab-1/validity/variant-map.json",
  );

const VP_DESKTOP = { name: "1440x900", width: 1440, height: 900 };
const VP_NARROW = { name: "1100x800", width: 1100, height: 800 };
const VP_BOUNDARY = { name: "1023x800", width: 1023, height: 800 };

/**
 * Fixture rows seeded through the real question API (§11/§12/§13). Content
 * carries the unique marker "D6" so the server-side content search selects
 * exactly these rows. Rendered order = creation order (questionRepo lists
 * createdAt ascending), deterministic under the canonical reseed.
 */
const FIXTURE_QUESTIONS: Array<{ content: string; tags: string[] }> = [
  { content: "判断题-D6-灭火器压力表指针处于绿区", tags: ["安全"] },
  { content: "判断题-D6-消防报警联动测试每季度一次", tags: ["消防安全"] },
  { content: "判断题-D6-配电箱月度巡检记录完整", tags: ["设备", "电气"] },
  {
    content: "判断题-D6-应急演练评估报告已归档",
    tags: ["设备维护", "应急处置"],
  },
  {
    content: "判断题-D6-新员工安全培训考核已通过",
    tags: ["消防安全", "安全培训", "safety"],
  },
  {
    content: "判断题-D6-高处作业审批手续齐全",
    tags: ["应急", "基础", "equipment", "PPE"],
  },
  {
    content: "判断题-D6-设备维护保养计划已批准",
    tags: ["设备维护", "电气", "应急处置", "安全", "safety"],
  },
  {
    content: "判断题-D6-综合安全大检查结果合格",
    tags: ["消防安全", "设备", "安全培训", "PPE", "equipment", "应急"],
  },
];
/** Server-side content-search term that selects exactly the fixture rows. */
const FIXTURE_SEARCH_TERM = "D6";
/** CJK probe text for the font-face loads: the fixture tag vocabulary. */
const CJK_FACE_SAMPLE = "消防安全设备应急基础电气安全培训处置灭火配电";

// ── Blind variant map ──
type VariantLetter = "X" | "Y";

interface D6VariantMap {
  X?: string;
  Y?: string;
}

function loadVariantMap(): Record<VariantLetter, string> {
  const raw = JSON.parse(readFileSync(MAP_FILE, "utf8")) as D6VariantMap;
  const x = raw.X;
  const y = raw.Y;
  const legal = (v: string | undefined) => v === "400" || v === "500";
  if (!legal(x) || !legal(y) || x === y) {
    throw new Error(
      `invalid D6 variant map at ${MAP_FILE}: X=${String(x)} Y=${String(y)}`,
    );
  }
  return { X: x as string, Y: y as string };
}
const MAP = loadVariantMap();

/**
 * Experiment-only CSS per variant letter. The common D2 baseline block is
 * byte-identical to the one proven in the D2/D4/D5 campaign and installed in
 * BOTH arms. The ONLY line that differs between arms is the TagBadge
 * font-weight, declared on BOTH owner blocks (base + compact-table) with
 * `!important` so the candidate is authoritative regardless of cascade
 * order. Nothing else — height, size, line-height, padding, radius, border,
 * colors — is ever injected; those are the product's frozen values and are
 * re-proved per capture.
 */
function variantCss(variant: VariantLetter): string {
  const weight = MAP[variant];
  return [
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D2 = 15px ──
    ".type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }",
    '[data-slot="table-cell"] { font-size: 0.9375rem !important; }',
    // ── D6 VARIABLE (the only cross-arm difference): whole TagBadge owner ──
    `[data-slot="tag-badge"],
[data-slot="tag-badge"][data-tag-variant="compact-table"] {
  font-weight: ${weight} !important;
}`,
  ].join("\n");
}

// ── Style-proof targets ──
// `tier: "d6"` targets carry the experiment variable and MUST differ between
// the arms in font-weight ONLY. `tier: "d4frozen"` is the upstream D4
// authority (as-built 13px/20px/500 table header); `tier: "baseline"` is the
// frozen D2 tier (15px); `tier: "tagoverflow"` is the +N chip (NOT a
// TagBadge — must hold the product's 400 in both arms); `tier: "statusprobe"`
// is the frozen D5 StatusBadge (22px/500, identical across arms);
// `tier: "external"` is untouched context. Any non-d6 target that moves
// between arms is CROSS-VARIABLE CONTAMINATION.
interface StyleTarget {
  name: string;
  selector: string;
  tier:
    | "d6"
    | "d4frozen"
    | "baseline"
    | "tagoverflow"
    | "statusprobe"
    | "external";
  /** Prefer the first visible match that actually renders text (skips
   * icon-only buttons that share the selector). */
  withText?: boolean;
}

const QUESTIONS_TARGETS: StyleTarget[] = [
  { name: "body", selector: "body", tier: "external" },
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
  { name: "tag-badge", selector: '[data-slot="tag-badge"]', tier: "d6" },
  {
    name: "tag-overflow",
    selector: '[data-slot="tag-overflow"]',
    tier: "tagoverflow",
  },
  { name: "button", selector: "main button", tier: "baseline", withText: true },
  { name: "input", selector: "main input", tier: "baseline" },
];

/** Validity-only probe surface (§20): StatusBadge (frozen D5) + D2/D4
 * absolutes under the D6 injection. No screenshots, never judged. */
const EXAM_LIST_PROBE_TARGETS: StyleTarget[] = [
  { name: "body", selector: "body", tier: "external" },
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
  {
    name: "status-badge",
    selector: '[data-slot="status-badge"]',
    tier: "statusprobe",
  },
  { name: "button", selector: "main button", tier: "baseline", withText: true },
];

const STYLE_TARGETS: Record<string, StyleTarget[]> = {
  questions: QUESTIONS_TARGETS,
  "exam-list-probe": EXAM_LIST_PROBE_TARGETS,
};

/** Surfaces whose captures are judged evidence. The exam-list probe is
 * validity-only and produces no screenshots. */
const JUDGED_SURFACES = ["questions"];

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
  borderColor: string | null;
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
  faceInventory: Array<{ weight: string; status: string }>;
  pass: boolean;
}

/** §15 computed-style + §17 geometry oracle for one rendered TagBadge. */
interface TagOracle {
  rowAnchor: string;
  index: number;
  text: string;
  variant: string | null;
  tone: string | null;
  geometry: string | null;
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
  borderColor: string | null;
  color: string | null;
  backgroundColor: string | null;
  fontFamily: string | null;
  textRectWidth: number | null;
  textRectHeight: number | null;
  clusterWidth: number | null;
  clusterHeight: number | null;
  clusterLines: number | null;
  cellWidth: number | null;
  rowHeight: number | null;
  nextBadgeGapPx: number | null;
  overflowChip: {
    present: boolean;
    text: string;
    boundingWidth: number;
    fontSize: string | null;
    fontWeight: string | null;
    lineHeight: string | null;
    paddingLeft: string | null;
    paddingRight: string | null;
    borderRadius: string | null;
    color: string | null;
    distanceFromPrevBadgePx: number | null;
  } | null;
}

interface StructuralTableRecord {
  archetype: string | null;
  tier: string | null;
  clientWidth: number | null;
  scrollWidth: number | null;
  overflowing: string | null;
  scrollEnd: string | null;
  headerRowHeight: number | null;
  headerWrapped: number;
  headerClipped: number;
  columnAlignmentMaxDeltaPx: number | null;
  actionColumnReachable: boolean | null;
  rowHeights: number[];
  visibleRowCount: number;
  renderedTagBadgeCount: number;
  renderedOverflowChipCount: number;
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
  tags: TagOracle[];
  structural: StructuralRecord | null;
}

interface RepresentationChangeRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  change: "RESPONSIVE_REPRESENTATION_CHANGE";
  tagbadgeContinues: boolean;
  governedShellCount: number;
}

const captures: CaptureRecord[] = [];
const fontGates: FontGateRecord[] = [];
const structuralRecords: StructuralRecord[] = [];
const representationChanges: RepresentationChangeRecord[] = [];

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

/** Load the questions workbench and filter it to the fixture rows via the
 * real server-side search. The identical filter runs in BOTH arms, so the
 * pairwise DOM identity holds by construction and is re-proved by the tag
 * oracle (same rows, same tag arrays, same order, same +N). */
async function openFixtureView(p: Page): Promise<void> {
  await loginAsAdmin(p);
  await p.goto(`${BASE_URL}/admin/questions`, {
    waitUntil: "domcontentloaded",
  });
  await waitForStable(p);
  const search = p.locator('main input[type="search"]');
  await search.fill(FIXTURE_SEARCH_TERM);
  // Debounced commit (~300ms) then server round-trip; wait for the exact
  // fixture row set. Anything else invalidates the run.
  await expect(
    p.locator('[data-slot="admin-table-shell"] tbody tr'),
  ).toHaveCount(FIXTURE_QUESTIONS.length);
  // The 4+ tag row must show its +N chip (+1/+2/+3 on the last three rows);
  // nth(2) is the six-tag row whose chip reads +3.
  await expect(p.locator('[data-slot="tag-overflow"]').nth(2)).toHaveText("+3");
  await waitForStable(p);
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

/**
 * D6 font-face gate (§16). The experiment cannot be valid if one weight
 * silently falls back: prove the production stack carries BOTH candidate
 * faces of HarmonyOS Sans SC, force-load the subsets covering the actual CJK
 * tag vocabulary at both weights, then require fonts.check for 400 AND 500.
 */
async function runFontGate(
  p: Page,
  surface: string,
  variant: VariantLetter,
  viewport: string,
): Promise<void> {
  await p.evaluate(() => document.fonts.ready.then(() => undefined));
  const gate = await p.evaluate(async (sample) => {
    await document.fonts.load(`400 12px "HarmonyOS Sans SC"`, sample);
    await document.fonts.load(`500 12px "HarmonyOS Sans SC"`, sample);
    const stack = getComputedStyle(document.body).fontFamily;
    // FontFaceSet is not an iterable in this TS lib config — use forEach.
    const inventory: Array<{ weight: string; status: string }> = [];
    document.fonts.forEach((f) => {
      if (f.family.replace(/"/g, "").includes("HarmonyOS Sans SC")) {
        inventory.push({ weight: String(f.weight), status: f.status });
      }
    });
    return {
      bodyFontFamily: stack,
      harmonyInStack: stack.includes("HarmonyOS Sans SC"),
      check400: document.fonts.check(`400 12px "HarmonyOS Sans SC"`, sample),
      check500: document.fonts.check(`500 12px "HarmonyOS Sans SC"`, sample),
      faceInventory: inventory,
    };
  }, CJK_FACE_SAMPLE);
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
      `EXPERIMENT_INVALID_FONT_WEIGHT_FACE: font gate failed on ${surface}/${variant}@${viewport} ` +
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
      /font-weight\s*:[^;]*!important/.test(el.textContent ?? "")
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
        borderColor: s.borderTopColor,
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
        borderColor: props?.borderColor ?? null,
        gap: props?.gap ?? null,
      };
    });
  }, targets);
}

/**
 * TagBadge oracle (§15 computed style + §17 geometry + §18 structural
 * guards + §19 overflow-chip non-contamination) for every visible governed
 * badge in the fixture view. `rowAnchor` is a stable content substring of
 * the owning row so the cross-arm pairing proves pairwise DOM identity
 * (same questions, same tag arrays, same order, same +N).
 */
async function collectTagOracle(p: Page, limit = 40): Promise<TagOracle[]> {
  return p.evaluate((max) => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const visible = (el: Element) =>
      (el as HTMLElement).offsetParent !== null &&
      el.getBoundingClientRect().width > 0;
    const textRectOf = (
      el: HTMLElement,
    ): {
      w: number | null;
      h: number | null;
    } => {
      let w: number | null = null;
      let h: number | null = null;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent ?? "").trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) {
          if (r.height <= 0) continue;
          w = (w ?? 0) + r.width;
          h = Math.max(h ?? 0, r.height);
        }
      }
      return { w: w == null ? null : round(w), h: h == null ? null : round(h) };
    };
    const badges = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="tag-badge"]'),
    )
      .filter(visible)
      .slice(0, max);
    return badges.map((badge, index) => {
      const s = getComputedStyle(badge);
      const bRect = badge.getBoundingClientRect();
      const row = badge.closest("tr");
      const cell = badge.closest("td");
      const cluster = badge.parentElement;
      const cRect = cluster?.getBoundingClientRect() ?? null;
      const rowRect = row?.getBoundingClientRect() ?? null;
      const cellRect = cell?.getBoundingClientRect() ?? null;
      const rowAnchor = (
        row?.querySelector("td:nth-child(2)")?.textContent ?? ""
      )
        .trim()
        .slice(0, 16);
      const siblings = cluster
        ? (Array.from(
            cluster.querySelectorAll<HTMLElement>(
              '[data-slot="tag-badge"], [data-slot="tag-overflow"]',
            ),
          ).filter(visible) as HTMLElement[])
        : [];
      const pos = siblings.indexOf(badge);
      const next = pos >= 0 ? siblings[pos + 1] : undefined;
      let nextGap: number | null = null;
      let chip: TagOracle["overflowChip"] = null;
      if (next) {
        const nRect = next.getBoundingClientRect();
        nextGap = round(nRect.left - bRect.right);
        if (next.getAttribute("data-slot") === "tag-overflow") {
          const ns = getComputedStyle(next);
          chip = {
            present: true,
            text: (next.textContent ?? "").trim(),
            boundingWidth: round(nRect.width),
            fontSize: ns.fontSize,
            fontWeight: ns.fontWeight,
            lineHeight: ns.lineHeight,
            paddingLeft: ns.paddingLeft,
            paddingRight: ns.paddingRight,
            borderRadius: ns.borderRadius,
            color: ns.color,
            distanceFromPrevBadgePx: round(nRect.left - bRect.right),
          };
        }
      }
      const badgeH = bRect.height;
      const clusterLines =
        cRect && badgeH > 0
          ? Math.round((cRect.height / badgeH) * 10) / 10
          : null;
      return {
        rowAnchor,
        index,
        text: (badge.textContent ?? "").trim(),
        variant: badge.getAttribute("data-tag-variant"),
        tone: badge.getAttribute("data-tag-tone"),
        geometry: badge.getAttribute("data-tag-geometry"),
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
        borderColor: s.borderTopColor,
        color: s.color,
        backgroundColor: s.backgroundColor,
        fontFamily: s.fontFamily,
        textRectWidth: textRectOf(badge).w,
        textRectHeight: textRectOf(badge).h,
        clusterWidth: cRect ? round(cRect.width) : null,
        clusterHeight: cRect ? round(cRect.height) : null,
        clusterLines,
        cellWidth: cellRect ? round(cellRect.width) : null,
        rowHeight: rowRect ? round(rowRect.height) : null,
        nextBadgeGapPx: nextGap,
        overflowChip: chip,
      };
    });
  }, limit);
}

/**
 * Structural sweep (§18). Geometry is recorded, never repaired: cluster
 * wrapping or row growth caused by the weight is D6 evidence. Reuses the D4
 * Range line-box header-wrap detector as a contamination guard (the header
 * is untouched in D6 — and numerically the D6 candidate equals the header
 * weight, so a broad selector would light up here).
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
      const wrappedHeads = heads.filter(
        (th) => lineBoxTops(th).length > 1,
      ).length;
      const clippedHeads = heads.filter((th) => {
        const inner = th.querySelector<HTMLElement>(
          ".data-table-overflow-text",
        );
        const box = inner ?? th;
        return box.scrollWidth > box.clientWidth + 1;
      }).length;
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
      const lastHead = heads[heads.length - 1];
      const lastHeadRight = lastHead
        ? lastHead.getBoundingClientRect().right
        : 0;
      const scrollRegionWidth = scroll?.clientWidth ?? 0;
      const actionReachable =
        scroll && heads.length > 0 && scrollRegionWidth > 0
          ? Math.round(lastHeadRight - scroll.getBoundingClientRect().left) <=
            scrollRegionWidth + 1
          : null;
      const tagBadges = Array.from(
        shell.querySelectorAll('[data-slot="tag-badge"]'),
      ).filter(
        (el) =>
          (el as HTMLElement).offsetParent !== null &&
          el.getBoundingClientRect().width > 0,
      );
      const chips = Array.from(
        shell.querySelectorAll('[data-slot="tag-overflow"]'),
      ).filter(
        (el) =>
          (el as HTMLElement).offsetParent !== null &&
          el.getBoundingClientRect().width > 0,
      );
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
        headerWrapped: wrappedHeads,
        headerClipped: clippedHeads,
        columnAlignmentMaxDeltaPx:
          alignmentMax === null ? null : round(alignmentMax),
        actionColumnReachable: actionReachable,
        rowHeights: visibleRows.map((r) => Math.round(r.height)),
        visibleRowCount: visibleRows.length,
        renderedTagBadgeCount: tagBadges.length,
        renderedOverflowChipCount: chips.length,
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

/** Same governed-table predicate as the D4/D5 harnesses: the shell must be
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
interface BandCrop {
  top: Locator;
  bottom: Locator;
  out: string;
  padTop?: number;
  padBottom?: number;
}

/** Full-shell-width band between two element edges (header band + rows),
 * native pixels, no slicing. */
async function cropBand(
  p: Page,
  vp: { width: number; height: number },
  c: BandCrop,
): Promise<boolean> {
  const shell = await p
    .locator('[data-slot="admin-table-shell"]')
    .first()
    .boundingBox()
    .catch(() => null);
  const t = await c.top.boundingBox().catch(() => null);
  const b = await c.bottom.boundingBox().catch(() => null);
  if (!shell || !t || !b) return false;
  const x = Math.max(shell.x, 0);
  const y = Math.max(t.y - (c.padTop ?? 4), 0);
  const width = Math.min(shell.width, vp.width - x);
  const height = Math.min(
    b.y + b.height - y + (c.padBottom ?? 6),
    vp.height - y,
  );
  if (width <= 0 || height <= 0) return false;
  await p.screenshot({ path: c.out, clip: { x, y, width, height } });
  return true;
}

/** Tight context crop around one badge (body text | tag badge | adjacent
 * columns), native pixels, edges clamped to the viewport. */
async function cropTight(
  p: Page,
  badge: Locator,
  vp: { width: number; height: number },
  out: string,
): Promise<boolean> {
  const box = await badge.boundingBox().catch(() => null);
  if (!box) return false;
  const grow = { left: 260, right: 260, up: 26, down: 26 };
  const x = Math.max(box.x - grow.left, 0);
  const y = Math.max(box.y - grow.up, 0);
  const width = Math.min(box.width + grow.left + grow.right, vp.width - x);
  const height = Math.min(box.height + grow.up + grow.down, vp.height - y);
  await p.screenshot({ path: out, clip: { x, y, width, height } });
  return true;
}

/** Row locators anchored on unique fixture content substrings (the row's
 * question stem — stable cross-arm identity, independent of tag matching). */
function fixtureRow(p: Page, contentSubstring: string): Locator {
  return p
    .locator('[data-slot="admin-table-shell"] tbody tr')
    .filter({ hasText: contentSubstring });
}

interface MicroPlan {
  name: string;
  topContent?: string;
  bottomContent: string;
  tightBadgeContent?: string;
}

/** §22 micro evidence plan. Bands span the full shell width and start at
 * the header band so every authoritative crop carries the §23 hierarchy:
 * 13px header / 15px body / 12px tag. */
const MICRO_PLAN: MicroPlan[] = [
  {
    name: "short-cjk",
    bottomContent: "灭火器压力表",
    tightBadgeContent: "灭火器压力表",
  },
  { name: "medium-cjk", bottomContent: "消防报警联动" },
  {
    name: "cluster-3",
    bottomContent: "安全培训考核",
    tightBadgeContent: "安全培训考核",
  },
  {
    name: "cluster-overflow",
    topContent: "高处作业审批",
    bottomContent: "综合安全大检查",
  },
  { name: "dense-rows", bottomContent: "综合安全大检查" },
];

async function captureQuestions(opts: {
  browser: Browser;
  variant: VariantLetter;
  viewport: { name: string; width: number; height: number };
}): Promise<void> {
  const { browser, variant, viewport } = opts;
  const ctx = await variantContext(browser, variant, viewport);
  const p = await ctx.newPage();
  try {
    await openFixtureView(p);
    await assertVariantStyleApplied(p, "questions", variant);
    await runFontGate(p, "questions", variant, viewport.name);
    const structural = await collectStructural(
      p,
      "questions",
      variant,
      viewport.name,
    );

    // Representation gate (D4/D5 mechanism): at the boundary viewport a
    // hidden table behind the <lg card representation is handled by the
    // dedicated card-context capture; at the primary viewports a
    // non-rendering governed table invalidates the experiment.
    if (!governedTableRendered(structural)) {
      throw new Error(
        `EXPERIMENT_INVALID: governed table not rendered on questions/${variant}@${viewport.name}`,
      );
    }

    const styleProof = await collectStyleProof(p, "questions");
    const th = styleProof.find((s) => s.target === "table-th");
    const td = styleProof.find((s) => s.target === "table-td");
    const tag = styleProof.find((s) => s.target === "tag-badge");
    const chip = styleProof.find((s) => s.target === "tag-overflow");
    if (!th?.found || !td?.found || !tag?.found || !chip?.found) {
      throw new Error(
        `EXPERIMENT_INVALID: table head/cell/tag-badge/tag-overflow not found on questions/${variant}@${viewport.name}`,
      );
    }
    if (td.fontSize !== "15px") {
      throw new Error(
        `EXPERIMENT_INVALID_D2_BASELINE: table-cell is ${String(td.fontSize)}, not 15px, on questions/${variant}@${viewport.name}`,
      );
    }
    if (
      th.fontSize !== "13px" ||
      th.lineHeight !== "20px" ||
      th.fontWeight !== "500"
    ) {
      throw new Error(
        `EXPERIMENT_INVALID_D4_FROZEN: table-head is ${String(th.fontSize)}/${String(th.lineHeight)}/${String(th.fontWeight)}, not 13px/20px/500, on questions/${variant}@${viewport.name}`,
      );
    }

    const tags = await collectTagOracle(p);
    if (tags.length === 0) {
      throw new Error(
        `EXPERIMENT_INVALID: no visible tag badge on questions/${variant}@${viewport.name}`,
      );
    }
    // §13 pairwise DOM identity preconditions: the fixture row set and the
    // 4+/+N coverage must be present in this arm. The oracle's rowAnchor is
    // the owning row's content cell truncated to 16 chars — fixture stems
    // diverge by char 8, so the truncation stays unique.
    const anchors = new Set(tags.map((t) => t.rowAnchor));
    for (const q of FIXTURE_QUESTIONS) {
      if (!anchors.has(q.content.slice(0, 16))) {
        throw new Error(
          `EXPERIMENT_INVALID: fixture row missing from oracle on questions/${variant}@${viewport.name}: ${q.content}`,
        );
      }
    }
    if (!tags.some((t) => t.overflowChip?.present)) {
      throw new Error(
        `EXPERIMENT_INVALID: no +N overflow chip captured on questions/${variant}@${viewport.name}`,
      );
    }

    // Macro: the fixture-filtered view fits one viewport by construction
    // (header + 8 rows), so the default scroll IS the deterministic macro
    // state in both arms.
    const screenshot = join(
      MACRO_DIR,
      `questions-${variant}-${viewport.name}.png`,
    );
    await p.screenshot({ path: screenshot });

    // Micro bands + tight supplements (native pixels).
    const thead = p.locator('[data-slot="admin-table-shell"] thead');
    for (const m of MICRO_PLAN) {
      const top = m.topContent ? fixtureRow(p, m.topContent) : thead;
      const bottom = fixtureRow(p, m.bottomContent);
      const ok = await cropBand(p, viewport, {
        top,
        bottom,
        out: join(
          MICRO_DIR,
          `questions-${m.name}-${variant}-${viewport.name}.png`,
        ),
      });
      if (!ok) progressLog(OUTPUT_DIR, `[d6] micro miss: ${m.name} ${variant}`);
      if (m.tightBadgeContent) {
        const tightOk = await cropTight(
          p,
          fixtureRow(p, m.tightBadgeContent)
            .locator('[data-slot="tag-badge"]')
            .first(),
          viewport,
          join(
            MICRO_DIR,
            `questions-tight-${m.name}-${variant}-${viewport.name}.png`,
          ),
        );
        if (!tightOk) {
          progressLog(
            OUTPUT_DIR,
            `[d6] tight micro miss: ${m.name} ${variant}`,
          );
        }
      }
    }

    captures.push({
      surface: "questions",
      variant,
      viewport: viewport.name,
      screenshot,
      styleProof,
      tags,
      structural,
    });
    progressLog(
      OUTPUT_DIR,
      `[d6] captured questions variant=${variant}@${viewport.name}`,
    );
  } finally {
    await ctx.close();
  }
}

/** §14 boundary viewport: below `lg` Question Management switches to the
 * MobileRecordList card representation. As-built, the card mapping OMITS the
 * tags column (role "tag-list" resolves to priority "low", and low columns
 * are dropped from cards), so governed TagBadges DISAPPEAR — 1023 is then
 * classified `TAGBADGE_CONTINUES = NO` and excluded from D6 evidence. The
 * probe records the classification; it captures a card-context pair only if
 * a future product change makes governed badges render there. */
async function captureQuestionsCard(opts: {
  browser: Browser;
  variant: VariantLetter;
  viewport: { name: string; width: number; height: number };
}): Promise<void> {
  const { browser, variant, viewport } = opts;
  const ctx = await variantContext(browser, variant, viewport);
  const p = await ctx.newPage();
  try {
    await openFixtureView(p);
    await assertVariantStyleApplied(p, "questions-card", variant);
    await runFontGate(p, "questions-card", variant, viewport.name);
    const structural = await collectStructural(
      p,
      "questions-card",
      variant,
      viewport.name,
    );
    if (governedTableRendered(structural)) {
      throw new Error(
        `EXPERIMENT_INVALID: expected card representation at ${viewport.name} on questions-card/${variant}`,
      );
    }
    const cards = p.locator('[data-slot="mobile-record-card"]');
    await expect(cards).toHaveCount(FIXTURE_QUESTIONS.length);
    const cardTags = await collectTagOracle(p);
    if (cardTags.length === 0) {
      // As-built classification (§14): no TagBadge in the card representation
      // — exclude 1023 from D6. No screenshot, no judged evidence.
      representationChanges.push({
        surface: "questions-card",
        variant,
        viewport: viewport.name,
        change: "RESPONSIVE_REPRESENTATION_CHANGE",
        tagbadgeContinues: false,
        governedShellCount: structural.governedShellCount,
      });
      progressLog(
        OUTPUT_DIR,
        `[d6] 1023 card representation owns no TagBadge — excluded from D6 (${variant})`,
      );
      return;
    }
    representationChanges.push({
      surface: "questions-card",
      variant,
      viewport: viewport.name,
      change: "RESPONSIVE_REPRESENTATION_CHANGE",
      tagbadgeContinues: true,
      governedShellCount: structural.governedShellCount,
    });
    await cards.first().evaluate((el) => {
      el.scrollIntoView({ block: "start" });
    });
    await p.waitForTimeout(250);
    const screenshot = join(
      MACRO_DIR,
      `questions-card-${variant}-${viewport.name}.png`,
    );
    await p.screenshot({ path: screenshot });
    captures.push({
      surface: "questions-card",
      variant,
      viewport: viewport.name,
      screenshot,
      styleProof: await collectStyleProof(p, "questions"),
      tags: cardTags,
      structural,
    });
    progressLog(
      OUTPUT_DIR,
      `[d6] captured questions-card variant=${variant}@${viewport.name}`,
    );
  } finally {
    await ctx.close();
  }
}

// ── Test suite ──
test.describe.serial("UI-D6-VISUAL-AB-582", () => {
  test.beforeAll(async ({ request }) => {
    mkdirSync(MACRO_DIR, { recursive: true });
    mkdirSync(MICRO_DIR, { recursive: true });

    const token = await adminApiToken(request);

    // §11/§13: real Question records persisted through the product API —
    // one course owns the fixture set; no exams, no attempts (the D6
    // evidence surface is static: nothing mutates question rows between
    // the back-to-back arm captures).
    const course = await adminPostJson(request, "/api/courses", token, {
      name: "D6-TagBadge证据课程",
      code: `E2E-d6-${Date.now()}`,
      description: "D6 blind A/B fixture course (issue 582)",
    });
    const courseId = String(course.id);
    for (const q of FIXTURE_QUESTIONS) {
      await adminPostJson(request, "/api/questions", token, {
        courseId,
        type: "true_false",
        content: q.content,
        standardAnswer: true,
        score: 5,
        tags: q.tags,
      });
    }
    progressLog(OUTPUT_DIR, "[d6] fixture course + 8 tagged questions seeded");

    writeFileSync(
      join(OUTPUT_DIR, "run-manifest.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE. Mapping: validity/variant-map.json.",
          runId: RUN_ID,
          issue: 582,
          variable: "D6",
          question:
            "TagBadge font weight (400 vs 500) for 12px metadata tags, judged against the frozen upstream D2 (15px body/control), D4 (13px/20px/500 table header) and D5 (22px StatusBadge) baselines",
          variants: ["X", "Y"],
          mapFileRef:
            "docs/research/exam-582-d6-visual-ab-1/validity/variant-map.json",
          frozenConstants: {
            tagBadgeGeometry:
              "22px height / 12px size / 6px inline padding / 4px radius (3px compact-table) — product values, not injected",
            compactTableVariant:
              "18px line-height, text-muted color — product values, not injected",
            tagOverflowChip:
              "22px / 12px / 400 weight / 18px line-height / 3px radius (workbench.css) — NOT a TagBadge, must not move",
            bodyControlBaseline: "15px (common D2 block injected in BOTH arms)",
            tableHeaderBaseline:
              "13px/20px/500 (upstream D4 as-built, verified per capture)",
            statusBadgeBaseline:
              "22px height (upstream D5 as-built, probed per arm)",
          },
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          viewports: [VP_DESKTOP, VP_NARROW, VP_BOUNDARY],
          surfaces: Object.keys(STYLE_TARGETS),
          judgedSurfaces: JUDGED_SURFACES,
          fixtureRows: FIXTURE_QUESTIONS,
          fixtureSearchTerm: FIXTURE_SEARCH_TERM,
          injection:
            "addInitScript <style> — D2 baseline block (both arms) + tag-badge font-weight on both owner blocks (the only cross-arm difference)",
        },
        null,
        2,
      ),
    );
  });

  test("D6 A/B dense-table captures (questions x2 viewports x2 arms)", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW]) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        await captureQuestions({ browser, variant, viewport });
      }
    }
  });

  test("D6 card-context capture (questions @1023, both arms)", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      await captureQuestionsCard({ browser, variant, viewport: VP_BOUNDARY });
    }
  });

  test("StatusBadge non-contamination probe (exam-list, validity-only)", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      const ctx = await variantContext(browser, variant, VP_DESKTOP);
      const p = await ctx.newPage();
      try {
        await loginAsAdmin(p);
        await p.goto(`${BASE_URL}/admin/exams`, {
          waitUntil: "domcontentloaded",
        });
        await waitForStable(p);
        await assertVariantStyleApplied(p, "exam-list-probe", variant);
        await runFontGate(p, "exam-list-probe", variant, VP_DESKTOP.name);
        const proof = await collectStyleProof(p, "exam-list-probe");
        const badge = proof.find((s) => s.target === "status-badge");
        if (!badge?.found) {
          throw new Error(
            `EXPERIMENT_INVALID: no visible status-badge on exam-list-probe/${variant}`,
          );
        }
        captures.push({
          surface: "exam-list-probe",
          variant,
          viewport: VP_DESKTOP.name,
          screenshot: "",
          styleProof: proof,
          tags: [],
          structural: null,
        });
        progressLog(
          OUTPUT_DIR,
          `[d6] status probe captured variant=${variant}`,
        );
      } finally {
        await ctx.close();
      }
    }
  });

  test.afterAll(async () => {
    // ── Style proof: raw records + cross-variant pair diffs + tier guards ──
    interface PairDiff {
      key: string;
      complete: boolean;
      tier: string | null;
      xWeight: string | null;
      yWeight: string | null;
      weightChanged: boolean;
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
      "borderColor",
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
          xWeight: null,
          yWeight: null,
          weightChanged: false,
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
        xWeight: xRec.s.fontWeight,
        yWeight: yRec.s.fontWeight,
        weightChanged: xRec.s.fontWeight !== yRec.s.fontWeight,
        controlledDiffs,
        xValues,
        yValues,
      });
    }

    const absolute = (d: PairDiff, prop: string, want: string): boolean =>
      d.xValues[prop] === want && d.yValues[prop] === want;

    // D6 single-variable guard: the d6 tier moves in font-weight ONLY and
    // holds the product's frozen TagBadge constants in both arms (§15).
    const d6Pairs = pairDiffs.filter((d) => d.complete && d.tier === "d6");
    const d6Violations = d6Pairs.filter(
      (d) =>
        !d.weightChanged ||
        !absolute(d, "height", "22px") ||
        !absolute(d, "fontSize", "12px") ||
        !absolute(d, "lineHeight", "18px") ||
        !absolute(d, "paddingLeft", "6px") ||
        !absolute(d, "paddingRight", "6px") ||
        !absolute(d, "borderRadius", "3px") ||
        !absolute(d, "borderWidth", "1px") ||
        !(d.xValues.fontFamily ?? "").includes("HarmonyOS Sans SC") ||
        !(d.yValues.fontFamily ?? "").includes("HarmonyOS Sans SC") ||
        d.controlledDiffs.some((k) => k !== "fontWeight"),
    );

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

    // Tag-overflow non-contamination guard (§19): the +N chip is NOT a
    // TagBadge — its computed typography must hold the product's own values
    // (including 400 weight) in BOTH arms.
    const chipPairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "tagoverflow",
    );
    const chipViolations = chipPairs.filter(
      (d) =>
        d.controlledDiffs.length > 0 ||
        !absolute(d, "fontWeight", "400") ||
        !absolute(d, "fontSize", "12px") ||
        !absolute(d, "lineHeight", "18px") ||
        !absolute(d, "paddingLeft", "6px") ||
        !absolute(d, "paddingRight", "6px") ||
        !absolute(d, "borderRadius", "3px"),
    );

    // StatusBadge non-contamination guard (§20): frozen D5 — 22px/500/12px,
    // 6px radius, identical across arms under the D6 injection.
    const statusPairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "statusprobe",
    );
    const statusViolations = statusPairs.filter(
      (d) =>
        d.controlledDiffs.length > 0 ||
        !absolute(d, "height", "22px") ||
        !absolute(d, "fontWeight", "500") ||
        !absolute(d, "fontSize", "12px") ||
        !absolute(d, "borderRadius", "6px"),
    );

    // Cross-variable contamination: no tier other than d6 may move at all.
    const nonD6Pairs = pairDiffs.filter((d) => d.complete && d.tier !== "d6");
    const contaminationViolations = nonD6Pairs.filter(
      (d) => d.weightChanged || d.controlledDiffs.length > 0,
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D6", "style-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Records computed px per variant letter and therefore reveals the mapping. Judge-facing: D6/macro, D6/micro, contact sheets, judge/README.md, 04-judge-handoff.md.",
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
          tagOracle: captures.map((c) => ({
            surface: c.surface,
            variant: c.variant,
            viewport: c.viewport,
            tags: c.tags,
          })),
          pairDiffs,
          guards: {
            d6SingleVariablePass:
              d6Violations.length === 0 && d6Pairs.length > 0,
            d6Violations,
            d2BaselinePass:
              baselineViolations.length === 0 && baselinePairs.length > 0,
            baselineViolations,
            d4FrozenPass: d4Violations.length === 0 && d4Pairs.length > 0,
            d4Violations,
            tagOverflowNonContaminationPass:
              chipViolations.length === 0 && chipPairs.length > 0,
            chipViolations,
            statusBadgeNonContaminationPass:
              statusViolations.length === 0 && statusPairs.length > 0,
            statusViolations,
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

    // ── Geometry proof (§17): pairwise deltas. Width/wrap/position deltas
    // are CAUSAL GEOMETRY EFFECTS of the weight (D6 §8), recorded evidence,
    // never repaired and never classified as contamination. ──
    interface GeometryPair {
      key: string;
      domIdentity: boolean;
      badgeCountX: number | null;
      badgeCountY: number | null;
      badgeWidthsX: number[];
      badgeWidthsY: number[];
      badgeWidthDeltas: number[];
      textWidthsX: (number | null)[];
      textWidthsY: (number | null)[];
      clusterHeightsX: (number | null)[];
      clusterHeightsY: (number | null)[];
      clusterLinesX: (number | null)[];
      clusterLinesY: (number | null)[];
      rowHeightsX: (number | null)[];
      rowHeightsY: (number | null)[];
      chipTextsX: string[];
      chipTextsY: string[];
      chipWidthsX: number[];
      chipWidthsY: number[];
      chipPositionDeltas: number[];
      cellWidthsX: (number | null)[];
      cellWidthsY: (number | null)[];
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
      const identity =
        JSON.stringify(x.tags.map((t) => [t.rowAnchor, t.text])) ===
        JSON.stringify(y.tags.map((t) => [t.rowAnchor, t.text]));
      const round1 = (a: number, b: number) => Math.round((b - a) * 10) / 10;
      geometryPairs.push({
        key,
        domIdentity: identity,
        badgeCountX: x.tags.length,
        badgeCountY: y.tags.length,
        badgeWidthsX: x.tags.map((t) => t.boundingWidth),
        badgeWidthsY: y.tags.map((t) => t.boundingWidth),
        badgeWidthDeltas: x.tags.map((t, i) => {
          const yv = y.tags[i]?.boundingWidth;
          return yv == null ? 0 : round1(t.boundingWidth, yv);
        }),
        textWidthsX: x.tags.map((t) => t.textRectWidth),
        textWidthsY: y.tags.map((t) => t.textRectWidth),
        clusterHeightsX: x.tags.map((t) => t.clusterHeight),
        clusterHeightsY: y.tags.map((t) => t.clusterHeight),
        clusterLinesX: x.tags.map((t) => t.clusterLines),
        clusterLinesY: y.tags.map((t) => t.clusterLines),
        rowHeightsX: x.tags.map((t) => t.rowHeight),
        rowHeightsY: y.tags.map((t) => t.rowHeight),
        chipTextsX: x.tags.flatMap((t) =>
          t.overflowChip ? [t.overflowChip.text] : [],
        ),
        chipTextsY: y.tags.flatMap((t) =>
          t.overflowChip ? [t.overflowChip.text] : [],
        ),
        chipWidthsX: x.tags.flatMap((t) =>
          t.overflowChip ? [t.overflowChip.boundingWidth] : [],
        ),
        chipWidthsY: y.tags.flatMap((t) =>
          t.overflowChip ? [t.overflowChip.boundingWidth] : [],
        ),
        chipPositionDeltas: x.tags.flatMap((t, i) => {
          const yc = y.tags[i]?.overflowChip;
          const xc = t.overflowChip;
          if (!xc || !yc) return [];
          return [
            round1(
              xc.distanceFromPrevBadgePx ?? 0,
              yc.distanceFromPrevBadgePx ?? 0,
            ),
          ];
        }),
        cellWidthsX: x.tags.map((t) => t.cellWidth),
        cellWidthsY: y.tags.map((t) => t.cellWidth),
      });
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D6", "geometry.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Per-badge geometry pairs (letters only, no weight mapping). Width/wrap deltas are causal geometry effects of the weight, not contamination.",
          pairs: geometryPairs,
          representationChanges,
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
      tableOverflowX: string | null;
      tableOverflowY: string | null;
      docOverflowX: boolean;
      docOverflowY: boolean;
      clientWidthDelta: number | null;
      visibleRowCountX: number | null;
      visibleRowCountY: number | null;
      renderedTagBadgeCountX: number | null;
      renderedTagBadgeCountY: number | null;
      renderedOverflowChipCountX: number | null;
      renderedOverflowChipCountY: number | null;
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
      const rowDeltas = (xt?.rowHeights ?? []).map((h, i) => {
        const yh = yt?.rowHeights[i];
        return yh == null ? null : yh - h;
      });
      pairwise.push({
        key,
        rowHeightsIdentical:
          JSON.stringify(xt?.rowHeights) === JSON.stringify(yt?.rowHeights),
        rowHeightDeltas: rowDeltas,
        headerRowHeightX: xt?.headerRowHeight ?? null,
        headerRowHeightY: yt?.headerRowHeight ?? null,
        wrappedHeadersX: xt?.headerWrapped ?? 0,
        wrappedHeadersY: yt?.headerWrapped ?? 0,
        clippedHeadersX: xt?.headerClipped ?? 0,
        clippedHeadersY: yt?.headerClipped ?? 0,
        tableOverflowX: xt?.overflowing ?? null,
        tableOverflowY: yt?.overflowing ?? null,
        docOverflowX: x.docHorizontalOverflow,
        docOverflowY: y.docHorizontalOverflow,
        clientWidthDelta:
          xt?.clientWidth != null && yt?.clientWidth != null
            ? yt.clientWidth - xt.clientWidth
            : null,
        visibleRowCountX: xt?.visibleRowCount ?? null,
        visibleRowCountY: yt?.visibleRowCount ?? null,
        renderedTagBadgeCountX: xt?.renderedTagBadgeCount ?? null,
        renderedTagBadgeCountY: yt?.renderedTagBadgeCount ?? null,
        renderedOverflowChipCountX: xt?.renderedOverflowChipCount ?? null,
        renderedOverflowChipCountY: yt?.renderedOverflowChipCount ?? null,
      });
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D6", "structural.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Letters only; no weight mapping. Cluster wrap or row growth from the weight is recorded evidence, never repaired.",
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
          d5FrozenUpstream: {
            declared:
              "22px/500/12px StatusBadge identical across arms (upstream D5 freeze, as-built)",
            pass: statusViolations.length === 0 && statusPairs.length > 0,
            completePairs: statusPairs.length,
            violations: statusViolations.map((d) => d.key),
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
      `[d6] DONE: ${captures.length} captures, ` +
        `d6Pairs=${d6Pairs.length} baselinePairs=${baselinePairs.length} ` +
        `d4Pairs=${d4Pairs.length} chipPairs=${chipPairs.length} statusPairs=${statusPairs.length} ` +
        `d6Violations=${d6Violations.length} baselineViolations=${baselineViolations.length} ` +
        `d4Violations=${d4Violations.length} chipViolations=${chipViolations.length} ` +
        `statusViolations=${statusViolations.length} contamination=${contaminationViolations.length}`,
    );
  });
});
