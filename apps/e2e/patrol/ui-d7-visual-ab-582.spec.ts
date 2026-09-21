/**
 * UI-D7-VISUAL-AB-582 — blind A/B evidence generation for D7 (issue #582).
 *
 * STAGE B of the #582 campaign, D7 (Dialog / Sheet modal-surface background
 * tier). This spec generates evidence ONLY — it does not choose a value, does
 * not change any production visual file, and does not adjudicate any other
 * decision or re-open D2/D3/D4/D5/D6. #590 is not exercised.
 *
 * D7 semantic family (NOT "all overlays"): the modal/panel LARGE-SURFACE
 * background tier only —
 *   [data-slot="dialog-content"][data-overlay-variant="modal"]
 *   [data-slot="alert-dialog-content"][data-overlay-variant="modal"]
 *   [data-slot="sheet-content"][data-overlay-variant="panel"]
 * The small overlay family (popover / dropdown-menu / select / tooltip /
 * toast / context-menu) is the CONTROL GROUP: it stays on `.surface-overlay`'s
 * base background in BOTH arms and is probed for non-contamination.
 *
 * Experiment law (single-variable isolation):
 *   - Variant CSS is injected at runtime via addInitScript; no production CSS
 *     is edited. The ONLY cross-arm difference is the `background` declaration
 *     on the modal/panel recipe selectors, expressed with SEMANTIC tokens
 *     (var(--bg) = canvas tier / var(--surface) = content tier; no literal
 *     hex). `!important` makes the candidate authoritative over the cascade.
 *   - MODAL AND PANEL MOVE TOGETHER: one semantic decision, so both variants
 *     of the recipe carry the same arm token (never Dialog-X + Sheet-Y).
 *   - COMMON BASELINE (byte-identical in both arms): the frozen upstream
 *     decisions D2 (15px body/control), D6 (TagBadge weight 500) and D3 (6px
 *     primary control family, including its seam/pagination guard rules) via
 *     the same convergence-up blocks proven in the D2–D6 campaign. The frozen
 *     D4 (13px/20px/500 table header) and D5 (22px StatusBadge) are
 *     production as-built and re-verified absolutely per capture.
 *   - Background is paint-only: every controlled property (border, radius,
 *     shadow, padding, gap, typography, geometry) must be identical across
 *     arms; the dimmer (bg-black/50), sheet panel edge, dialog-body scroll
 *     ownership and interaction behavior (Escape close, close button, focus
 *     trap, body scroll lock) are proved invariant per pair.
 *
 * Evidence surfaces (real product states, no invented galleries):
 *   course-dialog        /admin/courses        create-course dialog over the
 *                        white-card governed table (white-card backdrop case)
 *   users-dialog         /admin/users          create-user dialog over the
 *                        white-card table + StatusBadge guard; the role
 *                        SelectContent doubles as the small-overlay control
 *                        crop (M6)
 *   exam-detail-confirm  /admin/exams/:id      unpublish AlertDialog
 *                        (destructive confirmation) over the sectioned exam
 *                        detail page (canvas-heavy backdrop case)
 *   candidates-import    /admin/candidates     import wizard DialogContent
 *                        size="lg" (large content-rich surface; CSV preview
 *                        rows typed identically in both arms)
 *   sheet-nav            /admin/courses @1023  AdminLayout mobile nav Sheet
 *                        (panel variant) over the below-lg card page
 *   probes (validity-only, no judged screenshots):
 *     fields-dropdown    /admin/candidate-fields  RowActions DropdownMenuContent
 *     questions-popover  /admin/questions         TagFilterSelect PopoverContent
 *     questions-d6       /admin/questions         frozen D6 TagBadge probe
 *
 * Blinding: which letter (X/Y) carries which background tier lives ONLY in
 * docs/research/exam-582-d7-visual-ab-1/validity/variant-map.json
 * (independent crypto coin flip). Captures, contact sheets and progress logs
 * carry letters only. The judge bundle is physically separated from the
 * validity bundle.
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh --keep-server \
 *     -- --config=playwright.patrol.config.ts patrol/ui-d7-visual-ab-582.spec.ts
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
const RUN_ID = `d7-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/d7-ab",
  RUN_ID,
);
const MACRO_DIR = join(OUTPUT_DIR, "artifacts", "D7", "macro");
const MICRO_DIR = join(OUTPUT_DIR, "artifacts", "D7", "micro");
const STYLE_ID = "d7-ab-variant-style";
const MAP_FILE =
  process.env.D7_MAP_FILE ??
  join(
    import.meta.dirname,
    "../../../docs/research/exam-582-d7-visual-ab-1/validity/variant-map.json",
  );

const VP_DESKTOP = { name: "1440x900", width: 1440, height: 900 };
const VP_NARROW = { name: "1100x800", width: 1100, height: 800 };
const VP_SHEET = { name: "1023x800", width: 1023, height: 800 };

/** Fixture seed marker; content also selects rows naturally. */
const FIXTURE_MARKER = "D7";

/** CSV typed into the import wizard textarea — identical in both arms, so
 * the preview rows (create/update/error coloring) render from real product
 * parsing. The rows are NEVER confirmed, so no candidate is created. */
const IMPORT_CSV = [
  "username,password,name",
  `d7ab_stu1_${FIXTURE_MARKER},d7pass123,证据考生一`,
  `d7ab_stu2_${FIXTURE_MARKER},d7pass123,证据考生二`,
  `d7ab_stu3_${FIXTURE_MARKER},d7pass123,证据考生三`,
].join("\n");

// ── Blind variant map ──
type VariantLetter = "X" | "Y";
type BackgroundTier = "canvas" | "white";

interface D7VariantMap {
  X?: string;
  Y?: string;
}

function loadVariantMap(): Record<VariantLetter, BackgroundTier> {
  const raw = JSON.parse(readFileSync(MAP_FILE, "utf8")) as D7VariantMap;
  const x = raw.X;
  const y = raw.Y;
  const legal = (v: string | undefined) => v === "canvas" || v === "white";
  if (!legal(x) || !legal(y) || x === y) {
    throw new Error(
      `invalid D7 variant map at ${MAP_FILE}: X=${String(x)} Y=${String(y)}`,
    );
  }
  return { X: x as BackgroundTier, Y: y as BackgroundTier };
}
const MAP = loadVariantMap();

/** Semantic token per background tier — never a literal hex (task §2). */
const TIER_TOKEN: Record<BackgroundTier, string> = {
  canvas: "var(--bg)",
  white: "var(--surface)",
};

/**
 * Experiment-only CSS per variant letter. The common upstream-frozen blocks
 * are byte-identical to the ones proven in the D2–D6 campaign and installed
 * in BOTH arms. The ONLY block that differs between arms is the D7 modal/panel
 * background, declared with `!important` so the candidate is authoritative
 * regardless of cascade order. Modal and panel always receive the SAME token
 * (one semantic decision — task §4).
 */
function variantCss(variant: VariantLetter): string {
  const token = TIER_TOKEN[MAP[variant]];
  return [
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D2 = 15px ──
    ".type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }",
    '[data-slot="table-cell"] { font-size: 0.9375rem !important; }',
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D6 = 500 ──
    `[data-slot="tag-badge"],
[data-slot="tag-badge"][data-tag-variant="compact-table"] {
  font-weight: 500 !important;
}`,
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D3 = 6px
    // primary control family, byte-identical to the proven D3 substrate
    // (alert-dialog slots named explicitly — Radix Slot precedence keeps the
    // primitive's slot name off data-slot="button").
    `[data-slot="input"],
[data-slot="select-trigger"],
[data-slot="textarea"],
[data-slot="button"],
[data-slot="alert-dialog-trigger"],
[data-slot="alert-dialog-cancel"],
[data-slot="alert-dialog-action"] {
  border-radius: 6px !important;
}`,
    // ── D3 substrate invariant guards (identical in both arms) ──
    `@media (min-width: 64rem) {
  [data-toolbar-appearance="quiet"] [data-slot="toolbar-filters"] > [data-slot="select-trigger"],
  [data-toolbar-appearance="quiet"] [data-slot="toolbar-filters"] > [data-slot="input"] {
    border-radius: 0 !important;
  }
}`,
    `[data-slot="pagination"] [data-slot="button"] {
  border-radius: 0.5rem !important;
}`,
    // ── D7 VARIABLE (the only cross-arm difference): modal/panel background
    // tier. Targets the recipe selectors — the same authorities the production
    // variants own — so the small-overlay base tier is untouched. ──
    `.surface-overlay[data-overlay-variant="modal"],
.surface-overlay[data-overlay-variant="panel"] {
  background: ${token} !important;
}`,
  ].join("\n");
}

// ── Style-proof target definitions ──
// `tier: "d7"` targets carry the experiment variable and MUST differ between
// the arms in background-color ONLY (and must equal the two token resolutions
// as a set). Every other tier is a frozen/non-family guard: ANY cross-arm
// movement is CROSS-VARIABLE CONTAMINATION.
interface ControlDef {
  name: string;
  selector: string;
  tier:
    | "d7"
    | "d2baseline"
    | "d3frozen"
    | "d4frozen"
    | "d5frozen"
    | "d6frozen"
    | "dimfrozen"
    | "overlayfrozen"
    | "chassisfrozen"
    | "external";
  context: string;
  nth?: number;
  textContains?: string;
}

const COURSE_DIALOG: ControlDef[] = [
  {
    name: "dialog-content",
    selector: '[data-slot="dialog-content"]',
    tier: "d7",
    context: "create-course dialog (D7 modal tier)",
  },
  {
    name: "dialog-close",
    selector: '[data-slot="dialog-content"] [data-slot="dialog-close"]',
    tier: "chassisfrozen",
    context: "dialog header close button (interaction chassis)",
  },
  {
    name: "dialog-title",
    selector: '[data-slot="dialog-title"]',
    tier: "chassisfrozen",
    context: "dialog header title",
  },
  {
    name: "dialog-overlay-dim",
    selector: '[data-slot="dialog-overlay"]',
    tier: "dimfrozen",
    context: "modal dimmer (D7 does not adjudicate dimming)",
  },
  {
    name: "name-input",
    selector: "#course-name",
    tier: "d3frozen",
    context: "create-course form (frozen D3 family)",
  },
  {
    name: "code-input",
    selector: "#course-code",
    tier: "d3frozen",
    context: "create-course form (frozen D3 family)",
  },
  {
    name: "description-textarea",
    selector: "#course-desc",
    tier: "d3frozen",
    context: "create-course form (frozen D3 family)",
  },
  {
    name: "footer-cancel-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
    tier: "d3frozen",
    context: "create-course footer",
    textContains: "取消",
  },
  {
    name: "footer-save-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
    tier: "d3frozen",
    context: "create-course footer",
    textContains: "保存",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
    context: "courses table behind the dialog (frozen D4 header)",
  },
  {
    name: "table-td",
    selector: '[data-slot="table-cell"]',
    tier: "d2baseline",
    context: "courses table behind the dialog (frozen D2 baseline)",
  },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "admin sidebar (frozen D2 baseline)",
  },
];

const USERS_DIALOG: ControlDef[] = [
  {
    name: "dialog-content",
    selector: '[data-slot="dialog-content"]',
    tier: "d7",
    context: "create-user dialog (D7 modal tier)",
  },
  {
    name: "dialog-close",
    selector: '[data-slot="dialog-content"] [data-slot="dialog-close"]',
    tier: "chassisfrozen",
    context: "dialog header close button (interaction chassis)",
  },
  {
    name: "dialog-title",
    selector: '[data-slot="dialog-title"]',
    tier: "chassisfrozen",
    context: "dialog header title",
  },
  {
    name: "dialog-overlay-dim",
    selector: '[data-slot="dialog-overlay"]',
    tier: "dimfrozen",
    context: "modal dimmer (D7 does not adjudicate dimming)",
  },
  {
    name: "username-input",
    selector: '[data-slot="dialog-content"] [data-slot="input"]',
    tier: "d3frozen",
    context: "create-user form (frozen D3 family)",
    nth: 0,
  },
  {
    name: "password-input",
    selector: '[data-slot="dialog-content"] [data-slot="input"]',
    tier: "d3frozen",
    context: "create-user form (frozen D3 family)",
    nth: 1,
  },
  {
    name: "name-input",
    selector: '[data-slot="dialog-content"] [data-slot="input"]',
    tier: "d3frozen",
    context: "create-user form (frozen D3 family)",
    nth: 2,
  },
  {
    name: "role-select-trigger",
    selector: '[data-slot="dialog-content"] [data-slot="select-trigger"]',
    tier: "d3frozen",
    context: "create-user form (frozen D3 family)",
  },
  {
    name: "footer-cancel-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
    tier: "d3frozen",
    context: "create-user footer",
    textContains: "取消",
  },
  {
    name: "footer-save-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
    tier: "d3frozen",
    context: "create-user footer",
    textContains: "保存",
  },
  {
    name: "status-badge",
    selector: 'tbody [data-slot="status-badge"]',
    tier: "d5frozen",
    context: "users table behind the dialog (frozen D5 height)",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
    context: "users table behind the dialog (frozen D4 header)",
  },
  {
    name: "table-td",
    selector: '[data-slot="table-cell"]',
    tier: "d2baseline",
    context: "users table behind the dialog (frozen D2 baseline)",
  },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "admin sidebar (frozen D2 baseline)",
  },
];

const USERS_DIALOG_SELECT: ControlDef[] = [
  {
    name: "select-content",
    selector: '[data-slot="select-content"]',
    tier: "overlayfrozen",
    context: "role select popover (small-overlay control group, must not move)",
  },
  {
    name: "select-item",
    selector: '[data-slot="select-item"]',
    tier: "overlayfrozen",
    context: "role select popover (small-overlay control group, must not move)",
  },
];

const EXAM_CONFIRM: ControlDef[] = [
  {
    name: "alert-dialog-content",
    selector: '[data-slot="alert-dialog-content"]',
    tier: "d7",
    context: "unpublish confirm (D7 modal tier, destructive)",
  },
  {
    name: "alert-dialog-title",
    selector: '[data-slot="alert-dialog-title"]',
    tier: "chassisfrozen",
    context: "confirm header title",
  },
  {
    name: "alert-dialog-overlay-dim",
    selector: '[data-slot="alert-dialog-overlay"]',
    tier: "dimfrozen",
    context: "modal dimmer (D7 does not adjudicate dimming)",
  },
  {
    name: "confirm-cancel-button",
    selector: '[data-slot="alert-dialog-cancel"]',
    tier: "d3frozen",
    context: "confirm footer (frozen D3 family)",
    textContains: "取消",
  },
  {
    name: "confirm-destructive-button",
    selector: '[data-slot="alert-dialog-action"]',
    tier: "d3frozen",
    context: "confirm footer (frozen D3 family)",
  },
  {
    name: "status-badge",
    selector: '[data-slot="status-badge"]',
    tier: "d5frozen",
    context: "exam status on the page behind (frozen D5 height)",
  },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "admin sidebar (frozen D2 baseline)",
  },
];

const IMPORT_DIALOG: ControlDef[] = [
  {
    name: "dialog-content",
    selector: '[data-slot="dialog-content"]',
    tier: "d7",
    context: "candidate import wizard (D7 modal tier, size lg)",
  },
  {
    name: "dialog-close",
    selector: '[data-slot="dialog-content"] [data-slot="dialog-close"]',
    tier: "chassisfrozen",
    context: "dialog header close button (interaction chassis)",
  },
  {
    name: "dialog-title",
    selector: '[data-slot="dialog-title"]',
    tier: "chassisfrozen",
    context: "dialog header title",
  },
  {
    name: "dialog-body-scroll-owner",
    selector: '[data-slot="dialog-content"] [data-slot="dialog-body"]',
    tier: "chassisfrozen",
    context: "dialog body (owns vertical scroll — §17 scroll ownership)",
  },
  {
    name: "dialog-overlay-dim",
    selector: '[data-slot="dialog-overlay"]',
    tier: "dimfrozen",
    context: "modal dimmer (D7 does not adjudicate dimming)",
  },
  {
    name: "import-textarea",
    selector: '[data-slot="dialog-content"] [data-slot="textarea"]',
    tier: "d3frozen",
    context: "import CSV entry (frozen D3 family)",
  },
  {
    name: "footer-close-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
    tier: "d3frozen",
    context: "import footer",
  },
  {
    name: "footer-confirm-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
    tier: "d3frozen",
    context: "import footer",
  },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "admin sidebar (frozen D2 baseline)",
  },
];

const SHEET_NAV: ControlDef[] = [
  {
    name: "sheet-content",
    selector: '[data-slot="sheet-content"]',
    tier: "d7",
    context: "mobile nav drawer (D7 panel tier)",
  },
  {
    name: "sheet-close-button",
    selector: '#mobile-nav-drawer [aria-label="关闭菜单"]',
    tier: "chassisfrozen",
    context: "drawer close button (interaction chassis)",
  },
  {
    name: "sheet-overlay-dim",
    selector: '[data-slot="sheet-overlay"]',
    tier: "dimfrozen",
    context: "panel dimmer (D7 does not adjudicate dimming)",
  },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "navigation items inside the drawer (frozen D2 baseline)",
  },
];

const DROPDOWN_PROBE: ControlDef[] = [
  {
    name: "dropdown-menu-content",
    selector: '[data-slot="dropdown-menu-content"]',
    tier: "overlayfrozen",
    context: "RowActions menu (small-overlay control group, must not move)",
  },
  {
    name: "dropdown-menu-item",
    selector: '[data-slot="dropdown-menu-item"]',
    tier: "overlayfrozen",
    context: "RowActions menu (small-overlay control group, must not move)",
  },
];

const POPOVER_PROBE: ControlDef[] = [
  {
    name: "popover-content",
    selector: '[data-slot="popover-content"]',
    tier: "overlayfrozen",
    context: "tag filter popover (small-overlay control group, must not move)",
  },
];

const QUESTIONS_D6: ControlDef[] = [
  {
    name: "tag-badge",
    selector: '[data-slot="tag-badge"]',
    tier: "d6frozen",
    context: "questions tags column (frozen D6 = 500, must not move)",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
    context: "questions table (frozen D4 header)",
  },
  {
    name: "table-td",
    selector: '[data-slot="table-cell"]',
    tier: "d2baseline",
    context: "questions table (frozen D2 baseline)",
  },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "admin sidebar (frozen D2 baseline)",
  },
];

const SURFACE_TARGETS: Record<string, ControlDef[]> = {
  "course-dialog": COURSE_DIALOG,
  "users-dialog": USERS_DIALOG,
  "users-dialog-select": USERS_DIALOG_SELECT,
  "exam-detail-confirm": EXAM_CONFIRM,
  "import-dialog": IMPORT_DIALOG,
  "sheet-nav": SHEET_NAV,
  "fields-dropdown": DROPDOWN_PROBE,
  "questions-popover": POPOVER_PROBE,
  "questions-d6": QUESTIONS_D6,
};

/** Surfaces whose captures are judged evidence (probes produce no judged
 * screenshots and never enter the judge bundle). */
const JUDGED_SURFACES = [
  "course-dialog",
  "users-dialog",
  "exam-detail-confirm",
  "import-dialog",
  "sheet-nav",
];

// ── Evidence structures ──
interface ControlRecord {
  target: string;
  selector: string;
  tier: string;
  context: string;
  found: boolean;
  dataOverlayVariant: string | null;
  dataOverlayPanelEdge: string | null;
  dataSize: string | null;
  backgroundColor: string | null;
  borderRadius: string | null;
  borderTopLeftRadius: string | null;
  boxShadow: string | null;
  paddingTop: string | null;
  paddingRight: string | null;
  paddingBottom: string | null;
  paddingLeft: string | null;
  borderTopWidth: string | null;
  borderRightWidth: string | null;
  borderBottomWidth: string | null;
  borderLeftWidth: string | null;
  borderTopColor: string | null;
  borderRightColor: string | null;
  borderBottomColor: string | null;
  borderLeftColor: string | null;
  height: string | null;
  fontSize: string | null;
  fontWeight: string | null;
  lineHeight: string | null;
  color: string | null;
  gap: string | null;
  opacity: string | null;
  scrollHeight: number | null;
  clientHeight: number | null;
  overflowY: string | null;
  bounding: { x: number; y: number; width: number; height: number } | null;
}

type Phase = "asbuilt" | "arm";

interface CaptureRecord {
  phase: Phase;
  surface: string;
  variant: VariantLetter;
  viewport: string;
  screenshot: string;
  controls: ControlRecord[];
}

interface StateRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  closeButtonVisible: boolean | null;
  scrollLockActive: boolean;
  bodyOverflow: string | null;
  bodyPointerEvents: string | null;
  focusContainedAfterTabs: boolean;
  escapeClosed: boolean;
}

interface FontGateRecord {
  surface: string;
  variant: VariantLetter | "asbuilt";
  viewport: string;
  bodyFontFamily: string | null;
  harmonyInStack: boolean;
  check400: boolean;
  check500: boolean;
  pass: boolean;
}

interface TokenResolution {
  rawBg: string;
  rawSurface: string;
  rawBorder: string;
  resolvedBg: string;
  resolvedSurface: string;
  resolvedBorder: string;
}

const captures: CaptureRecord[] = [];
const stateRecords: StateRecord[] = [];
const fontGates: FontGateRecord[] = [];
const tokenResolutions: Array<
  TokenResolution & { phase: Phase; variant: VariantLetter | "asbuilt" }
> = [];

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
  variant: VariantLetter | null,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const css = variant === null ? null : variantCss(variant);
  return browser
    .newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    })
    .then(async (ctx) => {
      if (css) {
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
      }
      return ctx;
    });
}

/** Font gate: the frozen baselines assume the production HarmonyOS Sans SC
 * path carries the weights the frozen tiers use (400 body + 500 header/tag). */
const CJK_FACE_SAMPLE = "课程考试创建用户名密码角色描述安全设备考生导入";

async function runFontGate(
  p: Page,
  surface: string,
  variant: VariantLetter | "asbuilt",
  viewport: string,
): Promise<void> {
  await p.evaluate(() => document.fonts.ready.then(() => undefined));
  const gate = await p.evaluate(async (sample) => {
    await document.fonts.load(`400 12px "HarmonyOS Sans SC"`, sample);
    await document.fonts.load(`500 12px "HarmonyOS Sans SC"`, sample);
    const stack = getComputedStyle(document.body).fontFamily;
    return {
      bodyFontFamily: stack,
      harmonyInStack: stack.includes("HarmonyOS Sans SC"),
      check400: document.fonts.check(`400 12px "HarmonyOS Sans SC"`, sample),
      check500: document.fonts.check(`500 12px "HarmonyOS Sans SC"`, sample),
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
      `EXPERIMENT_INVALID_FONT_STACK: font gate failed on ${surface}/${variant}@${viewport} ` +
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
      /background\s*:\s*var\(--(bg|surface)\)\s*!important/.test(
        el.textContent ?? "",
      )
    );
  }, STYLE_ID);
  if (!applied) {
    throw new Error(
      `EXPERIMENT_INVALID: variant style not installed in head on ${surface}/${variant}`,
    );
  }
}

/** §24 color-truth probe: record the raw semantic tokens AND their resolved
 * RGB (via ephemeral probe elements painted with each token). Validity-only. */
async function collectTokens(
  p: Page,
  phase: Phase,
  variant: VariantLetter | "asbuilt",
): Promise<TokenResolution> {
  const resolution = await p.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const resolve = (token: string): string => {
      const probe = document.createElement("div");
      probe.style.background = token;
      probe.style.display = "none";
      document.body.appendChild(probe);
      // display:none skips painting but computed value still resolves the
      // var(); read it through a visible offscreen twin to be safe.
      probe.style.display = "block";
      probe.style.position = "fixed";
      probe.style.left = "-9999px";
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };
    return {
      rawBg: root.getPropertyValue("--bg").trim(),
      rawSurface: root.getPropertyValue("--surface").trim(),
      rawBorder: root.getPropertyValue("--border").trim(),
      resolvedBg: resolve("var(--bg)"),
      resolvedSurface: resolve("var(--surface)"),
      resolvedBorder: resolve("var(--border)"),
    };
  });
  tokenResolutions.push({ phase, variant, ...resolution });
  return resolution;
}

/** Computed-style + geometry oracle over one target list (§16/§17). Runs
 * entirely in page land; `nth`/`textContains` pick among matches the same
 * way every capture in both arms does, so pairwise identity holds. */
async function collectControls(
  p: Page,
  defs: ControlDef[],
): Promise<ControlRecord[]> {
  return p.evaluate((targetDefs) => {
    const round = (n: number) => Math.round(n * 10) / 10;
    // position:fixed elements (dialogs, sheets, popovers) have
    // offsetParent === null, so visibility is judged by layout box + computed
    // paint state, not by offsetParent.
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    };
    const emptyRecord = (d: ControlDef): ControlRecord => ({
      target: d.name,
      selector: d.selector,
      tier: d.tier,
      context: d.context,
      found: false,
      dataOverlayVariant: null,
      dataOverlayPanelEdge: null,
      dataSize: null,
      backgroundColor: null,
      borderRadius: null,
      borderTopLeftRadius: null,
      boxShadow: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      borderTopWidth: null,
      borderRightWidth: null,
      borderBottomWidth: null,
      borderLeftWidth: null,
      borderTopColor: null,
      borderRightColor: null,
      borderBottomColor: null,
      borderLeftColor: null,
      height: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      color: null,
      gap: null,
      opacity: null,
      scrollHeight: null,
      clientHeight: null,
      overflowY: null,
      bounding: null,
    });
    return targetDefs.map((d) => {
      const matches = Array.from(document.querySelectorAll(d.selector)).filter(
        visible,
      ) as HTMLElement[];
      let el: HTMLElement | undefined = matches[d.nth ?? 0];
      if (d.textContains) {
        el = matches.find((m) =>
          (m.textContent ?? "").includes(d.textContains ?? ""),
        );
      }
      if (!el) return emptyRecord(d);
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        target: d.name,
        selector: d.selector,
        tier: d.tier,
        context: d.context,
        found: true,
        dataOverlayVariant: el.getAttribute("data-overlay-variant"),
        dataOverlayPanelEdge: el.getAttribute("data-overlay-panel-edge"),
        dataSize: el.getAttribute("data-size"),
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
        borderTopLeftRadius: s.borderTopLeftRadius,
        boxShadow: s.boxShadow,
        paddingTop: s.paddingTop,
        paddingRight: s.paddingRight,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        borderTopWidth: s.borderTopWidth,
        borderRightWidth: s.borderRightWidth,
        borderBottomWidth: s.borderBottomWidth,
        borderLeftWidth: s.borderLeftWidth,
        borderTopColor: s.borderTopColor,
        borderRightColor: s.borderRightColor,
        borderBottomColor: s.borderBottomColor,
        borderLeftColor: s.borderLeftColor,
        height: s.height,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        gap: s.gap,
        opacity: s.opacity,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: s.overflowY,
        bounding: {
          x: round(r.x),
          y: round(r.y),
          width: round(r.width),
          height: round(r.height),
        },
      };
    });
  }, defs);
}

function firstRecord(records: ControlRecord[], target: string): ControlRecord {
  const rec = records.find((r) => r.target === target);
  if (!rec) {
    throw new Error(`EXPERIMENT_INVALID: record ${target} missing from oracle`);
  }
  return rec;
}

function requireFound(
  records: ControlRecord[],
  surface: string,
  targets: string[],
): void {
  const missing = records
    .filter((r) => targets.includes(r.target) && !r.found)
    .map((r) => r.target);
  if (missing.length > 0) {
    throw new Error(
      `EXPERIMENT_INVALID: required targets not visible on ${surface}: ${missing.join(", ")}`,
    );
  }
}

// ── Crops (native pixels; grown bounding boxes keep the page-behind context —
// §11/§14: the D7 question is relational, so a crop that removes the page
// context is invalid by construction) ──
async function cropGrown(
  p: Page,
  selector: string,
  vp: { width: number; height: number },
  out: string,
  grow: { up?: number; down?: number; left?: number; right?: number } = {},
  pad = 0,
): Promise<boolean> {
  const box = await p
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  if (!box) return false;
  const left = (grow.left ?? 0) + pad;
  const up = (grow.up ?? 0) + pad;
  const x = Math.max(box.x - left, 0);
  const y = Math.max(box.y - up, 0);
  const width = Math.min(
    box.width + left + (grow.right ?? 0) + pad,
    vp.width - x,
  );
  const height = Math.min(
    box.height + up + (grow.down ?? 0) + pad,
    vp.height - y,
  );
  if (width <= 0 || height <= 0) return false;
  await p.screenshot({ path: out, clip: { x, y, width, height } });
  return true;
}

/** Vertical band from one element's top edge to another's bottom edge,
 * spanning the common container's width (dialog interior context). */
async function cropBandBetween(
  p: Page,
  topSel: Locator,
  bottomSel: Locator,
  spanSel: Locator,
  vp: { width: number; height: number },
  out: string,
  padTop = 8,
  padBottom = 10,
): Promise<boolean> {
  const t = await topSel.boundingBox().catch(() => null);
  const b = await bottomSel.boundingBox().catch(() => null);
  const s = await spanSel.boundingBox().catch(() => null);
  if (!t || !b || !s) return false;
  const x = Math.max(s.x, 0);
  const y = Math.max(t.y - padTop, 0);
  const width = Math.min(s.width, vp.width - x);
  const height = Math.min(b.y + b.height - y + padBottom, vp.height - y);
  if (width <= 0 || height <= 0) return false;
  await p.screenshot({ path: out, clip: { x, y, width, height } });
  return true;
}

// ── Modal/panel interaction probe (§23): D7 must not affect behavior. ──
async function probeModalBehavior(
  p: Page,
  surface: string,
  variant: VariantLetter,
  viewport: string,
  contentSelector: string,
  closeButtonSelector: string | null,
): Promise<void> {
  const closeButtonVisible = closeButtonSelector
    ? await p
        .locator(closeButtonSelector)
        .first()
        .isVisible()
        .catch(() => false)
    : null;
  const lock = await p.evaluate(() => {
    const s = getComputedStyle(document.body);
    return {
      bodyOverflow: s.overflow,
      bodyPointerEvents: s.pointerEvents,
      scrollLocked:
        document.body.getAttribute("data-scroll-locked") != null ||
        s.overflow === "hidden" ||
        s.pointerEvents === "none",
    };
  });
  // Focus trap: after 8 Tabs the focus must still sit inside the modal.
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press("Tab");
  }
  const focusContained = await p.evaluate((sel) => {
    const content = document.querySelector(sel);
    return content != null && content.contains(document.activeElement);
  }, contentSelector);
  // Escape close still works (Radix modal dismiss).
  await p.keyboard.press("Escape");
  await p.waitForTimeout(350);
  const escapeClosed = await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return true;
    const s = getComputedStyle(el);
    return (
      s.display === "none" ||
      s.visibility === "hidden" ||
      el.getAttribute("data-state") === "closed"
    );
  }, contentSelector);
  const record: StateRecord = {
    surface,
    variant,
    viewport,
    closeButtonVisible,
    scrollLockActive: lock.scrollLocked,
    bodyOverflow: lock.bodyOverflow,
    bodyPointerEvents: lock.bodyPointerEvents,
    focusContainedAfterTabs: focusContained,
    escapeClosed,
  };
  stateRecords.push(record);
  if (!record.scrollLockActive) {
    throw new Error(
      `EXPERIMENT_INVALID: body scroll lock not active on ${surface}/${variant}@${viewport}`,
    );
  }
  if (!record.focusContainedAfterTabs) {
    throw new Error(
      `EXPERIMENT_INVALID: focus escaped the modal on ${surface}/${variant}@${viewport}`,
    );
  }
  if (!record.escapeClosed) {
    throw new Error(
      `EXPERIMENT_INVALID: Escape no longer closes the modal on ${surface}/${variant}@${viewport}`,
    );
  }
  if (closeButtonSelector != null && !record.closeButtonVisible) {
    throw new Error(
      `EXPERIMENT_INVALID: close button not visible on ${surface}/${variant}@${viewport}`,
    );
  }
}

// ── Dialog / sheet openers (real product states, i18n-stable roles) ──
async function newSurfacePage(
  opts: {
    browser: Browser;
    variant: VariantLetter | null;
    viewport: { name: string; width: number; height: number };
  },
  route: string,
): Promise<{ p: Page; close: () => Promise<void> }> {
  const ctx = await variantContext(opts.browser, opts.variant, opts.viewport);
  const p = await ctx.newPage();
  await loginAsAdmin(p);
  await p.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  await waitForStable(p);
  return {
    p,
    close: async () => {
      await ctx.close();
    },
  };
}

async function openCourseDialog(p: Page): Promise<void> {
  await p.getByRole("button", { name: "新增课程" }).click();
  await expect(p.locator("#course-name")).toBeVisible();
  await waitForStable(p);
}

async function openUsersDialog(p: Page): Promise<void> {
  await p.getByRole("button", { name: "新增用户" }).click();
  await expect(
    p.locator('[data-slot="dialog-content"] [data-slot="input"]').first(),
  ).toBeVisible();
  await waitForStable(p);
}

async function openUnpublishConfirm(p: Page): Promise<void> {
  await p.locator('[data-testid="exam-detail-unpublish-btn"]').click();
  await expect(p.locator('[data-slot="alert-dialog-content"]')).toBeVisible();
  await waitForStable(p);
}

async function openImportDialog(p: Page): Promise<void> {
  await p.getByRole("button", { name: "导入", exact: true }).click();
  await expect(
    p.locator('[data-slot="dialog-content"] [data-slot="textarea"]'),
  ).toBeVisible();
  await p
    .locator('[data-slot="dialog-content"] [data-slot="textarea"]')
    .fill(IMPORT_CSV);
  // The typed CSV must reach the real parser: a preview row carrying the
  // first seeded candidate name proves the wizard's parse+preview pipeline
  // ran (identically in both arms).
  await expect(
    p.locator('[data-slot="dialog-content"]').getByText("证据考生一"),
  ).toBeVisible();
  await waitForStable(p);
}

async function openSheetNav(p: Page): Promise<void> {
  await expect(p.locator('[data-testid="mobile-nav-trigger"]')).toBeVisible();
  await p.locator('[data-testid="mobile-nav-trigger"]').click();
  await expect(p.locator('[data-slot="sheet-content"]')).toBeVisible();
  await waitForStable(p);
}

// ── Per-surface capture ──
interface CaptureOptions {
  browser: Browser;
  variant: VariantLetter | null;
  viewport: { name: string; width: number; height: number };
}

async function armPhaseStart(
  opts: CaptureOptions,
  surface: string,
  route: string,
  open: (p: Page) => Promise<void>,
): Promise<{ p: Page; close: () => Promise<void> }> {
  const { p, close } = await newSurfacePage(opts, route);
  await open(p);
  const variant = opts.variant;
  await runFontGate(p, surface, variant ?? "asbuilt", opts.viewport.name);
  await collectTokens(p, variant ? "arm" : "asbuilt", variant ?? "asbuilt");
  if (variant) {
    await assertVariantStyleApplied(p, surface, variant);
  }
  return { p, close };
}

/** Shared guard block for a judged dialog capture: required targets found,
 * the d7 target present, and the frozen baselines absolute-verified. */
function verifyFrozenBaselines(
  records: ControlRecord[],
  surface: string,
  variant: VariantLetter,
  /** Overlay surfaces must render their d7-tier modal/panel; page probes
   * (e.g. the questions-d6 frozen-tag probe) carry no overlay at all. */
  expectOverlay = true,
): void {
  const tierAbsolute: Array<{
    tier: string;
    check: (r: ControlRecord) => boolean;
    label: string;
  }> = [
    {
      tier: "d3frozen",
      check: (r) => r.borderRadius === "6px",
      label: "radius 6px (frozen D3, injected both arms)",
    },
    {
      tier: "d4frozen",
      check: (r) =>
        r.fontSize === "13px" &&
        r.lineHeight === "20px" &&
        r.fontWeight === "500",
      label: "13px/20px/500 (frozen D4, as-built)",
    },
    {
      tier: "d5frozen",
      check: (r) =>
        r.height === "22px" && r.fontSize === "12px" && r.fontWeight === "500",
      label: "22px height / 12px / 500 (frozen D5, as-built)",
    },
    {
      tier: "d6frozen",
      check: (r) => r.fontWeight === "500",
      label: "weight 500 (frozen D6, injected both arms)",
    },
    {
      tier: "d2baseline",
      check: (r) => r.fontSize === "15px",
      label: "15px (frozen D2, injected both arms)",
    },
  ];
  for (const { tier, check, label } of tierAbsolute) {
    for (const rec of records.filter((r) => r.tier === tier && r.found)) {
      if (!check(rec)) {
        throw new Error(
          `EXPERIMENT_INVALID_UPSTREAM_BASELINE: ${rec.target} on ${surface}/${variant} violates frozen ${tier} (${label}): ` +
            JSON.stringify({
              fontSize: rec.fontSize,
              lineHeight: rec.lineHeight,
              fontWeight: rec.fontWeight,
              height: rec.height,
              borderRadius: rec.borderRadius,
            }),
        );
      }
    }
  }
  if (!expectOverlay) return;
  const d7 = records.find((r) => r.tier === "d7");
  if (!d7?.found) {
    throw new Error(
      `EXPERIMENT_INVALID: no d7-tier overlay rendered on ${surface}/${variant}`,
    );
  }
  if (
    (d7.dataOverlayVariant !== "modal" && d7.dataOverlayVariant !== "panel") ||
    (surface === "sheet-nav" && d7.dataOverlayVariant !== "panel") ||
    (surface !== "sheet-nav" && d7.dataOverlayVariant !== "modal")
  ) {
    throw new Error(
      `EXPERIMENT_INVALID: wrong overlay variant on ${surface}/${variant}: ${String(d7.dataOverlayVariant)}`,
    );
  }
}

async function captureCourseDialog(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await armPhaseStart(
    opts,
    "course-dialog",
    "/admin/courses",
    openCourseDialog,
  );
  try {
    const controls = await collectControls(p, COURSE_DIALOG);
    requireFound(controls, "course-dialog", [
      "dialog-content",
      "dialog-close",
      "dialog-title",
      "dialog-overlay-dim",
      "name-input",
      "code-input",
      "description-textarea",
      "footer-cancel-button",
      "footer-save-button",
      "table-th",
      "table-td",
      "sidebar-link",
    ]);
    if (variant) {
      verifyFrozenBaselines(controls, "course-dialog", variant);
      const macro = join(
        MACRO_DIR,
        `course-dialog-${variant}-${viewport.name}.png`,
      );
      // Full viewport: page behind (canvas + white governed table card) is
      // part of the evidence (§11) — never crop the modal alone at macro.
      await p.screenshot({ path: macro });
      // M1: modal edge + underlying page context on all sides (grown crop).
      await cropGrown(
        p,
        '[data-slot="dialog-content"]',
        viewport,
        join(MICRO_DIR, `course-dialog-edge-${variant}-${viewport.name}.png`),
        { left: 340, right: 340, up: 110, down: 190 },
      );
      // Interior band: fields + interior background + footer.
      await cropBandBetween(
        p,
        p.locator("#course-name"),
        p
          .locator(
            '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
          )
          .filter({ hasText: "保存" }),
        p.locator('[data-slot="dialog-content"]'),
        viewport,
        join(
          MICRO_DIR,
          `course-dialog-interior-${variant}-${viewport.name}.png`,
        ),
      );
      captures.push({
        phase,
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        screenshot: macro,
        controls,
      });
      await probeModalBehavior(
        p,
        "course-dialog",
        variant,
        viewport.name,
        '[data-slot="dialog-content"]',
        '[data-slot="dialog-content"] [data-slot="dialog-close"]',
      );
    } else {
      captures.push({
        phase,
        surface: "course-dialog",
        variant: "X",
        viewport: viewport.name,
        screenshot: "",
        controls,
      });
    }
    progressLog(
      OUTPUT_DIR,
      `[d7] captured course-dialog ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureUsersDialog(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await armPhaseStart(
    opts,
    "users-dialog",
    "/admin/users",
    openUsersDialog,
  );
  try {
    const controls = await collectControls(p, USERS_DIALOG);
    requireFound(controls, "users-dialog", [
      "dialog-content",
      "dialog-close",
      "dialog-title",
      "dialog-overlay-dim",
      "username-input",
      "password-input",
      "name-input",
      "role-select-trigger",
      "footer-cancel-button",
      "footer-save-button",
      "status-badge",
      "table-th",
      "table-td",
      "sidebar-link",
    ]);
    if (variant) {
      verifyFrozenBaselines(controls, "users-dialog", variant);
      const macro = join(
        MACRO_DIR,
        `users-dialog-${variant}-${viewport.name}.png`,
      );
      await p.screenshot({ path: macro });
      await cropGrown(
        p,
        '[data-slot="dialog-content"]',
        viewport,
        join(MICRO_DIR, `users-dialog-edge-${variant}-${viewport.name}.png`),
        { left: 340, right: 340, up: 110, down: 190 },
      );
      captures.push({
        phase,
        surface: "users-dialog",
        variant,
        viewport: viewport.name,
        screenshot: macro,
        controls,
      });

      // M6 small-overlay control crop: open the role select INSIDE the
      // dialog; SelectContent must be identical across arms (computed proof
      // in overlay-control-proof.json, native crop here for the judge).
      await p
        .locator('[data-slot="dialog-content"] [data-slot="select-trigger"]')
        .click();
      await expect(p.locator('[data-slot="select-content"]')).toBeVisible();
      await p.waitForTimeout(250);
      const overlayRecs = await collectControls(p, USERS_DIALOG_SELECT);
      requireFound(overlayRecs, "users-dialog-select", [
        "select-content",
        "select-item",
      ]);
      const cropOk = await cropGrown(
        p,
        '[data-slot="select-content"]',
        viewport,
        join(MICRO_DIR, `users-dialog-select-${variant}-${viewport.name}.png`),
        { left: 80, right: 80, up: 60, down: 60 },
      );
      if (!cropOk) {
        throw new Error(
          `EXPERIMENT_INVALID: select-content crop failed on users-dialog/${variant}`,
        );
      }
      captures.push({
        phase,
        surface: "users-dialog-select",
        variant,
        viewport: viewport.name,
        screenshot: "",
        controls: overlayRecs,
      });
      await p.keyboard.press("Escape");
      await expect(p.locator('[data-slot="select-content"]')).toBeHidden();

      await probeModalBehavior(
        p,
        "users-dialog",
        variant,
        viewport.name,
        '[data-slot="dialog-content"]',
        '[data-slot="dialog-content"] [data-slot="dialog-close"]',
      );
    } else {
      captures.push({
        phase,
        surface: "users-dialog",
        variant: "X",
        viewport: viewport.name,
        screenshot: "",
        controls,
      });
      // As-built select facts for the inventory.
      await p
        .locator('[data-slot="dialog-content"] [data-slot="select-trigger"]')
        .click();
      await expect(p.locator('[data-slot="select-content"]')).toBeVisible();
      await p.waitForTimeout(250);
      const overlayRecs = await collectControls(p, USERS_DIALOG_SELECT);
      captures.push({
        phase,
        surface: "users-dialog-select",
        variant: "X",
        viewport: viewport.name,
        screenshot: "",
        controls: overlayRecs,
      });
      await p.keyboard.press("Escape");
      await expect(p.locator('[data-slot="select-content"]')).toBeHidden();
    }
    progressLog(
      OUTPUT_DIR,
      `[d7] captured users-dialog ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureExamConfirm(
  opts: CaptureOptions,
  examId: string,
): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await armPhaseStart(
    opts,
    "exam-detail-confirm",
    `/admin/exams/${examId}`,
    openUnpublishConfirm,
  );
  try {
    const controls = await collectControls(p, EXAM_CONFIRM);
    requireFound(controls, "exam-detail-confirm", [
      "alert-dialog-content",
      "alert-dialog-title",
      "alert-dialog-overlay-dim",
      "confirm-cancel-button",
      "confirm-destructive-button",
      "status-badge",
      "sidebar-link",
    ]);
    if (variant) {
      verifyFrozenBaselines(controls, "exam-detail-confirm", variant);
      const macro = join(
        MACRO_DIR,
        `exam-detail-confirm-${variant}-${viewport.name}.png`,
      );
      await p.screenshot({ path: macro });
      // M2: destructive confirm + canvas-heavy page context (§13).
      await cropGrown(
        p,
        '[data-slot="alert-dialog-content"]',
        viewport,
        join(
          MICRO_DIR,
          `exam-detail-confirm-context-${variant}-${viewport.name}.png`,
        ),
        { left: 430, right: 430, up: 240, down: 240 },
      );
      // M3: the small confirm surface whole (native pixels).
      await cropGrown(
        p,
        '[data-slot="alert-dialog-content"]',
        viewport,
        join(
          MICRO_DIR,
          `exam-detail-confirm-whole-${variant}-${viewport.name}.png`,
        ),
        {},
        8,
      );
      captures.push({
        phase,
        surface: "exam-detail-confirm",
        variant,
        viewport: viewport.name,
        screenshot: macro,
        controls,
      });
      await probeModalBehavior(
        p,
        "exam-detail-confirm",
        variant,
        viewport.name,
        '[data-slot="alert-dialog-content"]',
        null,
      );
    } else {
      captures.push({
        phase,
        surface: "exam-detail-confirm",
        variant: "X",
        viewport: viewport.name,
        screenshot: "",
        controls,
      });
    }
    progressLog(
      OUTPUT_DIR,
      `[d7] captured exam-detail-confirm ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureImportDialog(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await armPhaseStart(
    opts,
    "import-dialog",
    "/admin/candidates",
    openImportDialog,
  );
  try {
    const controls = await collectControls(p, IMPORT_DIALOG);
    requireFound(controls, "import-dialog", [
      "dialog-content",
      "dialog-close",
      "dialog-title",
      "dialog-body-scroll-owner",
      "dialog-overlay-dim",
      "import-textarea",
      "footer-close-button",
      "footer-confirm-button",
      "sidebar-link",
    ]);
    if (variant) {
      verifyFrozenBaselines(controls, "import-dialog", variant);
      const macro = join(
        MACRO_DIR,
        `import-dialog-${variant}-${viewport.name}.png`,
      );
      await p.screenshot({ path: macro });
      // M4: large content-rich dialog edge + page context.
      await cropGrown(
        p,
        '[data-slot="dialog-content"]',
        viewport,
        join(MICRO_DIR, `import-dialog-edge-${variant}-${viewport.name}.png`),
        { left: 260, right: 260, up: 70, down: 140 },
      );
      // Interior: textarea + preview + footer in one band.
      await cropBandBetween(
        p,
        p.locator('[data-slot="dialog-content"] [data-slot="textarea"]'),
        p
          .locator(
            '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
          )
          .first(),
        p.locator('[data-slot="dialog-content"]'),
        viewport,
        join(
          MICRO_DIR,
          `import-dialog-interior-${variant}-${viewport.name}.png`,
        ),
      );
      captures.push({
        phase,
        surface: "import-dialog",
        variant,
        viewport: viewport.name,
        screenshot: macro,
        controls,
      });
      await probeModalBehavior(
        p,
        "import-dialog",
        variant,
        viewport.name,
        '[data-slot="dialog-content"]',
        '[data-slot="dialog-content"] [data-slot="dialog-close"]',
      );
    } else {
      captures.push({
        phase,
        surface: "import-dialog",
        variant: "X",
        viewport: viewport.name,
        screenshot: "",
        controls,
      });
    }
    progressLog(
      OUTPUT_DIR,
      `[d7] captured candidates-import ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureSheetNav(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await armPhaseStart(
    opts,
    "sheet-nav",
    "/admin/courses",
    openSheetNav,
  );
  try {
    const controls = await collectControls(p, SHEET_NAV);
    requireFound(controls, "sheet-nav", [
      "sheet-content",
      "sheet-close-button",
      "sheet-overlay-dim",
      "sidebar-link",
    ]);
    if (variant) {
      verifyFrozenBaselines(controls, "sheet-nav", variant);
      const sheetRec = firstRecord(controls, "sheet-content");
      // As-built authority: a side="left" drawer meets the page on its RIGHT
      // edge (sheet.tsx maps side → the border-bearing meeting edge), so the
      // panel-edge attribute is "right".
      if (sheetRec.dataOverlayPanelEdge !== "right") {
        throw new Error(
          `EXPERIMENT_INVALID: sheet panel edge is ${String(sheetRec.dataOverlayPanelEdge)}, expected right, on sheet-nav/${variant}`,
        );
      }
      const macro = join(
        MACRO_DIR,
        `sheet-nav-${variant}-${viewport.name}.png`,
      );
      await p.screenshot({ path: macro });
      // M5: sheet edge + underlying page (panel edge + dimmed cards).
      await cropGrown(
        p,
        '[data-slot="sheet-content"]',
        viewport,
        join(MICRO_DIR, `sheet-nav-edge-${variant}-${viewport.name}.png`),
        { right: 560 },
      );
      captures.push({
        phase,
        surface: "sheet-nav",
        variant,
        viewport: viewport.name,
        screenshot: macro,
        controls,
      });
      await probeModalBehavior(
        p,
        "sheet-nav",
        variant,
        viewport.name,
        '[data-slot="sheet-content"]',
        '#mobile-nav-drawer [aria-label="关闭菜单"]',
      );
    } else {
      captures.push({
        phase,
        surface: "sheet-nav",
        variant: "X",
        viewport: viewport.name,
        screenshot: "",
        controls,
      });
    }
    progressLog(OUTPUT_DIR, `[d7] captured sheet-nav ${tag}@${viewport.name}`);
  } finally {
    await close();
  }
}

/** Validity-only small-overlay probes (§5 control group) — no judged
 * screenshots; computed identity is proved in overlay-control-proof.json. */
async function probeSmallOverlay(
  opts: CaptureOptions,
  surface: "fields-dropdown" | "questions-popover",
  route: string,
  open: (p: Page) => Promise<void>,
): Promise<void> {
  const { variant, viewport } = opts;
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, route);
  try {
    await open(p);
    if (variant) {
      await assertVariantStyleApplied(p, surface, variant);
      await runFontGate(p, surface, variant, viewport.name);
      await collectTokens(p, "arm", variant);
    }
    const controls = await collectControls(p, SURFACE_TARGETS[surface] ?? []);
    requireFound(
      controls,
      surface,
      controls.map((r) => r.target),
    );
    captures.push({
      phase,
      surface,
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: "",
      controls,
    });
    await p.keyboard.press("Escape");
    progressLog(OUTPUT_DIR, `[d7] probed ${surface} ${variant ?? "asbuilt"}`);
  } finally {
    await close();
  }
}

/** Validity-only frozen-D6 probe (questions workbench). */
async function probeQuestionsD6(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, "/admin/questions");
  try {
    await expect(p.locator('[data-slot="tag-badge"]').first()).toBeVisible();
    if (variant) {
      await assertVariantStyleApplied(p, "questions-d6", variant);
      await runFontGate(p, "questions-d6", variant, viewport.name);
      await collectTokens(p, "arm", variant);
    }
    const controls = await collectControls(p, QUESTIONS_D6);
    requireFound(controls, "questions-d6", [
      "tag-badge",
      "table-th",
      "table-td",
      "sidebar-link",
    ]);
    if (variant)
      verifyFrozenBaselines(controls, "questions-d6", variant, false);
    captures.push({
      phase,
      surface: "questions-d6",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: "",
      controls,
    });
    progressLog(
      OUTPUT_DIR,
      `[d7] probed questions-d6 ${variant ?? "asbuilt"}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

// ── Test suite ──
test.describe.serial("UI-D7-VISUAL-AB-582", () => {
  let examId = "";
  const fixtureCourseName = `${FIXTURE_MARKER}-证据课程`;
  let fixtureFieldName = "";

  test.beforeAll(async ({ request }) => {
    mkdirSync(MACRO_DIR, { recursive: true });
    mkdirSync(MICRO_DIR, { recursive: true });

    const token = await adminApiToken(request);

    // Course + question + published exam: courses-table row behind the
    // course dialog, and the real unpublish confirm on exam detail (D3
    // pattern — the unpublish trigger only exists on a published exam).
    const course = await adminPostJson(request, "/api/courses", token, {
      name: fixtureCourseName,
      code: `E2E-d7-${Date.now()}`,
      description: "D7 blind A/B fixture course (issue 582)",
    });
    const courseId = String(course.id);
    const question = await adminPostJson(request, "/api/questions", token, {
      courseId,
      type: "true_false",
      content: `判断题-${FIXTURE_MARKER}-灭火器压力表指针处于绿区`,
      standardAnswer: true,
      score: 100,
      tags: ["安全", "设备维护"],
    });
    const exam = await adminPostJson(request, "/api/exams", token, {
      title: `${FIXTURE_MARKER}-考试-撤回发布证据`,
      description: "",
      courseId,
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(Date.now() - 3600_000).toISOString(),
      closeAt: new Date(Date.now() + 86400_000).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [String(question.id)],
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
    examId = String(exam.id);
    await adminPostJson(request, `/api/exams/${examId}/publish`, token, {});

    // Candidate field: gives /admin/candidate-fields a real row whose
    // RowActions kebab opens the DropdownMenuContent control probe.
    fixtureFieldName = `容量字段${Date.now()}`;
    await adminPostJson(request, "/api/candidate-fields", token, {
      name: `capacity_${Date.now()}`,
      label: fixtureFieldName,
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 990,
    });
    progressLog(
      OUTPUT_DIR,
      "[d7] fixture course + published exam + candidate field seeded",
    );

    // Static-DOM reconciliation (proven D5 substrate): the canonical E2E
    // demo seed leaves live candidate attempts that the heartbeat
    // disruption scanner keeps re-alerting; terminate every exposed live
    // attempt via the real recovery force-submit command and require two
    // consecutive scanner periods (16s) with zero live attempts before any
    // capture, so the page-behind DOM cannot change between arms.
    let quietCycles = 0;
    // 8 cycles: the escalating disruption scanner can keep re-alerting the
    // freshly reseeded demo attempts for ~45s+ per attempt; 4 cycles proved
    // marginal on a noisy server. Two consecutive quiet periods remain the
    // strict success condition.
    for (let cycle = 0; cycle < 8 && quietCycles < 2; cycle++) {
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
                "E2E D7 static-DOM reconciliation: terminate leftover demo live attempts before blind A/B captures",
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
      "[d7] static-DOM reconciliation: two quiet scanner cycles",
    );

    writeFileSync(
      join(OUTPUT_DIR, "run-manifest.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE. Mapping: validity/variant-map.json.",
          runId: RUN_ID,
          issue: 582,
          variable: "D7",
          question:
            "Dialog/Sheet modal-surface background tier (modal+panel move together), judged against the frozen upstream D2 (15px body/control), D3 (6px control family), D4 (13px/20px/500 table header), D5 (22px StatusBadge) and D6 (500 TagBadge) baselines",
          variants: ["X", "Y"],
          mapFileRef:
            "docs/research/exam-582-d7-visual-ab-1/validity/variant-map.json",
          d7Family: {
            included: [
              '[data-slot="dialog-content"][data-overlay-variant="modal"]',
              '[data-slot="alert-dialog-content"][data-overlay-variant="modal"]',
              '[data-slot="sheet-content"][data-overlay-variant="panel"]',
            ],
            excludedControlGroup: [
              "[data-slot=popover-content]",
              "[data-slot=dropdown-menu-content]",
              "[data-slot=select-content]",
              "(tooltip / toast / context-menu remain base-tier by construction)",
            ],
          },
          frozenConstants: {
            bodyControlBaseline: "15px (common D2 block injected in BOTH arms)",
            controlFamilyRadius:
              "6px (common D3 block injected in BOTH arms, incl. seam/pagination guards)",
            tableHeaderBaseline:
              "13px/20px/500 (upstream D4 as-built, verified per capture)",
            statusBadgeBaseline:
              "22px height / 12px / 500 (upstream D5 as-built, verified per capture)",
            tagBadgeBaseline:
              "weight 500 (common D6 block injected in BOTH arms)",
            dimmer: "bg-black/50 overlay computed color identical both arms",
            radiusShadowBorder:
              "modal/panel radius, shadow, border and panel edge identical both arms (D7 changes background only)",
          },
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          viewports: [VP_DESKTOP, VP_NARROW, VP_SHEET],
          surfaces: Object.keys(SURFACE_TARGETS),
          judgedSurfaces: JUDGED_SURFACES,
          validityOnlySurfaces: [
            "users-dialog-select",
            "fields-dropdown",
            "questions-popover",
            "questions-d6",
          ],
          injection:
            "addInitScript <style> — D2+D6+D3 common baseline blocks (both arms) + modal/panel background token (the only cross-arm difference)",
        },
        null,
        2,
      ),
    );
  });

  test("D7 as-built overlay-surface inventory (§2, clean product, no injection)", async ({
    browser,
  }) => {
    const opts: CaptureOptions = {
      browser,
      variant: null,
      viewport: VP_DESKTOP,
    };
    await captureCourseDialog(opts);
    await captureUsersDialog(opts);
    await captureExamConfirm(opts, examId);
    await captureImportDialog(opts);
    await captureSheetNav({ ...opts, viewport: VP_SHEET });
    await probeSmallOverlay(
      opts,
      "fields-dropdown",
      "/admin/candidate-fields",
      async (p) => {
        await expect(
          p.getByRole("row").filter({ hasText: fixtureFieldName }).first(),
        ).toBeVisible();
        await p
          .getByRole("row")
          .filter({ hasText: fixtureFieldName })
          .first()
          .locator('[data-action-id="overflow-menu"]')
          .click();
        await expect(
          p.locator('[data-slot="dropdown-menu-content"]'),
        ).toBeVisible();
        await p.waitForTimeout(250);
      },
    );
    await probeSmallOverlay(
      opts,
      "questions-popover",
      "/admin/questions",
      async (p) => {
        await expect(
          p.locator('[data-slot="tag-filter-trigger"]'),
        ).toBeVisible();
        await p.locator('[data-slot="tag-filter-trigger"]').click();
        await expect(p.locator('[data-slot="popover-content"]')).toBeVisible();
        await p.waitForTimeout(250);
      },
    );
    await probeQuestionsD6(opts);

    // Authority check (§2): browser computed style is final authority. The
    // modal/panel tiers must carry the canvas token resolution and the small
    // overlay family the content token resolution — else AUTHORITY_MISMATCH.
    const asBuilt = captures.filter((c) => c.phase === "asbuilt");
    const tokens = tokenResolutions.find((t) => t.phase === "asbuilt");
    if (!tokens) {
      throw new Error(
        "EXPERIMENT_INVALID: no as-built token resolution recorded",
      );
    }
    const overlayOf = (surface: string, target: string): ControlRecord => {
      const rec = asBuilt
        .filter((c) => c.surface === surface)
        .flatMap((c) => c.controls)
        .find((r) => r.target === target);
      if (!rec?.found) {
        throw new Error(
          `EXPERIMENT_INVALID: as-built inventory missing ${surface}/${target}`,
        );
      }
      return rec;
    };
    const includedRows = [
      {
        surface: "course-dialog",
        target: "dialog-content",
        route: "/admin/courses (create-course dialog)",
        slot: "dialog-content",
      },
      {
        surface: "users-dialog",
        target: "dialog-content",
        route: "/admin/users (create-user dialog)",
        slot: "dialog-content",
      },
      {
        surface: "import-dialog",
        target: "dialog-content",
        route: "/admin/candidates (import wizard, size lg)",
        slot: "dialog-content",
      },
      {
        surface: "exam-detail-confirm",
        target: "alert-dialog-content",
        route: `/admin/exams/${examId} (unpublish confirm)`,
        slot: "alert-dialog-content",
      },
      {
        surface: "sheet-nav",
        target: "sheet-content",
        route: "/admin/courses @1023 (mobile nav drawer)",
        slot: "sheet-content",
      },
    ];
    const excludedRows = [
      {
        surface: "users-dialog-select",
        target: "select-content",
        route: "/admin/users (role select popover)",
        slot: "select-content",
      },
      {
        surface: "fields-dropdown",
        target: "dropdown-menu-content",
        route: "/admin/candidate-fields (RowActions menu)",
        slot: "dropdown-menu-content",
      },
      {
        surface: "questions-popover",
        target: "popover-content",
        route: "/admin/questions (tag filter popover)",
        slot: "popover-content",
      },
    ];
    const rows = [
      ...includedRows.map((row) => {
        const rec = overlayOf(row.surface, row.target);
        const resolvedToken =
          rec.backgroundColor === tokens.resolvedBg
            ? "--bg"
            : rec.backgroundColor === tokens.resolvedSurface
              ? "--surface"
              : "UNRESOLVED";
        return {
          slot: row.slot,
          overlayVariant: rec.dataOverlayVariant,
          panelEdge: rec.dataOverlayPanelEdge,
          route: row.route,
          computedBackgroundColor: rec.backgroundColor,
          resolvedSemanticToken: resolvedToken,
          inclusion: "D7_INCLUDED",
          reason:
            rec.dataOverlayVariant === "panel"
              ? "panel tier of surface/recipes.css .surface-overlay — large edge-attached surface"
              : "modal tier of surface/recipes.css .surface-overlay — large centered surface",
        };
      }),
      ...excludedRows.map((row) => {
        const rec = overlayOf(row.surface, row.target);
        const resolvedToken =
          rec.backgroundColor === tokens.resolvedSurface
            ? "--surface"
            : rec.backgroundColor === tokens.resolvedBg
              ? "--bg"
              : "UNRESOLVED";
        return {
          slot: row.slot,
          overlayVariant: rec.dataOverlayVariant,
          panelEdge: rec.dataOverlayPanelEdge,
          route: row.route,
          computedBackgroundColor: rec.backgroundColor,
          resolvedSemanticToken: resolvedToken,
          inclusion: "D7_EXCLUDED",
          reason:
            "small overlay family — stays on the .surface-overlay base tier (task §1 exclusions)",
        };
      }),
      // Dimmers recorded as D7-excluded invariants (§18).
      ...["course-dialog", "users-dialog", "import-dialog"].map((surface) => {
        const rec = overlayOf(surface, "dialog-overlay-dim");
        return {
          slot: "dialog-overlay",
          overlayVariant: rec.dataOverlayVariant,
          panelEdge: rec.dataOverlayPanelEdge,
          route: `${surface} (dimmer)`,
          computedBackgroundColor: rec.backgroundColor,
          resolvedSemanticToken: "bg-black/50 utility",
          inclusion: "D7_EXCLUDED",
          reason: "overlay dimmer — D7 does not adjudicate dimming (§18)",
        };
      }),
      {
        slot: "sheet-overlay",
        overlayVariant: null,
        panelEdge: null,
        route: "sheet-nav (dimmer)",
        computedBackgroundColor: overlayOf("sheet-nav", "sheet-overlay-dim")
          .backgroundColor,
        resolvedSemanticToken: "bg-black/50 utility",
        inclusion: "D7_EXCLUDED",
        reason: "overlay dimmer — D7 does not adjudicate dimming (§18)",
      },
    ];
    const authorityCheck = {
      modalPanelMatchCanvasToken: rows
        .filter((r) => r.inclusion === "D7_INCLUDED")
        .every((r) => r.computedBackgroundColor === tokens.resolvedBg),
      smallOverlayMatchContentToken: rows
        .filter(
          (r) =>
            r.inclusion === "D7_EXCLUDED" &&
            String(r.slot).endsWith("-content") &&
            r.slot !== "dialog-overlay" &&
            r.slot !== "sheet-overlay",
        )
        .every((r) => r.computedBackgroundColor === tokens.resolvedSurface),
    };
    if (!authorityCheck.modalPanelMatchCanvasToken) {
      throw new Error(
        "AUTHORITY_MISMATCH: modal/panel computed background does not match the canvas token resolution — STOP",
      );
    }
    if (!authorityCheck.smallOverlayMatchContentToken) {
      throw new Error(
        "AUTHORITY_MISMATCH: small-overlay computed background does not match the content token resolution — STOP",
      );
    }
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D7", "as-built-surface-inventory.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "As-built overlay population actually reachable in product routes, recorded clean (no injection). Computed style is the authority (task §2).",
          tokenResolutions: tokens,
          authorityCheck: { ...authorityCheck, result: "PASS" },
          rows,
        },
        null,
        2,
      ),
    );
    progressLog(
      OUTPUT_DIR,
      "[d7] as-built surface inventory written (authority check PASS)",
    );
  });

  test("D7 A/B round 1 (course-dialog, users-dialog) x2 viewports x2 arms", async ({
    browser,
  }) => {
    for (const viewport of [VP_DESKTOP, VP_NARROW]) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        await captureCourseDialog({ browser, variant, viewport });
        await captureUsersDialog({ browser, variant, viewport });
      }
    }
  });

  test("D7 A/B round 2 (confirm, import) x2 viewports + sheet @1023, x2 arms", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      for (const viewport of [VP_DESKTOP, VP_NARROW]) {
        await captureExamConfirm({ browser, variant, viewport }, examId);
        await captureImportDialog({ browser, variant, viewport });
      }
      await captureSheetNav({
        browser,
        variant,
        viewport: VP_SHEET,
      });
    }
  });

  test("D7 control probes (small overlays + frozen D6, validity-only) x2 arms", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      await probeSmallOverlay(
        { browser, variant, viewport: VP_DESKTOP },
        "fields-dropdown",
        "/admin/candidate-fields",
        async (p) => {
          await expect(
            p.getByRole("row").filter({ hasText: fixtureFieldName }).first(),
          ).toBeVisible();
          await p
            .getByRole("row")
            .filter({ hasText: fixtureFieldName })
            .first()
            .locator('[data-action-id="overflow-menu"]')
            .click();
          await expect(
            p.locator('[data-slot="dropdown-menu-content"]'),
          ).toBeVisible();
          await p.waitForTimeout(250);
        },
      );
      await probeSmallOverlay(
        { browser, variant, viewport: VP_DESKTOP },
        "questions-popover",
        "/admin/questions",
        async (p) => {
          await expect(
            p.locator('[data-slot="tag-filter-trigger"]'),
          ).toBeVisible();
          await p.locator('[data-slot="tag-filter-trigger"]').click();
          await expect(
            p.locator('[data-slot="popover-content"]'),
          ).toBeVisible();
          await p.waitForTimeout(250);
        },
      );
      await probeQuestionsD6({ browser, variant, viewport: VP_DESKTOP });
    }
  });

  test.afterAll(async () => {
    // ── Style proof: raw records + cross-variant pair diffs + tier guards ──
    interface PairDiff {
      key: string;
      complete: boolean;
      tier: string | null;
      xBackground: string | null;
      yBackground: string | null;
      backgroundChanged: boolean;
      controlledDiffs: string[];
      xValues: Record<string, string | number | boolean | null>;
      yValues: Record<string, string | number | boolean | null>;
    }
    const controlled = [
      "borderRadius",
      "borderTopLeftRadius",
      "boxShadow",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "height",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "color",
      "gap",
      "opacity",
      "dataOverlayVariant",
      "dataOverlayPanelEdge",
      "dataSize",
    ] as const;
    const pairDiffs: PairDiff[] = [];
    const pairKeys = new Set(
      captures
        .filter((c) => c.phase === "arm")
        .map((c) => `${c.surface}@${c.viewport}`),
    );
    for (const key of pairKeys) {
      const [surface, viewport] = key.split("@");
      // INVARIANT: pairs compare ARM captures only. As-built records share
      // surface/viewport and are stamped variant "X", so an unfiltered find
      // would pair the clean product against an arm.
      const pickRecords = (variant: VariantLetter): ControlRecord[] =>
        captures.find(
          (c) =>
            c.phase === "arm" &&
            c.surface === surface &&
            c.viewport === viewport &&
            c.variant === variant,
        )?.controls ?? [];
      const xRecs = pickRecords("X");
      const yRecs = pickRecords("Y");
      const targets = new Set([
        ...xRecs.map((r) => r.target),
        ...yRecs.map((r) => r.target),
      ]);
      for (const target of targets) {
        const xRec = xRecs.find((r) => r.target === target);
        const yRec = yRecs.find((r) => r.target === target);
        if (
          !xRec ||
          !yRec ||
          !xRec.found ||
          !yRec.found ||
          xRec.tier !== yRec.tier
        ) {
          pairDiffs.push({
            key: `${key}:${target}`,
            complete: false,
            tier: xRec?.tier ?? yRec?.tier ?? null,
            xBackground: xRec?.backgroundColor ?? null,
            yBackground: yRec?.backgroundColor ?? null,
            backgroundChanged: false,
            controlledDiffs: [],
            xValues: {},
            yValues: {},
          });
          continue;
        }
        const controlledDiffs = controlled.filter((k) => xRec[k] !== yRec[k]);
        const xValues: Record<string, string | number | boolean | null> = {};
        const yValues: Record<string, string | number | boolean | null> = {};
        for (const k of controlled) {
          xValues[k] = xRec[k];
          yValues[k] = yRec[k];
        }
        pairDiffs.push({
          key: `${key}:${target}`,
          complete: true,
          tier: xRec.tier,
          xBackground: xRec.backgroundColor,
          yBackground: yRec.backgroundColor,
          backgroundChanged: xRec.backgroundColor !== yRec.backgroundColor,
          controlledDiffs,
          xValues,
          yValues,
        });
      }
    }

    const absolute = (
      d: PairDiff,
      prop: string,
      want: string | number | boolean,
    ): boolean => d.xValues[prop] === want && d.yValues[prop] === want;

    // D7 single-variable guard: d7-tier pairs move in background-color ONLY,
    // and the two arm backgrounds equal the two token resolutions as a set
    // (both candidates reached computed style).
    const canvasBg = tokenResolutions.find(
      (t) => t.phase === "asbuilt",
    )?.resolvedBg;
    const whiteBg = tokenResolutions.find(
      (t) => t.phase === "asbuilt",
    )?.resolvedSurface;
    const tierSetMatches = (d: PairDiff): boolean =>
      canvasBg != null &&
      whiteBg != null &&
      [d.xBackground, d.yBackground].sort().join("|") ===
        [canvasBg, whiteBg].sort().join("|");
    const d7Pairs = pairDiffs.filter((d) => d.complete && d.tier === "d7");
    const d7Violations = d7Pairs.filter(
      (d) =>
        !d.backgroundChanged ||
        !tierSetMatches(d) ||
        d.controlledDiffs.some((k) => k !== "backgroundColor"),
    );
    const d7Static = d7Pairs.filter((d) => !d.backgroundChanged);

    // Dim invariant (§18): dimmer computed background identical across arms.
    const dimPairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "dimfrozen",
    );
    const dimViolations = dimPairs.filter(
      (d) =>
        d.backgroundChanged ||
        d.controlledDiffs.length > 0 ||
        !absolute(d, "opacity", "1"),
    );

    // Small-overlay non-contamination (§5): identical across arms; the
    // overlay CONTAINERS additionally sit at the content-token resolution in
    // BOTH arms. Items (select/dropdown entries) carry the product's own
    // fills (e.g. the subtle item tier) — identity is their contract.
    const overlayContainerTargets = new Set([
      "select-content",
      "dropdown-menu-content",
      "popover-content",
    ]);
    const overlayPairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "overlayfrozen",
    );
    const overlayViolations = overlayPairs.filter(
      (d) =>
        d.backgroundChanged ||
        d.controlledDiffs.length > 0 ||
        (overlayContainerTargets.has(d.key.split(":").pop() ?? "")
          ? d.xBackground !== whiteBg || d.yBackground !== whiteBg
          : false),
    );

    // Chassis invariants: geometry anchors + scroll owner identical.
    const chassisPairs = pairDiffs.filter(
      (d) => d.complete && d.tier === "chassisfrozen",
    );
    const chassisViolations = chassisPairs.filter(
      (d) => d.backgroundChanged || d.controlledDiffs.length > 0,
    );

    // Cross-variable contamination: no tier other than d7 may move at all.
    const nonD7Pairs = pairDiffs.filter((d) => d.complete && d.tier !== "d7");
    const contaminationViolations = nonD7Pairs.filter(
      (d) => d.backgroundChanged || d.controlledDiffs.length > 0,
    );

    // Frozen-tier absolute baselines (both arms).
    const tierAbsoluteChecks: Array<{
      name: string;
      tier: string;
      check: (d: PairDiff) => boolean;
    }> = [
      {
        name: "d2Baseline15px",
        tier: "d2baseline",
        check: (d) => absolute(d, "fontSize", "15px"),
      },
      {
        name: "d3FamilyRadius6px",
        tier: "d3frozen",
        check: (d) => absolute(d, "borderRadius", "6px"),
      },
      {
        name: "d4Header13px20px500",
        tier: "d4frozen",
        check: (d) =>
          absolute(d, "fontSize", "13px") &&
          absolute(d, "lineHeight", "20px") &&
          absolute(d, "fontWeight", "500"),
      },
      {
        name: "d5StatusBadge22px",
        tier: "d5frozen",
        check: (d) =>
          absolute(d, "height", "22px") &&
          absolute(d, "fontSize", "12px") &&
          absolute(d, "fontWeight", "500"),
      },
      {
        name: "d6TagBadge500",
        tier: "d6frozen",
        check: (d) => absolute(d, "fontWeight", "500"),
      },
    ];
    const baselineResults: Record<
      string,
      { pass: boolean; completePairs: number; violations: string[] }
    > = {};
    for (const { name, tier, check } of tierAbsoluteChecks) {
      const pairs = pairDiffs.filter((d) => d.complete && d.tier === tier);
      const violations = pairs.filter(
        (d) => !check(d) || d.controlledDiffs.length > 0,
      );
      baselineResults[name] = {
        pass: violations.length === 0 && pairs.length > 0,
        completePairs: pairs.length,
        violations: violations.map((d) => d.key),
      };
    }

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D7", "style-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Records computed values per variant letter and therefore reveals the mapping. Judge-facing: D7/macro, D7/micro, contact sheets, judge/README.md, 04-judge-handoff.md.",
          captures: captures
            .filter(
              (c) => c.phase === "arm" && JUDGED_SURFACES.includes(c.surface),
            )
            .map((c) => ({
              surface: c.surface,
              variant: c.variant,
              viewport: c.viewport,
              screenshot: c.screenshot,
            })),
          styleProof: captures
            .filter((c) => c.phase === "arm")
            .map((c) => ({
              surface: c.surface,
              variant: c.variant,
              viewport: c.viewport,
              records: c.controls,
            })),
          tokenResolutions,
          pairDiffs,
          guards: {
            d7SingleVariablePass:
              d7Violations.length === 0 && d7Pairs.length > 0,
            d7Violations,
            d7StaticPairs: d7Static,
            dimInvariantPass: dimViolations.length === 0 && dimPairs.length > 0,
            dimViolations,
            smallOverlayNonContaminationPass:
              overlayViolations.length === 0 && overlayPairs.length > 0,
            overlayViolations,
            chassisInvariantPass:
              chassisViolations.length === 0 && chassisPairs.length > 0,
            chassisViolations,
            upstreamBaselines: baselineResults,
            crossVariableContamination:
              contaminationViolations.length === 0 ? "NONE" : "PRESENT",
            contaminationViolations,
            fontGatePass: fontGates.every((g) => g.pass),
            fontGateCount: fontGates.length,
            stateProbeCount: stateRecords.length,
          },
        },
        null,
        2,
      ),
    );

    // ── Geometry proof (§17): pairwise bounding + scroll ownership deltas ──
    interface GeometryPair {
      key: string;
      x: { x: number; y: number; width: number; height: number } | null;
      y: { x: number; y: number; width: number; height: number } | null;
      deltaX: number | null;
      deltaY: number | null;
      deltaWidth: number | null;
      deltaHeight: number | null;
      scrollHeightX: number | null;
      scrollHeightY: number | null;
      clientHeightX: number | null;
      clientHeightY: number | null;
      sheetPanelEdgeX: string | null;
      sheetPanelEdgeY: string | null;
    }
    const geometryPairs: GeometryPair[] = [];
    for (const key of pairKeys) {
      const [surface, viewport] = key.split("@");
      // Arm captures only — see the pair-diff picker invariant above.
      const xRecs =
        captures.find(
          (c) =>
            c.phase === "arm" &&
            c.surface === surface &&
            c.viewport === viewport &&
            c.variant === "X",
        )?.controls ?? [];
      const yRecs =
        captures.find(
          (c) =>
            c.phase === "arm" &&
            c.surface === surface &&
            c.viewport === viewport &&
            c.variant === "Y",
        )?.controls ?? [];
      for (const xRec of xRecs) {
        const yRec = yRecs.find((r) => r.target === xRec.target);
        if (!yRec?.found || !xRec.found) continue;
        const bx = xRec.bounding;
        const by = yRec.bounding;
        geometryPairs.push({
          key: `${key}:${xRec.target}`,
          x: bx,
          y: by,
          deltaX: bx && by ? Math.round((by.x - bx.x) * 10) / 10 : null,
          deltaY: bx && by ? Math.round((by.y - bx.y) * 10) / 10 : null,
          deltaWidth:
            bx && by ? Math.round((by.width - bx.width) * 10) / 10 : null,
          deltaHeight:
            bx && by ? Math.round((by.height - bx.height) * 10) / 10 : null,
          scrollHeightX: xRec.scrollHeight,
          scrollHeightY: yRec.scrollHeight,
          clientHeightX: xRec.clientHeight,
          clientHeightY: yRec.clientHeight,
          sheetPanelEdgeX: xRec.dataOverlayPanelEdge,
          sheetPanelEdgeY: yRec.dataOverlayPanelEdge,
        });
      }
    }
    const geometryViolations = geometryPairs.filter(
      (g) =>
        Math.abs(g.deltaX ?? 0) > 0.5 ||
        Math.abs(g.deltaY ?? 0) > 0.5 ||
        Math.abs(g.deltaWidth ?? 0) > 0.5 ||
        Math.abs(g.deltaHeight ?? 0) > 0.5 ||
        g.scrollHeightX !== g.scrollHeightY ||
        g.clientHeightX !== g.clientHeightY,
    );
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D7", "geometry.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Pairwise geometry deltas (letters only, no tier mapping). Background is paint-only: every delta must be 0.",
          pairs: geometryPairs,
          violations: geometryViolations,
          geometryPass: geometryViolations.length === 0,
        },
        null,
        2,
      ),
    );

    // ── Overlay control proof (§5/§18/§19/§20/§21/§24) ──
    const sheetPairs = d7Pairs.filter((d) => d.key.startsWith("sheet-nav@"));
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D7", "overlay-control-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          tokenResolutions,
          smallOverlayControlGroup: {
            declared:
              "popover/dropdown/select contents identical across arms at the content-token resolution",
            pairs: overlayPairs.length,
            violations: overlayViolations,
            pass: overlayViolations.length === 0 && overlayPairs.length > 0,
          },
          dimmerInvariant: {
            declared: "dialog/sheet overlay computed background identical",
            pairs: dimPairs.length,
            violations: dimViolations,
            pass: dimViolations.length === 0 && dimPairs.length > 0,
          },
          shadowInvariant: {
            declared: "modal/panel box-shadow identical across arms (§19)",
            evidence:
              "boxShadow is in the d7 controlled set — any movement fails d7SingleVariablePass",
          },
          radiusInvariant: {
            declared:
              "modal/panel + small-overlay radius identical across arms (§20)",
            evidence:
              "borderRadius is in the controlled set for every target; modal/panel radius additionally absolute-identical",
          },
          panelEdgeInvariant: {
            declared: "sheet panel edge attribute identical across arms (§21)",
            sheetPairs: sheetPairs.length,
            sheetBackgroundMovedPairs: sheetPairs.filter(
              (d) => d.backgroundChanged,
            ).length,
            pass:
              sheetPairs.length > 0 &&
              sheetPairs.every(
                (d) =>
                  d.xValues.dataOverlayPanelEdge ===
                    d.yValues.dataOverlayPanelEdge && d.backgroundChanged,
              ),
          },
        },
        null,
        2,
      ),
    );

    // ── State proof (§23): interaction behavior identical across arms ──
    interface StatePair {
      key: string;
      identical: boolean;
      diffs: string[];
      x: StateRecord;
      y: StateRecord;
    }
    const stateKeys = new Set(
      stateRecords.map((r) => `${r.surface}@${r.viewport}`),
    );
    const statePairs: StatePair[] = [];
    for (const key of stateKeys) {
      const [surface, viewport] = key.split("@");
      const x = stateRecords.find(
        (r) =>
          r.surface === surface && r.viewport === viewport && r.variant === "X",
      );
      const y = stateRecords.find(
        (r) =>
          r.surface === surface && r.viewport === viewport && r.variant === "Y",
      );
      if (!x || !y) continue;
      const diffs = (
        [
          "closeButtonVisible",
          "scrollLockActive",
          "bodyOverflow",
          "bodyPointerEvents",
          "focusContainedAfterTabs",
          "escapeClosed",
        ] as const
      ).filter((k) => x[k] !== y[k]);
      statePairs.push({ key, identical: diffs.length === 0, diffs, x, y });
    }
    const stateAbsoluteViolations = stateRecords.filter(
      (r) =>
        !r.scrollLockActive ||
        !r.focusContainedAfterTabs ||
        !r.escapeClosed ||
        r.closeButtonVisible === false,
    );
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D7", "state-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          declared:
            "Escape close, close-button visibility, focus containment and body scroll lock are active in BOTH arms and identical across arms (§23)",
          records: stateRecords,
          pairs: statePairs,
          crossArmDivergences: statePairs.filter((p) => !p.identical),
          absoluteViolations: stateAbsoluteViolations,
          pass:
            stateAbsoluteViolations.length === 0 &&
            statePairs.length > 0 &&
            statePairs.every((p) => p.identical),
        },
        null,
        2,
      ),
    );

    // ── Upstream baseline proof (mapping-neutral absolutes) ──
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D7", "upstream-baseline.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          injectedBothArms: {
            d2: {
              declared: "15px body/control tier in BOTH arms",
              ...baselineResults.d2Baseline15px,
            },
            d3: {
              declared: "6px primary control family radius in BOTH arms",
              ...baselineResults.d3FamilyRadius6px,
            },
            d6: {
              declared: "TagBadge weight 500 in BOTH arms",
              ...baselineResults.d6TagBadge500,
            },
          },
          asBuiltUpstream: {
            d4: {
              declared: "13px/20px/500 governed table header in BOTH arms",
              ...baselineResults.d4Header13px20px500,
            },
            d5: {
              declared: "22px/12px/500 StatusBadge in BOTH arms",
              ...baselineResults.d5StatusBadge22px,
            },
          },
        },
        null,
        2,
      ),
    );

    progressLog(
      OUTPUT_DIR,
      `[d7] DONE: ${captures.length} captures, ` +
        `d7Pairs=${d7Pairs.length} d7Violations=${d7Violations.length} ` +
        `dimPairs=${dimPairs.length} overlayPairs=${overlayPairs.length} ` +
        `chassisPairs=${chassisPairs.length} geometryViolations=${geometryViolations.length} ` +
        `contamination=${contaminationViolations.length}`,
    );
  });
});
