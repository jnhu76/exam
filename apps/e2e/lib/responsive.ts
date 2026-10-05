import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Shared deterministic narrow-viewport operability assertions for the
 * candidate responsive journey (candidate-responsive.spec.ts). Pure
 * computed-geometry proofs — no screenshots, no visual-regression dependency.
 */

/** 1px tolerance for sub-pixel rounding on scrollWidth. */
export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

/** The control is visible and its box sits inside the viewport width. */
export async function assertReachable(
  page: Page,
  locator: Locator,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}
