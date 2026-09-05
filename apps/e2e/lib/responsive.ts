import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Shared deterministic geometry assertions for the responsive baselines
 * (Issue #306). Pure computed-geometry proofs — no screenshots, no visual
 * regression dependency. The 390x844 candidate baseline (candidate-responsive
 * spec) and the Admin baseline (admin-responsive spec) both assert through
 * these helpers so a regression in either lane fails identically.
 */

/** The issue-#306 contract viewport. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

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

/**
 * A dialog must fit the mobile viewport width and keep its whole box
 * horizontally inside the viewport (vertical content may scroll inside the
 * dialog per the #306 responsive contract).
 */
export async function assertDialogFitsViewport(
  page: Page,
  dialog: Locator,
): Promise<void> {
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

/**
 * R2 — deliberate local dense-content scrolling is allowed, but the element
 * that actually OWNS the overflow must be a real local scroll container
 * (overflow-x: auto|scroll) whose box stays inside the viewport, so the
 * page-level document stays bounded while content remains reachable by
 * local scrolling.
 *
 * Candidates may nest (DataTableShell's scroll region wraps ui/Table's
 * container): an element whose content overflows but whose nearest
 * scrolling ancestor already owns the horizontal overflow is fine — the
 * outermost owner is what must be contained.
 */
export async function assertLocalScrollContained(
  page: Page,
  locator: Locator,
): Promise<void> {
  await expect(locator).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await locator.boundingBox())!;
  // The candidate itself must sit inside the viewport horizontally…
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);

  // …and if it (or a scrolling ancestor) actually holds overflowing
  // content, the nearest overflow owner must be a real local scroll
  // container that also stays inside the viewport.
  const owner = await locator.evaluate((el) => {
    const scrolling = (node: Element | null): Element | null => {
      let cur: Element | null = node;
      while (cur && cur !== document.documentElement) {
        const ox = getComputedStyle(cur).overflowX;
        if (ox === "auto" || ox === "scroll") return cur;
        cur = cur.parentElement;
      }
      return null;
    };
    const target: Element =
      el.scrollWidth > el.clientWidth + 1 ? (scrolling(el) ?? el) : el;
    const cs = getComputedStyle(target);
    const r = target.getBoundingClientRect();
    return {
      overflowX: cs.overflowX,
      x: r.x,
      right: r.x + r.width,
      scrollWidth: target.scrollWidth,
      clientWidth: target.clientWidth,
    };
  });
  if (owner.scrollWidth > owner.clientWidth + 1) {
    expect(["auto", "scroll"]).toContain(owner.overflowX);
  }
  expect(owner.x).toBeGreaterThanOrEqual(-1);
  expect(owner.right).toBeLessThanOrEqual(viewport.width + 1);
}
