import { expect, test, type Page } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  answerTrueFalse,
  candidateLogin,
  startExamFromList,
  submitExam,
  waitForSaveSaved,
} from "../lib/flow";
import { assertNoHorizontalOverflow } from "../lib/responsive";

/**
 * UI-TABLE-MOBILE-1 runtime evidence (issue 457) — the management-list
 * mobile card representation in real Chromium with the built app CSS.
 *
 *   - 375px viewport: management-list renders MobileRecordCard list (the
 *     squeezed table is display:none), cards carry high+normal fields,
 *     low-priority columns are omitted, and the actions declaration is
 *     reachable (kebab opens) with no document-level horizontal overflow;
 *   - lg boundary (1024px): the SAME page keeps the table — narrow
 *     containers degrade the TIER (tier negotiation), never swap to cards;
 *   - negative proofs: log-diagnostic (AuditLogPage) and detail-comparison
 *     (ResultPage) keep their scrolling table at 375px — no cards.
 *
 * Screenshots are evidence artifacts only; every gate is DOM state /
 * computed visibility, per the repo's deterministic-geometry rule.
 */

const CARD = '[data-slot="mobile-record-card"]';
const MOBILE_REGION = '[data-slot="table-mobile-region"]';
const DESKTOP_REGION = '[data-slot="table-scroll-frame"]';

async function visibility(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible();
}

test.describe("management-list mobile card representation (issue 457)", () => {
  test.describe.configure({ mode: "serial" });

  test("375px: users management-list renders derived cards, not a squeezed table", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await page.locator("main h1").waitFor({ state: "visible" });
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    // The viewport switch is CSS-only: below lg the card list is the
    // representation and the table region is display:none.
    await expect(page.locator(MOBILE_REGION)).toBeVisible();
    await expect(page.locator(DESKTOP_REGION)).toBeHidden();
    const cards = page.locator(CARD);
    expect(await cards.count()).toBeGreaterThan(0);

    // Derived card content: high primary-text (username) in the primary
    // area, the status badge in the header cluster, labeled meta fields —
    // and the low-priority role badge (type role) is omitted.
    const card = cards.first();
    await expect(card.locator('[data-field-id="username"]')).toBeVisible();
    await expect(card.locator('[data-field-id="status"]')).toBeVisible();
    // Low-priority columns never participate: no role field on the card.
    expect(await card.locator('[data-field-id="role"]').count()).toBe(0);

    // Actions declaration is reachable on the card: the kebab opens.
    const kebab = card.locator('[data-action-id="overflow-menu"]');
    await expect(kebab).toBeVisible();
    await kebab.click();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.keyboard.press("Escape");

    await assertNoHorizontalOverflow(page);
  });

  test("lg boundary (1024px): narrow container keeps the table — tier drops, cards do not appear", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await page.locator("main h1").waitFor({ state: "visible" });
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    // The viewport switch is <lg only: at lg the table is the
    // representation even though the container is narrow (tier negotiation
    // owns narrow-container degradation — ownership boundary frozen).
    await expect(page.locator(DESKTOP_REGION)).toBeVisible();
    await expect(page.locator(MOBILE_REGION)).toBeHidden();
    const tier = await page
      .locator('[data-slot="admin-table-shell"]')
      .first()
      .getAttribute("data-table-tier");
    expect(tier).toBe("compact");
    expect(await page.locator(CARD).first().isVisible()).toBe(false);
  });

  test("negative: log-diagnostic keeps its scrolling table at 375px (no cards)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);
    await page.goto("/admin/audit-log");
    await page.locator("main h1").waitFor({ state: "visible" });
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    // Scroll-retained archetype: the table stays the representation below
    // lg; no mobile region, no record cards anywhere on the page.
    await expect(
      page.locator('[data-slot="admin-table-shell"]').first(),
    ).toBeVisible();
    expect(await page.locator(MOBILE_REGION).count()).toBe(0);
    expect(await page.locator(CARD).count()).toBe(0);
    await assertNoHorizontalOverflow(page);
  });

  test("negative: detail-comparison keeps its scrolling table at 375px (no cards)", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "table-mobile-neg", {
      questionAnswer: true,
      questionScore: 100,
      passingScore: 60,
      resultPublicationMode: "immediate",
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await page.waitForURL("**/result", { timeout: 15_000 });

    await expect(
      page.locator('[data-slot="admin-table-shell"]').first(),
    ).toBeVisible();
    expect(await page.locator(MOBILE_REGION).count()).toBe(0);
    expect(await page.locator(CARD).count()).toBe(0);
    await assertNoHorizontalOverflow(page);
  });
});
