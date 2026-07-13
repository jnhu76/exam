import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const output = process.env.OPTICAL_CROPS ?? "/tmp/ui-optical-finish/crops";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-gpu", "--force-device-scale-factor=1"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();

await page.goto(`${baseURL}/login`);
await page.getByLabel(/用户名/).fill(process.env.E2E_ADMIN_USERNAME ?? "admin");
await page
  .getByLabel(/密码/)
  .fill(process.env.E2E_ADMIN_PASSWORD ?? "admin123");
await page.getByRole("button", { name: /^登录$/ }).click();
await page.waitForURL(/\/admin\/dashboard/);

async function go(route) {
  await page.evaluate((nextRoute) => {
    window.history.pushState({}, "", nextRoute);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0, 0);
  }, route);
  await page.getByTestId("admin-layout").waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width - 1, 0);
}

async function crop(name, locator) {
  await locator.screenshot({ path: path.join(output, `${name}.png`) });
}

await go("/admin/dashboard");
await crop(
  "dashboard-stats-card",
  page.locator('[data-slot="stats-card"]').first(),
);
await crop("dashboard-table", page.locator('[data-slot="admin-table-shell"]'));
await crop("sidebar-active-inactive", page.getByTestId("app-sidebar"));
await page.getByRole("button", { name: /创建考试/ }).hover();
await crop("button-hover", page.getByRole("button", { name: /创建考试/ }));

await go("/admin/exams");
const examShell = page.locator('[data-slot="admin-table-shell"]');
const examRow = examShell
  .locator('[data-slot="table-body"] [data-slot="table-row"]')
  .first();
await crop("exam-table-default", examShell);
await examRow.hover();
await crop("exam-row-hover", examRow);
const examAction = examRow
  .locator('[data-slot="row-actions"] [data-slot="button"]')
  .first();
await examAction.hover();
await crop("exam-action-hover", examRow);
await examAction.focus();
await crop("exam-action-keyboard-focus", examRow);

await go("/admin/questions");
const questionToolbar = page.getByRole("toolbar");
await crop("question-toolbar", questionToolbar);
const questionInput = questionToolbar.locator("input").first();
await questionInput.focus();
await crop("question-input-focus", questionToolbar);
const questionRow = page
  .locator('[data-slot="table-body"] [data-slot="table-row"]')
  .first();
await crop("question-tags-actions", questionRow);

await go("/admin/courses");
await crop("course-toolbar", page.getByRole("toolbar"));
await crop("course-table", page.locator('[data-slot="admin-table-shell"]'));

await go("/admin/candidates");
await crop("candidate-table", page.locator('[data-slot="admin-table-shell"]'));

await go("/admin/users");
await crop(
  "user-sparse-table",
  page.locator('[data-slot="admin-table-shell"]'),
);

await go("/admin/system");
await crop(
  "system-metric-card",
  page.locator('[data-slot="stats-card"]').first(),
);
await crop(
  "system-information-card",
  page.locator('[data-diagnostic-role="information"]').first(),
);
await crop(
  "system-scanner-card",
  page.locator('[data-diagnostic-role="scanner"]').first(),
);

await page.setViewportSize({ width: 420, height: 1000 });
await go("/admin/questions");
const mobileRegion = page.locator('[data-slot="table-scroll-region"]');
const mobileShell = page.locator('[data-slot="admin-table-shell"]');
await crop("table-scroll-start", mobileShell);
await mobileRegion.evaluate((region) => {
  region.scrollLeft = (region.scrollWidth - region.clientWidth) / 2;
  region.dispatchEvent(new Event("scroll", { bubbles: true }));
});
await page.waitForTimeout(150);
await crop("table-scroll-middle", mobileShell);
await mobileRegion.evaluate((region) => {
  region.scrollLeft = region.scrollWidth;
  region.dispatchEvent(new Event("scroll", { bubbles: true }));
});
await page.waitForTimeout(150);
await crop("table-scroll-end", mobileShell);

const runtime = await page.evaluate(() => {
  const region = document.querySelector('[data-slot="table-scroll-region"]');
  return {
    dpr: window.devicePixelRatio,
    zoom: getComputedStyle(document.documentElement).zoom,
    documentOverflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    tableOverflowOwner: region?.getAttribute("data-overflow-owner"),
    overflowing: region?.getAttribute("data-overflowing"),
    scrollStart: region?.getAttribute("data-scroll-start"),
    scrollEnd: region?.getAttribute("data-scroll-end"),
  };
});
await writeFile(
  path.join(output, "runtime.json"),
  JSON.stringify(runtime, null, 2),
);

await context.close();
await browser.close();
