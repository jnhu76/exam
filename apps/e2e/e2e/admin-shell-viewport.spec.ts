import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";

/**
 * MVP-P2-04 closeout — Admin shell viewport scrolling (geometry assertions,
 * not screenshots).
 *
 * Desktop contract: the aside is a viewport-attached flex item
 * (sticky top-0 h-screen self-start) whose nav region scrolls independently;
 * logout stays reachable without scrolling the document; the topbar pins to
 * the viewport while main content scrolls. Breakpoints: >=xl expanded,
 * lg..<xl collapsed rail, <lg Sheet drawer (SidebarContent reuse regression).
 */
const LOGOUT_NAME = "退出登录";

async function assertViewportAttached(
  box: { x: number; y: number; height: number },
  viewportHeight: number,
): Promise<void> {
  // Sticky top-0: the sidebar's top edge is the viewport top.
  expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
  // h-screen: the sidebar fills the viewport height (normal browser rounding).
  expect(Math.abs(box.height - viewportHeight)).toBeLessThanOrEqual(1);
}

async function navScrollInfo(sidebar: ReturnType<Page["getByTestId"]>) {
  return sidebar.locator("nav").evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
}

async function scrollNavToBottom(sidebar: ReturnType<Page["getByTestId"]>) {
  await sidebar.locator("nav").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
}

test.describe("admin shell viewport scrolling (MVP-P2-04)", () => {
  test("1440x900 expanded sidebar: viewport-attached aside, independent nav scroll, reachable logout, pinned topbar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    // Long admin page so the main document actually scrolls below the fold.
    await page.goto("/admin/operations");

    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    const viewport = page.viewportSize()!;
    await assertViewportAttached(
      (await sidebar.boundingBox())!,
      viewport.height,
    );

    // Topbar is pinned at the viewport top (sticky).
    const topbar = page.getByTestId("admin-layout").locator("header");
    await expect(topbar).toBeVisible();
    expect(Math.abs((await topbar.boundingBox())!.y)).toBeLessThanOrEqual(1);

    // The nav region has its own vertical scroll (content exceeds the
    // viewport-constrained aside).
    const before = await navScrollInfo(sidebar);
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    // Scrolling the nav reveals 管理 items while the document stays at top.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await scrollNavToBottom(sidebar);
    await expect(
      page.getByTestId("nav-group-label").filter({ hasText: "管理" }),
    ).toBeVisible();

    // Logout is reachable inside the sidebar without scrolling the document.
    const logoutBox = (await page
      .getByRole("button", { name: LOGOUT_NAME })
      .boundingBox())!;
    expect(logoutBox.y + logoutBox.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // The main page scrolls; the sidebar and topbar stay attached to the
    // viewport while content moves under them.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight > window.innerHeight,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 400));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await assertViewportAttached(
      (await sidebar.boundingBox())!,
      viewport.height,
    );
    expect(Math.abs((await topbar.boundingBox())!.y)).toBeLessThanOrEqual(1);
  });

  test("1280x720 expanded sidebar: same viewport-attachment contract", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);
    await page.goto("/admin/operations");

    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    const viewport = page.viewportSize()!;
    await assertViewportAttached(
      (await sidebar.boundingBox())!,
      viewport.height,
    );

    const topbar = page.getByTestId("admin-layout").locator("header");
    expect(Math.abs((await topbar.boundingBox())!.y)).toBeLessThanOrEqual(1);

    const nav = await navScrollInfo(sidebar);
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight);

    await scrollNavToBottom(sidebar);
    await expect(
      page.getByTestId("nav-group-label").filter({ hasText: "管理" }),
    ).toBeVisible();
    const logoutBox = (await page
      .getByRole("button", { name: LOGOUT_NAME })
      .boundingBox())!;
    expect(logoutBox.y + logoutBox.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
  });

  test("1024x768 collapsed rail: rail stays viewport-attached, logout reachable via internal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await loginAsAdmin(page);
    await page.goto("/admin/operations");

    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    const viewport = page.viewportSize()!;
    await assertViewportAttached(
      (await sidebar.boundingBox())!,
      viewport.height,
    );

    // Collapsed rail: width is the 56px icon rail (lg..<xl contract).
    expect(
      Math.abs((await sidebar.boundingBox())!.width - 56),
    ).toBeLessThanOrEqual(1);

    const nav = await navScrollInfo(sidebar);
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight);

    await scrollNavToBottom(sidebar);
    const logoutBox = (await page
      .getByRole("button", { name: LOGOUT_NAME })
      .boundingBox())!;
    expect(logoutBox.y + logoutBox.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
  });

  test("390x844 mobile: Sheet drawer open/scroll/navigate/close/focus-restore/logout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);

    // Below lg the desktop aside is hidden; the drawer is the nav surface.
    await expect(page.getByTestId("app-sidebar")).toBeHidden();

    const trigger = page.getByTestId("mobile-nav-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const drawer = page.getByTestId("mobile-nav-drawer");
    await expect(drawer).toBeVisible();

    // The drawer reuses SidebarContent: its nav region scrolls independently.
    const nav = await drawer.locator("nav").evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(nav.scrollHeight).toBeGreaterThan(nav.clientHeight);

    // Logout stays reachable when the nav is scrolled to the bottom.
    await drawer.locator("nav").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(
      drawer.getByRole("button", { name: "退出登录" }),
    ).toBeVisible();

    // Navigate inside the drawer: it closes automatically after routing.
    await drawer.getByRole("link", { name: "考试管理" }).click();
    await expect(page).toHaveURL(/\/admin\/exams(?:$|[?#])/);
    await expect(drawer).toBeHidden();

    // Focus restore: the menu trigger regains focus when the drawer closes.
    await expect(trigger).toBeFocused();

    // Reopen and log out through the drawer.
    await trigger.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login(?:$|[?#])/);
  });
});
