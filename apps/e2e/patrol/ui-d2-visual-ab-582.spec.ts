/**
 * UI-D2-VISUAL-AB-582 — blind A/B evidence generation for D2 (issue #582).
 *
 * STAGE B of the #582 campaign: produce the controlled A/B evidence pair for
 * D2 (body / control text size, 14px vs 15px). This spec generates evidence
 * ONLY — it does not choose a value, does not change any production visual
 * file, and does not adjudicate D4–D7.
 *
 * Experiment law (single-variable isolation):
 *   - Variant CSS is injected at runtime via addInitScript; no production CSS
 *     is edited. Only `font-size` declarations are touched; line-height,
 *     family, weight, color, radius, padding and layout are the product's.
 *   - The product currently splits the D2 tier: `.type-*` body recipes and
 *     governed table cells render 0.875rem, while the `text-sm` control tier
 *     renders 0.9375rem (`@theme inline` in index.css). D2 converges the
 *     tier at 14 or 15, so:
 *       14px variant → `.text-sm` / `.md:text-sm` lowered to 0.875rem;
 *       15px variant → body recipes + `[data-slot="table-cell"]` raised to
 *       0.9375rem.
 *   - Table headers ([data-slot="table-head"], 0.8125rem/20/500 — D4) live in
 *     apps/web/src/table/recipes.css and are structurally outside both
 *     override sets; the style proof re-checks them per capture.
 *
 * Blinding: which letter (X/Y) carries which px value lives ONLY in
 * docs/research/exam-582-d2-visual-ab-1/artifacts/variant-map.json. Captures,
 * contact sheets and logs carry letters only. style-proof.json records
 * computed px values and is therefore a validity artifact, not judge-facing.
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh --keep-server \
 *     -- --config=playwright.patrol.config.ts patrol/ui-d2-visual-ab-582.spec.ts
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

import { loginAsAdmin, loginViaUi } from "../lib/login";
import { seedExam, type SeededExam } from "../lib/seed";
import { createTeacherViaApi } from "../lib/teacher";
import { candidateApiToken, candidateStartAttempt } from "../lib/flow";
import { PATROL_BASE_URL, progressLog } from "./patrol-fixtures";

// ── Constants ──
const BASE_URL = PATROL_BASE_URL;
const RUN_ID = `d2-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/d2-ab",
  RUN_ID,
);
const MACRO_DIR = join(OUTPUT_DIR, "artifacts", "D2", "macro");
const MICRO_DIR = join(OUTPUT_DIR, "artifacts", "D2", "micro");
const STYLE_ID = "d2-ab-variant-style";
const MAP_FILE =
  process.env.D2_MAP_FILE ??
  join(
    import.meta.dirname,
    "../../../docs/research/exam-582-d2-visual-ab-1/artifacts/variant-map.json",
  );

const VP_DESKTOP = { name: "1440x900", width: 1440, height: 900 };
const VP_NARROW = { name: "1100x800", width: 1100, height: 800 };

// ── Blind variant map ──
type VariantLetter = "X" | "Y";

interface D2VariantMap {
  variable?: string;
  X?: string;
  Y?: string;
}

function loadVariantMap(): Record<VariantLetter, string> {
  const raw = JSON.parse(readFileSync(MAP_FILE, "utf8")) as D2VariantMap;
  const x = raw.X;
  const y = raw.Y;
  const legal = (v: string | undefined) => v === "14" || v === "15";
  if (!legal(x) || !legal(y) || x === y) {
    throw new Error(
      `invalid D2 variant map at ${MAP_FILE}: X=${String(x)} Y=${String(y)}`,
    );
  }
  return { X: x as string, Y: y as string };
}
const MAP = loadVariantMap();

/**
 * Experiment-only CSS per px value. ONLY font-size declarations; `!important`
 * isolates against cascade order (built CSS inlines `.text-sm` literally, so
 * an order-dependent override would be fragile). Line-height declarations are
 * deliberately absent — their product couplings (unitless 1.5 on text-sm,
 * fixed rem values on recipes/table cells) are recorded in the style proof.
 */
const VARIANT_CSS: Record<string, string> = {
  "14": [
    ".text-sm { font-size: 0.875rem !important; }",
    "@media (min-width: 48rem) { .md\\:text-sm { font-size: 0.875rem !important; } }",
  ].join("\n"),
  "15": [
    ".type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }",
    '[data-slot="table-cell"] { font-size: 0.9375rem !important; }',
  ].join("\n"),
};

// ── Style-proof targets ──
// `tier: "d2"` targets belong to the body/control text tier and MUST differ
// between the variants. `tier: "external"` targets must stay identical —
// table-th is the D4 guard (CROSS_VARIABLE_CONTAMINATION if it moves).
interface StyleTarget {
  name: string;
  selector: string;
  tier: "d2" | "external";
  /** Prefer the first visible match that actually renders text (skips
   * icon-only buttons / checkbox pills that share the selector). */
  withText?: boolean;
}

const STYLE_TARGETS: Record<string, StyleTarget[]> = {
  dashboard: [
    { name: "body", selector: "body", tier: "external" },
    {
      name: "sidebar-link",
      selector: '[data-slot="sidebar-nav-item"]',
      tier: "d2",
    },
    { name: "page-heading", selector: ".type-page-title", tier: "external" },
    { name: "page-body-text", selector: ".type-body", tier: "d2" },
    { name: "page-secondary-text", selector: ".type-secondary", tier: "d2" },
    {
      name: "table-th",
      selector: '[data-slot="table-head"]',
      tier: "external",
    },
    { name: "table-td", selector: '[data-slot="table-cell"]', tier: "d2" },
  ],
  "exam-list": [
    { name: "body", selector: "body", tier: "external" },
    {
      name: "sidebar-link",
      selector: '[data-slot="sidebar-nav-item"]',
      tier: "d2",
    },
    { name: "page-heading", selector: ".type-page-title", tier: "external" },
    {
      name: "table-th",
      selector: '[data-slot="table-head"]',
      tier: "external",
    },
    { name: "table-td", selector: '[data-slot="table-cell"]', tier: "d2" },
    { name: "button", selector: "main button", tier: "d2" },
  ],
  questions: [
    { name: "body", selector: "body", tier: "external" },
    {
      name: "sidebar-link",
      selector: '[data-slot="sidebar-nav-item"]',
      tier: "d2",
    },
    { name: "page-heading", selector: ".type-page-title", tier: "external" },
    {
      name: "table-th",
      selector: '[data-slot="table-head"]',
      tier: "external",
    },
    { name: "table-td", selector: '[data-slot="table-cell"]', tier: "d2" },
  ],
  settings: [
    { name: "body", selector: "body", tier: "external" },
    {
      name: "sidebar-link",
      selector: '[data-slot="sidebar-nav-item"]',
      tier: "d2",
    },
    { name: "page-heading", selector: ".type-page-title", tier: "external" },
    { name: "form-label", selector: "main label", tier: "d2" },
    { name: "input", selector: "main input", tier: "d2" },
    { name: "button", selector: "main button", tier: "d2" },
    { name: "helper-text", selector: "main .type-secondary", tier: "d2" },
  ],
  dialog: [
    {
      name: "dialog-heading",
      selector: '[role="dialog"] h2',
      tier: "external",
    },
    { name: "dialog-label", selector: '[role="dialog"] label', tier: "d2" },
    { name: "dialog-input", selector: '[role="dialog"] input', tier: "d2" },
    {
      name: "dialog-button",
      selector: '[role="dialog"] button',
      tier: "d2",
      withText: true,
    },
  ],
  take: [
    { name: "question-stem", selector: ".type-reading", tier: "external" },
    { name: "runtime-body", selector: "main .type-body", tier: "d2" },
    { name: "runtime-text-sm", selector: "main .text-sm", tier: "d2" },
    { name: "runtime-button", selector: "main button", tier: "d2" },
  ],
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
  borderRadius: string | null;
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

interface StructuralTableRecord {
  archetype: string | null;
  clientWidth: number | null;
  scrollWidth: number | null;
  overflowing: string | null;
  scrollEnd: string | null;
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
  tables: StructuralTableRecord[];
}

interface PillRecord {
  page: string;
  variant: VariantLetter;
  viewport: string;
  text: string;
  badgeRight: number;
  cellRight: number;
  overflowPx: number;
}

interface CaptureRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  screenshot: string;
  styleProof: StyleRecord[];
  structural: StructuralRecord | null;
}

const captures: CaptureRecord[] = [];
const fontGates: FontGateRecord[] = [];
const structuralRecords: StructuralRecord[] = [];
const pillRecords: PillRecord[] = [];

// ── Fixture state ──
let takeExam: SeededExam | null = null;
let teacher: Awaited<ReturnType<typeof createTeacherViaApi>> | null = null;
let attemptId: string | null = null;

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
  const px = MAP[variant];
  const css = VARIANT_CSS[px];
  if (!css) {
    throw new Error(`no variant CSS for ${px}px (variant ${variant})`);
  }
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
    // B6: fallback invalidates the experiment — stop instead of capturing.
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
        borderRadius: s.borderRadius,
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
        borderRadius: props?.borderRadius ?? null,
        paddingTop: props?.paddingTop ?? null,
        paddingBottom: props?.paddingBottom ?? null,
        height: props?.height ?? null,
      };
    });
  }, targets);
}

async function collectStructural(
  p: Page,
  surface: string,
  variant: VariantLetter,
  viewport: string,
): Promise<StructuralRecord> {
  const facts = await p.evaluate(() => {
    const doc = document.documentElement;
    const tables = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="admin-table-shell"]'),
    ).map((shell) => {
      const scroll = shell.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      const rows = Array.from(
        shell.querySelectorAll<HTMLElement>("tbody tr"),
      ).slice(0, 5);
      const lastCell = shell.querySelector<HTMLElement>(
        "tbody tr:last-child td:last-child",
      );
      return {
        archetype: shell.getAttribute("data-table-archetype"),
        clientWidth: scroll?.clientWidth ?? null,
        scrollWidth: scroll?.scrollWidth ?? null,
        overflowing: scroll?.getAttribute("data-overflowing") ?? null,
        scrollEnd: scroll?.getAttribute("data-scroll-end") ?? null,
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
    tables: facts.tables,
  };
  structuralRecords.push(record);
  return record;
}

/**
 * Geometry probe for the two KNOWN Phase-1 pill defects (UsersPage role
 * badge, AuditLogPage action span). These are NOT D2 targets and are not
 * fixed here; the measurement records how D2 text size moves their overflow.
 */
async function collectPillOverflow(
  p: Page,
  page: string,
  variant: VariantLetter,
  viewport: string,
): Promise<void> {
  const rows = await p.evaluate((pageKind) => {
    const selector =
      pageKind === "users"
        ? '[data-slot="admin-table-shell"] [data-slot="badge"]'
        : '[data-slot="admin-table-shell"] span.bg-primary-soft';
    const visible = (el: Element) =>
      (el as HTMLElement).offsetParent !== null &&
      el.getBoundingClientRect().width > 0;
    const out: Array<{
      text: string;
      badgeRight: number;
      cellRight: number;
      overflowPx: number;
    }> = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!visible(el) || out.length >= 6) continue;
      const cell = el.closest("td, th");
      if (!cell) continue;
      const b = el.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      out.push({
        text: (el.textContent ?? "").trim(),
        badgeRight: Math.round(b.right * 10) / 10,
        cellRight: Math.round(c.right * 10) / 10,
        overflowPx: Math.round((b.right - c.right) * 10) / 10,
      });
    }
    return out;
  }, page);
  for (const r of rows) {
    pillRecords.push({ page, variant, viewport, ...r });
  }
}

/** Crop constraints that snap clip edges to element boundaries or
 * whitespace, so no glyph is sliced at a crop edge. */
interface CropConstraints {
  grow?: { up?: number; down?: number; left?: number; right?: number };
  /** Clip bottom = bottom of the index-th match + pad (e.g. stop after row 3). */
  bottomOf?: { selector: string; index: number; pad?: number };
  /** Clip bottom = LOWEST visible match bottom + pad (e.g. include footer controls). */
  bottomOfMax?: { selector: string; pad?: number };
  /** Clip right = highest visible match right + pad (e.g. end after stat cards). */
  rightOfMax?: { selector: string; pad?: number };
  /** Clip bottom = top of the first match BELOW the anchor − pad (stop before the next section). */
  stopBefore?: { selector: string; pad?: number };
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
  const boxes = async (sel: string) => {
    const out = [];
    for (const el of await p.locator(sel).all()) {
      const b = await el.boundingBox().catch(() => null);
      if (b && b.width > 0 && b.height > 0) out.push(b);
    }
    return out;
  };
  if (c.bottomOf) {
    const b = await p
      .locator(c.bottomOf.selector)
      .nth(c.bottomOf.index)
      .boundingBox()
      .catch(() => null);
    if (b)
      height = Math.min(b.y + b.height - y + (c.bottomOf.pad ?? 6), height);
  }
  if (c.bottomOfMax) {
    let maxBottom = 0;
    for (const b of await boxes(c.bottomOfMax.selector)) {
      maxBottom = Math.max(maxBottom, b.y + b.height);
    }
    if (maxBottom > y) {
      height = Math.min(
        maxBottom - y + (c.bottomOfMax.pad ?? 12),
        vp.height - y,
      );
    }
  }
  if (c.rightOfMax) {
    let maxRight = 0;
    for (const b of await boxes(c.rightOfMax.selector)) {
      maxRight = Math.max(maxRight, b.x + b.width);
    }
    if (maxRight > x) {
      width = Math.min(maxRight - x + (c.rightOfMax.pad ?? 24), vp.width - x);
    }
  }
  if (c.stopBefore) {
    let minTop = Infinity;
    for (const b of await boxes(c.stopBefore.selector)) {
      if (b.y > box.y + box.height) minTop = Math.min(minTop, b.y);
    }
    if (Number.isFinite(minTop)) {
      height = Math.min(minTop - y - (c.stopBefore.pad ?? 10), height);
    }
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
  structural: boolean;
  micros: Array<{ name: string; selector: string } & CropConstraints>;
}): Promise<void> {
  const { browser, surface, variant, viewport, prepare, structural, micros } =
    opts;
  const ctx = await variantContext(browser, variant, viewport);
  const p = await ctx.newPage();
  try {
    await prepare(p);
    await assertVariantStyleApplied(p, surface, variant);
    await runFontGate(p, surface, variant, viewport.name);
    const screenshot = join(
      MACRO_DIR,
      `${surface}-${variant}-${viewport.name}.png`,
    );
    await p.screenshot({ path: screenshot });

    const styleProof = await collectStyleProof(p, surface);
    let structuralRecord: StructuralRecord | null = null;
    if (structural) {
      structuralRecord = await collectStructural(
        p,
        surface,
        variant,
        viewport.name,
      );
    }
    for (const m of micros) {
      const ok = await cropLocator(
        p,
        m.selector,
        join(MICRO_DIR, `${m.name}-${variant}-${viewport.name}.png`),
        viewport,
        m,
      );
      if (!ok) {
        progressLog(OUTPUT_DIR, `[d2] micro miss: ${m.name} ${variant}`);
      }
    }
    captures.push({
      surface,
      variant,
      viewport: viewport.name,
      screenshot,
      styleProof,
      structural: structuralRecord,
    });
    progressLog(OUTPUT_DIR, `[d2] captured ${surface} variant=${variant}`);
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

async function prepareDialog(p: Page): Promise<void> {
  await loginAsAdmin(p);
  await p.goto(`${BASE_URL}/admin/users`, { waitUntil: "domcontentloaded" });
  await waitForStable(p);
  if (!teacher) throw new Error("teacher fixture missing");
  const row = p.locator(`tbody tr:has-text("${teacher.name}")`).first();
  await expect(row).toBeVisible();
  await row.locator('[data-action-id="overflow-menu"]').click();
  await p.locator('[data-action-id="teacher-courses"]').click();
  await expect(p.locator('[role="dialog"]')).toBeVisible();
  await waitForStable(p);
}

async function prepareTake(p: Page): Promise<void> {
  if (!takeExam) throw new Error("take-exam fixture missing");
  await loginViaUi(
    p,
    takeExam.candidate.username,
    takeExam.candidate.password,
    /\/exam\/list/,
  );
  if (!attemptId) throw new Error("attempt missing");
  await p.goto(`${BASE_URL}/exam/${attemptId}/take`, {
    waitUntil: "domcontentloaded",
  });
  await waitForStable(p);
}

// ── Test suite ──
test.describe.serial("UI-D2-VISUAL-AB-582", () => {
  test.beforeAll(async ({ browser, request }) => {
    void browser;
    mkdirSync(MACRO_DIR, { recursive: true });
    mkdirSync(MICRO_DIR, { recursive: true });

    const token = await adminApiToken(request);
    takeExam = await seedExam(request, "d2-ab-take", {
      timingMode: "timed_window",
      durationMinutes: 60,
    });
    const courseId = takeExam.courseId;
    const stamp = Date.now();
    const seeds: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 5; i++) {
      seeds.push({
        courseId,
        type: "true_false",
        content: `判断题-D2-${stamp}-${i}`,
        standardAnswer: i % 2 === 0,
        score: 10,
        tags: [`D2-${stamp}`],
      });
    }
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "single_choice",
        content: `单选题-D2-${stamp}-${i}`,
        options: [
          { id: "a", content: "选项一" },
          { id: "b", content: "选项二", isCorrect: true },
          { id: "c", content: "选项三" },
          { id: "d", content: "选项四" },
        ],
        standardAnswer: "b",
        score: 10,
        tags: [`D2-${stamp}`],
      });
    }
    seeds.push({
      courseId,
      type: "multiple_choice",
      content: `多选题-D2-${stamp}`,
      options: [
        { id: "a", content: "选项甲", isCorrect: true },
        { id: "b", content: "选项乙", isCorrect: true },
        { id: "c", content: "选项丙" },
        { id: "d", content: "选项丁" },
      ],
      standardAnswer: ["a", "b"],
      score: 10,
      tags: [`D2-${stamp}`],
    });
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "fill_blank",
        content: `填空题-D2-${stamp}-${i}：____`,
        standardAnswer: "答案",
        score: 10,
        tags: [`D2-${stamp}`],
      });
    }
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "text_response",
        content: `论述题-D2-${stamp}-${i}`,
        standardAnswer: null,
        rubric: "按逻辑完整性给分",
        score: 20,
        tags: [`D2-${stamp}`],
      });
    }
    for (const s of seeds) {
      await adminPost(request, "/api/questions", token, s);
    }
    progressLog(OUTPUT_DIR, `[d2] seeded exam + ${seeds.length} questions`);

    teacher = await createTeacherViaApi(request, {
      name: "对照教师",
      usernamePrefix: "d2-ab-teacher",
    });
    await adminPost(
      request,
      `/api/admin/users/${teacher.userId}/course-assignments`,
      token,
      { courseId },
    );

    const candToken = await candidateApiToken(request, takeExam.candidate);
    attemptId = await candidateStartAttempt(
      request,
      candToken,
      takeExam.examId,
    );
    progressLog(OUTPUT_DIR, "[d2] fixtures ready, attempt started");

    writeFileSync(
      join(OUTPUT_DIR, "run-manifest.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          issue: 582,
          variable: "D2",
          variants: ["X", "Y"],
          mapFileRef:
            "docs/research/exam-582-d2-visual-ab-1/artifacts/variant-map.json",
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          viewports: [VP_DESKTOP, VP_NARROW],
          surfaces: Object.keys(STYLE_TARGETS),
          injection: "addInitScript <style> — font-size declarations only",
        },
        null,
        2,
      ),
    );
  });

  test("Admin surfaces A/B (dashboard, settings, dialog, take) @1440", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      await captureSurface({
        browser,
        surface: "dashboard",
        variant,
        viewport: VP_DESKTOP,
        prepare: await adminPrepare("/admin/dashboard"),
        structural: true,
        micros: [
          { name: "m3-sidebar", selector: "aside" },
          {
            name: "m3-heading",
            selector: ".type-page-title",
            grow: { left: 24, right: 640, down: 220 },
            rightOfMax: { selector: '[data-slot="stats-card"]', pad: 2 },
            stopBefore: { selector: ".type-section-title", pad: 12 },
          },
        ],
      });
      await captureSurface({
        browser,
        surface: "settings",
        variant,
        viewport: VP_DESKTOP,
        prepare: await adminPrepare("/admin/settings"),
        structural: false,
        micros: [{ name: "m2-form", selector: "main form" }],
      });
      await captureSurface({
        browser,
        surface: "dialog",
        variant,
        viewport: VP_DESKTOP,
        prepare: prepareDialog,
        structural: false,
        micros: [],
      });
      await captureSurface({
        browser,
        surface: "take",
        variant,
        viewport: VP_DESKTOP,
        prepare: prepareTake,
        structural: false,
        micros: [
          {
            name: "m4-runtime",
            selector: ".type-reading",
            grow: { up: 8 },
            rightOfMax: { selector: "main button", pad: 14 },
            bottomOfMax: { selector: "main button", pad: 14 },
          },
        ],
      });
    }
  });

  test("Dense table A/B (exam-list, questions) @1440+1100", async ({
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
          structural: true,
          micros: [],
        });
        await captureSurface({
          browser,
          surface: "questions",
          variant,
          viewport,
          prepare: await adminPrepare("/admin/questions"),
          structural: true,
          micros:
            viewport.name === VP_DESKTOP.name
              ? [
                  {
                    name: "m1-table",
                    selector: '[data-slot="admin-table-shell"]',
                    bottomOf: { selector: "tbody tr", index: 2, pad: 6 },
                  },
                ]
              : [],
        });
      }
    }
  });

  test("Pill overflow measurement (users, audit-logs) x2 viewports", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW]) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        for (const pageKind of ["users", "audit-logs"] as const) {
          const ctx = await variantContext(browser, variant, viewport);
          const p = await ctx.newPage();
          try {
            await loginAsAdmin(p);
            await p.goto(`${BASE_URL}/admin/${pageKind}`, {
              waitUntil: "domcontentloaded",
            });
            await waitForStable(p);
            await assertVariantStyleApplied(p, `pill-${pageKind}`, variant);
            await runFontGate(p, `pill-${pageKind}`, variant, viewport.name);
            await collectPillOverflow(p, pageKind, variant, viewport.name);
          } finally {
            await ctx.close();
          }
        }
      }
    }
  });

  test.afterAll(async () => {
    mkdirSync(join(OUTPUT_DIR, "artifacts", "D2"), { recursive: true });

    // Style proof: raw records + cross-variant pair diffs + tier/D4 guards.
    const pairDiffs: Array<{
      key: string;
      complete: boolean;
      tier: string | null;
      xFontSize: string | null;
      yFontSize: string | null;
      fontSizeChanged: boolean;
      lineHeightX: string | null;
      lineHeightY: string | null;
      controlledDiffs: string[];
    }> = [];
    const keys = new Set(
      captures.flatMap((c) =>
        c.styleProof.map((s) => `${c.surface}@${c.viewport}:${s.target}`),
      ),
    );
    for (const key of keys) {
      const [surfaceAtViewport, target] = key.split(":");
      const xRec = captures
        .flatMap((c) => c.styleProof.map((s) => ({ c, s })))
        .find(
          ({ c, s }) =>
            `${c.surface}@${c.viewport}` === surfaceAtViewport &&
            s.target === target &&
            c.variant === "X",
        );
      const yRec = captures
        .flatMap((c) => c.styleProof.map((s) => ({ c, s })))
        .find(
          ({ c, s }) =>
            `${c.surface}@${c.viewport}` === surfaceAtViewport &&
            s.target === target &&
            c.variant === "Y",
        );
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
          controlledDiffs: [],
        });
        continue;
      }
      const controlled = [
        "fontFamily",
        "fontWeight",
        "color",
        "letterSpacing",
        "borderRadius",
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
        controlledDiffs,
      });
    }

    const d4Violations = pairDiffs.filter(
      (d) =>
        d.key.endsWith(":table-th") &&
        d.complete &&
        (d.fontSizeChanged ||
          d.lineHeightX !== d.lineHeightY ||
          d.controlledDiffs.includes("fontWeight")),
    );
    // Height is a controlled property only "where not text-driven" (B7 law):
    // label / running-text containers shrink with their line-height, which is
    // the D2 variable propagating through text-driven geometry, not a layout
    // change. Fixed-height controls (input/button h-9) are still policed.
    const TEXT_DRIVEN_HEIGHT = new Set([
      "form-label",
      "dialog-label",
      "helper-text",
      "page-body-text",
      "page-secondary-text",
      "sidebar-link",
      "runtime-body",
      "runtime-text-sm",
    ]);
    const controlledViolations = pairDiffs.filter((d) => {
      if (!d.complete) return false;
      const target = d.key.split(":")[1] ?? "";
      return d.controlledDiffs.some(
        (k) => !(k === "height" && TEXT_DRIVEN_HEIGHT.has(target)),
      );
    });
    // Tier targets that exist in both variants but did not change size at
    // all. A real 14↔15 pair moves every target whose product CSS sits in
    // the converging half; one direction per variant means a tier target can
    // legitimately be static only if its CSS is in the non-moving half — the
    // per-target rows carry that fact. Kept as a tripwire: any static tier
    // target must be explainable in 02-style-proof.md or the experiment is
    // mis-scoped.
    const tierViolations = pairDiffs.filter(
      (d) => d.complete && d.tier === "d2" && !d.fontSizeChanged,
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D2", "style-proof.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          note: "Validity artifact — records computed px per variant letter and therefore reveals the mapping. NOT judge-facing. Judge-facing: D2/macro, D2/micro, contact sheets.",
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
            d4GuardPass: d4Violations.length === 0,
            d4Violations,
            controlledPropsPass: controlledViolations.length === 0,
            controlledViolations,
            tierConsistencyPass: tierViolations.length === 0,
            tierViolations,
            fontGatePass: fontGates.every((g) => g.pass),
          },
        },
        null,
        2,
      ),
    );

    // Structural: per-variant overflow/row facts + pill deltas.
    const pillPairs = [];
    const pillKeys = new Set(
      pillRecords.map((r) => `${r.page}@${r.viewport}:${r.text}`),
    );
    for (const key of pillKeys) {
      const [pageAtViewport, text] = key.split(":");
      const x = pillRecords.find(
        (r) =>
          `${r.page}@${r.viewport}` === pageAtViewport &&
          r.text === text &&
          r.variant === "X",
      );
      const y = pillRecords.find(
        (r) =>
          `${r.page}@${r.viewport}` === pageAtViewport &&
          r.text === text &&
          r.variant === "Y",
      );
      if (x && y) {
        pillPairs.push({
          key,
          text,
          xOverflowPx: x.overflowPx,
          yOverflowPx: y.overflowPx,
          deltaPx: Math.round((y.overflowPx - x.overflowPx) * 10) / 10,
        });
      }
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D2", "structural.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          perVariant: structuralRecords,
          knownPillDefects: {
            note: "Phase-1 MINOR defects (UsersPage role badge, AuditLogPage action span) — measured, not fixed; delta belongs to D2 evidence.",
            pairs: pillPairs,
          },
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "font-gate.json"),
      JSON.stringify({ gates: fontGates }, null, 2),
    );

    progressLog(
      OUTPUT_DIR,
      `[d2] DONE: ${captures.length} captures, ${pillRecords.length} pill rows`,
    );
  });
});
