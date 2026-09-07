/**
 * UI-MULTIMODAL-PATROL comparison suites (#494 §33-§42).
 *
 * Screenshots are no longer reviewed only as independent images: this spec
 * generates comparison sets that hold persona, viewport, responsive shell
 * state, browser, and seed constant while varying exactly one dimension
 * (route / persona / viewport / archetype). Every tile is emitted together
 * with deterministic DOM facts, and the permanent multimodal review prompt is
 * written into the run output.
 *
 * Output: .tmp/ui-patrol/cmp-<sha>-<ts>/ — comparison-sets.json, contact
 * sheets (labels OUTSIDE the application UI), REVIEW-PROMPT.md.
 *
 * §42: the harness itself (grouping, ordering, sidebar crops, DOM metadata)
 * is proven by the in-test assertions below — no LLM response is a CI
 * assertion. Multimodal review remains exploratory discovery; every
 * HIGH/MEDIUM candidate must be confirmed by deterministic DOM probes (§41).
 */
import { test, expect, type Page } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loginAsAdmin, loginViaUi } from "../lib/login";
import {
  ADMIN_NAV_SEQUENCE,
  COMPARISON_REVIEW_PROMPT,
  RESPONSIVE_ROUTE,
  RESPONSIVE_VIEWPORTS,
  ROLE_COMPARISON_VIEWPORT,
  ROLE_SURFACES,
  SHELL_COMPARISON_VIEWPORT,
  TABLE_SIBLING_SETS,
  buildContactSheetHtml,
} from "./comparison-sets";
import {
  PATROL_BASE_URL,
  collectShellFacts,
  createUserViaApi,
  progressLog,
} from "./patrol-fixtures";

const BASE_SHA = execSync("git rev-parse --short HEAD", {
  cwd: join(import.meta.dirname, "../../.."),
})
  .toString()
  .trim();
const OUTPUT_DIR = join(
  import.meta.dirname,
  "../../../.tmp/ui-patrol",
  `cmp-${BASE_SHA}-${Date.now()}`,
);
const SHEETS_DIR = join(OUTPUT_DIR, "sheets");

interface ComparisonItem {
  id: string;
  label: string;
  route: string;
  viewport: string;
  screenshot: string | null;
  sidebarScreenshot: string | null;
  navFacts: Awaited<ReturnType<typeof collectShellFacts>>["nav"];
}

interface ComparisonSetRecord {
  id: string;
  kind: "navigation" | "responsive" | "role-shell" | "table-sibling";
  heldConstant: string[];
  varies: string;
  reviewNotes: string[];
  items: ComparisonItem[];
}

const comparisonSets: ComparisonSetRecord[] = [];

async function waitForPageStable(page: Page) {
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function captureComparisonTile(
  page: Page,
  setId: string,
  item: { id: string; label: string; route: string },
  viewport: { width: number; height: number },
): Promise<ComparisonItem> {
  await page.setViewportSize(viewport);
  await page.goto(item.route, { waitUntil: "domcontentloaded" });
  await waitForPageStable(page);

  const fileLabel = `${setId}--${item.id}--${item.label
    .replace(/\s+/g, "-")
    .toLowerCase()}`;
  const shotPath = join(SHEETS_DIR, `${fileLabel}.png`);
  await page.screenshot({ path: shotPath });

  // §35: locator sidebar crop — never a manual post-crop.
  const sidebar = page.getByTestId("app-sidebar");
  let sidebarPath: string | null = null;
  if (await sidebar.isVisible()) {
    sidebarPath = join(SHEETS_DIR, `${fileLabel}--sidebar.png`);
    await sidebar.screenshot({ path: sidebarPath });
  }

  const facts = await collectShellFacts(page);
  return {
    id: item.id,
    label: item.label,
    route: item.route,
    viewport: `${viewport.width}x${viewport.height}`,
    screenshot: shotPath,
    sidebarScreenshot: sidebarPath,
    navFacts: facts.nav,
  };
}

async function renderContactSheet(
  page: Page,
  outPath: string,
  title: string,
  tiles: Array<{ label: string; imagePath: string }>,
) {
  const tilesHtml = tiles.map((tile) => ({
    label: tile.label,
    imageBase64: readFileSync(tile.imagePath).toString("base64"),
  }));
  await page.setContent(buildContactSheetHtml(title, tilesHtml), {
    waitUntil: "load",
  });
  await page.screenshot({ path: outPath, fullPage: true });
}

test.describe.serial("UI patrol comparison suites", () => {
  let page: Page;
  let staff: Record<
    "teacher" | "grader" | "proctor",
    { username: string; password: string }
  >;

  test.beforeAll(async ({ browser, request }) => {
    mkdirSync(SHEETS_DIR, { recursive: true });

    const loginRes = await request.post(`${PATROL_BASE_URL}/api/auth/login`, {
      data: { username: "admin", password: "admin123" },
    });
    const setCookie = loginRes.headers()["set-cookie"] ?? "";
    const adminToken = setCookie.match(/auth-token=([^;]+)/)?.[1] ?? "";
    expect(adminToken).toBeTruthy();

    // Set C personas: capability-filtered staff shells. No exam fixtures are
    // required — the comparison question is navigation grammar, not content.
    staff = {
      teacher: await createUserViaApi(
        request,
        adminToken,
        "Teacher",
        "teacher",
      ),
      grader: await createUserViaApi(request, adminToken, "Grader", "grader"),
      proctor: await createUserViaApi(
        request,
        adminToken,
        "Proctor",
        "proctor",
      ),
    };

    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page?.close();
    writeFileSync(
      join(OUTPUT_DIR, "comparison-sets.json"),
      JSON.stringify(
        {
          runSha: BASE_SHA,
          generatedAt: new Date().toISOString(),
          sets: comparisonSets,
        },
        null,
        2,
      ),
    );
    // §40: the permanent review prompt travels with every run.
    writeFileSync(
      join(OUTPUT_DIR, "REVIEW-PROMPT.md"),
      COMPARISON_REVIEW_PROMPT,
    );
    progressLog(OUTPUT_DIR, `[patrol-compare] DONE: ${OUTPUT_DIR}`);
  });

  test("Set A: admin shell continuity across the route sequence (1280x800)", async () => {
    await loginAsAdmin(page);
    const items: ComparisonItem[] = [];
    for (const stop of ADMIN_NAV_SEQUENCE) {
      items.push(
        await captureComparisonTile(
          page,
          "nav",
          stop,
          SHELL_COMPARISON_VIEWPORT,
        ),
      );
    }
    const record: ComparisonSetRecord = {
      id: "NAV-COMPARE-admin-1280x800",
      kind: "navigation",
      heldConstant: [
        "persona: Admin",
        "viewport: 1280x800",
        "shell: full sidebar",
        "browser: chromium",
        "seed: e2e canonical",
      ],
      varies: "route",
      reviewNotes: [
        "A changed active item is EXPECTED.",
        "A changed nav scrollTop is EXPECTED when required to reveal the active item.",
        "Inspect the review prompt: shell width, brand, group order, item rhythm, current visibility, footer.",
      ],
      items,
    };
    comparisonSets.push(record);

    // §36 contact sheets from the captured set — full viewport tiles plus a
    // sidebar-only sheet; tile order preserves the route sequence.
    await renderContactSheet(
      page,
      join(SHEETS_DIR, "NAV-COMPARE-admin-1280x800.png"),
      `Admin shell continuity — route sequence @1280x800 (${BASE_SHA})`,
      items.map((item) => ({
        label: `${item.id} ${item.label}`,
        imagePath: item.screenshot!,
      })),
    );
    await renderContactSheet(
      page,
      join(SHEETS_DIR, "NAV-COMPARE-admin-1280x800-sidebars.png"),
      `Admin sidebar continuity — route sequence @1280x800 (${BASE_SHA})`,
      items.map((item) => ({
        label: `${item.id} ${item.label}`,
        imagePath: item.sidebarScreenshot!,
      })),
    );

    // §42 harness proof (deterministic, no LLM in CI): grouping, ordering,
    // sidebar crops, and DOM metadata must all be present and correct.
    expect(record.items.map((item) => item.id)).toEqual(
      ADMIN_NAV_SEQUENCE.map((stop) => stop.id),
    );
    expect(record.items.map((item) => item.route)).toEqual(
      ADMIN_NAV_SEQUENCE.map((stop) => stop.route),
    );
    for (const item of record.items) {
      expect(existsSync(item.screenshot!), `viewport shot ${item.id}`).toBe(
        true,
      );
      expect(
        statSync(item.screenshot!).size,
        `viewport shot non-empty ${item.id}`,
      ).toBeGreaterThan(0);
      expect(
        existsSync(item.sidebarScreenshot!),
        `sidebar crop ${item.id}`,
      ).toBe(true);
      expect(item.navFacts, `nav facts ${item.id}`).not.toBeNull();
      expect(item.navFacts!.currentCount, `aria-current ${item.id}`).toBe(1);
      expect(
        item.navFacts!.groupLabels.length,
        `groups ${item.id}`,
      ).toBeGreaterThan(0);
      expect(item.navFacts!.hrefs.length, `items ${item.id}`).toBeGreaterThan(
        0,
      );
      expect(
        item.navFacts!.overflowState,
        `overflow state ${item.id}`,
      ).not.toBeNull();
    }
  });

  test("Set B: responsive shell representation (route fixed, viewport varies)", async () => {
    await loginAsAdmin(page);
    const items: ComparisonItem[] = [];
    for (const viewport of RESPONSIVE_VIEWPORTS) {
      items.push(
        await captureComparisonTile(
          page,
          "bp",
          {
            id: viewport.id,
            label: `exams@${viewport.id}`,
            route: RESPONSIVE_ROUTE,
          },
          { width: viewport.width, height: viewport.height },
        ),
      );
    }
    const record: ComparisonSetRecord = {
      id: "NAV-COMPARE-breakpoints-exams",
      kind: "responsive",
      heldConstant: [
        "persona: Admin",
        "route: /admin/exams",
        "browser: chromium",
        "seed: e2e canonical",
      ],
      varies: "viewport band (representation is a function of the band)",
      reviewNotes: [
        "Representation changes BETWEEN bands are EXPECTED (drawer / 56px rail / 232px sidebar).",
        "Look for discontinuities WITHIN a band and missing drawer authority below lg.",
      ],
      items,
    };
    comparisonSets.push(record);

    await renderContactSheet(
      page,
      join(SHEETS_DIR, "NAV-COMPARE-breakpoints-exams.png"),
      `Responsive shell — /admin/exams across bands (${BASE_SHA})`,
      items.map((item) => ({
        label: `${item.id} ${item.label}`,
        imagePath: item.screenshot!,
      })),
    );

    // lg+ bands expose the persistent sidebar; below lg the drawer is the
    // authority and the persistent sidebar's facts are absent by design.
    for (const item of record.items) {
      expect(existsSync(item.screenshot!), `viewport shot ${item.id}`).toBe(
        true,
      );
      const belowLg = ['"1023x800"', '"375x812"', '"320x800"'].includes(
        JSON.stringify(item.id),
      );
      if (belowLg) {
        expect(item.navFacts, `drawer band ${item.id}`).toBeNull();
        expect(item.sidebarScreenshot, `no sidebar crop ${item.id}`).toBeNull();
      } else {
        expect(item.navFacts, `sidebar band ${item.id}`).not.toBeNull();
      }
    }
  });

  test("Set C: role shell grammar at 1440x900", async () => {
    // Admin via its helper, then each staff persona via real UI login to its
    // capability-resolved landing surface.
    const logins: Record<string, () => Promise<void>> = {
      admin: () => loginAsAdmin(page),
      teacher: () =>
        loginViaUi(
          page,
          staff.teacher.username,
          staff.teacher.password,
          /\/admin\/exams(?:$|[/?#])/,
        ),
      grader: () =>
        loginViaUi(
          page,
          staff.grader.username,
          staff.grader.password,
          /\/admin\/grading-queue(?:$|[/?#])/,
        ),
      proctor: () =>
        loginViaUi(
          page,
          staff.proctor.username,
          staff.proctor.password,
          /\/admin\/proctor(?:$|[/?#])/,
        ),
    };

    const items: ComparisonItem[] = [];
    for (const surface of ROLE_SURFACES) {
      await logins[surface.id]();
      items.push(
        await captureComparisonTile(
          page,
          "role",
          surface,
          ROLE_COMPARISON_VIEWPORT,
        ),
      );
    }
    const record: ComparisonSetRecord = {
      id: "ROLE-SHELL-COMPARE-1440x900",
      kind: "role-shell",
      heldConstant: [
        "viewport: 1440x900",
        "browser: chromium",
        "seed: e2e canonical",
      ],
      varies: "persona (capability-filtered destination set)",
      reviewNotes: [
        "Different destinations per role are EXPECTED.",
        "The question is whether capability filtering preserves the navigation grammar: orphan headings, empty groups, odd separators, footer displacement, inconsistent item heights, different shell dimensions.",
      ],
      items,
    };
    comparisonSets.push(record);

    await renderContactSheet(
      page,
      join(SHEETS_DIR, "ROLE-SHELL-COMPARE-1440x900.png"),
      `Role shells — capability-filtered navigation grammar @1440x900 (${BASE_SHA})`,
      items.map((item) => ({
        label: `${item.id} ${item.label}`,
        imagePath: item.sidebarScreenshot ?? item.screenshot!,
      })),
    );

    for (const item of record.items) {
      expect(item.navFacts, `nav facts ${item.id}`).not.toBeNull();
      // Grammar invariant: capability filtering removes destinations but the
      // surviving structure stays a group-ordered nav.
      expect(item.navFacts!.groupLabels.length).toBeGreaterThan(0);
    }
  });

  test("Set D: table sibling comparison by archetype (1280x800)", async () => {
    await loginAsAdmin(page);
    for (const set of TABLE_SIBLING_SETS) {
      const items: ComparisonItem[] = [];
      for (const stop of set.routes) {
        items.push(
          await captureComparisonTile(
            page,
            `table-${set.id}`,
            stop,
            SHELL_COMPARISON_VIEWPORT,
          ),
        );
      }
      const record: ComparisonSetRecord = {
        id: set.sheet.replace(".png", ""),
        kind: "table-sibling",
        heldConstant: [
          "persona: Admin",
          "viewport: 1280x800",
          `archetype: ${set.archetype}`,
          "browser: chromium",
          "seed: e2e canonical",
        ],
        varies: "route (within the same table archetype)",
        reviewNotes: [
          "Sibling tables of one archetype should share containment, toolbar geometry, and scroll affordance behavior.",
          "Use the DOM facts (archetype/tier/overflow/hintInViewport) to confirm or reject visual candidates.",
        ],
        items,
      };
      comparisonSets.push(record);

      await renderContactSheet(
        page,
        join(SHEETS_DIR, set.sheet),
        `Table siblings — ${set.archetype} @1280x800 (${BASE_SHA})`,
        items.map((item) => ({
          label: `${item.id} ${item.label}`,
          imagePath: item.screenshot!,
        })),
      );

      for (const item of record.items) {
        expect(existsSync(item.screenshot!), `viewport shot ${item.id}`).toBe(
          true,
        );
      }
    }
  });
});
