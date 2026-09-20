/**
 * EXAM-582 confirmatory DOM probe (review discipline #494 §41): the visual
 * judges flagged two badge pills crossing table column borders. This probe
 * measures the live DOM to confirm or refute:
 *   1. /admin/users    — <Badge variant="outline"> (data-slot="badge") pill
 *                        考试管理员 in the 角色 column
 *   2. /admin/audit-logs — hand-rolled primary-soft span 分配课程教师 in the
 *                        操作 column
 * A finding is CONFIRMED when the pill rect's right edge exceeds its own
 * table cell's right edge (overflow into the adjacent cell).
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const OUT_DIR = process.env.PROBE_OUT_DIR ?? null;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
const login = await page.request.post(`${BASE_URL}/api/auth/login`, {
  data: { username: "admin", password: "admin123" },
});
const token = (login.headers()["set-cookie"] ?? "").match(
  /auth-token=([^;]+)/,
)?.[1];
if (!token) throw new Error("login failed");
await ctx.addCookies([{ name: "auth-token", value: token, url: BASE_URL }]);

async function probe(route, selector, text) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  return page.evaluate(
    ({ selector, text }) => {
      const pill = Array.from(document.querySelectorAll(selector)).find(
        (el) =>
          (el.textContent ?? "").trim() === text &&
          el.offsetParent !== null &&
          el.getBoundingClientRect().width > 0,
      );
      if (!pill) return { found: false, selector, text };
      const cell = pill.closest("td");
      const b = pill.getBoundingClientRect();
      const c = cell?.getBoundingClientRect() ?? null;
      const nextCell = cell?.nextElementSibling ?? null;
      const nextRect = nextCell?.getBoundingClientRect() ?? null;
      return {
        found: true,
        selector,
        text,
        badge: {
          x: +b.x.toFixed(1),
          right: +b.right.toFixed(1),
          width: +b.width.toFixed(1),
        },
        cellRight: c ? +c.right.toFixed(1) : null,
        cellWidth: c ? +c.width.toFixed(1) : null,
        badgeOverflowsCell: c ? b.right > c.right + 0.5 : null,
        overflowPx: c ? +(b.right - c.right).toFixed(1) : null,
        gapToAdjacentCellStart: nextRect
          ? +(nextRect.x - b.right).toFixed(1)
          : null,
        adjacentCellText: nextCell
          ? (nextCell.textContent ?? "").trim().slice(0, 24)
          : null,
      };
    },
    { selector, text },
  );
}

const results = [];
results.push({
  route: "/admin/users",
  probe: await probe(
    "/admin/users",
    '[data-slot="admin-table-shell"] [data-slot="badge"]',
    "考试管理员",
  ),
});
results.push({
  route: "/admin/audit-logs",
  probe: await probe(
    "/admin/audit-logs",
    '[data-slot="admin-table-shell"] span.bg-primary-soft',
    "分配课程教师",
  ),
});
await browser.close();

const payload = {
  probedAt: new Date().toISOString(),
  viewport: "1440x900",
  results,
};
if (OUT_DIR) {
  mkdirSync(join(OUT_DIR, "artifacts"), { recursive: true });
  writeFileSync(
    join(OUT_DIR, "artifacts", "badge-overflow-dom-probe.json"),
    JSON.stringify(payload, null, 2),
  );
}
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
