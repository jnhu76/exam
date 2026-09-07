/**
 * UI-NAV-CONTINUITY-1 corrective-1 — Set E: navigation hierarchy continuity.
 *
 * Set A compared equivalent SHELL states across top-level destinations; Set E
 * varies the route INSIDE one navigation family (exams / questions /
 * profiles / recovery / grading) at a constant 1280×800. Every tile of a
 * family must keep the SAME current destination — its family root — proving
 * routed descendants (new/detail/edit/scores/proctor/monitor/import/…) do not
 * make the shell "look like a different sidebar" or lose the current item.
 *
 * The questions import tile is the exactly-one negative control: 题目导入 is
 * current, 题目管理 is NOT (a naive prefix matcher would light both).
 *
 * Output: .tmp/ui-patrol/hier-<sha>-<ts>/ — sheets/NAV-HIERARCHY-*.png (+
 * -sidebars.png crops), comparison-sets.json, REVIEW-PROMPT.md, progress.log.
 *
 * Like the other patrol specs, the harness proves itself deterministically
 * in-test (per-tile current facts + crops + DOM metadata); multimodal review
 * of the generated sheets remains a separate, mandatory human step.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { IncidentSeverity, IncidentType } from "@exam/domain";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  adminPost,
  candidateApiToken,
  candidateStartAttempt,
  startAndSubmitAttempt,
} from "../lib/flow";
import { seedExam } from "../lib/seed";
import {
  COMPARISON_REVIEW_PROMPT,
  HIERARCHY_SETS,
  SHELL_COMPARISON_VIEWPORT,
  type HierarchyIds,
} from "./comparison-sets";
import { renderContactSheet, sheetTileLabel } from "./contact-sheet";
import {
  PATROL_BASE_URL,
  collectShellFacts,
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
  `hier-${BASE_SHA}-${Date.now()}`,
);
const SHEETS_DIR = join(OUTPUT_DIR, "sheets");

interface HierarchyTile {
  setId: string;
  stopId: string;
  label: string;
  route: string;
  expectedHref: string;
  notCurrentHref?: string;
  viewport: string;
  screenshot: string;
  sidebarScreenshot: string | null;
  navFacts: Awaited<ReturnType<typeof collectShellFacts>>["nav"];
}

interface HierarchySetRecord {
  id: string;
  kind: "nav-hierarchy";
  heldConstant: string[];
  varies: string;
  destinationLabel: string;
  reviewNotes: string[];
  items: HierarchyTile[];
}

function verticallyInside(
  inner: { y: number; height: number },
  outer: { y: number; height: number },
): boolean {
  return (
    inner.y >= outer.y - 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

async function waitForPageStable(page: Page) {
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  // Small layout-settle delay after semantic readiness for raster stability
  // (documented per corrective §26; the reveal effect is synchronous).
  await page.waitForTimeout(300);
}

const hierarchySets: HierarchySetRecord[] = [];

test.describe.serial("UI patrol — Set E navigation hierarchy", () => {
  let page: Page;
  let ids: HierarchyIds;

  test.beforeAll(async ({ browser, request }) => {
    mkdirSync(SHEETS_DIR, { recursive: true });

    const loginRes = await request.post(`${PATROL_BASE_URL}/api/auth/login`, {
      data: { username: "admin", password: "admin123" },
    });
    const setCookie = loginRes.headers()["set-cookie"] ?? "";
    const adminToken = setCookie.match(/auth-token=([^;]+)/)?.[1] ?? "";
    expect(adminToken).toBeTruthy();

    // Exam + question + candidate for the exams/questions/recovery families.
    const s = await seedExam(request, `nav-hier-${Date.now()}`, {
      timingMode: "timed_window",
      durationMinutes: 60,
    });

    // Profile for the profiles family.
    const profileRes = await adminPost(
      request,
      adminToken,
      "/api/exam-profiles",
      {
        name: `nav-hier-${Date.now()}`,
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

    // Live attempt + anchored incident for the recovery family.
    const attemptId = await candidateStartAttempt(
      request,
      await candidateApiToken(request, s.candidate),
      s.examId,
    );
    const incidentRes = await adminPost(
      request,
      adminToken,
      `/api/admin/exams/${s.examId}/incidents`,
      {
        operationId: crypto.randomUUID(),
        type: IncidentType.NetworkInterruption,
        severity: IncidentSeverity.Critical,
        description: "Set E hierarchy — network disruption",
        attemptId,
        candidateId: s.candidate.profileId,
      },
    );
    expect(incidentRes.ok()).toBe(true);
    const { incident } = (await incidentRes.json()) as {
      incident: { id: string };
    };

    // Submitted attempt with a manual-graded question for the grading family
    // (pending_manual work puts the exam into the grading queue + detail).
    // NOTE: text_response is the supported subjective encoding (P3-MOD-P0-4);
    // the legacy fill_blank+null-answer seed is rejected at publish (P3-L0-5).
    const grading = await seedExam(request, `nav-hier-grade-${Date.now()}`, {
      timingMode: "timed_window",
      durationMinutes: 60,
      textResponseQuestions: [{ score: 50, content: "请论述某主题" }],
    });
    await startAndSubmitAttempt(
      request,
      await candidateApiToken(request, grading.candidate),
      grading.examId,
    );

    ids = {
      examId: s.examId,
      questionId: s.questionId,
      profileId: profile.id,
      attemptId,
      incidentId: incident.id,
    };
    progressLog(OUTPUT_DIR, `[hierarchy] ids=${JSON.stringify(ids)}`);

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
          sets: hierarchySets,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(OUTPUT_DIR, "REVIEW-PROMPT.md"),
      COMPARISON_REVIEW_PROMPT,
    );
    progressLog(OUTPUT_DIR, `[hierarchy] DONE: ${OUTPUT_DIR}`);
  });

  for (const set of HIERARCHY_SETS) {
    test(`Set E — ${set.id} family: same current destination across the route hierarchy`, async () => {
      await loginAsAdmin(page);
      const items: HierarchyTile[] = [];

      for (const stop of set.stops) {
        const route = stop.buildRoute(ids);
        await page.setViewportSize(SHELL_COMPARISON_VIEWPORT);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await waitForPageStable(page);

        const fileLabel = `${set.id}--${stop.id}--${stop.label
          .replace(/\s+/g, "-")
          .toLowerCase()}`;
        const shotPath = join(SHEETS_DIR, `${fileLabel}.png`);
        await page.screenshot({ path: shotPath });

        const sidebar = page.getByTestId("app-sidebar");
        const sidebarPath = join(SHEETS_DIR, `${fileLabel}--sidebar.png`);
        await sidebar.screenshot({ path: sidebarPath });

        const facts = await collectShellFacts(page);

        // Deterministic per-tile proof: exactly one current destination, the
        // family root, discoverable in the nav viewport.
        expect(facts.nav, `nav facts ${stop.id}`).not.toBeNull();
        expect(
          facts.nav!.currentCount,
          `exactly one aria-current on ${route}`,
        ).toBe(1);
        expect(facts.nav!.currentHrefs, `current href on ${route}`).toEqual([
          stop.expectedHref,
        ]);
        const [currentRect] = facts.nav!.currentRects;
        const region = facts.nav!.region;
        expect(region, `region ${stop.id}`).not.toBeNull();
        expect(
          verticallyInside(currentRect!, region!),
          `current item inside nav viewport on ${route}`,
        ).toBe(true);

        // Exactly-one negative (questions import): the family root link must
        // NOT be current.
        if (stop.notCurrentHref) {
          await expect(
            page
              .getByTestId("app-sidebar")
              .locator(`a[href="${stop.notCurrentHref}"]`),
            `not-current on ${route}`,
          ).not.toHaveAttribute("aria-current", "page");
        }

        items.push({
          setId: set.id,
          stopId: stop.id,
          label: stop.label,
          route,
          expectedHref: stop.expectedHref,
          ...(stop.notCurrentHref
            ? { notCurrentHref: stop.notCurrentHref }
            : {}),
          viewport: `${SHELL_COMPARISON_VIEWPORT.width}x${SHELL_COMPARISON_VIEWPORT.height}`,
          screenshot: shotPath,
          sidebarScreenshot: sidebarPath,
          navFacts: facts.nav,
        });
      }

      const record: HierarchySetRecord = {
        id: set.sheetBase,
        kind: "nav-hierarchy",
        heldConstant: [
          "persona: Admin",
          "viewport: 1280x800",
          "shell: full sidebar",
          "browser: chromium",
          "seed: e2e canonical",
        ],
        varies: "route within one navigation family",
        destinationLabel: set.destinationLabel,
        reviewNotes: [
          `Every tile must keep "${set.destinationLabel}" current — a different current destination or a missing current is a defect.`,
          "A changed nav scrollTop is EXPECTED only when required to reveal the current item.",
          "Questions stop 04: 题目导入 current and 题目管理 NOT current (exactly-one).",
        ],
        items,
      };
      hierarchySets.push(record);

      await renderContactSheet(page, {
        outputPath: join(SHEETS_DIR, `${set.sheetBase}.png`),
        title: `${set.title} (${BASE_SHA})`,
        tiles: items.map((item) => ({
          label: sheetTileLabel({ id: item.stopId, label: item.label }),
          imagePath: item.screenshot,
        })),
      });
      await renderContactSheet(page, {
        outputPath: join(SHEETS_DIR, `${set.sheetBase}-sidebars.png`),
        title: `${set.title} — sidebars (${BASE_SHA})`,
        tiles: items.map((item) => ({
          label: sheetTileLabel({ id: item.stopId, label: item.label }),
          imagePath: item.sidebarScreenshot!,
        })),
      });

      // Harness proof: ordering, crops, and DOM metadata all present.
      expect(items.map((item) => item.stopId)).toEqual(
        set.stops.map((stop) => stop.id),
      );
      for (const item of items) {
        expect(
          existsSync(item.screenshot),
          `viewport shot ${item.stopId}`,
        ).toBe(true);
        expect(
          statSync(item.screenshot).size,
          `viewport shot non-empty ${item.stopId}`,
        ).toBeGreaterThan(0);
        expect(
          existsSync(item.sidebarScreenshot!),
          `sidebar crop ${item.stopId}`,
        ).toBe(true);
        expect(
          item.navFacts!.overflowState,
          `overflow ${item.stopId}`,
        ).not.toBe(null);
      }
    });
  }
});
