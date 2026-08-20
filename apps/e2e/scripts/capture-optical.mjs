import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outputRoot =
  process.env.OPTICAL_OUTPUT ?? "/tmp/ui-optical-finish/before";
const widths = (process.env.OPTICAL_WIDTHS ?? "1024,1280,1440,1920")
  .split(",")
  .map(Number);
const routeFilter = new Set(
  (process.env.OPTICAL_ROUTES ?? "")
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean),
);
const allRoutes = [
  ["dashboard", "/admin/dashboard"],
  ["exams", "/admin/exams"],
  ["questions", "/admin/questions"],
  ["courses", "/admin/courses"],
  ["candidates", "/admin/candidates"],
  ["users", "/admin/users"],
  ["system", "/admin/system"],
];
const routes = routeFilter.size
  ? allRoutes.filter(([name]) => routeFilter.has(name))
  : allRoutes;

async function login(page) {
  await page.goto(`${baseURL}/login`);
  await page
    .getByLabel(/用户名/)
    .fill(process.env.E2E_ADMIN_USERNAME ?? "admin");
  await page
    .getByLabel(/密码/)
    .fill(process.env.E2E_ADMIN_PASSWORD ?? "admin123");
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/admin\/dashboard/);
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("admin-layout").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    document.documentElement.style.zoom = "1";
  });
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width - 1, 0);
  await page.waitForTimeout(250);
}

async function measure(page) {
  return page.evaluate(() => {
    const style = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const value = getComputedStyle(element);
      return {
        background: value.backgroundColor,
        border: value.borderColor,
        borderRadius: value.borderRadius,
        boxShadow: value.boxShadow,
        color: value.color,
        fontSize: value.fontSize,
        fontWeight: value.fontWeight,
        lineHeight: value.lineHeight,
      };
    };
    const root = getComputedStyle(document.documentElement);
    const tokens = [
      "--bg",
      "--surface",
      "--surface-muted",
      "--surface-hover",
      "--text",
      "--text-secondary",
      "--text-muted",
      "--text-subtle",
      "--border-shell",
      "--border-header",
      "--border-row",
      "--border-control",
      "--primary",
      "--primary-hover",
      "--primary-active",
      "--primary-soft",
      "--primary-soft-strong",
      "--primary-focus",
    ];
    return {
      tokens: Object.fromEntries(
        tokens.map((token) => [token, root.getPropertyValue(token).trim()]),
      ),
      canvas: style("body"),
      surface: style('[data-slot="admin-table-shell"]'),
      toolbar: style('[role="toolbar"]'),
      tableHeader: style('[data-slot="table-header"]'),
      tableRow: style('[data-slot="table-body"] [data-slot="table-row"]'),
      control: style("input"),
      statsCard: style('[data-slot="stats-card"]'),
      status: style('[data-slot="status-badge"]'),
      tag: style('[data-slot="tag-badge"]'),
      rowAction: style('[data-slot="row-actions"] [data-slot="button"]'),
    };
  });
}

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-gpu", "--force-device-scale-factor=1"],
});
const measurements = {};
const context = await browser.newContext({
  viewport: { width: widths[0] ?? 1280, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
await login(page);

for (const width of widths) {
  await page.setViewportSize({ width, height: 1000 });
  for (const [name, route] of routes) {
    await page.evaluate((nextRoute) => {
      window.history.pushState({}, "", nextRoute);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, route);
    await settle(page);
    await page.screenshot({
      path: path.join(outputRoot, `${name}-${width}.png`),
      fullPage: false,
    });
    if (width === 1440) measurements[name] = await measure(page);
  }
}

await writeFile(
  path.join(outputRoot, "measurements.json"),
  JSON.stringify(measurements, null, 2),
);
await context.close();
await browser.close();
