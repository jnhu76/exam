/**
 * UI-D3-VISUAL-AB-582 — blind A/B evidence generation for D3 (issue #582).
 *
 * STAGE B of the #582 campaign, D3 (primary control family radius 6px vs
 * 8px). This spec generates evidence ONLY — it does not choose a value, does
 * not change any production visual file, and does not adjudicate D7 or
 * re-open D2/D4/D5/D6. #590 (dense-table cell fitting) is not exercised.
 *
 * D3 is a FAMILY CONVERGENCE decision: the semantic family is the primary
 * interactive form/control family — `[data-slot="input"]`,
 * `[data-slot="select-trigger"]`, `[data-slot="textarea"]` and standalone
 * `[data-slot="button"]` — judged as ONE family, not per-selector. The
 * as-built split (inputs/triggers/textarea = 6px via control/recipes.css
 * 0.375rem; buttons = 8px via rounded-lg) is verified per route BEFORE the
 * arms run; any mismatch stops the run (AUTHORITY_MISMATCH).
 *
 * Experiment law (single-variable isolation):
 *   - Variant CSS is injected at runtime via addInitScript; no production CSS
 *     is edited. The ONLY cross-arm difference is the computed
 *     `border-radius` on the D3 family, raised to the arm candidate with
 *     `!important` so the candidate is authoritative regardless of cascade
 *     order.
 *   - COMMON BASELINE (byte-identical in both arms): the frozen upstream D2
 *     decision (15px body/control) and the frozen upstream D6 decision
 *     (TagBadge weight 500) via the same convergence-up blocks proven in the
 *     D2/D4/D5/D6 campaign. The frozen D4 decision (13px/20px/500 governed
 *     table header) and the frozen D5 decision (22px StatusBadge) are
 *     production as-built and re-verified per capture.
 *   - COMPOSITE INTERNAL SEAMS: the quiet-toolbar joined-filter geometry
 *     (`[data-slot="toolbar-filters"]` direct children at radius 0) is
 *     dead CSS at runtime — no component renders that slot (as-built
 *     discovery, see 00-environment.md). The seam-preservation rule is kept
 *     in BOTH arms as a guard (0 !important, higher specificity than the
 *     family rule), the oracle proves the selectors match nothing in both
 *     arms, and quiet-toolbar controls are probed as the standalone family
 *     members they now are.
 *   - PAGINATION EXCLUSION (task §3): pagination pills must not change. No
 *     evidence surface renders pagination (fixtures stay under the page
 *     size); the injection still carries a guard rule pinning
 *     `[data-slot="pagination"] [data-slot="button"]` to the as-built 8px in
 *     both arms.
 *   - D7 OWNS dialog/sheet surface geometry: the dialog and alert-dialog
 *     containers are probed as frozen guards and must not move.
 *   - Radius cannot change layout, so bounding-box deltas across arms must
 *     be 0 (≤0.5px float tolerance); any larger delta is investigated before
 *     packaging.
 *
 * Evidence surfaces (real product states, no invented galleries):
 *   exam-create  /admin/exams/new   wizard form: Input + 2×SelectTrigger +
 *                                   outline/primary footer buttons + the
 *                                   product-disabled future stepper buttons
 *   course       /admin/courses     quiet toolbar (standalone filter
 *                                   context) + create-course dialog:
 *                                   Input + Input + Textarea + footer
 *                                   buttons — the Textarea-bearing form
 *   users        /admin/users       create-user dialog: 3×Input +
 *                                   SelectTrigger + footer buttons; role
 *                                   Badge + StatusBadge guards
 *   exam-detail  /admin/exams/:id   published exam: StatusBadge guard +
 *                                   unpublish ConfirmDialog (destructive +
 *                                   cancel)
 *   question-list-probe             validity-only: TagBadge (frozen D6)
 *                                   + second quiet-toolbar sample; no
 *                                   screenshots, never judged (task §13)
 *
 * Blinding: which letter (X/Y) carries which radius lives ONLY in
 * docs/research/exam-582-d3-visual-ab-1/validity/variant-map.json
 * (independent crypto coin flip). Captures, contact sheets and progress logs
 * carry letters only. The judge bundle is physically separated from the
 * validity bundle.
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_WORKERS=1 bash scripts/e2e/run-wsl.sh --keep-server \
 *     -- --config=playwright.patrol.config.ts patrol/ui-d3-visual-ab-582.spec.ts
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
const RUN_ID = `d3-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/d3-ab",
  RUN_ID,
);
const MACRO_DIR = join(OUTPUT_DIR, "artifacts", "D3", "macro");
const MICRO_DIR = join(OUTPUT_DIR, "artifacts", "D3", "micro");
const STYLE_ID = "d3-ab-variant-style";
const MAP_FILE =
  process.env.D3_MAP_FILE ??
  join(
    import.meta.dirname,
    "../../../docs/research/exam-582-d3-visual-ab-1/validity/variant-map.json",
  );

const VP_DESKTOP = { name: "1440x900", width: 1440, height: 900 };
const VP_NARROW = { name: "1100x800", width: 1100, height: 800 };
const VIEWPORTS = [VP_DESKTOP, VP_NARROW];

/** Fixture seed marker; content also selects the probe row naturally. */
const FIXTURE_MARKER = "D3";

// ── Blind variant map ──
type VariantLetter = "X" | "Y";

interface D3VariantMap {
  X?: string;
  Y?: string;
}

function loadVariantMap(): Record<VariantLetter, string> {
  const raw = JSON.parse(readFileSync(MAP_FILE, "utf8")) as D3VariantMap;
  const x = raw.X;
  const y = raw.Y;
  const legal = (v: string | undefined) => v === "6px" || v === "8px";
  if (!legal(x) || !legal(y) || x === y) {
    throw new Error(
      `invalid D3 variant map at ${MAP_FILE}: X=${String(x)} Y=${String(y)}`,
    );
  }
  return { X: x as string, Y: y as string };
}
const MAP = loadVariantMap();

/**
 * Experiment-only CSS per variant letter. The common upstream-frozen blocks
 * are byte-identical to the ones proven in the D2/D4/D5/D6 campaign and
 * installed in BOTH arms. The ONLY line that differs between arms is the
 * D3 family `border-radius` candidate, declared with `!important` so the
 * candidate is authoritative. The invariant exception rules (composite seam
 * at 0, pagination pinned to as-built 8px) use higher-specificity
 * `!important` selectors so they win the cascade in BOTH arms — they are
 * byte-identical across arms and are additionally proven by the oracle.
 */
function variantCss(variant: VariantLetter): string {
  const radius = MAP[variant];
  return [
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D2 = 15px ──
    ".type-body, .type-secondary, .type-page-description, .type-long-response { font-size: 0.9375rem !important; }",
    '[data-slot="table-cell"] { font-size: 0.9375rem !important; }',
    // ── COMMON FROZEN BASELINE (identical in both arms): upstream D6 = 500 ──
    `[data-slot="tag-badge"],
[data-slot="tag-badge"][data-tag-variant="compact-table"] {
  font-weight: 500 !important;
}`,
    // ── D3 VARIABLE (the only cross-arm difference): primary control family ──
    // alert-dialog-trigger / alert-dialog-cancel / alert-dialog-action are
    // Button-primitive consumers under Radix asChild composition: buttonVariants
    // owns their radius, but Slot prop precedence keeps the primitive's slot
    // name, so they never carry data-slot="button". The family selector names
    // the as-built slots explicitly (§9 runtime validation): the unpublish
    // trigger, the confirm cancel (secondary) and the confirm action
    // (primary/destructive).
    `[data-slot="input"],
[data-slot="select-trigger"],
[data-slot="textarea"],
[data-slot="button"],
[data-slot="alert-dialog-trigger"],
[data-slot="alert-dialog-cancel"],
[data-slot="alert-dialog-action"] {
  border-radius: ${radius} !important;
}`,
    // ── INVARIANT EXCEPTION (identical in both arms): COMPOSITE_INTERNAL_SEAM.
    // As-built this slot renders nowhere (dead CSS); kept as a guard so any
    // joined-control context stays 0px in BOTH arms. Higher specificity
    // (0,3,0) beats the family rule (0,1,0) under equal !important. ──
    `@media (min-width: 64rem) {
  [data-toolbar-appearance="quiet"] [data-slot="toolbar-filters"] > [data-slot="select-trigger"],
  [data-toolbar-appearance="quiet"] [data-slot="toolbar-filters"] > [data-slot="input"] {
    border-radius: 0 !important;
  }
}`,
    // ── INVARIANT EXCEPTION (identical in both arms): pagination pills are
    // excluded from D3 (task §3) — pinned to the as-built 8px in both arms. ──
    `[data-slot="pagination"] [data-slot="button"] {
  border-radius: 0.5rem !important;
}`,
  ].join("\n");
}

// ── Style-proof target definitions ──
// `tier: "d3"` targets are the experiment family and MUST differ between the
// arms in border-radius ONLY (and must equal the arm candidate — convergence).
// Every other tier is a frozen/non-family guard: ANY cross-arm movement is
// CROSS-VARIABLE CONTAMINATION. `tier: "seam"` selects the composite internal
// seam selectors — as-built they match nothing; if one ever renders it must
// read 0px in both arms.
interface ControlDef {
  name: string;
  selector: string;
  tier:
    | "d3"
    | "d2baseline"
    | "d4frozen"
    | "d6frozen"
    | "statusprobe"
    | "dialogfrozen"
    | "overlayfrozen"
    | "badgeexcl"
    | "seam"
    | "pagexcl"
    | "external";
  context: string;
  nth?: number;
  textContains?: string;
}

const SEAM_DEFS: ControlDef[] = [
  {
    name: "seam-select-trigger",
    selector:
      '[data-toolbar-appearance="quiet"] [data-slot="toolbar-filters"] > [data-slot="select-trigger"]',
    tier: "seam",
    context: "quiet-toolbar joined filters (as-built: absent)",
  },
  {
    name: "seam-input",
    selector:
      '[data-toolbar-appearance="quiet"] [data-slot="toolbar-filters"] > [data-slot="input"]',
    tier: "seam",
    context: "quiet-toolbar joined filters (as-built: absent)",
  },
];

const EXAM_CREATE_PAGE: ControlDef[] = [
  ...SEAM_DEFS,
  { name: "body", selector: "body", tier: "external", context: "page" },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "sidebar",
  },
  {
    name: "title-input",
    selector: "#wiz-title",
    tier: "d3",
    context: "wizard step-1 basic-info form",
  },
  {
    name: "course-select-trigger",
    selector: "#wiz-course",
    tier: "d3",
    context: "wizard step-1 basic-info form",
  },
  {
    name: "description-input",
    selector: "#wiz-description",
    tier: "d3",
    context: "wizard step-1 basic-info form",
  },
  {
    name: "profile-select-trigger",
    selector: 'main [data-slot="select-trigger"]',
    tier: "d3",
    context: "wizard step-1 policy profile form",
    nth: 1,
  },
  {
    name: "footer-cancel-button",
    selector: 'main [data-slot="button"][data-variant="outline"]',
    tier: "d3",
    context: "wizard navigation footer",
    textContains: "取消",
  },
  {
    name: "footer-next-button",
    selector: 'main [data-slot="button"][data-variant="default"]',
    tier: "d3",
    context: "wizard navigation footer",
    textContains: "下一步",
  },
  {
    // WizardStepper renders the product Button primitive; future steps are
    // disabled at step 1 — the natural, always-present product disabled
    // state (nth 1 = step 2 of 4).
    name: "stepper-future-button",
    selector: "main nav ol li [data-slot='button']",
    tier: "d3",
    context: "wizard stepper, future step (product-disabled at step 1)",
    nth: 1,
  },
];

const COURSE_PAGE: ControlDef[] = [
  ...SEAM_DEFS,
  { name: "body", selector: "body", tier: "external", context: "page" },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "sidebar",
  },
  {
    name: "toolbar-search-input",
    selector: '[data-slot="toolbar-search"] input',
    tier: "d3",
    context: "quiet toolbar (standalone as-built)",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
    context: "course table",
  },
  {
    name: "table-td",
    selector: '[data-slot="table-cell"]',
    tier: "d2baseline",
    context: "course table",
  },
  {
    name: "create-button",
    selector: 'main [data-slot="button"][data-variant="default"]',
    tier: "d3",
    context: "page header action",
    textContains: "新增课程",
  },
  {
    name: "pagination-button",
    selector: '[data-slot="pagination"] [data-slot="button"]',
    tier: "pagexcl",
    context: "table pagination (excluded from D3, must not move)",
  },
];

const COURSE_DIALOG: ControlDef[] = [
  {
    name: "dialog-content",
    selector: '[data-slot="dialog-content"]',
    tier: "dialogfrozen",
    context: "create-course dialog surface (D7 owns)",
  },
  {
    name: "name-input",
    selector: "#course-name",
    tier: "d3",
    context: "create-course dialog form",
  },
  {
    name: "code-input",
    selector: "#course-code",
    tier: "d3",
    context: "create-course dialog form",
  },
  {
    name: "description-textarea",
    selector: "#course-desc",
    tier: "d3",
    context: "create-course dialog form",
  },
  {
    name: "footer-cancel-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
    tier: "d3",
    context: "create-course dialog footer",
    textContains: "取消",
  },
  {
    name: "footer-save-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
    tier: "d3",
    context: "create-course dialog footer",
    textContains: "保存",
  },
];

const USERS_PAGE: ControlDef[] = [
  ...SEAM_DEFS,
  { name: "body", selector: "body", tier: "external", context: "page" },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "sidebar",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
    context: "users table",
  },
  {
    name: "table-td",
    selector: '[data-slot="table-cell"]',
    tier: "d2baseline",
    context: "users table",
  },
  {
    name: "role-badge",
    selector: '[data-slot="badge"]',
    tier: "badgeexcl",
    context: "users table role pill (excluded from D3, must not move)",
  },
  {
    name: "status-badge",
    selector: '[data-slot="status-badge"]',
    tier: "statusprobe",
    context: "users table account status (frozen D5, must not move)",
  },
  {
    name: "create-button",
    selector: 'main [data-slot="button"][data-variant="default"]',
    tier: "d3",
    context: "page header action",
    textContains: "新增用户",
  },
  {
    name: "pagination-button",
    selector: '[data-slot="pagination"] [data-slot="button"]',
    tier: "pagexcl",
    context: "table pagination (excluded from D3, must not move)",
  },
];

const USERS_DIALOG: ControlDef[] = [
  {
    name: "dialog-content",
    selector: '[data-slot="dialog-content"]',
    tier: "dialogfrozen",
    context: "create-user dialog surface (D7 owns)",
  },
  {
    name: "username-input",
    selector: '[data-slot="dialog-content"] [data-slot="input"]',
    tier: "d3",
    context: "create-user dialog form",
    nth: 0,
  },
  {
    name: "password-input",
    selector: '[data-slot="dialog-content"] [data-slot="input"]',
    tier: "d3",
    context: "create-user dialog form",
    nth: 1,
  },
  {
    name: "name-input",
    selector: '[data-slot="dialog-content"] [data-slot="input"]',
    tier: "d3",
    context: "create-user dialog form",
    nth: 2,
  },
  {
    name: "role-select-trigger",
    selector: '[data-slot="dialog-content"] [data-slot="select-trigger"]',
    tier: "d3",
    context: "create-user dialog form",
  },
  {
    name: "footer-cancel-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
    tier: "d3",
    context: "create-user dialog footer",
    textContains: "取消",
  },
  {
    name: "footer-save-button",
    selector:
      '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
    tier: "d3",
    context: "create-user dialog footer",
    textContains: "保存",
  },
];

const USERS_DIALOG_OVERLAY: ControlDef[] = [
  {
    name: "select-content",
    selector: '[data-slot="select-content"]',
    tier: "overlayfrozen",
    context: "role select popover (frozen overlay, must not move)",
  },
  {
    name: "select-item",
    selector: '[data-slot="select-item"]',
    tier: "overlayfrozen",
    context: "role select popover (frozen overlay, must not move)",
  },
];

const EXAM_DETAIL_PAGE: ControlDef[] = [
  ...SEAM_DEFS,
  { name: "body", selector: "body", tier: "external", context: "page" },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "sidebar",
  },
  {
    name: "status-badge",
    selector: '[data-slot="status-badge"]',
    tier: "statusprobe",
    context: "exam status (frozen D5, must not move)",
  },
  {
    name: "unpublish-trigger-button",
    selector: '[data-testid="exam-detail-unpublish-btn"]',
    tier: "d3",
    context: "exam-detail header actions (outline)",
  },
];

const EXAM_CONFIRM: ControlDef[] = [
  {
    name: "alert-dialog-content",
    selector: '[data-slot="alert-dialog-content"]',
    tier: "dialogfrozen",
    context: "unpublish confirm surface (D7 owns)",
  },
  {
    name: "confirm-cancel-button",
    selector:
      '[data-slot="alert-dialog-content"] [data-slot="alert-dialog-cancel"]',
    tier: "d3",
    context: "unpublish confirm footer",
    textContains: "取消",
  },
  {
    name: "confirm-destructive-button",
    selector:
      '[data-slot="alert-dialog-content"] [data-slot="alert-dialog-action"]',
    tier: "d3",
    context: "unpublish confirm footer",
  },
];

/** Validity-only probe (task §13): the questions workbench is NOT judged
 * D3 evidence — it contributes the TagBadge frozen-D6 guard, the D2/D4
 * absolutes and a second quiet-toolbar standalone-filter sample. */
const QUESTIONS_PROBE: ControlDef[] = [
  ...SEAM_DEFS,
  { name: "body", selector: "body", tier: "external", context: "page" },
  {
    name: "sidebar-link",
    selector: '[data-slot="sidebar-nav-item"]',
    tier: "d2baseline",
    context: "sidebar",
  },
  {
    name: "toolbar-search-input",
    selector: '[data-slot="toolbar-search"] input',
    tier: "d3",
    context: "quiet toolbar (standalone as-built)",
  },
  {
    name: "toolbar-filter-trigger",
    selector: '[data-slot="toolbar-filter"] [data-slot="select-trigger"]',
    tier: "d3",
    context: "quiet toolbar (standalone as-built)",
  },
  {
    name: "table-th",
    selector: '[data-slot="table-head"]',
    tier: "d4frozen",
    context: "questions table",
  },
  {
    name: "table-td",
    selector: '[data-slot="table-cell"]',
    tier: "d2baseline",
    context: "questions table",
  },
  {
    name: "tag-badge",
    selector: '[data-slot="tag-badge"]',
    tier: "d6frozen",
    context: "questions tags column (frozen D6 = 500, radius must not move)",
  },
];

const SURFACE_TARGETS: Record<string, ControlDef[]> = {
  "exam-create": EXAM_CREATE_PAGE,
  course: COURSE_PAGE,
  "course-dialog": COURSE_DIALOG,
  users: USERS_PAGE,
  "users-dialog": USERS_DIALOG,
  "users-dialog-select": USERS_DIALOG_OVERLAY,
  "exam-detail": EXAM_DETAIL_PAGE,
  "exam-detail-confirm": EXAM_CONFIRM,
  "question-list-probe": QUESTIONS_PROBE,
};

const JUDGED_SURFACES = [
  "exam-create",
  "course",
  "course-dialog",
  "users",
  "users-dialog",
  "exam-detail",
  "exam-detail-confirm",
];

// ── Evidence structures ──
interface ControlRecord {
  target: string;
  selector: string;
  tier: string;
  context: string;
  found: boolean;
  dataVariant: string | null;
  dataSize: string | null;
  focusVisible: boolean | null;
  borderRadius: string | null;
  borderTopLeftRadius: string | null;
  height: string | null;
  minHeight: string | null;
  paddingTop: string | null;
  paddingRight: string | null;
  paddingBottom: string | null;
  paddingLeft: string | null;
  borderTopWidth: string | null;
  borderRightWidth: string | null;
  borderBottomWidth: string | null;
  borderLeftWidth: string | null;
  borderTopColor: string | null;
  backgroundColor: string | null;
  boxShadow: string | null;
  outlineStyle: string | null;
  outlineWidth: string | null;
  outlineColor: string | null;
  opacity: string | null;
  fontSize: string | null;
  fontWeight: string | null;
  lineHeight: string | null;
  fontFamily: string | null;
  color: string | null;
  letterSpacing: string | null;
  gap: string | null;
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

type ProbeState = "resting" | "focus" | "invalid" | "disabled";

interface StateRecord {
  surface: string;
  variant: VariantLetter;
  viewport: string;
  state: ProbeState;
  target: string;
  record: ControlRecord;
}

const captures: CaptureRecord[] = [];
const stateRecords: StateRecord[] = [];

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

/** Font gate (§7/§16): the common frozen baseline assumes the production
 * HarmonyOS Sans SC path carries the weights the frozen tiers use (400 body
 * + 500 header/tag). A missing face invalidates the experiment. */
const CJK_FACE_SAMPLE = "课程考试创建用户名密码角色描述安全设备";

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
    return {
      bodyFontFamily: stack,
      harmonyInStack: stack.includes("HarmonyOS Sans SC"),
      check400: document.fonts.check(`400 12px "HarmonyOS Sans SC"`, sample),
      check500: document.fonts.check(`500 12px "HarmonyOS Sans SC"`, sample),
    };
  }, CJK_FACE_SAMPLE);
  if (!gate.harmonyInStack || !gate.check400 || !gate.check500) {
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
      /border-radius\s*:[^;]*!important/.test(el.textContent ?? "")
    );
  }, STYLE_ID);
  if (!applied) {
    throw new Error(
      `EXPERIMENT_INVALID: variant style not installed in head on ${surface}/${variant}`,
    );
  }
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
    // position:fixed elements (dialogs, popovers) have offsetParent === null,
    // so visibility is judged by layout box + computed paint state, not by
    // offsetParent.
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
      dataVariant: null,
      dataSize: null,
      focusVisible: null,
      borderRadius: null,
      borderTopLeftRadius: null,
      height: null,
      minHeight: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      borderTopWidth: null,
      borderRightWidth: null,
      borderBottomWidth: null,
      borderLeftWidth: null,
      borderTopColor: null,
      backgroundColor: null,
      boxShadow: null,
      outlineStyle: null,
      outlineWidth: null,
      outlineColor: null,
      opacity: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      fontFamily: null,
      color: null,
      letterSpacing: null,
      gap: null,
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
        dataVariant: el.getAttribute("data-variant"),
        dataSize: el.getAttribute("data-size"),
        focusVisible: el.matches(":focus-visible"),
        borderRadius: s.borderRadius,
        borderTopLeftRadius: s.borderTopLeftRadius,
        height: s.height,
        minHeight: s.minHeight,
        paddingTop: s.paddingTop,
        paddingRight: s.paddingRight,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        borderTopWidth: s.borderTopWidth,
        borderRightWidth: s.borderRightWidth,
        borderBottomWidth: s.borderBottomWidth,
        borderLeftWidth: s.borderLeftWidth,
        borderTopColor: s.borderTopColor,
        backgroundColor: s.backgroundColor,
        boxShadow: s.boxShadow,
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
        opacity: s.opacity,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        fontFamily: s.fontFamily,
        color: s.color,
        letterSpacing: s.letterSpacing,
        gap: s.gap,
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

/** Oracle collections are pin-sized; an empty oracle is a harness bug, not
 * evidence — fail loudly instead of indexing into undefined. */
function firstRecord(records: ControlRecord[], what: string): ControlRecord {
  const rec = records[0];
  if (!rec) {
    throw new Error(
      `EXPERIMENT_INVALID: oracle returned no record for ${what}`,
    );
  }
  return rec;
}

/** Loud guards after every oracle collection (§17 convergence preconditions,
 * evaluated per arm — the cross-arm pairing happens in afterAll). */
function requireFound(
  records: ControlRecord[],
  surface: string,
  names: string[],
): void {
  for (const name of names) {
    const rec = records.find((r) => r.target === name);
    if (!rec?.found) {
      throw new Error(
        `EXPERIMENT_INVALID: required target "${name}" not visible on ${surface}`,
      );
    }
  }
}

/** Seam gate (§18): the composite internal seam selectors must either match
 * nothing (as-built) or read 0px — in EVERY arm, without exception. */
function requireSeamInvariant(
  records: ControlRecord[],
  surface: string,
  variant: VariantLetter,
): void {
  for (const rec of records.filter((r) => r.tier === "seam")) {
    if (rec.found && rec.borderRadius !== "0px") {
      throw new Error(
        `CROSS_CONTEXT_CONTAMINATION: seam target ${rec.target} reads ${String(rec.borderRadius)} on ${surface}/${variant} — EXPERIMENT_INVALID`,
      );
    }
  }
}

/** D3 convergence gate (§17): every found standalone family control on this
 * surface reads exactly this arm's candidate radius. */
function requireFamilyConvergence(
  records: ControlRecord[],
  surface: string,
  variant: VariantLetter,
): void {
  const expected = MAP[variant];
  for (const rec of records.filter((r) => r.tier === "d3")) {
    if (rec.found && rec.borderRadius !== expected) {
      throw new Error(
        `EXPERIMENT_INVALID: family target ${rec.target} reads ${String(rec.borderRadius)}, expected arm candidate on ${surface}/${variant}`,
      );
    }
  }
}

/** Keyboard focus walk (§15): tabs until the target owns focus WITH the
 * :focus-visible ring (product focus treatment); a focus state that cannot
 * be reached invalidates the run. */
async function focusViaTab(
  p: Page,
  target: Locator,
  name: string,
  maxTabs = 60,
): Promise<void> {
  const state = () =>
    target.evaluate((el) => ({
      active: document.activeElement === el,
      focusVisible: el.matches(":focus-visible"),
    }));
  for (let i = 0; i < maxTabs; i++) {
    const s = await state().catch(() => ({
      active: false,
      focusVisible: false,
    }));
    if (s.active && s.focusVisible) return;
    await p.keyboard.press("Tab");
  }
  const s = await state().catch(() => ({ active: false, focusVisible: false }));
  if (s.active && s.focusVisible) return;
  throw new Error(
    `EXPERIMENT_INVALID: could not reach :focus-visible on ${name}`,
  );
}

// ── Crops (native pixels; edges snap to element boundaries or whitespace,
// so no control is sliced at a crop edge — §27) ──
async function cropDialog(
  p: Page,
  dialogSelector: string,
  vp: { width: number; height: number },
  out: string,
): Promise<boolean> {
  const box = await p
    .locator(dialogSelector)
    .first()
    .boundingBox()
    .catch(() => null);
  if (!box) return false;
  const pad = 6;
  const x = Math.max(box.x - pad, 0);
  const y = Math.max(box.y - pad, 0);
  const width = Math.min(box.width + pad * 2, vp.width - x);
  const height = Math.min(box.height + pad * 2, vp.height - y);
  if (width <= 0 || height <= 0) return false;
  await p.screenshot({ path: out, clip: { x, y, width, height } });
  return true;
}

/** Vertical band from one element's top edge to another's bottom edge,
 * spanning the common container's width (both elements inside the same form
 * column / dialog / footer row). Full controls + their labels, no slicing. */
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

// ── Dialog / confirm openers (real product states, i18n-stable roles) ──
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

// ── Per-surface capture ──
interface CaptureOptions {
  browser: Browser;
  variant: VariantLetter | null;
  viewport: { name: string; width: number; height: number };
}

async function newSurfacePage(
  opts: CaptureOptions,
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

async function captureExamCreate(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, "/admin/exams/new");
  try {
    await expect(p.locator("#wiz-title")).toBeVisible();
    if (variant) {
      await assertVariantStyleApplied(p, "exam-create", variant);
      await runFontGate(p, "exam-create", variant, viewport.name);
    }
    const controls = await collectControls(p, EXAM_CREATE_PAGE);
    requireFound(controls, "exam-create", [
      "title-input",
      "course-select-trigger",
      "description-input",
      "profile-select-trigger",
      "footer-cancel-button",
      "footer-next-button",
      "stepper-future-button",
    ]);
    requireSeamInvariant(controls, "exam-create", variant ?? "X");
    if (variant) requireFamilyConvergence(controls, "exam-create", variant);

    const macro = join(MACRO_DIR, `exam-create-${tag}-${viewport.name}.png`);
    await p.screenshot({ path: macro });

    // C1/C2/C3 context band: the step-1 basic-info + policy form.
    await cropBandBetween(
      p,
      p.locator("#wiz-title"),
      p.locator('main [data-slot="select-trigger"]').nth(1),
      p.locator("main"),
      viewport,
      join(MICRO_DIR, `exam-create-form-band-${tag}-${viewport.name}.png`),
      8,
      34,
    );
    // C4: outline cancel + primary next, one row. At 1100×800 the footer
    // row sits below the fold: scroll it into view first (same sequence in
    // every arm), then crop with fresh boxes.
    const nextBtn = p
      .locator('main [data-slot="button"][data-variant="default"]')
      .filter({ hasText: "下一步" });
    await nextBtn.scrollIntoViewIfNeeded().catch(() => undefined);
    await p.waitForTimeout(150);
    await cropBandBetween(
      p,
      p
        .locator('main [data-slot="button"][data-variant="outline"]')
        .filter({ hasText: "取消" }),
      nextBtn,
      p.locator("main"),
      viewport,
      join(MICRO_DIR, `exam-create-footer-band-${tag}-${viewport.name}.png`),
    );

    captures.push({
      phase,
      surface: "exam-create",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: macro,
      controls,
    });

    // §15/§16 states on this surface (arm captures only; the same sequence
    // runs in both arms): focus via keyboard + the natural product-disabled
    // future stepper button.
    if (variant) {
      const titleDef = EXAM_CREATE_PAGE.filter((d) => d.name === "title-input");
      const stepperDef = EXAM_CREATE_PAGE.filter(
        (d) => d.name === "stepper-future-button",
      );

      // natural disabled state: the future-step button is product-disabled
      // at step 1; the current-step sibling (same component, size, variant)
      // is the resting comparator.
      const restingDisabled = await collectControls(p, stepperDef);
      const currentDef: ControlDef = {
        ...stepperDef[0]!,
        name: "stepper-current-button",
        nth: 0,
      };
      const currentRec = firstRecord(
        await collectControls(p, [currentDef]),
        "stepper-current-button",
      );
      const disabledCheck = firstRecord(
        restingDisabled,
        "stepper-future-button resting",
      );
      stateRecords.push({
        surface: "exam-create",
        variant,
        viewport: viewport.name,
        state: "resting",
        target: "stepper-future-button",
        record: currentRec,
      });
      if (
        !disabledCheck.found ||
        disabledCheck.backgroundColor === currentRec.backgroundColor
      ) {
        throw new Error(
          `EXPERIMENT_INVALID: natural disabled treatment not expressed on stepper button, exam-create/${variant}`,
        );
      }
      stateRecords.push({
        surface: "exam-create",
        variant,
        viewport: viewport.name,
        state: "disabled",
        target: "stepper-future-button",
        record: disabledCheck,
      });
      // Band crop spanning the WHOLE stepper row so no step chip is sliced
      // at a crop edge (§27); the disabled future-step chip is the target.
      const olLoc = p.locator("main nav ol").first();
      await olLoc.scrollIntoViewIfNeeded().catch(() => undefined);
      await p.waitForTimeout(150);
      await cropBandBetween(
        p,
        p.locator("main nav ol li").first(),
        p.locator("main nav ol li").last(),
        olLoc,
        viewport,
        join(
          MICRO_DIR,
          `exam-create-disabled-stepper-${tag}-${viewport.name}.png`,
        ),
      );

      // focus state on the title Input (M5): resting record first, then the
      // keyboard focus walk.
      const restingFocus = firstRecord(
        await collectControls(p, titleDef),
        "title-input resting",
      );
      stateRecords.push({
        surface: "exam-create",
        variant,
        viewport: viewport.name,
        state: "resting",
        target: "title-input",
        record: restingFocus,
      });
      await focusViaTab(p, p.locator("#wiz-title"), "exam-create title-input");
      await p.waitForTimeout(250);
      const focusRec = firstRecord(
        await collectControls(p, titleDef),
        "title-input focus",
      );
      if (!focusRec.found || focusRec.focusVisible !== true) {
        throw new Error(
          `EXPERIMENT_INVALID: focus-visible treatment absent on exam-create/${variant}`,
        );
      }
      stateRecords.push({
        surface: "exam-create",
        variant,
        viewport: viewport.name,
        state: "focus",
        target: "title-input",
        record: focusRec,
      });
      // Field-boundary band: label + input + error block whole, so no
      // neighbouring control is sliced at a crop edge (§27).
      await cropBandBetween(
        p,
        p.locator("#wiz-title").locator("xpath=.."),
        p.locator("#wiz-title").locator("xpath=.."),
        p.locator("main"),
        viewport,
        join(MICRO_DIR, `exam-create-focus-input-${tag}-${viewport.name}.png`),
      );
    }

    progressLog(
      OUTPUT_DIR,
      `[d3] captured exam-create ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureCourse(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, "/admin/courses");
  try {
    await expect(p.locator('[data-slot="table-head"]').first()).toBeVisible();
    if (variant) {
      await assertVariantStyleApplied(p, "course", variant);
      await runFontGate(p, "course", variant, viewport.name);
    }
    const controls = await collectControls(p, COURSE_PAGE);
    requireFound(controls, "course", [
      "toolbar-search-input",
      "table-th",
      "table-td",
      "create-button",
    ]);
    requireSeamInvariant(controls, "course", variant ?? "X");
    if (variant) requireFamilyConvergence(controls, "course", variant);

    const macro = join(MACRO_DIR, `course-${tag}-${viewport.name}.png`);
    await p.screenshot({ path: macro });

    // §13 non-dominant toolbar sample: the quiet toolbar band as the
    // standalone-filter context (NOT judged D3 evidence by itself).
    await cropBandBetween(
      p,
      p.locator('[data-slot="toolbar-search"] input'),
      p.locator('[data-slot="toolbar-search"] input'),
      p.locator('[data-toolbar-appearance="quiet"]').first(),
      viewport,
      join(MICRO_DIR, `course-toolbar-band-${tag}-${viewport.name}.png`),
    );

    // Dialog phase: Textarea-bearing create-course form (§12-B).
    await openCourseDialog(p);
    const dialogControls = await collectControls(p, COURSE_DIALOG);
    requireFound(dialogControls, "course-dialog", [
      "dialog-content",
      "name-input",
      "code-input",
      "description-textarea",
      "footer-cancel-button",
      "footer-save-button",
    ]);
    requireSeamInvariant(dialogControls, "course-dialog", variant ?? "X");
    if (variant)
      requireFamilyConvergence(dialogControls, "course-dialog", variant);

    const dialogMacro = join(
      MACRO_DIR,
      `course-dialog-${tag}-${viewport.name}.png`,
    );
    await p.screenshot({ path: dialogMacro });
    await cropDialog(
      p,
      '[data-slot="dialog-content"]',
      viewport,
      join(MICRO_DIR, `course-dialog-whole-${tag}-${viewport.name}.png`),
    );
    // C1/C3: name + code fields, one visual context.
    await cropBandBetween(
      p,
      p.locator("#course-name"),
      p.locator("#course-desc"),
      p.locator('[data-slot="dialog-content"]'),
      viewport,
      join(MICRO_DIR, `course-fields-band-${tag}-${viewport.name}.png`),
    );
    // M3 + C1/C4: textarea directly above the footer buttons.
    await cropBandBetween(
      p,
      p.locator("#course-desc"),
      p
        .locator(
          '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
        )
        .filter({ hasText: "保存" }),
      p.locator('[data-slot="dialog-content"]'),
      viewport,
      join(
        MICRO_DIR,
        `course-textarea-footer-band-${tag}-${viewport.name}.png`,
      ),
    );

    captures.push({
      phase,
      surface: "course",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: macro,
      controls,
    });
    captures.push({
      phase,
      surface: "course-dialog",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: dialogMacro,
      controls: dialogControls,
    });

    // §15/§16 state probes on real dialog controls (arm captures only).
    if (variant) {
      const nameDef = COURSE_DIALOG.filter((d) => d.name === "name-input");
      const saveDef = COURSE_DIALOG.filter(
        (d) => d.name === "footer-save-button",
      );
      const nameLoc = p.locator("#course-name");
      const saveLoc = p
        .locator(
          '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
        )
        .filter({ hasText: "保存" });

      // focus — Input with the product :focus-visible ring (M5). Radix
      // autofocuses the first tabbable element on open, and the dialog close
      // button sits LAST in the DOM, so the name input opens already focused:
      // blur first so the resting reference is genuinely resting, then run
      // the keyboard focus walk.
      await nameLoc.blur();
      await p.waitForTimeout(250);
      const restingFocus = firstRecord(
        await collectControls(p, nameDef),
        "name-input resting (focus ref)",
      );
      stateRecords.push({
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        state: "resting",
        target: "name-input",
        record: restingFocus,
      });
      await focusViaTab(p, nameLoc, "course name-input");
      await p.waitForTimeout(250);
      const focusRec = firstRecord(
        await collectControls(p, nameDef),
        "name-input focus",
      );
      if (!focusRec.found || focusRec.focusVisible !== true) {
        throw new Error(
          `EXPERIMENT_INVALID: focus-visible treatment absent on course-dialog/${variant}`,
        );
      }
      stateRecords.push({
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        state: "focus",
        target: "name-input",
        record: focusRec,
      });
      // Field-boundary band (label + input + error whole, §27).
      const nameField = nameLoc.locator("xpath=..");
      await cropBandBetween(
        p,
        nameField,
        nameField,
        p.locator('[data-slot="dialog-content"]'),
        viewport,
        join(MICRO_DIR, `course-focus-input-${tag}-${viewport.name}.png`),
        8,
        0,
      );
      await nameLoc.blur();
      // border-color/box-shadow are transitioned: let the transition finish
      // before the resting reference reads computed values.
      await p.waitForTimeout(250);

      // invalid — the product aria-invalid treatment on a real Input,
      // expressed against the resting record captured moments earlier.
      const restingInvalid = firstRecord(
        await collectControls(p, nameDef),
        "name-input resting (invalid ref)",
      );
      await nameLoc.evaluate((el) => el.setAttribute("aria-invalid", "true"));
      await p.waitForTimeout(250);
      const invalidRec = firstRecord(
        await collectControls(p, nameDef),
        "name-input invalid",
      );
      if (
        !invalidRec.found ||
        (invalidRec.borderTopColor === restingInvalid.borderTopColor &&
          invalidRec.boxShadow === restingInvalid.boxShadow)
      ) {
        throw new Error(
          `EXPERIMENT_INVALID: aria-invalid treatment not expressed on course-dialog/${variant}`,
        );
      }
      stateRecords.push({
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        state: "resting",
        target: "name-input-invalid-ref",
        record: restingInvalid,
      });
      stateRecords.push({
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        state: "invalid",
        target: "name-input",
        record: invalidRec,
      });
      await cropBandBetween(
        p,
        nameField,
        nameField,
        p.locator('[data-slot="dialog-content"]'),
        viewport,
        join(MICRO_DIR, `course-invalid-input-${tag}-${viewport.name}.png`),
        8,
        0,
      );
      await nameLoc.evaluate((el) => el.removeAttribute("aria-invalid"));
      await p.waitForTimeout(250);

      // disabled — the product disabled treatment on the save Button
      // (mechanical probe; the natural disabled evidence lives on the
      // exam-create stepper).
      const restingDisabledBtn = firstRecord(
        await collectControls(p, saveDef),
        "footer-save-button resting",
      );
      await saveLoc.evaluate((el) => {
        (el as HTMLButtonElement).disabled = true;
      });
      await p.waitForTimeout(250);
      const disabledRec = firstRecord(
        await collectControls(p, saveDef),
        "footer-save-button disabled",
      );
      if (
        !disabledRec.found ||
        (disabledRec.backgroundColor === restingDisabledBtn.backgroundColor &&
          disabledRec.color === restingDisabledBtn.color)
      ) {
        throw new Error(
          `EXPERIMENT_INVALID: disabled treatment not expressed on course-dialog/${variant}`,
        );
      }
      stateRecords.push({
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        state: "resting",
        target: "footer-save-button",
        record: restingDisabledBtn,
      });
      stateRecords.push({
        surface: "course-dialog",
        variant,
        viewport: viewport.name,
        state: "disabled",
        target: "footer-save-button",
        record: disabledRec,
      });
      // Band crop: full textarea above + the disabled save button, so no
      // neighbouring control is sliced at a crop edge (§27).
      await cropBandBetween(
        p,
        p.locator("#course-desc"),
        saveLoc,
        p.locator('[data-slot="dialog-content"]'),
        viewport,
        join(MICRO_DIR, `course-disabled-button-${tag}-${viewport.name}.png`),
      );
      await saveLoc.evaluate((el) => {
        (el as HTMLButtonElement).disabled = false;
      });
      await p.waitForTimeout(250);
    }

    await p
      .locator(
        '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
      )
      .filter({ hasText: "取消" })
      .click();
    await expect(p.locator("#course-name")).toBeHidden();
    progressLog(
      OUTPUT_DIR,
      `[d3] captured course(+dialog) ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureUsers(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, "/admin/users");
  try {
    await expect(p.locator('[data-slot="table-head"]').first()).toBeVisible();
    if (variant) {
      await assertVariantStyleApplied(p, "users", variant);
      await runFontGate(p, "users", variant, viewport.name);
    }
    const controls = await collectControls(p, USERS_PAGE);
    requireFound(controls, "users", [
      "table-th",
      "table-td",
      "role-badge",
      "status-badge",
      "create-button",
    ]);
    requireSeamInvariant(controls, "users", variant ?? "X");
    if (variant) requireFamilyConvergence(controls, "users", variant);

    const macro = join(MACRO_DIR, `users-${tag}-${viewport.name}.png`);
    await p.screenshot({ path: macro });

    // Dialog phase: create-user form (Input ×3 + SelectTrigger + footer).
    await openUsersDialog(p);
    const dialogControls = await collectControls(p, USERS_DIALOG);
    requireFound(dialogControls, "users-dialog", [
      "dialog-content",
      "username-input",
      "password-input",
      "name-input",
      "role-select-trigger",
      "footer-cancel-button",
      "footer-save-button",
    ]);
    requireSeamInvariant(dialogControls, "users-dialog", variant ?? "X");
    if (variant)
      requireFamilyConvergence(dialogControls, "users-dialog", variant);

    const dialogMacro = join(
      MACRO_DIR,
      `users-dialog-${tag}-${viewport.name}.png`,
    );
    await p.screenshot({ path: dialogMacro });
    await cropDialog(
      p,
      '[data-slot="dialog-content"]',
      viewport,
      join(MICRO_DIR, `users-dialog-whole-${tag}-${viewport.name}.png`),
    );
    // C2/C4: role SelectTrigger + footer buttons in one context.
    await cropBandBetween(
      p,
      p.locator('[data-slot="dialog-content"] [data-slot="select-trigger"]'),
      p
        .locator(
          '[data-slot="dialog-content"] [data-slot="button"][data-variant="default"]',
        )
        .filter({ hasText: "保存" }),
      p.locator('[data-slot="dialog-content"]'),
      viewport,
      join(MICRO_DIR, `users-select-footer-band-${tag}-${viewport.name}.png`),
    );

    captures.push({
      phase,
      surface: "users",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: macro,
      controls,
    });
    captures.push({
      phase,
      surface: "users-dialog",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: dialogMacro,
      controls: dialogControls,
    });

    if (variant) {
      // §15 focus state: SelectTrigger with the product :focus-visible ring.
      const triggerLoc = p.locator(
        '[data-slot="dialog-content"] [data-slot="select-trigger"]',
      );
      await focusViaTab(p, triggerLoc, "users role-select-trigger");
      await p.waitForTimeout(250);
      const focusRec = firstRecord(
        await collectControls(
          p,
          USERS_DIALOG.filter((d) => d.name === "role-select-trigger"),
        ),
        "role-select-trigger focus",
      );
      stateRecords.push({
        surface: "users-dialog",
        variant,
        viewport: viewport.name,
        state: "resting",
        target: "role-select-trigger",
        record: dialogControls.find((c) => c.target === "role-select-trigger")!,
      });
      if (!focusRec.found || focusRec.focusVisible !== true) {
        throw new Error(
          `EXPERIMENT_INVALID: focus-visible treatment absent on users-dialog/${variant}`,
        );
      }
      stateRecords.push({
        surface: "users-dialog",
        variant,
        viewport: viewport.name,
        state: "focus",
        target: "role-select-trigger",
        record: focusRec,
      });
      // Field-boundary band (label + trigger whole, §27).
      const roleField = triggerLoc.locator("xpath=..");
      await cropBandBetween(
        p,
        roleField,
        roleField,
        p.locator('[data-slot="dialog-content"]'),
        viewport,
        join(MICRO_DIR, `users-focus-select-${tag}-${viewport.name}.png`),
      );

      // §19 SelectContent overlay guard: open, probe, close (validity only).
      await triggerLoc.click();
      await expect(p.locator('[data-slot="select-content"]')).toBeVisible();
      const overlayRecs = await collectControls(p, USERS_DIALOG_OVERLAY);
      requireFound(overlayRecs, "users-dialog-select", [
        "select-content",
        "select-item",
      ]);
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
    }

    await p
      .locator(
        '[data-slot="dialog-content"] [data-slot="button"][data-variant="outline"]',
      )
      .filter({ hasText: "取消" })
      .click();
    await expect(
      p.locator('[data-slot="dialog-content"] [data-slot="input"]').first(),
    ).toBeHidden();
    progressLog(
      OUTPUT_DIR,
      `[d3] captured users(+dialog) ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

async function captureExamDetail(
  opts: CaptureOptions,
  examId: string,
): Promise<void> {
  const { variant, viewport } = opts;
  const tag = variant ?? "asbuilt";
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, `/admin/exams/${examId}`);
  try {
    await expect(p.locator('[data-slot="status-badge"]').first()).toBeVisible();
    if (variant) {
      await assertVariantStyleApplied(p, "exam-detail", variant);
      await runFontGate(p, "exam-detail", variant, viewport.name);
    }
    const controls = await collectControls(p, EXAM_DETAIL_PAGE);
    requireFound(controls, "exam-detail", [
      "status-badge",
      "unpublish-trigger-button",
    ]);
    requireSeamInvariant(controls, "exam-detail", variant ?? "X");
    if (variant) requireFamilyConvergence(controls, "exam-detail", variant);

    const macro = join(MACRO_DIR, `exam-detail-${tag}-${viewport.name}.png`);
    await p.screenshot({ path: macro });

    // Destructive confirmation (§12-D): the real unpublish ConfirmDialog.
    await openUnpublishConfirm(p);
    const confirmControls = await collectControls(p, EXAM_CONFIRM);
    requireFound(confirmControls, "exam-detail-confirm", [
      "alert-dialog-content",
      "confirm-cancel-button",
      "confirm-destructive-button",
    ]);
    requireSeamInvariant(
      confirmControls,
      "exam-detail-confirm",
      variant ?? "X",
    );
    if (variant)
      requireFamilyConvergence(confirmControls, "exam-detail-confirm", variant);

    const confirmMacro = join(
      MACRO_DIR,
      `exam-detail-confirm-${tag}-${viewport.name}.png`,
    );
    await p.screenshot({ path: confirmMacro });
    await cropDialog(
      p,
      '[data-slot="alert-dialog-content"]',
      viewport,
      join(MICRO_DIR, `exam-detail-confirm-whole-${tag}-${viewport.name}.png`),
    );
    // C5/M6: destructive + secondary/cancel, one footer row.
    await cropBandBetween(
      p,
      p
        .locator(
          '[data-slot="alert-dialog-content"] [data-slot="alert-dialog-cancel"]',
        )
        .filter({ hasText: "取消" }),
      p.locator(
        '[data-slot="alert-dialog-content"] [data-slot="alert-dialog-action"]',
      ),
      p.locator('[data-slot="alert-dialog-content"]'),
      viewport,
      join(
        MICRO_DIR,
        `exam-detail-confirm-footer-band-${tag}-${viewport.name}.png`,
      ),
    );

    captures.push({
      phase,
      surface: "exam-detail",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: macro,
      controls,
    });
    captures.push({
      phase,
      surface: "exam-detail-confirm",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: confirmMacro,
      controls: confirmControls,
    });

    await p
      .locator(
        '[data-slot="alert-dialog-content"] [data-slot="alert-dialog-cancel"]',
      )
      .filter({ hasText: "取消" })
      .click();
    await expect(p.locator('[data-slot="alert-dialog-content"]')).toBeHidden();
    progressLog(
      OUTPUT_DIR,
      `[d3] captured exam-detail(+confirm) ${tag}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

/** Validity-only TagBadge/toolbar probe (task §13) — no screenshots. */
async function probeQuestions(opts: CaptureOptions): Promise<void> {
  const { variant, viewport } = opts;
  const phase: Phase = variant ? "arm" : "asbuilt";
  const { p, close } = await newSurfacePage(opts, "/admin/questions");
  try {
    if (variant) {
      await assertVariantStyleApplied(p, "question-list-probe", variant);
      await runFontGate(p, "question-list-probe", variant, viewport.name);
    }
    const controls = await collectControls(p, QUESTIONS_PROBE);
    requireFound(controls, "question-list-probe", [
      "toolbar-search-input",
      "table-th",
      "table-td",
      "tag-badge",
    ]);
    requireSeamInvariant(controls, "question-list-probe", variant ?? "X");
    if (variant)
      requireFamilyConvergence(controls, "question-list-probe", variant);
    captures.push({
      phase,
      surface: "question-list-probe",
      variant: variant ?? "X",
      viewport: viewport.name,
      screenshot: "",
      controls,
    });
    progressLog(
      OUTPUT_DIR,
      `[d3] probed question-list (validity-only) ${variant ?? "asbuilt"}@${viewport.name}`,
    );
  } finally {
    await close();
  }
}

// ── Test suite ──
test.describe.serial("UI-D3-VISUAL-AB-582", () => {
  let examId = "";

  test.beforeAll(async ({ request }) => {
    mkdirSync(MACRO_DIR, { recursive: true });
    mkdirSync(MICRO_DIR, { recursive: true });

    const token = await adminApiToken(request);

    const course = await adminPostJson(request, "/api/courses", token, {
      name: `${FIXTURE_MARKER}-证据课程`,
      code: `E2E-d3-${Date.now()}`,
      description: "D3 blind A/B fixture course (issue 582)",
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
    progressLog(
      OUTPUT_DIR,
      "[d3] fixture course + tagged question + published exam seeded",
    );

    writeFileSync(
      join(OUTPUT_DIR, "run-manifest.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE. Mapping: validity/variant-map.json.",
          runId: RUN_ID,
          issue: 582,
          variable: "D3",
          question:
            "Primary control family radius — Input, SelectTrigger, Textarea and standalone Button judged as ONE family (family convergence decision), against the frozen upstream D2 (15px body/control), D4 (13px/20px/500 table header), D5 (22px StatusBadge) and D6 (500 TagBadge weight) baselines",
          variants: ["X", "Y"],
          mapFileRef:
            "docs/research/exam-582-d3-visual-ab-1/validity/variant-map.json",
          asBuiltExpectations: {
            standaloneInput: "6px",
            standaloneSelectTrigger: "6px",
            standaloneTextarea: "6px",
            standaloneButton: "8px",
            authority:
              "browser computed style; recipes.css 0.375rem vs button.tsx rounded-lg",
            mismatchProtocol: "AUTHORITY_MISMATCH stop",
          },
          frozenConstants: {
            bodyControlBaseline: "15px (common D2 block injected in BOTH arms)",
            tableHeaderBaseline:
              "13px/20px/500 (upstream D4 as-built, verified per capture)",
            statusBadgeBaseline:
              "22px height (upstream D5 as-built, probed per arm)",
            tagBadgeBaseline:
              "weight 500 (common D6 block injected in BOTH arms), radius as-built unchanged",
            dialogSurface:
              "dialog-content / alert-dialog-content radius and shadow frozen (D7 owns), probed per arm",
            compositeInternalSeam:
              "quiet-toolbar joined-filter geometry is dead CSS at runtime (no [data-slot=toolbar-filters] renderer); seam-preservation rule kept in BOTH arms; oracle proves absence per capture",
            paginationExclusion:
              "pagination pills excluded (task §3); no surface renders pagination (fixtures below page size); guard rule pins as-built 8px in both arms",
          },
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          viewports: VIEWPORTS,
          surfaces: Object.keys(SURFACE_TARGETS),
          judgedSurfaces: JUDGED_SURFACES,
          validityOnlySurfaces: ["question-list-probe", "users-dialog-select"],
          injection:
            "addInitScript <style> — D2+D6 common baseline blocks (both arms) + D3 family border-radius candidate (the only cross-arm difference) + invariant seam/pagination exception rules (identical both arms)",
        },
        null,
        2,
      ),
    );
  });

  test("D3 as-built radius inventory (§2, clean product, no injection)", async ({
    browser,
  }) => {
    const opts: CaptureOptions = {
      browser,
      variant: null,
      viewport: VP_DESKTOP,
    };
    await captureExamCreate(opts);
    await captureCourse(opts);
    await captureUsers(opts);
    await captureExamDetail(opts, examId);
    await probeQuestions(opts);

    const asBuiltCaptures = captures.filter((c) => c.phase === "asbuilt");
    const recordsOf = (surface: string): ControlRecord[] =>
      asBuiltCaptures
        .filter((c) => c.surface === surface)
        .flatMap((c) => c.controls);

    interface InventoryRow {
      route: string;
      component: string;
      selector: string;
      context: string;
      computedRadius: string | null;
      found: boolean;
      sourceOwner: string;
      inclusion: "D3_INCLUDED" | "D3_EXCLUDED";
      reason: string;
    }
    const routeOfSurface: Record<string, string> = {
      "exam-create": "/admin/exams/new",
      course: "/admin/courses",
      "course-dialog": "/admin/courses (dialog)",
      users: "/admin/users",
      "users-dialog": "/admin/users (dialog)",
      "exam-detail": `/admin/exams/${examId}`,
      "exam-detail-confirm": `/admin/exams/${examId} (confirm)`,
      "question-list-probe": "/admin/questions",
    };
    const ownerReasonOf = (
      tier: string,
    ): {
      sourceOwner: string;
      inclusion: "D3_INCLUDED" | "D3_EXCLUDED";
      reason: string;
    } => {
      switch (tier) {
        case "d3":
          return {
            sourceOwner:
              "control/recipes.css 0.375rem (input/select-trigger/textarea) + components/ui/button.tsx rounded-lg (button)",
            inclusion: "D3_INCLUDED",
            reason:
              "primary interactive form/control family, standalone context",
          };
        case "seam":
          return {
            sourceOwner:
              "control/recipes.css @media block (dead CSS at runtime)",
            inclusion: "D3_EXCLUDED",
            reason:
              "COMPOSITE_INTERNAL_SEAM selector — as-built absent; if it ever renders it must stay 0px in both arms",
          };
        case "dialogfrozen":
          return {
            sourceOwner: "components/ui/dialog.tsx / alert-dialog.tsx surface",
            inclusion: "D3_EXCLUDED",
            reason: "dialog/sheet surface is D7 scope (task §3/§12)",
          };
        case "statusprobe":
          return {
            sourceOwner:
              "components/shared/StatusBadge.tsx + badge/recipes.css",
            inclusion: "D3_EXCLUDED",
            reason: "frozen D5 decision — non-contamination guard",
          };
        case "d6frozen":
          return {
            sourceOwner: "components/shared/TagBadge.tsx + badge/recipes.css",
            inclusion: "D3_EXCLUDED",
            reason: "frozen D6 decision (weight 500 injected) — radius guard",
          };
        case "badgeexcl":
          return {
            sourceOwner: "components/ui/badge.tsx (generic Badge)",
            inclusion: "D3_EXCLUDED",
            reason: "generic Badge/chip/pill — task §3 exclusion",
          };
        case "pagexcl":
          return {
            sourceOwner: "components/ui/pagination.tsx + button.tsx",
            inclusion: "D3_EXCLUDED",
            reason: "pagination pills — task §3 exclusion",
          };
        case "d4frozen":
          return {
            sourceOwner: "data-table header typography recipes",
            inclusion: "D3_EXCLUDED",
            reason: "frozen D4 decision — upstream baseline",
          };
        case "d2baseline":
          return {
            sourceOwner: "typography/recipes.css",
            inclusion: "D3_EXCLUDED",
            reason: "frozen D2 decision (15px injected) — upstream baseline",
          };
        case "overlayfrozen":
          return {
            sourceOwner: "components/ui/select.tsx popover surface",
            inclusion: "D3_EXCLUDED",
            reason: "select popover overlay — non-D3 guard",
          };
        default:
          return {
            sourceOwner: "product as-built",
            inclusion: "D3_EXCLUDED",
            reason: "untouched context",
          };
      }
    };

    const rows: InventoryRow[] = [];
    for (const cap of asBuiltCaptures) {
      for (const rec of cap.controls) {
        const o = ownerReasonOf(rec.tier);
        rows.push({
          route: routeOfSurface[cap.surface] ?? cap.surface,
          component: rec.target,
          selector: rec.selector,
          context: rec.context,
          computedRadius: rec.borderRadius,
          found: rec.found,
          sourceOwner: o.sourceOwner,
          inclusion: o.inclusion,
          reason: o.reason,
        });
      }
    }

    // Seam + pagination presence facts (§4/§18/§3).
    const seamFacts = asBuiltCaptures.flatMap((c) =>
      c.controls
        .filter((r) => r.tier === "seam")
        .map((r) => ({
          route: routeOfSurface[c.surface] ?? c.surface,
          target: r.target,
          found: r.found,
          computedRadius: r.borderRadius,
        })),
    );
    const paginationFacts = asBuiltCaptures.flatMap((c) =>
      c.controls
        .filter((r) => r.tier === "pagexcl")
        .map((r) => ({
          route: routeOfSurface[c.surface] ?? c.surface,
          target: r.target,
          found: r.found,
          computedRadius: r.borderRadius,
        })),
    );

    // §2 AUTHORITY gate: the assumed 6/8 split must hold in computed styles.
    const splitCheck: string[] = [];
    for (const cap of asBuiltCaptures) {
      for (const rec of cap.controls) {
        if (rec.tier !== "d3" || !rec.found) continue;
        const isButton = rec.target.endsWith("button");
        const isTextarea = rec.target.endsWith("textarea");
        const isInput = rec.target.endsWith("input") || isTextarea;
        const isTrigger = rec.target.endsWith("trigger");
        const expected = isButton ? "8px" : isInput || isTrigger ? "6px" : null;
        if (expected && rec.borderRadius !== expected) {
          splitCheck.push(
            `${routeOfSurface[cap.surface]}:${rec.target} computed ${String(rec.borderRadius)} != expected ${expected}`,
          );
        }
      }
    }
    if (splitCheck.length > 0) {
      throw new Error(
        `AUTHORITY_MISMATCH: as-built 6/8 split not confirmed —\n${splitCheck.join("\n")}`,
      );
    }

    mkdirSync(join(OUTPUT_DIR, "artifacts"), { recursive: true });
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "as-built-radius-inventory.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          authority:
            "browser computed styles on the clean product (no injection), 1440×900, DPR=1",
          asBuiltSplit: {
            standaloneInput: "6px",
            standaloneSelectTrigger: "6px",
            standaloneTextarea: "6px",
            standaloneButton: "8px",
            verified: true,
          },
          compositeSeamFacts: {
            note: "task §4 assumed joined quiet-toolbar filters with 0px internal seams; as-built no component renders [data-slot=toolbar-filters] — the seam rules in control/recipes.css are dead CSS. Quiet-toolbar controls are standalone family members.",
            seamProbe: seamFacts,
            paginationProbe: paginationFacts,
          },
          rows,
        },
        null,
        2,
      ),
    );
    // Judged evidence comes ONLY from the injected arms; drop the clean
    // records now that the §2 inventory is written.
    for (let i = captures.length - 1; i >= 0; i--) {
      const rec = captures[i];
      if (rec?.phase === "asbuilt") captures.splice(i, 1);
    }
    progressLog(
      OUTPUT_DIR,
      "[d3] as-built inventory verified: 6/8 split confirmed, seam selectors absent",
    );
  });

  test("D3 A/B captures (4 surfaces + dialogs x2 viewports x2 arms)", async ({
    browser,
  }) => {
    for (const viewport of VIEWPORTS) {
      for (const variant of ["X", "Y"] as VariantLetter[]) {
        const opts: CaptureOptions = { browser, variant, viewport };
        await captureExamCreate(opts);
        await captureCourse(opts);
        await captureUsers(opts);
        await captureExamDetail(opts, examId);
      }
    }
  });

  test("D3 validity-only probe (questions TagBadge/toolbar, both arms)", async ({
    browser,
  }) => {
    for (const variant of ["X", "Y"] as VariantLetter[]) {
      await probeQuestions({ browser, variant, viewport: VP_DESKTOP });
    }
  });

  test.afterAll(async () => {
    // ── Pairwise style diffs + tier guards (§8/§16/§17/§19) ──
    const CONTROLLED = [
      "height",
      "minHeight",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderTopColor",
      "backgroundColor",
      "boxShadow",
      "outlineStyle",
      "outlineWidth",
      "outlineColor",
      "opacity",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "fontFamily",
      "color",
      "letterSpacing",
      "gap",
      "dataVariant",
      "dataSize",
    ] as const;

    const armCaptures = captures.filter((c) => c.phase === "arm");
    const phaseRecords: Array<{
      surface: string;
      viewport: string;
      variant: VariantLetter;
      controls: ControlRecord[];
    }> = armCaptures.map((c) => ({
      surface: c.surface,
      viewport: c.viewport,
      variant: c.variant,
      controls: c.controls,
    }));

    const identityOf = (r: ControlRecord): string =>
      `${r.selector}|${r.target}|${r.tier}`;

    interface PairDiff {
      key: string;
      complete: boolean;
      tier: string | null;
      xFound: boolean;
      yFound: boolean;
      xRadius: string | null;
      yRadius: string | null;
      radiusChanged: boolean;
      controlledDiffs: string[];
      xValues: Record<string, string | null>;
      yValues: Record<string, string | null>;
    }

    const pairDiffs: PairDiff[] = [];
    const identityKeys = new Set<string>();
    for (const pr of phaseRecords) {
      for (const rec of pr.controls) {
        identityKeys.add(`${pr.surface}@${pr.viewport}:${identityOf(rec)}`);
      }
    }
    for (const key of identityKeys) {
      const sep = key.indexOf(":");
      const surfaceAtViewport = key.slice(0, sep);
      const identity = key.slice(sep + 1);
      const pick = (variant: VariantLetter) =>
        phaseRecords
          .find(
            (pr) =>
              `${pr.surface}@${pr.viewport}` === surfaceAtViewport &&
              pr.variant === variant &&
              pr.controls.some((r) => identityOf(r) === identity),
          )
          ?.controls.find((r) => identityOf(r) === identity);
      const xRec = pick("X");
      const yRec = pick("Y");
      if (!xRec || !yRec) {
        pairDiffs.push({
          key,
          complete: false,
          tier: (xRec ?? yRec)?.tier ?? null,
          xFound: xRec?.found ?? false,
          yFound: yRec?.found ?? false,
          xRadius: xRec?.borderRadius ?? null,
          yRadius: yRec?.borderRadius ?? null,
          radiusChanged: false,
          controlledDiffs: [],
          xValues: {},
          yValues: {},
        });
        continue;
      }
      const controlledDiffs = CONTROLLED.filter((k) => xRec[k] !== yRec[k]);
      const xValues: Record<string, string | null> = {
        borderRadius: xRec.borderRadius,
      };
      const yValues: Record<string, string | null> = {
        borderRadius: yRec.borderRadius,
      };
      for (const k of CONTROLLED) {
        xValues[k] = xRec[k];
        yValues[k] = yRec[k];
      }
      pairDiffs.push({
        key,
        complete: xRec.found && yRec.found,
        tier: xRec.tier,
        xFound: xRec.found,
        yFound: yRec.found,
        xRadius: xRec.borderRadius,
        yRadius: yRec.borderRadius,
        radiusChanged: xRec.borderRadius !== yRec.borderRadius,
        controlledDiffs,
        xValues,
        yValues,
      });
    }

    const absolute = (d: PairDiff, prop: string, want: string): boolean =>
      d.xValues[prop] === want && d.yValues[prop] === want;
    const nothingMoved = (d: PairDiff): boolean =>
      d.complete && d.controlledDiffs.length === 0 && !d.radiusChanged;

    // D3 single-variable guard: family pairs move in border-radius ONLY and
    // each arm equals its candidate (§17 convergence, pairwise form).
    const d3Pairs = pairDiffs.filter((d) => d.tier === "d3" && d.complete);
    const d3Violations = d3Pairs.filter(
      (d) =>
        !d.radiusChanged ||
        d.xRadius !== MAP.X ||
        d.yRadius !== MAP.Y ||
        d.controlledDiffs.length > 0,
    );

    // D2 common-baseline guard (absolute): 15px in BOTH arms, nothing moves.
    const baselinePairs = pairDiffs.filter(
      (d) => d.tier === "d2baseline" && d.complete,
    );
    const baselineViolations = baselinePairs.filter(
      (d) =>
        !absolute(d, "fontSize", "15px") ||
        d.controlledDiffs.length > 0 ||
        d.radiusChanged,
    );

    // D4 frozen-upstream guard (absolute): 13px/20px/500 in BOTH arms.
    const d4Pairs = pairDiffs.filter(
      (d) => d.tier === "d4frozen" && d.complete,
    );
    const d4Violations = d4Pairs.filter(
      (d) =>
        !absolute(d, "fontSize", "13px") ||
        !absolute(d, "lineHeight", "20px") ||
        !absolute(d, "fontWeight", "500") ||
        d.controlledDiffs.length > 0 ||
        d.radiusChanged,
    );

    // D6 frozen-upstream guard: TagBadge weight 500 in BOTH arms (injected
    // common baseline) and radius/surface untouched.
    const d6Pairs = pairDiffs.filter(
      (d) => d.tier === "d6frozen" && d.complete,
    );
    const d6Violations = d6Pairs.filter(
      (d) =>
        !absolute(d, "fontWeight", "500") ||
        d.controlledDiffs.length > 0 ||
        d.radiusChanged,
    );

    // D5 StatusBadge guard: 22px height, nothing moves.
    const statusPairs = pairDiffs.filter(
      (d) => d.tier === "statusprobe" && d.complete,
    );
    const statusViolations = statusPairs.filter(
      (d) =>
        !absolute(d, "height", "22px") ||
        d.controlledDiffs.length > 0 ||
        d.radiusChanged,
    );

    // Dialog/sheet surface guard (D7 owns): container radius+shadow frozen.
    const dialogPairs = pairDiffs.filter(
      (d) => d.tier === "dialogfrozen" && d.complete,
    );
    const dialogViolations = dialogPairs.filter((d) => !nothingMoved(d));

    // Overlay guard (SelectContent/SelectItem): frozen, nothing moves.
    const overlayPairs = pairDiffs.filter(
      (d) => d.tier === "overlayfrozen" && d.complete,
    );
    const overlayViolations = overlayPairs.filter((d) => !nothingMoved(d));

    // Badge exclusion guard (generic role Badge): task §3, nothing moves.
    const badgePairs = pairDiffs.filter(
      (d) => d.tier === "badgeexcl" && d.complete,
    );
    const badgeViolations = badgePairs.filter((d) => !nothingMoved(d));

    // Pagination exclusion guard: task §3 — pinned as-built, nothing moves.
    const paginationPairs = pairDiffs.filter(
      (d) => d.tier === "pagexcl" && d.complete,
    );
    const paginationViolations = paginationPairs.filter(
      (d) => !nothingMoved(d),
    );

    // Seam guard (§18): as-built absence (selectors match nothing) in BOTH
    // arms, or 0px in both arms if a joined context ever renders.
    const seamPairs = pairDiffs.filter((d) => d.tier === "seam");
    const seamViolations = seamPairs.filter((d) => {
      const absentBoth = !d.xFound && !d.yFound;
      const zeroBoth =
        d.xFound && d.yFound && d.xRadius === "0px" && d.yRadius === "0px";
      return !(absentBoth || zeroBoth);
    });

    // Cross-variable contamination: no non-d3 tier may move at all.
    const nonD3Complete = pairDiffs.filter(
      (d) => d.complete && d.tier !== "d3",
    );
    const contaminationViolations = nonD3Complete.filter(
      (d) => d.radiusChanged || d.controlledDiffs.length > 0,
    );

    // ── State oracle pairing (§16): only border-radius moves; the product
    // state treatment must be PRESENT and IDENTICAL in both arms. ──
    interface StatePair {
      key: string;
      state: string;
      target: string;
      xRadius: string | null;
      yRadius: string | null;
      radiusChanged: boolean;
      controlledDiffs: string[];
      focusVisibleX: boolean | null;
      focusVisibleY: boolean | null;
      expressedX: boolean;
      expressedY: boolean;
      pass: boolean;
    }
    const statePairs: StatePair[] = [];
    const stateKeys = new Set(
      stateRecords
        .filter((s) => s.state !== "resting")
        .map((s) => `${s.surface}@${s.viewport}:${s.state}:${s.target}`),
    );
    for (const key of stateKeys) {
      const parts = key.split(":");
      const surfaceAtViewport = parts[0] ?? "";
      const state = parts[1] ?? "";
      const target = parts[2] ?? "";
      const findRec = (variant: VariantLetter) =>
        stateRecords.find(
          (s) =>
            `${s.surface}@${s.viewport}` === surfaceAtViewport &&
            s.state === state &&
            s.target === target &&
            s.variant === variant,
        );
      const restingRec = (variant: VariantLetter) =>
        stateRecords.find(
          (s) =>
            `${s.surface}@${s.viewport}` === surfaceAtViewport &&
            s.state === "resting" &&
            (s.target === target ||
              (state === "invalid" && s.target === `${target}-invalid-ref`)) &&
            s.variant === variant,
        );
      const x = findRec("X");
      const y = findRec("Y");
      const rx = restingRec("X");
      const ry = restingRec("Y");
      if (!x || !y || !rx || !ry) {
        statePairs.push({
          key,
          state,
          target,
          xRadius: x?.record.borderRadius ?? null,
          yRadius: y?.record.borderRadius ?? null,
          radiusChanged: false,
          controlledDiffs: ["MISSING_ARM"],
          focusVisibleX: x?.record.focusVisible ?? null,
          focusVisibleY: y?.record.focusVisible ?? null,
          expressedX: false,
          expressedY: false,
          pass: false,
        });
        continue;
      }
      const controlledDiffs = CONTROLLED.filter(
        (k) => x.record[k] !== y.record[k],
      );
      const radiusChanged = x.record.borderRadius !== y.record.borderRadius;
      const expressed = (rec: ControlRecord, rest: ControlRecord): boolean => {
        if (state === "focus") {
          return (
            rec.focusVisible === true &&
            rec.boxShadow !== "none" &&
            rec.boxShadow !== rest.boxShadow
          );
        }
        if (state === "invalid") {
          return (
            rec.borderTopColor !== rest.borderTopColor ||
            rec.boxShadow !== rest.boxShadow
          );
        }
        // disabled
        return (
          rec.backgroundColor !== rest.backgroundColor ||
          rec.color !== rest.color
        );
      };
      const expressedX = expressed(x.record, rx.record);
      const expressedY = expressed(y.record, ry.record);
      statePairs.push({
        key,
        state,
        target,
        xRadius: x.record.borderRadius,
        yRadius: y.record.borderRadius,
        radiusChanged,
        controlledDiffs,
        focusVisibleX: x.record.focusVisible,
        focusVisibleY: y.record.focusVisible,
        expressedX,
        expressedY,
        pass:
          expressedX &&
          expressedY &&
          radiusChanged &&
          controlledDiffs.length === 0 &&
          x.record.borderRadius === MAP.X &&
          y.record.borderRadius === MAP.Y,
      });
    }

    // ── Geometry pairing (§20): radius cannot change layout — deltas must
    // be 0 within float tolerance; anything larger is investigated. ──
    interface GeometryPair {
      key: string;
      deltaX: number | null;
      deltaY: number | null;
      deltaWidth: number | null;
      deltaHeight: number | null;
      pass: boolean;
    }
    const geometryPairs: GeometryPair[] = [];
    for (const key of identityKeys) {
      const sep = key.indexOf(":");
      const surfaceAtViewport = key.slice(0, sep);
      const identity = key.slice(sep + 1);
      const grab = (variant: VariantLetter) =>
        phaseRecords
          .find(
            (pr) =>
              `${pr.surface}@${pr.viewport}` === surfaceAtViewport &&
              pr.variant === variant,
          )
          ?.controls.find((r) => identityOf(r) === identity)?.bounding;
      const xb = grab("X");
      const yb = grab("Y");
      if (!xb || !yb) continue;
      const round1 = (a: number, b: number) => Math.round((b - a) * 10) / 10;
      const dx = round1(xb.x, yb.x);
      const dy = round1(xb.y, yb.y);
      const dw = round1(xb.width, yb.width);
      const dh = round1(xb.height, yb.height);
      geometryPairs.push({
        key,
        deltaX: dx,
        deltaY: dy,
        deltaWidth: dw,
        deltaHeight: dh,
        pass:
          Math.abs(dx) <= 0.5 &&
          Math.abs(dy) <= 0.5 &&
          Math.abs(dw) <= 0.5 &&
          Math.abs(dh) <= 0.5,
      });
    }

    // ── Artifacts ──
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D3", "style-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Records computed px per variant letter and therefore reveals the mapping. Judge-facing: D3/macro, D3/micro, contact sheets, judge/README.md, 04-judge-handoff.md.",
          captures: armCaptures.map((c) => ({
            surface: c.surface,
            variant: c.variant,
            viewport: c.viewport,
            screenshot: c.screenshot,
          })),
          controls: phaseRecords,
          pairDiffs,
          guards: {
            d3SingleVariablePass:
              d3Violations.length === 0 && d3Pairs.length > 0,
            d3Violations,
            d3ConvergedPairs: d3Pairs.length,
            d2BaselinePass:
              baselineViolations.length === 0 && baselinePairs.length > 0,
            baselineViolations,
            d4FrozenPass: d4Violations.length === 0 && d4Pairs.length > 0,
            d4Violations,
            d6FrozenPass: d6Violations.length === 0 && d6Pairs.length > 0,
            d6Violations,
            statusBadgeNonContaminationPass:
              statusViolations.length === 0 && statusPairs.length > 0,
            statusViolations,
            dialogSurfaceNonContaminationPass:
              dialogViolations.length === 0 && dialogPairs.length > 0,
            dialogViolations,
            overlayNonContaminationPass:
              overlayViolations.length === 0 && overlayPairs.length > 0,
            overlayViolations,
            badgeExclusionPass:
              badgeViolations.length === 0 && badgePairs.length > 0,
            badgeViolations,
            paginationExclusionPass: paginationViolations.length === 0,
            paginationPairCount: paginationPairs.length,
            paginationViolations,
            crossVariableContamination:
              contaminationViolations.length === 0 ? "NONE" : "PRESENT",
            contaminationViolations,
          },
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D3", "state-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY ONLY — MAPPING REVEALING. DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Per-state computed records per arm. Only border-radius may differ across arms; the product state treatment must be present in both (focus ring present, invalid ring expressed, disabled treatment expressed).",
          states: stateRecords,
          pairs: statePairs,
          pass: statePairs.length > 0 && statePairs.every((s) => s.pass),
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "D3", "geometry.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          note: "Pairwise bounding-box deltas across arms. Radius cannot change layout: expected Δ=0 (≤0.5px float tolerance).",
          pairs: geometryPairs,
          pass: geometryPairs.every((g) => g.pass),
          violations: geometryPairs.filter((g) => !g.pass),
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "composite-seam-proof.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          asBuiltFinding:
            "No component renders [data-slot=toolbar-filters]; the joined-filter seam rules in control/recipes.css match nothing at runtime. The task §4/§18 seam gate therefore proves ABSENCE: the seam selectors must match nothing in both arms (or read 0px in both arms if a joined context ever renders), and quiet-toolbar controls are probed as standalone family members.",
          seamPairCount: seamPairs.length,
          seamAbsentInBothArms:
            seamPairs.length > 0 &&
            seamPairs.every((d) => !d.xFound && !d.yFound),
          seamZeroInBothArms:
            seamPairs.length > 0 &&
            seamPairs.every(
              (d) =>
                d.xFound &&
                d.yFound &&
                d.xRadius === "0px" &&
                d.yRadius === "0px",
            ),
          violations: seamViolations,
          quietToolbarStandaloneSamples: pairDiffs.filter(
            (d) => d.tier === "d3" && d.key.includes("toolbar"),
          ),
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "upstream-baseline.json"),
      JSON.stringify(
        {
          _warning:
            "VALIDITY BUNDLE — DO NOT PROVIDE TO BLIND MULTIMODAL JUDGE.",
          capturedAt: new Date().toISOString(),
          d2CommonBaseline: {
            declared:
              "15px body/control tier in BOTH arms (upstream D2 freeze, injected)",
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
              "22px StatusBadge identical across arms (upstream D5 freeze, as-built)",
            pass: statusViolations.length === 0 && statusPairs.length > 0,
            completePairs: statusPairs.length,
            violations: statusViolations.map((d) => d.key),
          },
          d6FrozenUpstream: {
            declared:
              "TagBadge weight 500 in BOTH arms (upstream D6 freeze, injected); TagBadge radius as-built and unchanged across arms",
            pass: d6Violations.length === 0 && d6Pairs.length > 0,
            completePairs: d6Pairs.length,
            violations: d6Violations.map((d) => d.key),
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
          note: "Per-capture production font-stack gate (HarmonyOS Sans SC, 400/500 faces). Gate failures throw during capture, so a completed run implies PASS on every capture.",
          captureGate:
            "harmonyInStack && check400 && check500 (throws EXPERIMENT_INVALID_FONT_STACK)",
        },
        null,
        2,
      ),
    );

    progressLog(
      OUTPUT_DIR,
      `[d3] DONE: ${armCaptures.length} arm captures, ` +
        `d3Pairs=${d3Pairs.length} baselinePairs=${baselinePairs.length} ` +
        `d4Pairs=${d4Pairs.length} d6Pairs=${d6Pairs.length} statusPairs=${statusPairs.length} ` +
        `dialogPairs=${dialogPairs.length} overlayPairs=${overlayPairs.length} badgePairs=${badgePairs.length} ` +
        `seamPairs=${seamPairs.length} statePairs=${statePairs.length} geometryPairs=${geometryPairs.length} ` +
        `violations: d3=${d3Violations.length} baseline=${baselineViolations.length} d4=${d4Violations.length} ` +
        `d6=${d6Violations.length} status=${statusViolations.length} dialog=${dialogViolations.length} ` +
        `overlay=${overlayViolations.length} badge=${badgeViolations.length} pagination=${paginationViolations.length} ` +
        `seam=${seamViolations.length} contamination=${contaminationViolations.length} ` +
        `statePass=${statePairs.every((s) => s.pass)} geometryPass=${geometryPairs.every((g) => g.pass)}`,
    );
  });
});
