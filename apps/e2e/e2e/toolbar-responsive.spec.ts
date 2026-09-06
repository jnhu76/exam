import { expect, test } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";

/**
 * issue 445 UI-TOOLBAR-RESPONSIVE-1 (issue 458) runtime geometry — real Chromium.
 *
 * The toolbar filter sizing contract: narrow = 9rem (144px), wide = 11.25rem
 * (180px), declared via <ToolbarFilter size="narrow|wide"> on DataToolbar.
 * Search stays DataToolbar-owned (w-80 at lg) and date stays DatePicker-
 * owned — neither may drift into the tiers. Below `sm` the controls flow
 * full-width (no rigid desktop box, no horizontal page overflow).
 *
 * QuestionPage is the one page that carries both semantic sizes side by side
 * (course → wide, type/difficulty → narrow, tags → wide).
 */
test.describe("toolbar control sizing (issue 458)", () => {
  test("desktop: narrow ≈144px, wide ≈180px, search keeps its own width", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedExam(request, "toolbar-458", { questionAnswer: true });

    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    const toolbar = page.locator('[role="toolbar"]');
    await toolbar.waitFor({ state: "visible" });

    const wide = toolbar.locator('[data-toolbar-filter-size="wide"]').first();
    const narrow = toolbar
      .locator('[data-toolbar-filter-size="narrow"]')
      .first();
    await expect(wide).toBeVisible();
    await expect(narrow).toBeVisible();

    // Semantic tiers are the physical widths at desktop.
    const wideBox = (await wide.boundingBox())!;
    const narrowBox = (await narrow.boundingBox())!;
    expect(Math.abs(wideBox.width - 180)).toBeLessThanOrEqual(2);
    expect(Math.abs(narrowBox.width - 144)).toBeLessThanOrEqual(2);

    // The inner control fills the semantic wrapper (no page-owned px).
    const wideTrigger = wide.locator('[data-slot="select-trigger"]').first();
    await expect(wideTrigger).toBeVisible();
    const triggerBox = (await wideTrigger.boundingBox())!;
    expect(Math.abs(triggerBox.width - 180)).toBeLessThanOrEqual(2);

    // Search stays DataToolbar-owned (w-80 at lg+), unchanged by this issue.
    const search = page.locator('[data-slot="toolbar-search"]').first();
    const searchBox = (await search.boundingBox())!;
    expect(Math.abs(searchBox.width - 320)).toBeLessThanOrEqual(2);
  });

  test("mobile: no horizontal page overflow and filters flow full-width", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedExam(request, "toolbar-458-mobile", { questionAnswer: true });

    await loginAsAdmin(page);
    await page.goto("/admin/questions");
    await page.locator('[role="toolbar"]').waitFor({ state: "visible" });

    // No document-level horizontal overflow from the new semantic tiers.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Below sm the semantic tier is NOT a rigid 144/180 box — the controls
    // participate in the responsive flow at the container width.
    const wide = page.locator('[data-toolbar-filter-size="wide"]').first();
    const narrow = page.locator('[data-toolbar-filter-size="narrow"]').first();
    const toolbarBox = (await page.locator('[role="toolbar"]').boundingBox())!;
    const wideBox = (await wide.boundingBox())!;
    const narrowBox = (await narrow.boundingBox())!;
    expect(wideBox.width).toBeGreaterThan(180);
    expect(narrowBox.width).toBeGreaterThan(144);
    expect(wideBox.x + wideBox.width).toBeLessThanOrEqual(
      toolbarBox.x + toolbarBox.width + 1,
    );
  });
});
