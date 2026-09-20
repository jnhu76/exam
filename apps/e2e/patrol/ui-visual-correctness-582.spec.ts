/**
 * UI-VISUAL-CORRECTNESS-582 — prerequisite audit for issue #582.
 *
 * Phase-1 evidence run BEFORE the D2–D7 A/B adjudication. It changes no
 * production visual values; it only captures per-surface screenshots plus
 * machine-checkable DOM/style facts:
 *
 *   1. Table visual correctness — geometry, overflow, tier, per-table crops.
 *   2. Scroll correctness — horizontal programmatic scrollLeft reachability
 *      on each admin-table-shell scroll region + vertical page scroll test.
 *   3. Font truth — computed font-family stacks, document.fonts loaded-face
 *      inventory, fonts.check() on CJK samples per weight, and a differential
 *      glyph-width measurement that distinguishes a real HarmonyOS Sans SC
 *      render from a silent fallback, plus woff2 network responses.
 *
 * Reuses the patrol fixtures/lifecycle (patrol-fixtures.ts, run-wsl.sh,
 * playwright.patrol.config.ts). Output: .tmp/ui-patrol/visual-correctness/<sha>-<ts>/
 *
 * Invoked via:
 *   DEV_API_PORT=3001 E2E_BASE_URL=http://localhost:3001 E2E_WORKERS=1 \
 *   bash scripts/e2e/run-wsl.sh --keep-server -- \
 *     --config=playwright.patrol.config.ts patrol/ui-visual-correctness-582.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { loginAsAdmin, loginViaUi } from "../lib/login";
import { seedExam, type SeededExam } from "../lib/seed";
import { createTeacherViaApi } from "../lib/teacher";
import { candidateApiToken, candidateStartAttempt } from "../lib/flow";
import {
  PATROL_BASE_URL,
  collectShellFacts,
  progressLog,
} from "./patrol-fixtures";

// ── Constants ──
const BASE_URL = PATROL_BASE_URL;
const BASE_SHA = execSync("git rev-parse HEAD", {
  cwd: join(import.meta.dirname, "../../.."),
})
  .toString()
  .trim();
const RUN_ID = `${BASE_SHA.slice(0, 8)}-${Date.now()}`;
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol/visual-correctness",
  RUN_ID,
);
const SCREENSHOTS_DIR = join(OUTPUT_DIR, "artifacts", "screenshots");
const CROPS_DIR = join(OUTPUT_DIR, "artifacts", "crops");

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1100x800", width: 1100, height: 800 },
  { name: "1023x800", width: 1023, height: 800 },
] as const;

const ADMIN_SURFACES = [
  { id: "S1-dashboard", route: "/admin/dashboard" },
  { id: "S2-exams", route: "/admin/exams" },
  { id: "S3-questions", route: "/admin/questions" },
  { id: "S4-users", route: "/admin/users" },
  { id: "S5-settings", route: "/admin/settings" },
  { id: "S8-audit-logs", route: "/admin/audit-logs" },
] as const;

const CJK_SAMPLE = "考试考生答案测评系统";
const LATIN_SAMPLE = "Exam Result 123";

// ── Types ──
interface StyleRecord {
  target: string;
  present: boolean;
  text: string | null;
  fontFamily?: string | null;
  fontSize?: string | null;
  fontWeight?: string | null;
  lineHeight?: string | null;
  color?: string | null;
  backgroundColor?: string | null;
}

interface FontFaceRecord {
  family: string;
  weight: string;
  style: string;
  status: string;
}

interface DifferentialWidth {
  text: string;
  harmonyPx: number | null;
  notoPx: number | null;
  fallbackPx: number | null;
  /** harmony differs from the never-installed fallback baseline. */
  harmonyDistinctFromFallback: boolean;
  harmonyDistinctFromNoto: boolean;
}

interface FontTruth {
  htmlFontFamily: string | null;
  bodyFontFamily: string | null;
  totalFaces: number;
  byStatus: Record<string, number>;
  harmonyFaces: { total: number; loaded: number };
  checkResults: Record<string, boolean>;
  differential: DifferentialWidth[];
  woff2Responses: Array<{ url: string; status: number }>;
}

interface TableScrollEvidence {
  archetype: string | null;
  tier: string | null;
  containerWidth: number;
  clientWidth: number | null;
  scrollWidth: number | null;
  overflowing: boolean | null;
  computedOverflowX: string | null;
  computedOverflowY: string | null;
  columns: number;
  bodyRows: number;
  horizontalScrollTest: {
    attempted: boolean;
    scrollLeftBefore: number;
    scrollLeftAfter: number;
    atEndAfter: string | null;
    /** Last body cell right edge reached inside the scroll region viewport. */
    lastCellReachable: boolean | null;
    cropFarRight: string | null;
  };
}

interface PageScrollEvidence {
  scrollHeight: number;
  clientHeight: number;
  verticalOverflow: boolean;
  scrollTest: {
    attempted: boolean;
    scrollYAfter: number;
    success: boolean;
    screenshotBottom: string | null;
  };
  stickyTopbar: {
    present: boolean;
    yAfterScroll: number | null;
    heightPx: number | null;
  };
}

interface CaptureEvidence {
  surface: string;
  route: string;
  viewport: string;
  dpr: number;
  capturedAt: string;
  screenshot: string;
  resolvedUrl: string;
  documentFacts: Awaited<ReturnType<typeof collectShellFacts>>["document"];
  shell: Awaited<ReturnType<typeof collectShellFacts>>["nav"];
  tables: TableScrollEvidence[];
  pageScroll: PageScrollEvidence;
  computedStyles: StyleRecord[];
  fontTruth: FontTruth;
}

// ── Global state ──
let page: Page;
const evidence: CaptureEvidence[] = [];
const fontResponses: Array<{ url: string; status: number; route: string }> = [];
let fontRouteCursor = "";
let teacherFixture: {
  username: string;
  password: string;
  name: string;
  userId: string;
} | null = null;
let takeExam: SeededExam | null = null;

// ── Helpers ──
function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function adminApiLoginToken(): Promise<string> {
  const res = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()["set-cookie"] ?? "";
  const token = setCookie.match(/auth-token=([^;]+)/)?.[1] ?? "";
  expect(token).toBeTruthy();
  return token;
}

/** One admin POST with retry on 429 (rate limiting). */
async function adminPost(
  path: string,
  token: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await page.request.post(`${BASE_URL}${path}`, {
      data,
      headers: { Cookie: `auth-token=${token}` },
    });
    if (res.status() === 429) {
      await page.waitForTimeout(1000 * attempt);
      continue;
    }
    expect(res.ok(), `POST ${path} -> ${res.status()}`).toBeTruthy();
    return (await res.json()) as Record<string, unknown>;
  }
  throw new Error(`POST ${path} rate-limited after retries`);
}

async function waitForPageStable(p: Page) {
  await p.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await p.evaluate(() => document.fonts.ready.then(() => undefined));
  await p.waitForTimeout(400);
}

// ── In-page collectors ──
async function collectComputedStyles(
  p: Page,
  dialogOpen: boolean,
): Promise<StyleRecord[]> {
  return p.evaluate((withDialog): StyleRecord[] => {
    const record = (target: string, el: Element | null): StyleRecord => {
      if (!el) {
        return { target, present: false, text: null };
      }
      const cs = window.getComputedStyle(el);
      const text = (el.textContent ?? "").trim().slice(0, 40) || null;
      return {
        target,
        present: true,
        text,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
      };
    };
    const visible = (el: Element | null): Element | null =>
      el &&
      (el as HTMLElement).offsetParent !== null &&
      (el as HTMLElement).getBoundingClientRect().width > 0
        ? el
        : null;
    const firstVisible = (selector: string): Element | null => {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (visible(el)) return el;
      }
      return null;
    };
    const root = document.querySelector("main") ?? document.body;
    void root;
    const out: StyleRecord[] = [
      record("body", document.body),
      record("page-heading", firstVisible("main h1, main h2")),
      record(
        "table-head-th",
        visible(
          document.querySelector('[data-slot="admin-table-shell"] thead th'),
        ),
      ),
      record(
        "table-cell-td",
        visible(
          document.querySelector('[data-slot="admin-table-shell"] tbody td'),
        ),
      ),
      record("status-badge", firstVisible('[data-slot="status-badge"]')),
      record("tag-badge", firstVisible('[data-slot="tag-badge"]')),
      record("button", firstVisible("main button")),
      record("input", firstVisible("main input")),
      record("select-trigger", firstVisible('main [role="combobox"]')),
      record(
        "sidebar-link",
        firstVisible('[data-testid="app-sidebar"] nav a[href]'),
      ),
    ];
    if (withDialog) {
      out.push(
        record("dialog-title", firstVisible('[role="dialog"] h2')),
        record("dialog-body-text", firstVisible('[role="dialog"] p')),
        record("dialog-input", firstVisible('[role="dialog"] input')),
        record("dialog-button", firstVisible('[role="dialog"] button')),
      );
    }
    return out;
  }, dialogOpen);
}

async function collectFontTruth(p: Page): Promise<FontTruth> {
  const inPage = await p.evaluate(() => {
    const csHtml = window.getComputedStyle(document.documentElement);
    const csBody = window.getComputedStyle(document.body);
    const faces: FontFaceRecord[] = [];
    document.fonts.forEach((f) => {
      faces.push({
        family: f.family.replace(/['"]/g, ""),
        weight: f.weight,
        style: f.style,
        status: f.status,
      });
    });
    const byStatus: Record<string, number> = {};
    for (const f of faces) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
    const harmony = faces.filter((f) => f.family === "HarmonyOS Sans SC");

    const check = (spec: string, text: string) => {
      try {
        return document.fonts.check(spec, text);
      } catch {
        return false;
      }
    };
    const checkResults = {
      "cjk-400": check("400 16px 'HarmonyOS Sans SC'", "考试考生答案测评系统"),
      "cjk-500": check("500 16px 'HarmonyOS Sans SC'", "考试考生答案测评系统"),
      "cjk-700": check("700 16px 'HarmonyOS Sans SC'", "考试考生答案测评系统"),
      "latin-400": check("400 16px 'HarmonyOS Sans SC'", "Exam Result 123"),
    };

    // Differential glyph-width measurement: if the HarmonyOS face is really
    // rendering, its advance widths differ from both Noto and a never-installed
    // family that falls through to the generic tail. document.fonts.check()
    // alone is not proof (unknown families resolve to fallback and still
    // "check" true), so widths are the primary render signal here.
    const measure = (text: string): DifferentialWidth => {
      const host = document.createElement("div");
      host.setAttribute(
        "style",
        "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:32px;line-height:normal;",
      );
      const mk = (family: string) => {
        const span = document.createElement("span");
        span.textContent = text;
        span.setAttribute("style", `font-family:${family};`);
        host.appendChild(span);
        return span;
      };
      const harmony = mk("'HarmonyOS Sans SC', cursive");
      const noto = mk("'Noto Sans CJK SC', cursive");
      const fallback = mk("'NotInstalled582Font', cursive");
      document.body.appendChild(host);
      const harmonyPx = harmony.getBoundingClientRect().width;
      const notoPx = noto.getBoundingClientRect().width;
      const fallbackPx = fallback.getBoundingClientRect().width;
      host.remove();
      return {
        text,
        harmonyPx,
        notoPx,
        fallbackPx,
        harmonyDistinctFromFallback: Math.abs(harmonyPx - fallbackPx) > 0.5,
        harmonyDistinctFromNoto: Math.abs(harmonyPx - notoPx) > 0.5,
      };
    };

    return {
      htmlFontFamily: csHtml.fontFamily,
      bodyFontFamily: csBody.fontFamily,
      totalFaces: faces.length,
      byStatus,
      harmonyFaces: {
        total: harmony.length,
        loaded: harmony.filter((f) => f.status === "loaded").length,
      },
      checkResults,
      differential: [
        measure("考试考生答案测评系统"),
        measure("Exam Result 123"),
      ],
    };
  });

  const woff2Responses = fontResponses
    .filter((r) => r.route === fontRouteCursor)
    .map(({ url, status }) => ({ url, status }));

  return { ...inPage, woff2Responses };
}

async function collectTableScrollEvidence(
  p: Page,
  surface: string,
  vp: string,
): Promise<TableScrollEvidence[]> {
  const facts = await p.evaluate(() => {
    const shells = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="admin-table-shell"]'),
    );
    return shells.map((shellEl) => {
      const scroll = shellEl.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      const table = shellEl.querySelector("table");
      const cs = scroll ? window.getComputedStyle(scroll) : null;
      return {
        archetype: shellEl.getAttribute("data-table-archetype"),
        tier: shellEl.getAttribute("data-table-tier"),
        containerWidth: shellEl.getBoundingClientRect().width,
        clientWidth: scroll?.clientWidth ?? null,
        scrollWidth: scroll?.scrollWidth ?? null,
        overflowing:
          scroll != null ? scroll.scrollWidth > scroll.clientWidth + 1 : null,
        computedOverflowX: cs?.overflowX ?? null,
        computedOverflowY: cs?.overflowY ?? null,
        columns: table?.querySelectorAll("thead th").length ?? 0,
        bodyRows: table?.querySelectorAll("tbody tr").length ?? 0,
      };
    });
  });

  const out: TableScrollEvidence[] = [];
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i];
    if (!fact || fact.archetype === "embedded-picker") {
      out.push({
        archetype: fact?.archetype ?? null,
        tier: fact?.tier ?? null,
        containerWidth: fact?.containerWidth ?? 0,
        clientWidth: fact?.clientWidth ?? null,
        scrollWidth: fact?.scrollWidth ?? null,
        overflowing: fact?.overflowing ?? null,
        computedOverflowX: fact?.computedOverflowX ?? null,
        computedOverflowY: fact?.computedOverflowY ?? null,
        columns: fact?.columns ?? 0,
        bodyRows: fact?.bodyRows ?? 0,
        horizontalScrollTest: {
          attempted: false,
          scrollLeftBefore: 0,
          scrollLeftAfter: 0,
          atEndAfter: null,
          lastCellReachable: null,
          cropFarRight: null,
        },
      });
      continue;
    }
    const idx = i;
    const before = await p.evaluate((i2) => {
      const shell = document.querySelectorAll<HTMLElement>(
        '[data-slot="admin-table-shell"]',
      )[i2];
      const scroll = shell?.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      return {
        scrollLeft: scroll?.scrollLeft ?? 0,
        atEnd: scroll?.getAttribute("data-scroll-end") ?? null,
      };
    }, idx);

    // Programmatic far-right scroll, then verify reachability facts.
    await p.evaluate((i2) => {
      const shell = document.querySelectorAll<HTMLElement>(
        '[data-slot="admin-table-shell"]',
      )[i2];
      const scroll = shell?.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      if (scroll) scroll.scrollLeft = 999999;
    }, idx);
    await p.waitForTimeout(200);

    const after = await p.evaluate((i2) => {
      const shell = document.querySelectorAll<HTMLElement>(
        '[data-slot="admin-table-shell"]',
      )[i2];
      const scroll = shell?.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      const table = shell?.querySelector("table");
      const rows = table?.querySelectorAll("tbody tr") ?? [];
      const lastRow = rows[rows.length - 1];
      const lastCell = lastRow
        ? (lastRow.querySelectorAll("td")[
            lastRow.querySelectorAll("td").length - 1
          ] ?? null)
        : null;
      let lastCellReachable: boolean | null = null;
      if (scroll && lastCell) {
        const cellRect = lastCell.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        // Right edge inside the scroll region's visible box (±1px tolerance).
        lastCellReachable =
          cellRect.right <= scrollRect.right + 1 &&
          cellRect.left < scrollRect.right;
      }
      return {
        scrollLeft: scroll?.scrollLeft ?? 0,
        atEnd: scroll?.getAttribute("data-scroll-end") ?? null,
        lastCellReachable,
      };
    }, idx);

    let cropFarRight: string | null = null;
    const shellBox = await p
      .locator('[data-slot="admin-table-shell"]')
      .nth(idx)
      .boundingBox()
      .catch(() => null);
    if (shellBox) {
      const vpBox = p.viewportSize();
      const clip = {
        x: Math.max(shellBox.x, 0),
        y: Math.max(shellBox.y, 0),
        width: Math.min(
          shellBox.width,
          (vpBox?.width ?? 0) - Math.max(shellBox.x, 0),
        ),
        height: Math.min(
          shellBox.height,
          (vpBox?.height ?? 0) - Math.max(shellBox.y, 0),
        ),
      };
      if (clip.width > 10 && clip.height > 10) {
        cropFarRight = join(
          CROPS_DIR,
          `${surface}--${vp}--table${out.length}-far-right.png`,
        );
        await p.screenshot({ path: cropFarRight, clip });
      }
    }

    out.push({
      ...fact,
      horizontalScrollTest: {
        attempted: fact.overflowing === true,
        scrollLeftBefore: before.scrollLeft,
        scrollLeftAfter: after.scrollLeft,
        atEndAfter: after.atEnd,
        lastCellReachable: after.lastCellReachable,
        cropFarRight,
      },
    });

    // Reset to start so later captures see the canonical state.
    await p.evaluate((i2) => {
      const shell = document.querySelectorAll<HTMLElement>(
        '[data-slot="admin-table-shell"]',
      )[i2];
      const scroll = shell?.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      if (scroll) scroll.scrollLeft = 0;
    }, idx);
    await p.waitForTimeout(150);
  }
  return out;
}

async function collectPageScrollEvidence(
  p: Page,
  surface: string,
  vp: string,
): Promise<PageScrollEvidence> {
  const facts = await p.evaluate(() => {
    const doc = document.documentElement;
    const topbar = document.querySelector("header");
    return {
      scrollHeight: doc.scrollHeight,
      clientHeight: doc.clientHeight,
      verticalOverflow: doc.scrollHeight > doc.clientHeight + 1,
      topbarPresent: topbar != null,
      topbarHeight: topbar?.getBoundingClientRect().height ?? null,
    };
  });

  let scrollYAfter = 0;
  let success = false;
  let screenshotBottom: string | null = null;
  let topbarYAfterScroll: number | null = null;
  if (facts.verticalOverflow) {
    await p.evaluate(() => window.scrollTo(0, 999999));
    await p.waitForTimeout(200);
    scrollYAfter = await p.evaluate(() => window.scrollY);
    success = scrollYAfter > 0;
    topbarYAfterScroll = await p.evaluate(() => {
      const topbar = document.querySelector("header");
      return topbar ? topbar.getBoundingClientRect().y : null;
    });
    screenshotBottom = join(
      SCREENSHOTS_DIR,
      `${surface}--${vp}--page-bottom.png`,
    );
    await p.screenshot({ path: screenshotBottom });
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(150);
  }

  return {
    scrollHeight: facts.scrollHeight,
    clientHeight: facts.clientHeight,
    verticalOverflow: facts.verticalOverflow,
    scrollTest: {
      attempted: facts.verticalOverflow,
      scrollYAfter,
      success,
      screenshotBottom,
    },
    stickyTopbar: {
      present: facts.topbarPresent,
      yAfterScroll: topbarYAfterScroll,
      heightPx: facts.topbarHeight,
    },
  };
}

async function captureSurface(
  p: Page,
  surface: string,
  route: string,
  viewport: { name: string; width: number; height: number },
  dialogOpen = false,
): Promise<CaptureEvidence> {
  fontRouteCursor = `${surface}@${viewport.name}`;
  const dpr = await p.evaluate(() => window.devicePixelRatio);
  const screenshot = join(SCREENSHOTS_DIR, `${surface}--${viewport.name}.png`);
  await p.screenshot({ path: screenshot });

  const shellFacts = await collectShellFacts(p);
  const tables = await collectTableScrollEvidence(p, surface, viewport.name);
  const pageScroll = await collectPageScrollEvidence(p, surface, viewport.name);
  const computedStyles = await collectComputedStyles(p, dialogOpen);
  const fontTruth = await collectFontTruth(p);

  const entry: CaptureEvidence = {
    surface,
    route,
    viewport: viewport.name,
    dpr,
    capturedAt: new Date().toISOString(),
    screenshot,
    resolvedUrl: p.url(),
    documentFacts: shellFacts.document,
    shell: shellFacts.nav,
    tables,
    pageScroll,
    computedStyles,
    fontTruth,
  };
  evidence.push(entry);
  progressLog(
    OUTPUT_DIR,
    `[582] captured ${surface} @${viewport.name} tables=${tables.length}`,
  );
  return entry;
}

async function navigateAndAudit(
  p: Page,
  surface: string,
  route: string,
  viewport: { name: string; width: number; height: number },
) {
  await p.setViewportSize({ width: viewport.width, height: viewport.height });
  // Tag font responses with the destination BEFORE navigation fires, or the
  // woff2 responses land under the previous capture's cursor.
  fontRouteCursor = `${surface}@${viewport.name}`;
  await p.goto(route, { waitUntil: "domcontentloaded" });
  await waitForPageStable(p);
  return captureSurface(p, surface, route, viewport);
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN AUDIT
// ══════════════════════════════════════════════════════════════════════════

test.describe.serial("UI-VISUAL-CORRECTNESS-582", () => {
  test.beforeAll(async ({ browser }) => {
    ensureDir(OUTPUT_DIR);
    ensureDir(SCREENSHOTS_DIR);
    ensureDir(CROPS_DIR);
    page = await browser.newPage();

    page.on("response", (res) => {
      const url = res.url();
      if (url.includes(".woff2")) {
        fontResponses.push({
          url,
          status: res.status(),
          route: fontRouteCursor,
        });
      }
    });

    // ── Seed: dense question bank + teacher (assignment dialog target) + take-exam fixture ──
    const token = await adminApiLoginToken();
    takeExam = await seedExam(page.request, "vis-audit-take", {
      timingMode: "timed_window",
      durationMinutes: 60,
    });
    progressLog(OUTPUT_DIR, `[582] seeded take-exam ${takeExam.examId}`);

    const courseId = takeExam.courseId;
    const stamp = Date.now();
    const seeds: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 5; i++) {
      seeds.push({
        courseId,
        type: "true_false",
        content: `判断题-审计-${stamp}-${i}`,
        standardAnswer: i % 2 === 0,
        score: 10,
        tags: [`审计-${stamp}`],
      });
    }
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "single_choice",
        content: `单选题-审计-${stamp}-${i}`,
        options: [
          { id: "a", content: "选项一" },
          { id: "b", content: "选项二", isCorrect: true },
          { id: "c", content: "选项三" },
          { id: "d", content: "选项四" },
        ],
        standardAnswer: "b",
        score: 10,
        tags: [`审计-${stamp}`],
      });
    }
    seeds.push({
      courseId,
      type: "multiple_choice",
      content: `多选题-审计-${stamp}`,
      options: [
        { id: "a", content: "选项甲", isCorrect: true },
        { id: "b", content: "选项乙", isCorrect: true },
        { id: "c", content: "选项丙" },
        { id: "d", content: "选项丁" },
      ],
      standardAnswer: ["a", "b"],
      score: 10,
      tags: [`审计-${stamp}`],
    });
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "fill_blank",
        content: `填空题-审计-${stamp}-${i}：____`,
        standardAnswer: "答案",
        score: 10,
        tags: [`审计-${stamp}`],
      });
    }
    for (let i = 1; i <= 2; i++) {
      seeds.push({
        courseId,
        type: "text_response",
        content: `论述题-审计-${stamp}-${i}`,
        standardAnswer: null,
        rubric: "按逻辑完整性给分",
        score: 20,
        tags: [`审计-${stamp}`],
      });
    }
    for (const s of seeds) {
      await adminPost("/api/questions", token, s);
    }
    progressLog(OUTPUT_DIR, `[582] seeded ${seeds.length} questions`);

    teacherFixture = await createTeacherViaApi(page.request, {
      name: "审计教师",
      usernamePrefix: "vis-audit-teacher",
    });
    await adminPost(
      `/api/admin/users/${teacherFixture.userId}/course-assignments`,
      token,
      { courseId },
    );

    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

    writeFileSync(
      join(OUTPUT_DIR, "manifest.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          baseSha: BASE_SHA,
          baseUrl: BASE_URL,
          startedAt: new Date().toISOString(),
          issue: 582,
          purpose: "visual-correctness + font-truth prerequisite audit",
          viewports: VIEWPORTS,
          surfaces: [
            ...ADMIN_SURFACES.map((s) => s.route),
            "S6 candidate",
            "S7 dialog",
          ],
        },
        null,
        2,
      ),
    );
  });

  test.afterAll(async () => {
    await page?.close();

    // Aggregate artifacts by evidence kind.
    const computedStyle = evidence.map((e) => ({
      surface: e.surface,
      route: e.route,
      viewport: e.viewport,
      computedStyles: e.computedStyles,
    }));
    const fontAudit = {
      environment: { runId: RUN_ID, baseSha: BASE_SHA },
      perCapture: evidence.map((e) => ({
        surface: e.surface,
        route: e.route,
        viewport: e.viewport,
        fontTruth: e.fontTruth,
      })),
    };
    const scrollAudit = {
      environment: { runId: RUN_ID, baseSha: BASE_SHA },
      perCapture: evidence.map((e) => ({
        surface: e.surface,
        route: e.route,
        viewport: e.viewport,
        pageScroll: e.pageScroll,
        documentFacts: e.documentFacts,
        tables: e.tables,
      })),
    };

    writeFileSync(
      join(OUTPUT_DIR, "manifest.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          baseSha: BASE_SHA,
          baseUrl: BASE_URL,
          completedAt: new Date().toISOString(),
          captures: evidence.length,
          entries: evidence.map((e) => ({
            surface: e.surface,
            route: e.route,
            viewport: e.viewport,
            screenshot: e.screenshot,
            dpr: e.dpr,
          })),
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "computed-style.json"),
      JSON.stringify(computedStyle, null, 2),
    );
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "font-audit.json"),
      JSON.stringify(fontAudit, null, 2),
    );
    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "scroll-audit.json"),
      JSON.stringify(scrollAudit, null, 2),
    );
    progressLog(OUTPUT_DIR, `[582] DONE: ${evidence.length} captures`);
  });

  test("Admin surfaces × viewports (tables, scroll, fonts)", async () => {
    await loginAsAdmin(page, "admin", "admin123");
    for (const viewport of VIEWPORTS) {
      for (const surface of ADMIN_SURFACES) {
        await navigateAndAudit(page, surface.id, surface.route, viewport);
      }
    }
  });

  test("S7 assignment dialog × viewports", async () => {
    if (!teacherFixture) return;
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      fontRouteCursor = `S7-assignment-dialog@${viewport.name}`;
      await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
      await waitForPageStable(page);

      // Management-list pages switch to the mobile card representation below
      // lg; the dialog opener (kebab overflow menu) exists in both, so pick
      // whichever representation owns the teacher record at this width.
      const desktopRow = page
        .locator(`tbody tr:has-text("${teacherFixture.name}")`)
        .first();
      const mobileCard = page
        .locator(
          `[data-slot="mobile-record-card"]:has-text("${teacherFixture.name}")`,
        )
        .first();
      const opener = (await desktopRow.isVisible().catch(() => false))
        ? desktopRow
        : mobileCard;
      await expect(opener).toBeVisible();
      await opener.locator('[data-action-id="overflow-menu"]').click();
      await page.locator('[data-action-id="teacher-courses"]').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await waitForPageStable(page);

      await captureSurface(
        page,
        "S7-assignment-dialog",
        "/admin/users (teacher course-assignment dialog open)",
        viewport,
        true,
      );

      const dialogBox = await dialog.boundingBox().catch(() => null);
      if (dialogBox) {
        await page.screenshot({
          path: join(
            CROPS_DIR,
            `S7-assignment-dialog--${viewport.name}--crop.png`,
          ),
          clip: {
            x: Math.max(dialogBox.x - 8, 0),
            y: Math.max(dialogBox.y - 8, 0),
            width: dialogBox.width + 16,
            height: dialogBox.height + 16,
          },
        });
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  });

  test("S6 candidate runtime × viewports", async () => {
    if (!takeExam) return;
    const candToken = await candidateApiToken(page.request, takeExam.candidate);
    // The /exam/:attemptId/take route is keyed by ATTEMPT id (App.tsx), not
    // exam id — navigating with the exam id renders the load-failure card.
    const attemptId = await candidateStartAttempt(
      page.request,
      candToken,
      takeExam.examId,
    );
    progressLog(OUTPUT_DIR, `[582] started attempt ${attemptId}`);

    await loginViaUi(
      page,
      takeExam.candidate.username,
      takeExam.candidate.password,
      /\/exam\/list/,
    );
    for (const viewport of VIEWPORTS) {
      await navigateAndAudit(page, "S6-exam-list", "/exam/list", viewport);
      await navigateAndAudit(
        page,
        "S6-exam-take",
        `/exam/${attemptId}/take`,
        viewport,
      );
    }
  });

  test("Below-lg probe 700x800 (forced horizontal overflow)", async () => {
    // At every audited viewport (>=1023) tier negotiation keeps all governed
    // tables inside their containers, so the horizontal scroll machinery
    // never engages. Below lg (1024) management-list pages switch to the
    // mobile card representation, but log-diagnostic tables (audit-logs)
    // keep horizontal scroll at every width — 700px forces the scroll region
    // to overflow so the far-right reachability test actually runs.
    await loginAsAdmin(page, "admin", "admin123");
    const vp = { name: "700x800", width: 700, height: 800 };
    await navigateAndAudit(page, "S8-audit-logs", "/admin/audit-logs", vp);
    await navigateAndAudit(page, "S2-exams", "/admin/exams", vp);
    await navigateAndAudit(page, "S3-questions", "/admin/questions", vp);
  });

  test("Font network probe (fresh context, cache-free)", async ({
    browser,
  }) => {
    // The shared patrol page primes the HTTP cache, so later navigations hit
    // the memory cache and emit no network events. This probe opens a fresh
    // context to prove the deployment actually serves the HarmonyOS Sans SC
    // resources (CSS + woff2) with 200s, and inventories which faces load.
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const p = await context.newPage();
    const requests: Array<{ url: string; status: number; kind: string }> = [];
    p.on("response", (res) => {
      const url = res.url();
      if (url.includes(".woff2") || url.includes("/fonts/")) {
        requests.push({
          url,
          status: res.status(),
          kind: url.endsWith(".css") ? "css" : "woff2",
        });
      }
    });
    await p.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await p.evaluate(() => document.fonts.ready.then(() => undefined));
    await p.waitForTimeout(600);

    const loadedFaces = await p.evaluate(() => {
      const loaded: Array<{ family: string; weight: string; url: string }> = [];
      document.fonts.forEach((f) => {
        if (f.status === "loaded") {
          loaded.push({
            family: f.family.replace(/['"]/g, ""),
            weight: String(f.weight),
            url: "",
          });
        }
      });
      return loaded;
    });

    const woff2 = requests.filter((r) => r.kind === "woff2");
    const css = requests.filter((r) => r.kind === "css");
    const countByStatus = (rows: typeof requests) => {
      const counts: Record<string, number> = {};
      for (const r of rows) {
        counts[String(r.status)] = (counts[String(r.status)] ?? 0) + 1;
      }
      return counts;
    };
    const loadedByFamilyWeight: Record<string, number> = {};
    for (const f of loadedFaces) {
      const key = `${f.family} @${f.weight}`;
      loadedByFamilyWeight[key] = (loadedByFamilyWeight[key] ?? 0) + 1;
    }

    writeFileSync(
      join(OUTPUT_DIR, "artifacts", "font-network-probe.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          note: "Fresh browser context (no HTTP cache). Proves font resources are served by this deployment and which faces the font system reports loaded.",
          route: "/login",
          cssRequests: css,
          fontRequestCount: requests.length,
          fontRequestStatusCounts: countByStatus(requests),
          woff2RequestCount: woff2.length,
          woff2StatusCounts: countByStatus(woff2),
          woff2SampleUrls: woff2.slice(0, 12),
          loadedFaceCount: loadedFaces.length,
          loadedByFamilyWeight,
        },
        null,
        2,
      ),
    );
    progressLog(
      OUTPUT_DIR,
      `[582] font probe: ${woff2.length} woff2 requests, ${loadedFaces.length} loaded faces`,
    );
    await context.close();
  });
});
