import { test, expect, type Page } from "@playwright/test";
import { IncidentSeverity, IncidentType } from "@exam/domain";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  adminPost,
  candidateApiToken,
  candidateStartAttempt,
} from "../lib/flow";
import { seedExam } from "../lib/seed";

/**
 * UI-NAV-CONTINUITY-1 (#494) — deterministic gates for the navigation-shell
 * continuity contract (docs/standards/ui-system.md §Navigation shell
 * continuity, NAV-1…NAV-6).
 *
 * NAV-1 stable shell structure · NAV-2 current location discoverable ·
 * NAV-3 stable information architecture · NAV-4 explicit overflow state ·
 * NAV-5 region ownership · NAV-6 responsive representation.
 *
 * Geometry assertions on the live DOM, not screenshots and not
 * implementation classes: the only implementation-owned surfaces asserted
 * here are the contract's test-visible facts ([aria-current],
 * [data-slot="nav-scroll-region"] state attributes, edge-cue visibility).
 */

const VIEWPORT = { width: 1280, height: 800 };

/** Every Admin-represented nav destination (AppSidebar groups + management). */
const NAV_DESTINATIONS = [
  "/admin/dashboard",
  "/admin/operations",
  "/admin/system",
  "/admin/courses",
  "/admin/questions",
  "/admin/questions/import",
  "/admin/exams",
  "/admin/exam-profiles",
  "/admin/grading-queue",
  "/admin/results",
  "/admin/proctor",
  "/admin/recovery",
  "/admin/proctor/recovery",
  "/admin/users",
  "/admin/candidates",
  "/admin/import-logs",
  "/admin/audit-logs",
  "/admin/permissions",
  "/admin/settings",
  "/admin/candidate-fields",
];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NavFacts {
  sidebar: Rect;
  region: Rect;
  brand: Rect;
  footer: Rect;
  nav: Rect & {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  };
  currentCount: number;
  currentHrefs: string[];
  currentRects: Rect[];
  groupLabels: string[];
  hrefs: string[];
  overflowing: string;
  atStart: string;
  atEnd: string;
  docScrollY: number;
}

async function collectNavFacts(page: Page, root = "app-sidebar") {
  return page.evaluate((rootTestId) => {
    const rect = (el: Element): Rect => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const shell = document.querySelector(`[data-testid="${rootTestId}"]`)!;
    const region = shell.querySelector<HTMLElement>(
      '[data-slot="nav-scroll-region"]',
    )!;
    const nav = shell.querySelector<HTMLElement>("nav")!;
    const currents = Array.from(
      shell.querySelectorAll<HTMLElement>('a[aria-current="page"]'),
    );
    return {
      sidebar: rect(shell),
      region: rect(region),
      brand: rect(shell.querySelector('[data-testid="brand-header"]')!),
      footer: rect(shell.querySelector('[data-testid="sidebar-footer"]')!),
      nav: {
        ...rect(nav),
        clientHeight: nav.clientHeight,
        scrollHeight: nav.scrollHeight,
        scrollTop: nav.scrollTop,
      },
      currentCount: currents.length,
      currentHrefs: currents.map((el) => el.getAttribute("href") ?? ""),
      currentRects: currents.map(rect),
      groupLabels: Array.from(
        shell.querySelectorAll('[data-testid="nav-group-label"]'),
      ).map((el) => (el.textContent ?? "").trim()),
      hrefs: Array.from(
        shell.querySelectorAll<HTMLAnchorElement>("nav a[href]"),
      ).map((el) => el.getAttribute("href") ?? ""),
      overflowing: region.getAttribute("data-overflowing") ?? "attr-missing",
      atStart: region.getAttribute("data-at-start") ?? "attr-missing",
      atEnd: region.getAttribute("data-at-end") ?? "attr-missing",
      docScrollY: window.scrollY,
    };
  }, root);
}

function verticallyInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.y >= outer.y - 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

/** NAV-2: the current destination is discoverable inside the nav viewport. */
async function expectCurrentDiscoverable(
  page: Page,
  rootTestId = "app-sidebar",
) {
  await expect
    .poll(
      async () => {
        const facts = await collectNavFacts(page, rootTestId);
        return (
          facts.currentCount === 1 &&
          facts.currentRects.every((r) => verticallyInside(r, facts.region))
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

async function gotoAdmin(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
}

/** NAV-3 anchor: the frozen Admin navigation information architecture —
 * group headings (zh-CN render text) and destination hrefs in DOM order.
 * Reordering groups/items, adding headings, or dropping destinations is an
 * IA decision that must update this anchor explicitly (M-N3 kills on it). */
const EXPECTED_GROUP_LABELS = [
  "概览",
  "运维",
  "题库",
  "考试",
  "监考",
  "恢复中心",
  "管理",
];

const EXPECTED_HREFS = [
  "/admin/dashboard",
  "/admin/operations",
  "/admin/system",
  "/admin/courses",
  "/admin/questions",
  "/admin/questions/import",
  "/admin/exams",
  "/admin/exam-profiles",
  "/admin/grading-queue",
  "/admin/results",
  "/admin/proctor",
  "/admin/recovery",
  "/admin/proctor/recovery",
  "/admin/users",
  "/admin/candidates",
  "/admin/import-logs",
  "/admin/audit-logs",
  "/admin/permissions",
  "/admin/settings",
  "/admin/candidate-fields",
];

test.describe("NAV continuity contract (#494)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await loginAsAdmin(page);
  });

  test("NAV-2: exactly one discoverable current destination on every admin nav route", async ({
    page,
  }) => {
    for (const route of NAV_DESTINATIONS) {
      await gotoAdmin(page, route);
      const facts = await collectNavFacts(page);

      // NAV-2: exactly one semantic current destination, pointing at the
      // visited route family.
      expect(facts.currentCount, `exactly one aria-current on ${route}`).toBe(
        1,
      );
      // NAV-2: the current destination is discoverable — fully inside the
      // navigation viewport without manual searching.
      expect(
        verticallyInside(facts.currentRects[0]!, facts.region),
        `current item inside nav viewport on ${route}`,
      ).toBe(true);

      // NAV-5: regions keep their ownership on every route — footer fully
      // inside the sidebar and never overlapping the nav scroll region;
      // sidebar stays viewport-attached.
      expect(
        verticallyInside(facts.footer, facts.sidebar),
        `footer inside sidebar on ${route}`,
      ).toBe(true);
      expect(
        facts.footer.y,
        `footer below nav region on ${route}`,
      ).toBeGreaterThanOrEqual(facts.region.y + facts.region.height - 1);
      expect(
        Math.abs(facts.sidebar.y),
        `sidebar top on ${route}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(facts.sidebar.height - VIEWPORT.height),
        `sidebar height on ${route}`,
      ).toBeLessThanOrEqual(1);
      // NAV-1: navigation scrolling never leaks into document scrolling.
      expect(facts.docScrollY, `document scroll on ${route}`).toBe(0);
    }
  });

  test("NAV-2: descendant routes resolve to exactly one family destination", async ({
    page,
    request,
  }) => {
    // Real fixtures through the production API so every routed descendant
    // mounts its real page (shell semantics are what this gate asserts).
    const s = await seedExam(request, `nav-desc-${Date.now()}`);
    const adminToken = await adminApiToken(request);
    const attemptId = await candidateStartAttempt(
      request,
      await candidateApiToken(request, s.candidate),
      s.examId,
    );
    const createRes = await adminPost(
      request,
      adminToken,
      `/api/admin/exams/${s.examId}/incidents`,
      {
        operationId: crypto.randomUUID(),
        type: IncidentType.NetworkInterruption,
        severity: IncidentSeverity.Critical,
        description: "NAV-2 descendant gate — network disruption",
        attemptId,
        candidateId: s.candidate.profileId,
      },
    );
    expect(createRes.ok()).toBe(true);
    const { incident } = (await createRes.json()) as {
      incident: { id: string };
    };
    const profileRes = await adminPost(
      request,
      adminToken,
      "/api/exam-profiles",
      {
        name: `nav-desc-${Date.now()}`,
        timingMode: "timed_window",
        durationMinutes: 60,
        retakePolicy: "max_attempts",
        maxAttempts: 2,
        scoreStrategy: "highest",
        resultPublicationMode: "after_grading",
        interruptionTimePolicy: "strict",
      },
    );
    expect(profileRes.ok()).toBe(true);
    const profile = (await profileRes.json()) as { id: string };

    const cases = [
      { route: "/admin/questions", expected: "/admin/questions" },
      { route: "/admin/questions/new", expected: "/admin/questions" },
      {
        route: `/admin/questions/${s.questionId}/edit`,
        expected: "/admin/questions",
      },
      { route: "/admin/questions/import", expected: "/admin/questions/import" },
      { route: "/admin/exams", expected: "/admin/exams" },
      { route: "/admin/exams/new", expected: "/admin/exams" },
      { route: `/admin/exams/${s.examId}`, expected: "/admin/exams" },
      { route: `/admin/exams/${s.examId}/edit`, expected: "/admin/exams" },
      { route: `/admin/exams/${s.examId}/scores`, expected: "/admin/exams" },
      { route: `/admin/exams/${s.examId}/proctor`, expected: "/admin/exams" },
      {
        route: `/admin/exams/${s.examId}/proctor/monitor`,
        expected: "/admin/exams",
      },
      { route: `/admin/attempts/${attemptId}`, expected: "/admin/exams" },
      { route: "/admin/exam-profiles", expected: "/admin/exam-profiles" },
      { route: "/admin/exam-profiles/new", expected: "/admin/exam-profiles" },
      {
        route: `/admin/exam-profiles/${profile.id}/edit`,
        expected: "/admin/exam-profiles",
      },
      {
        route: `/admin/grading-queue/${s.examId}`,
        expected: "/admin/grading-queue",
      },
      { route: "/admin/recovery", expected: "/admin/recovery" },
      {
        route: `/admin/recovery/incidents/${incident.id}`,
        expected: "/admin/recovery",
      },
      {
        route: `/admin/recovery/attempts/${attemptId}`,
        expected: "/admin/recovery",
      },
      {
        route: `/admin/recovery/exams/${s.examId}`,
        expected: "/admin/recovery",
      },
    ];

    let reference: NavFacts | null = null;
    for (const { route, expected } of cases) {
      await gotoAdmin(page, route);
      const facts = await collectNavFacts(page);

      // Exactly one semantic current destination pointing at the family root.
      expect(facts.currentCount, `exactly one aria-current on ${route}`).toBe(
        1,
      );
      expect(facts.currentHrefs, `current href on ${route}`).toEqual([
        expected,
      ]);
      expect(
        verticallyInside(facts.currentRects[0]!, facts.region),
        `current item inside nav viewport on ${route}`,
      ).toBe(true);

      // Shell geometry stays constant across the family walk (NAV-1/NAV-5).
      if (reference === null) {
        reference = facts;
      } else {
        expect(
          Math.abs(facts.sidebar.width - reference.sidebar.width),
          `sidebar width on ${route}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(facts.sidebar.height - reference.sidebar.height),
          `sidebar height on ${route}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(facts.footer.y - reference.footer.y),
          `footer y on ${route}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(facts.footer.height - reference.footer.height),
          `footer height on ${route}`,
        ).toBeLessThanOrEqual(1);
      }
      expect(
        verticallyInside(facts.footer, facts.sidebar),
        `footer inside sidebar on ${route}`,
      ).toBe(true);
      expect(facts.docScrollY, `document scroll on ${route}`).toBe(0);
    }

    // Mandatory negative proof: 题目管理 (questions list family root) must NOT
    // be current on the import route — exactly-one, never dual-current.
    await gotoAdmin(page, "/admin/questions/import");
    const importFacts = await collectNavFacts(page);
    expect(importFacts.currentCount).toBe(1);
    expect(importFacts.currentHrefs).toEqual(["/admin/questions/import"]);
    await expect(
      page.getByTestId("app-sidebar").locator('a[href="/admin/questions"]'),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("NAV-2: direct-URL load of a lower destination reveals the current item", async ({
    page,
  }) => {
    // /admin/settings sits at the bottom of the management group — a fresh
    // direct load must already expose it in the nav viewport.
    await gotoAdmin(page, "/admin/settings");
    const currents = page
      .getByTestId("app-sidebar")
      .locator('a[aria-current="page"]');
    await expect(currents).toHaveCount(1);
    await expect(currents).toHaveAttribute("href", "/admin/settings");
    await expectCurrentDiscoverable(page);
  });

  test("NAV-3: navigation ordering is invariant across routes", async ({
    page,
  }) => {
    await gotoAdmin(page, "/admin/dashboard");
    const reference = await collectNavFacts(page);
    expect(reference.groupLabels.length).toBeGreaterThan(0);
    expect(reference.hrefs.length).toBeGreaterThan(0);
    // Absolute anchor: the frozen Admin IA. A nav-structure change is an
    // explicit decision that updates this spec (M-N3 mutation proof).
    expect(reference.groupLabels).toEqual(EXPECTED_GROUP_LABELS);
    expect(reference.hrefs).toEqual(EXPECTED_HREFS);

    for (const route of [
      "/admin/settings",
      "/admin/proctor",
      "/admin/exams",
      "/admin/users",
    ]) {
      await gotoAdmin(page, route);
      const facts = await collectNavFacts(page);
      // NAV-3: same persona → same group order, same surviving item order.
      expect(facts.groupLabels, `group order on ${route}`).toEqual(
        reference.groupLabels,
      );
      expect(facts.hrefs, `item order on ${route}`).toEqual(reference.hrefs);
    }
  });

  test("NAV-1/NAV-5: shell region geometry is stable across the route sequence", async ({
    page,
  }) => {
    await gotoAdmin(page, "/admin/dashboard");
    const reference = await collectNavFacts(page);

    for (const route of [
      "/admin/operations",
      "/admin/exams",
      "/admin/grading-queue",
      "/admin/settings",
    ]) {
      await gotoAdmin(page, route);
      const facts = await collectNavFacts(page);
      expect(
        Math.abs(facts.sidebar.width - reference.sidebar.width),
        `sidebar width drift on ${route}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(facts.brand.y - reference.brand.y),
        `brand y drift on ${route}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(facts.brand.height - reference.brand.height),
        `brand height drift on ${route}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(facts.footer.y - reference.footer.y),
        `footer y drift on ${route}`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(facts.footer.height - reference.footer.height),
        `footer height drift on ${route}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("NAV-4: overflow is an explicit state with edge cues", async ({
    page,
  }) => {
    await gotoAdmin(page, "/admin/dashboard");
    const sidebar = page.getByTestId("app-sidebar");
    const region = sidebar.locator('[data-slot="nav-scroll-region"]');
    const fadeTop = sidebar.locator('[data-slot="nav-scroll-fade-top"]');
    const fadeBottom = sidebar.locator('[data-slot="nav-scroll-fade-bottom"]');

    // Admin nav overflows the 800px viewport: the state facts must say so.
    await expect(region).toHaveAttribute("data-overflowing", "true");
    await expect(region).toHaveAttribute("data-at-start", "true");
    await expect(region).toHaveAttribute("data-at-end", "false");
    // At the start: bottom edge has more nav (cue visible), top does not.
    await expect(fadeBottom).toBeVisible();
    await expect(fadeTop).toHaveCount(0);

    // Scroll to the end: the state flips, and the cues flip with it.
    await sidebar.locator("nav").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(region).toHaveAttribute("data-at-end", "true");
    await expect(region).toHaveAttribute("data-at-start", "false");
    await expect(fadeTop).toBeVisible();
    await expect(fadeBottom).toHaveCount(0);
  });

  test("NAV-6: representation follows the viewport band, not the route", async ({
    page,
  }) => {
    const cases = [
      { size: { width: 1440, height: 900 }, expanded: true },
      { size: { width: 1280, height: 800 }, expanded: true },
      { size: { width: 1100, height: 800 }, expanded: false },
    ];
    for (const { size, expanded } of cases) {
      await page.setViewportSize(size);
      for (const route of [
        "/admin/dashboard",
        "/admin/exams",
        "/admin/settings",
      ]) {
        await gotoAdmin(page, route);
        const sidebar = page.getByTestId("app-sidebar");
        await expect(sidebar, `sidebar visible at ${size.width}`).toBeVisible();
        const width = (await sidebar.boundingBox())!.width;
        expect(
          Math.abs(width - (expanded ? 232 : 56)),
          `sidebar width at ${size.width} on ${route}`,
        ).toBeLessThanOrEqual(1);
      }
    }

    // Below lg: desktop sidebar hidden, drawer authority takes over.
    for (const size of [
      { width: 1023, height: 800 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      for (const route of ["/admin/dashboard", "/admin/settings"]) {
        await gotoAdmin(page, route);
        await expect(page.getByTestId("app-sidebar")).toBeHidden();
        await expect(
          page.getByTestId("mobile-nav-trigger"),
          `drawer trigger at ${size.width} on ${route}`,
        ).toBeVisible();
      }
    }
  });

  test("NAV-6: collapsed rail keeps the current destination discoverable at 1100x800", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await gotoAdmin(page, "/admin/settings");
    const currents = page
      .getByTestId("app-sidebar")
      .locator('a[aria-current="page"]');
    await expect(currents).toHaveCount(1);
    // Accessible label stays present in the collapsed state via title.
    await expect(currents).toHaveAttribute("title", /.+/);
    await expectCurrentDiscoverable(page);
  });

  test("NAV-2/NAV-5/NAV-6: mobile drawer reveals the current destination at 375x812", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoAdmin(page, "/admin/settings");

    await page.getByTestId("mobile-nav-trigger").click();
    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer).toBeVisible();

    // One shared SidebarContent authority: same group labels as the desktop.
    const facts = await collectNavFacts(page, "mobile-nav-drawer");
    expect(facts.groupLabels.length).toBeGreaterThan(0);

    const currents = drawer.locator('a[aria-current="page"]');
    await expect(currents).toHaveCount(1);
    await expect(currents).toHaveAttribute("href", "/admin/settings");
    await expectCurrentDiscoverable(page, "mobile-nav-drawer");

    // NAV-5 inside the drawer: footer/logout reachable, outside the scroll.
    await expect(
      drawer.getByRole("button", { name: "退出登录" }),
    ).toBeVisible();
    expect(facts.footer.y).toBeGreaterThanOrEqual(
      facts.region.y + facts.region.height - 1,
    );
  });
});
