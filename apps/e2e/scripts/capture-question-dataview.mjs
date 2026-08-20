/**
 * UI-TOKEN-TABLE-FOUNDATION-1 — Playwright capture for the QuestionPage DataView.
 *
 * Captures the §11/§12 required screenshots (4 widths × interaction states,
 * DPR 1, zoom 100%) against the real QuestionPage route, and writes a manifest
 * recording the browser/viewport/DPR/seed/API+Web addresses/command per shot.
 *
 * Prerequisites (a full stack must be running):
 *   docker compose -f docker-compose.dev.yml up -d
 *   pnpm db:migrate && pnpm db:seed:demo     # seeds the dev DB (exam)
 *   pnpm --filter api dev                     # http://localhost:3000
 *   pnpm --filter web dev                     # http://localhost:5173
 *   node apps/e2e/scripts/capture-question-dataview.mjs
 *
 * Output: /tmp/ui-question-dataview/ (PNGs + manifest.json, NOT committed).
 *
 * Env overrides: QD_BASE_URL (default http://localhost:5173),
 *                QD_API_URL, QD_ADMIN_USER, QD_ADMIN_PASS, QD_OUTPUT.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.QD_BASE_URL ?? "http://localhost:5173";
const apiURL = process.env.QD_API_URL ?? "http://localhost:3000";
const adminUser = process.env.QD_ADMIN_USER ?? "admin";
const adminPass = process.env.QD_ADMIN_PASS ?? "admin123";
const outputRoot = process.env.QD_OUTPUT ?? "/tmp/ui-question-dataview";

const dpr1 = { deviceScaleFactor: 1 };
const WIDTHS = [1440, 1024, 768, 420];

async function loginAndSaveState(browser) {
  const ctx = await browser.newContext({ ...dpr1 });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByLabel(/用户名/).fill(adminUser);
  await page.getByLabel(/密码/).fill(adminPass);
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/admin\/dashboard/);
  const statePath = path.join(outputRoot, ".qd-state.json");
  await ctx.storageState({ path: statePath });
  await ctx.close();
  return statePath;
}

async function openPage(browser, statePath, viewport) {
  const ctx = await browser.newContext({
    viewport,
    storageState: statePath,
    ...dpr1,
  });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/admin/questions`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  // Force zoom 100% / disable animations for deterministic captures.
  await page.addStyleTag({
    content: `* { transition: none !important; animation: none !important; }`,
  });
  return { ctx, page };
}

async function snap(page, ctx, name) {
  await page.screenshot({ path: path.join(outputRoot, `${name}.png`) });
  return name;
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const browser = await chromium.launch();
  process.stdout.write("logging in…\n");
  const statePath = await loginAndSaveState(browser);
  const manifest = {
    baseURL,
    apiURL,
    browser: chromium.name?.() ?? "chromium",
    dpr: 1,
    zoom: 1,
    seed: "pnpm db:seed:demo (dev DB exam)",
    command: "node apps/e2e/scripts/capture-question-dataview.mjs",
    shots: [],
  };

  const record = (name, width, state) =>
    manifest.shots.push({ file: `${name}.png`, width, state });

  for (const width of WIDTHS) {
    // ── default state
    {
      const { ctx, page } = await openPage(browser, statePath, {
        width,
        height: 1000,
      });
      const view = width < 1024 ? "mobile-card" : "desktop-table";
      await snap(page, ctx, `${width}-default`);
      record(`${width}-default`, width, `default (${view})`);
      await ctx.close();
    }

    // ── search focus + typing (desktop widths only have the search box in toolbar)
    if (width >= 1024) {
      const { ctx, page } = await openPage(browser, statePath, {
        width,
        height: 1000,
      });
      const search = page.getByLabel(/搜索题目/);
      await search.focus();
      await snap(page, ctx, `${width}-search-focus`);
      record(`${width}-search-focus`, width, "search focus");
      await search.fill("光合");
      await snap(page, ctx, `${width}-search-typing`);
      record(
        `${width}-search-typing`,
        width,
        "search typing (debounce pending)",
      );
      await page.waitForTimeout(500); // debounce + query settle
      await snap(page, ctx, `${width}-search-results`);
      record(`${width}-search-results`, width, "search results");
      await ctx.close();
    }

    // ── search no-results
    if (width >= 1024) {
      const { ctx, page } = await openPage(browser, statePath, {
        width,
        height: 1000,
      });
      await page.getByLabel(/搜索题目/).fill("__zzz_no_match_zzz__");
      await page.waitForTimeout(500);
      await snap(page, ctx, `${width}-search-no-results`);
      record(`${width}-search-no-results`, width, "search no results");
      await ctx.close();
    }

    // ── filter dropdown open (the previously-jittery interaction)
    if (width >= 1024) {
      const { ctx, page } = await openPage(browser, statePath, {
        width,
        height: 1000,
      });
      await page
        .getByRole("button", { name: /题型|筛选/ })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(150);
      await snap(page, ctx, `${width}-filter-open`);
      record(`${width}-filter-open`, width, "filter dropdown open");
      await ctx.close();
    }

    // ── row hover (desktop) / card (mobile)
    {
      const { ctx, page } = await openPage(browser, statePath, {
        width,
        height: 1000,
      });
      const rowOrCard =
        width < 1024
          ? page.locator('[data-slot="mobile-record-card"]').first()
          : page
              .locator('[data-slot="table-body"] [data-slot="table-row"]')
              .first();
      await rowOrCard.hover().catch(() => {});
      await page.waitForTimeout(150);
      await snap(page, ctx, `${width}-hover`);
      record(
        `${width}-hover`,
        width,
        width < 1024 ? "card hover" : "row hover",
      );
      await ctx.close();
    }

    // ── keyboard focus-visible
    if (width >= 1024) {
      const { ctx, page } = await openPage(browser, statePath, {
        width,
        height: 1000,
      });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await snap(page, ctx, `${width}-keyboard-focus`);
      record(`${width}-keyboard-focus`, width, "keyboard focus-visible");
      await ctx.close();
    }
  }

  // ── pagination (desktop, only meaningful if >1 page)
  {
    const { ctx, page } = await openPage(browser, statePath, {
      width: 1440,
      height: 1000,
    });
    const next = page.getByRole("button", { name: /下一页/ });
    // A visible-but-disabled next button (single-page data) must follow the
    // single-page snapshot path; only an enabled button advances to page 2.
    // (CodeRabbit R4 — previously clicked a disabled button and hung.)
    if (
      (await next.isVisible().catch(() => false)) &&
      (await next.isEnabled().catch(() => false))
    ) {
      await next.click();
      await page.waitForTimeout(400);
      await snap(page, ctx, `1440-pagination`);
      record(`1440-pagination`, 1440, "pagination page 2");
    } else {
      await snap(page, ctx, `1440-pagination-single`);
      record(`1440-pagination-single`, 1440, "pagination (single page)");
    }
    await ctx.close();
  }

  await writeFile(
    path.join(outputRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await browser.close();
  process.stdout.write(
    `capture complete → ${outputRoot} (${manifest.shots.length} shots)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err}\n`);
  process.exit(1);
});
