import { expect, test, type Page } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  adminPost,
  answerTrueFalse,
  candidateLogin,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";
import { assertNoHorizontalOverflow } from "../lib/responsive";
import { statusMeta, type StatusMeta } from "../../web/src/lib/statusMeta";
import { statusLabelKey } from "../../web/src/lib/statusMetaUtils";
import i18n, {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "../../web/src/i18n/index";

/**
 * UI-GOVERNANCE-1 (issue #461) — the durable #439 V1–V4 browser closure gates.
 *
 * Every gate asserts DOM geometry in real Chromium with the built product CSS
 * (getBoundingClientRect / scrollWidth / computed style / matchMedia) —
 * screenshots are human evidence, never the gate. Authorities under test:
 *
 *   V1  UsersPage action capacity — RowActions count-derived representation
 *       inside the contract actions column (6rem fine / 7.5rem coarse), the
 *       actions cell never colliding with the status cell.
 *   V2  ResultPage detail-comparison — score fully visible without scroll at
 *       1280×900 (the constrained sticky-scroll fallback is durable in
 *       table-contract-2.spec.ts "V2 narrow"; this spec owns the roomy case).
 *   V3  Column content semantics — long CJK identity and long unbroken token
 *       wrap safely inside primary-text cells; machine identifiers
 *       middle-truncate in the locked 7.5rem short-id column with the full
 *       value accessible.
 *   V4  Every statusMeta entry × every supported runtime locale rendered by
 *       the real StatusBadge in the real status column fits the frozen 8.5rem
 *       status capacity, derived from the statusMeta/i18n authorities (no
 *       hand-copied lists).
 */

/** Subpixel/border tolerance — never widened to absorb real overflow. */
const TOL = 1;

interface Box {
  left: number;
  right: number;
  width: number;
  height: number;
}

interface UserRowGeometry {
  actionsCell: Box;
  actionsContent: Box;
  buttons: Box[];
  statusCell: Box;
  statusBadge: Box;
  pointerCoarse: boolean;
}

/**
 * One-pass geometry probe of a UsersPage row: the actions cell (contract
 * width), the RowActions group + inline buttons inside it, and the status
 * cell + badge the historical V1 defect used to overlap.
 */
async function probeUserRow(
  row: import("@playwright/test").Locator,
): Promise<UserRowGeometry> {
  return row.evaluate((tr) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const actionsCell = tr.querySelector<HTMLElement>(
      '[data-column-role="actions"]',
    );
    const statusCell = tr.querySelector<HTMLElement>(
      '[data-column-role="status"]',
    );
    const content = actionsCell?.querySelector<HTMLElement>(
      '[data-slot="row-actions"]',
    );
    const badge = statusCell?.querySelector<HTMLElement>(
      '[data-slot="status-badge"]',
    );
    if (!actionsCell || !statusCell || !content || !badge) {
      throw new Error("user row probe: contract cells missing");
    }
    return {
      actionsCell: box(actionsCell),
      actionsContent: box(content),
      buttons: Array.from(actionsCell.querySelectorAll("button")).map(box),
      statusCell: box(statusCell),
      statusBadge: box(badge),
      pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    };
  });
}

async function createTeacher(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  username: string,
): Promise<void> {
  const token = await adminApiToken(request);
  const created = await adminPost(request, token, "/api/users", {
    username,
    password: "teacher123",
    name,
    role: "Teacher",
  });
  expect(created.ok()).toBeTruthy();
}

/**
 * Observable layout readiness: the self-hosted Noto Sans CJK SC @font-face
 * subsets load LAZILY, and `document.fonts.ready` resolves immediately when
 * queried before the first subset request begins — a probe can then measure
 * the fallback-metric layout before the real font swaps in and re-breaks
 * wrapped lines. Explicitly request the two UI faces (400 body, 500
 * medium/badge) so the load is triggered, THEN wait for quiescence. Still a
 * load-settled promise, never a timeout.
 */
async function waitForSettledLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.load('14px "Noto Sans CJK SC"');
    await document.fonts.load('500 12px "Noto Sans CJK SC"');
    await document.fonts.ready;
  });
}

test.describe("UI-GOVERNANCE-1 #439 V1–V4 durable gates", () => {
  test("V1 fine pointer: teacher row [edit][kebab] inside 6rem, status cell untouched", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const teacherName = `E2E Governance Teacher ${stamp}`;
    await createTeacher(request, teacherName, `e2e-gov1-teacher-${stamp}`);

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: teacherName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await waitForSettledLayout(page);

    const g = await probeUserRow(row);
    expect(g.pointerCoarse).toBe(false);

    // A: the >2 declaration path renders exactly [primary][kebab] inline.
    expect(g.buttons).toHaveLength(2);
    // B: action content stays inside the actions cell on BOTH edges.
    expect(g.actionsContent.left).toBeGreaterThanOrEqual(
      g.actionsCell.left - TOL,
    );
    expect(g.actionsContent.right).toBeLessThanOrEqual(
      g.actionsCell.right + TOL,
    );
    for (const button of g.buttons) {
      expect(button.right).toBeLessThanOrEqual(g.actionsCell.right + TOL);
    }
    // C: the actions cell never overlaps the neighbouring status cell.
    expect(g.statusCell.right).toBeLessThanOrEqual(g.actionsCell.left + TOL);
    // D: the status badge remains fully inside the status cell.
    expect(g.statusBadge.left).toBeGreaterThanOrEqual(g.statusCell.left - TOL);
    expect(g.statusBadge.right).toBeLessThanOrEqual(g.statusCell.right + TOL);
    // E: contract width authority — 6rem (96px) fine pointer.
    expect(Math.abs(g.actionsCell.width - 96)).toBeLessThanOrEqual(2);
  });

  test.describe("V1 coarse pointer", () => {
    // The repo's supported coarse-pointer mechanism: a touch-enabled context
    // makes the CSS `(pointer: coarse)` media feature match in Chromium, so
    // the 7.5rem actions-column rule is exercised by the real stylesheet.
    test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });

    test("teacher row [edit][kebab] inside 7.5rem, status cell untouched", async ({
      page,
      request,
    }) => {
      const stamp = Date.now();
      const teacherName = `E2E Governance Coarse Teacher ${stamp}`;
      await createTeacher(request, teacherName, `e2e-gov1-coarse-${stamp}`);

      await loginAsAdmin(page);
      await page.goto("/admin/users");
      const row = page
        .getByRole("row")
        .filter({ hasText: teacherName })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await waitForSettledLayout(page);

      const g = await probeUserRow(row);
      expect(g.pointerCoarse).toBe(true);
      expect(g.buttons).toHaveLength(2);
      expect(g.statusCell.right).toBeLessThanOrEqual(g.actionsCell.left + TOL);
      expect(g.statusBadge.right).toBeLessThanOrEqual(g.statusCell.right + TOL);
      // Coarse capacity authority — 7.5rem (120px).
      expect(Math.abs(g.actionsCell.width - 120)).toBeLessThanOrEqual(2);
    });
  });

  test("V2 1280×900: ResultPage score fully visible without horizontal scroll", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "governance-v2-score", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "immediate",
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await page.waitForURL("**/result", { timeout: 15_000 });
    const shell = page.locator('[data-slot="admin-table-shell"]');
    await shell.waitFor({ state: "visible" });
    await waitForSettledLayout(page);

    const g = await shell.evaluate((el) => {
      const region = el.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      const table = el.querySelector('[data-slot="table"]');
      const scoreHeader = el.querySelector<HTMLElement>(
        '[data-slot="table-head"][data-column-role="score"]',
      );
      const scoreCells = Array.from(
        el.querySelectorAll<HTMLElement>(
          '[data-slot="table-cell"][data-column-role="score"]',
        ),
      );
      return {
        archetype: el.getAttribute("data-table-archetype"),
        overflowing: region?.getAttribute("data-overflowing"),
        scrollLeft: region?.scrollLeft ?? -1,
        regionBox: region?.getBoundingClientRect(),
        tableBox: table?.getBoundingClientRect(),
        scoreHeaderVisible: scoreHeader !== null,
        scoreCellCount: scoreCells.length,
        scoreCellsVisible: scoreCells.every(
          (c) => c.getBoundingClientRect().width > 0,
        ),
        lastScoreBox: scoreCells.at(-1)?.getBoundingClientRect(),
      };
    });

    expect(g.archetype).toBe("detail-comparison");
    // The score column exists and renders (not merely present in the DOM).
    expect(g.scoreHeaderVisible).toBe(true);
    expect(g.scoreCellCount).toBeGreaterThan(0);
    expect(g.scoreCellsVisible).toBe(true);
    // No horizontal scroll at the initial state, physically.
    expect(g.overflowing).toBe("false");
    expect(g.scrollLeft).toBe(0);
    // The score rect sits fully inside the visible table container.
    expect(g.lastScoreBox && g.regionBox).toBeTruthy();
    expect(g.lastScoreBox!.right).toBeLessThanOrEqual(g.regionBox!.right + TOL);
    expect(g.lastScoreBox!.left).toBeGreaterThanOrEqual(
      g.regionBox!.left - TOL,
    );
    // The rendered table never exceeds its container.
    expect(g.tableBox!.width).toBeLessThanOrEqual(g.regionBox!.width + TOL);
    await assertNoHorizontalOverflow(page);
  });

  test("V3 Case A: long CJK identity + unbroken machine token wrap inside primary-text cells", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    // Deterministic fixture values (exactly the username contract max 50):
    // a long CJK human identity and a 50-char unbroken ASCII machine-style
    // token, both in primary-text columns. 50 chars cannot fit ANY legal
    // admin-standard column width (even sidebar-collapsed ~364px content
    // box < ~415px token), so the wrap decision is data-determined — never
    // a race against sidebar/font settling.
    const cjkName = `超长中文姓名测试超长中文姓名测试超长中文姓名测试${stamp}`;
    const unbrokenToken = `G3${stamp}UNBROKEN_MACHINE_IDENTIFIER_XZZZZ`;
    await createTeacher(request, cjkName, unbrokenToken);

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page
      .getByRole("row")
      .filter({ hasText: unbrokenToken })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await waitForSettledLayout(page);

    interface CellMetrics {
      role: string | null;
      overflow: string | null;
      whiteSpace: string;
      overflowWrap: string;
      clientWidth: number;
      scrollWidth: number;
      contentRight: number;
      contentHeight: number;
      contentBottom: number;
      cellRight: number;
      cellBottom: number;
      neighborLeft: number | null;
    }
    const metrics = await row.evaluate((tr): Record<string, CellMetrics> => {
      const measure = (cell: HTMLElement): CellMetrics => {
        const cs = getComputedStyle(cell);
        const range = document.createRange();
        range.selectNodeContents(cell);
        const content = range.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const neighbor = cell.nextElementSibling;
        return {
          role: cell.getAttribute("data-column-role"),
          overflow: cell.getAttribute("data-column-overflow"),
          whiteSpace: cs.whiteSpace,
          overflowWrap: cs.overflowWrap,
          clientWidth: cell.clientWidth,
          scrollWidth: cell.scrollWidth,
          contentRight: content.right,
          contentHeight: content.height,
          contentBottom: content.bottom,
          cellRight: cellRect.right,
          cellBottom: cellRect.bottom,
          neighborLeft: neighbor ? neighbor.getBoundingClientRect().left : null,
        };
      };
      const usernameCell = tr.querySelector<HTMLElement>(
        '[data-column-role="primary-text"]',
      );
      if (!usernameCell) throw new Error("no primary-text cell");
      return {
        username: measure(usernameCell),
        name: measure(usernameCell.nextElementSibling as HTMLElement),
      };
    });

    for (const [key, m] of Object.entries(metrics)) {
      // The wrap policy is the role default and physically applied.
      expect(m.role, key).toBe("primary-text");
      expect(m.overflow, key).toBe("wrap");
      expect(m.whiteSpace, key).toBe("normal");
      // Wrap/break safely: nothing overflows or clips the cell.
      expect(m.scrollWidth, key).toBeLessThanOrEqual(m.clientWidth + TOL);
      // Physical containment: the rendered line boxes end inside the cell.
      expect(m.contentRight, key).toBeLessThanOrEqual(m.cellRight + TOL);
      // The wrap really happened: the union of the rendered line boxes spans
      // two lines. Table cells are fixed h-12 (48px), so the ROW height
      // never changes on wrap — the line-box union is the direct proof
      // (one 14px line ≈ 19-22px; the 50-char fixture cannot fit one line
      // in any legal column width).
      expect(m.contentHeight, key).toBeGreaterThanOrEqual(30);
      // Vertical containment: the wrapped lines stay inside the cell box.
      expect(m.contentBottom, key).toBeLessThanOrEqual(m.cellBottom + TOL);
      // The neighbour column starts at/after this cell's boundary.
      expect(m.neighborLeft, key).not.toBeNull();
      expect(m.neighborLeft!, key).toBeGreaterThanOrEqual(m.cellRight - TOL);
    }
    await assertNoHorizontalOverflow(page);
  });

  test("V3 Case B: machine identifier middle-truncates inside the locked 7.5rem short-id column", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");
    const presenter = page
      .locator(
        '[data-slot="table-cell"] [data-overflow-policy="truncate-middle"]',
      )
      .first();
    await expect(presenter).toBeVisible({ timeout: 15_000 });
    await waitForSettledLayout(page);

    // The full value stays accessible; the visible form is the shortened one.
    const title = await presenter.getAttribute("title");
    const aria = await presenter.getAttribute("aria-label");
    const visible = ((await presenter.textContent()) ?? "").trim();
    expect(aria).toBeTruthy();
    expect(title).toBe(aria);
    expect(visible).toContain("…");
    expect(visible.length).toBeLessThan(title!.length);

    // The locked short-id column did not expand for the long value, and the
    // presenter's rendered box ends inside its cell.
    const probe = await presenter.evaluate((el) => {
      const cell = el.closest<HTMLElement>('[data-column-role="short-id"]');
      if (!cell) throw new Error("presenter outside short-id cell");
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        cellWidth: cell.getBoundingClientRect().width,
        contentRight: range.getBoundingClientRect().right,
        cellRight: cell.getBoundingClientRect().right,
      };
    });
    expect(Math.abs(probe.cellWidth - 120)).toBeLessThanOrEqual(2);
    expect(probe.contentRight).toBeLessThanOrEqual(probe.cellRight + TOL);
  });

  test("#445 320px baseline: admin management-list and candidate list stay overflow-free", async ({
    page,
    request,
  }) => {
    // The program-level 320px acceptance (narrower than the 375/390 lanes
    // the responsive specs cover): the representation switch and the shell
    // gutter must keep both surfaces inside the document at 320px.
    const seeded = await seedExam(request, "governance-320", {
      questionAnswer: true,
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await loginAsAdmin(page);

    await page.goto("/admin/users");
    await page.locator("main h1").waitFor({ state: "visible" });
    await expect(
      page.locator('[data-slot="mobile-record-card"]').first(),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Candidate shell: ExamLayout redirects an admin session, so exercise
    // the candidate role with a candidate session (page-geometry precedent).
    await candidateLogin(page, seeded.candidate);
    await page.goto("/exam/list");
    await page.locator('[data-slot="page-container"]').waitFor({
      state: "visible",
    });
    await page
      .getByText(/E2E-governance-320/)
      .first()
      .waitFor({ state: "visible" });
    await assertNoHorizontalOverflow(page);
  });

  for (const locale of SUPPORTED_LOCALES) {
    test(`V4: every statusMeta badge × locale ${locale} fits the frozen status column`, async ({
      page,
    }) => {
      // The matrix is derived from the authorities, never hand-copied: keys
      // from statusMeta, labels resolved per requested locale, locales from
      // SUPPORTED_LOCALES. Today the runtime exposes exactly one locale and
      // no switch mechanism; if a second locale ever lands, this gate fails
      // loudly HERE instead of silently rendering it under the default
      // language — extend the harness with the real switch mechanism then.
      if (locale !== DEFAULT_LOCALE) {
        throw new Error(
          `locale "${locale}" has no runtime switch mechanism in the harness; wire the app's locale control into this gate before trusting its result`,
        );
      }
      const universe = Object.entries(statusMeta).map(([status, raw]) => {
        const meta = raw as StatusMeta;
        return {
          status,
          label: i18n.t(statusLabelKey(meta.labelKey), { lng: locale }),
        };
      });
      const items = universe.map(({ status }, i) => ({
        attemptId: `e2e-status-${i}-${status}`,
        examId: "e2e-status-fixture",
        examTitle: "E2E status fixture exam",
        candidateId: `e2e-status-cand-${i}`,
        candidateName: `考生 ${status}`,
        submittedAt: null,
        gradingStatus: status,
        pendingQuestionCount: 1,
      }));

      // Test-only harness: the REAL GradingQueuePage renders the REAL
      // StatusBadge per row in the REAL status column; only the API payload
      // is synthesized (no production route, no product change).
      await page.route("**/api/admin/grading-queue*", (route) =>
        route.fulfill({
          json: {
            items,
            total: items.length,
            page: 1,
            pageSize: items.length,
          },
        }),
      );
      await loginAsAdmin(page);
      await page.goto("/admin/grading-queue");
      const shell = page.locator('[data-slot="admin-table-shell"]');
      await shell.waitFor({ state: "visible" });
      await waitForSettledLayout(page);

      const expectedByRowId = new Map(
        items.map((item, i) => [item.attemptId, universe[i]!]),
      );
      const result = await page.evaluate((expectedByRow) => {
        // Body rows only — the header row also carries data-slot="table-row".
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-slot="admin-table-shell"] [data-slot="table-body"] [data-slot="table-row"]',
          ),
        );
        const table = document.querySelector<HTMLElement>(
          '[data-slot="admin-table-shell"] [data-slot="table"]',
        );
        const region = document.querySelector<HTMLElement>(
          '[data-slot="table-scroll-region"]',
        );
        const rowsOut: {
          status: string;
          labelOk: boolean;
          badgeLabel: string;
          badgeInCell: boolean;
          badgeScrollFits: boolean;
          statusCellWidth: number;
        }[] = [];
        for (const row of rows) {
          const rowId = row.getAttribute("data-testid") ?? "";
          const expected = (
            expectedByRow as Record<string, { status: string; label: string }>
          )[rowId.replace("grading-queue-row-", "")];
          if (!expected) continue;
          const cell = row.querySelector<HTMLElement>(
            '[data-column-role="status"]',
          );
          const badge = row.querySelector<HTMLElement>(
            '[data-slot="status-badge"]',
          );
          if (!cell || !badge) continue;
          const cellRect = cell.getBoundingClientRect();
          const badgeRect = badge.getBoundingClientRect();
          rowsOut.push({
            status: expected.status,
            labelOk: badge.textContent?.trim() === expected.label,
            badgeLabel: badge.textContent?.trim() ?? "",
            badgeInCell:
              badgeRect.left >= cellRect.left - 1 &&
              badgeRect.right <= cellRect.right + 1,
            badgeScrollFits: badge.scrollWidth <= badge.clientWidth + 1,
            statusCellWidth: cellRect.width,
          });
        }
        return {
          rowCount: rows.length,
          tableWidth: table?.getBoundingClientRect().width ?? 0,
          regionClientWidth: region?.clientWidth ?? 0,
          regionScrollWidth: region?.scrollWidth ?? 0,
          rows: rowsOut,
        };
      }, Object.fromEntries(expectedByRowId));

      // Full coverage: every statusMeta key rendered exactly once.
      expect(result.rows).toHaveLength(universe.length);
      expect(result.rowCount).toBe(universe.length);

      const widths = result.rows.map((r) => r.statusCellWidth);
      for (const r of result.rows) {
        // Content proof: the badge resolves its label in the requested locale.
        expect(r.labelOk, `label ${r.status} → "${r.badgeLabel}"`).toBe(true);
        // Geometry proof: the badge fits the frozen status column physically.
        expect(r.badgeInCell, `containment ${r.status}`).toBe(true);
        expect(r.badgeScrollFits, `no clipping ${r.status}`).toBe(true);
        // The locked 8.5rem (136px) status capacity held for every label.
        expect(
          Math.abs(r.statusCellWidth - 136),
          `width ${r.status}`,
        ).toBeLessThanOrEqual(2);
      }
      // Table-inflation proof: the status matrix never grows the table
      // beyond its container (fixed layout + locked column), and every
      // status cell rendered at the same locked width.
      expect(result.regionScrollWidth).toBeLessThanOrEqual(
        result.regionClientWidth + TOL,
      );
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(
        0.5,
      );
    });
  }
});
