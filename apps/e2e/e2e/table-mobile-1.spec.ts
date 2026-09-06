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
 *     table region is display:none), cards carry the audited field slots,
 *     and the actions declaration is reachable with no document-level
 *     horizontal overflow;
 *   - CandidatesPage: deployment-defined CandidateField columns stay off the
 *     card (unbounded count) while the desktop table keeps them;
 *   - QuestionPage: the derived card preserves the audited slot assignment
 *     (type badge header, content primary, labeled score meta, RowActions);
 *   - lg boundary (1024px): the SAME page keeps the table — narrow
 *     containers degrade the TIER (tier negotiation), never swap to cards;
 *   - negative proofs: log-diagnostic (AuditLogPage) and detail-comparison
 *     (ResultPage) keep their scrolling table at 375px — no cards.
 *
 * Screenshots are evidence artifacts only; every gate is DOM state /
 * computed visibility, per the repo's deterministic-geometry rule.
 */

const CARD = '[data-slot="mobile-record-card"]';
const MOBILE_REGION = '[data-slot="responsive-mobile-region"]';
const DESKTOP_REGION = '[data-slot="responsive-desktop-region"]';

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
    await expect(page.locator(MOBILE_REGION).last()).toBeVisible();
    await expect(page.locator(DESKTOP_REGION).last()).toBeHidden();
    const cards = page
      .locator('[data-slot="admin-table-shell"]')
      .last()
      .locator(CARD);
    expect(await cards.count()).toBeGreaterThan(0);

    // Derived card content: high primary-text (username) in the primary
    // area, the status badge in the header cluster — and the account role
    // joins the meta line (C4 audit override: role is identity-critical).
    const card = cards.first();
    await expect(card.locator('[data-field-id="username"]')).toBeVisible();
    await expect(card.locator('[data-field-id="status"]')).toBeVisible();
    await expect(card.locator('[data-field-id="role"]')).toBeVisible();

    // Actions declaration is reachable on the card: the RowActions component
    // renders data-action-id attributes on each action button, proving the
    // mobile card surfaces the full actions set from the column declaration.
    await expect(card.locator("[data-action-id]").first()).toBeVisible();

    await assertNoHorizontalOverflow(page);
  });

  test("375px: CandidatesPage keeps dynamic CandidateFields off the card, desktop keeps them", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "table-mobile-cand", {
      questionAnswer: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);
    await page.goto("/admin/candidates");
    await page.locator("main h1").waitFor({ state: "visible" });
    // Deterministic slice: the persistent E2E database accumulates
    // candidates across runs and specs, so the seeded candidate can sit
    // past the list's first page — search narrows to it before the card
    // assertions (same pattern as the QuestionPage proof below).
    await page
      .getByRole("searchbox", { name: "搜索考生" })
      .fill(seeded.candidate.username);
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    const card = page.locator(CARD, {
      hasText: seeded.candidate.name,
    });
    await expect(card).toBeVisible();

    // The audited card field set: username + name (primary), status
    // (header), actions — and NOTHING else: every deployment-defined
    // CandidateField column (candidateNo, department, …) is priority "low"
    // and never renders on the card, whatever the deployment defines.
    const fieldIds = await card
      .locator("[data-field-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-field-id")));
    expect([...fieldIds].sort()).toEqual(["name", "status", "username"]);
    expect(await card.locator('[data-field-id="candidateNo"]').count()).toBe(0);

    // The dynamic columns still exist in the (hidden) desktop table of the
    // same column array — omission is card-scoped, not a data loss.
    const desktop = page.locator(DESKTOP_REGION).last();
    await expect(
      desktop.locator("th", { hasText: "编号" }).first(),
    ).toHaveCount(1);

    // Actions declaration is reachable on the card.
    await expect(card.locator("[data-action-id]").first()).toBeVisible();

    await assertNoHorizontalOverflow(page);
  });

  test("375px: QuestionPage derived card keeps the audited slot assignment", async ({
    page,
    request,
  }) => {
    // The seeded question's content is `判断题-table-mobile-q` (seed.ts).
    await seedExam(request, "table-mobile-q", {
      questionAnswer: true,
      questionScore: 100,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    await page.locator("main h1").waitFor({ state: "visible" });

    // Narrow to the seeded question so its card is on the page slice.
    await page
      .getByPlaceholder("搜索题目内容...")
      .fill(`判断题-table-mobile-q`);
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});

    const card = page.locator(CARD, {
      hasText: `判断题-table-mobile-q`,
    });
    await expect(card).toBeVisible();

    // Audited slots: type badge in the header cluster, content primary,
    // score as a LABELED meta line (not a bare header value), tags off.
    await expect(card.locator('[data-field-id="type"]')).toBeVisible();
    await expect(card.locator('[data-field-id="content"]')).toBeVisible();
    const score = card.locator('[data-field-id="score"]');
    await expect(score).toBeVisible();
    expect(await score.textContent()).toBe("分值: 100");
    expect(await card.locator('[data-field-id="tags"]').count()).toBe(0);

    // The desktop table of the same column array keeps the full column set.
    const desktop = page.locator(DESKTOP_REGION).last();
    await expect(
      desktop.locator("th", { hasText: "题型" }).first(),
    ).toHaveCount(1);

    // Actions declaration is reachable on the card.
    await expect(card.locator("[data-action-id]").first()).toBeVisible();

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
    await page.goto("/admin/audit-logs");
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
