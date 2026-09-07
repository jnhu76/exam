/**
 * UI-MULTIMODAL-PATROL shared fixtures and DOM fact collectors (#494).
 *
 * Both patrol specs import from this module: user fixtures (created via the
 * Admin product API) and the single implementation of the shell/table DOM
 * metadata collector that every patrol screenshot carries. Keeping one
 * collector is what makes comparison sets interpretable — every tile in a
 * sheet is accompanied by the same DOM facts.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, APIRequestContext } from "@playwright/test";

export const PATROL_BASE_URL =
  process.env.E2E_BASE_URL ?? "http://localhost:3001";

/** Patrol run progress goes to the run's output dir, never to the console —
 * the repo code-quality gate treats console output as a violation and CI
 * parses artifacts, not stdout. Callers own creating `outputDir` first. */
export function progressLog(outputDir: string, message: string): void {
  appendFileSync(
    join(outputDir, "progress.log"),
    `${new Date().toISOString()} ${message}\n`,
  );
}

/** Create a staff user through the admin API and return its login fixture. */
export async function createUserViaApi(
  request: APIRequestContext,
  token: string,
  role: string,
  namePrefix: string,
): Promise<{
  username: string;
  password: string;
  name: string;
  userId: string;
}> {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const username = `patrol-${namePrefix}-${stamp}-${rand}`;
  const password = `${namePrefix}123`;
  const name = `Patrol ${namePrefix} ${rand}`;

  const res = await request.post(`${PATROL_BASE_URL}/api/users`, {
    headers: { Cookie: `auth-token=${token}` },
    data: { username, password, name, role },
  });
  if (!res.ok()) {
    throw new Error(
      `create ${role} failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: string };
  return { username, password, name, userId: body.id };
}

/** Assign a user to a course through the admin API. */
export async function assignUserToCourse(
  request: APIRequestContext,
  token: string,
  userId: string,
  courseId: string,
): Promise<void> {
  const res = await request.post(
    `${PATROL_BASE_URL}/api/admin/users/${userId}/course-assignments`,
    {
      headers: { Cookie: `auth-token=${token}` },
      data: { courseId },
    },
  );
  if (!res.ok()) {
    throw new Error(
      `assign to course failed: ${res.status()} ${await res.text()}`,
    );
  }
}

export interface NavShellFacts {
  sidebar: { x: number; y: number; width: number; height: number } | null;
  region: { x: number; y: number; width: number; height: number } | null;
  footer: { x: number; y: number; width: number; height: number } | null;
  nav: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  } | null;
  currentCount: number;
  currentHrefs: string[];
  currentRects: Array<{ x: number; y: number; width: number; height: number }>;
  groupLabels: string[];
  hrefs: string[];
  overflowState: {
    overflowing: string | null;
    atStart: string | null;
    atEnd: string | null;
  } | null;
}

export interface TableShellFacts {
  archetype: string | null;
  tier: string | null;
  containerWidth: number;
  clientWidth: number | null;
  scrollWidth: number | null;
  overflowing: boolean | null;
  atStart: string | null;
  atEnd: string | null;
  hintRect: { x: number; y: number; width: number; height: number } | null;
  hintInViewport: boolean;
}

/** NAV-1…NAV-5 + table (#494 §30) DOM facts for the current document.
 * Returns nulls on layouts without the admin sidebar (candidate runtime). */
export async function collectShellFacts(page: Page): Promise<{
  nav: NavShellFacts | null;
  tables: TableShellFacts[];
  document: {
    clientWidth: number;
    scrollWidth: number;
    horizontalOverflow: boolean;
  };
}> {
  return page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const shell = document.querySelector(
      '[data-testid="app-sidebar"]',
    ) as HTMLElement | null;
    // Below lg the desktop sidebar is CSS-hidden but still mounted — its
    // rects are all zero and would poison the comparison metadata. The
    // drawer is the nav authority there; its facts are captured when open.
    const shellVisible = shell != null && shell.offsetParent !== null;
    const region = shell?.querySelector('[data-slot="nav-scroll-region"]');
    const nav = shell?.querySelector<HTMLElement>("nav");
    const currents = Array.from(
      shell?.querySelectorAll<HTMLElement>('a[aria-current="page"]') ?? [],
    );
    const navFacts = shellVisible
      ? {
          sidebar: rect(shell),
          region: rect(region ?? null),
          footer: rect(
            shell!.querySelector('[data-testid="sidebar-footer"]') ?? null,
          ),
          nav: nav
            ? {
                clientHeight: nav.clientHeight,
                scrollHeight: nav.scrollHeight,
                scrollTop: nav.scrollTop,
              }
            : null,
          currentCount: currents.length,
          currentHrefs: currents.map((el) => el.getAttribute("href") ?? ""),
          currentRects: currents.map((el) => rect(el)!),
          groupLabels: Array.from(
            shell!.querySelectorAll('[data-testid="nav-group-label"]'),
          ).map((el) => (el.textContent ?? "").trim()),
          hrefs: Array.from(
            shell!.querySelectorAll<HTMLAnchorElement>("nav a[href]"),
          ).map((el) => el.getAttribute("href") ?? ""),
          overflowState: region
            ? {
                overflowing: region.getAttribute("data-overflowing"),
                atStart: region.getAttribute("data-at-start"),
                atEnd: region.getAttribute("data-at-end"),
              }
            : null,
        }
      : null;

    const tables = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="admin-table-shell"]'),
    ).map((shellEl) => {
      const scroll = shellEl.querySelector<HTMLElement>(
        '[data-slot="table-scroll-region"]',
      );
      const hint = shellEl.querySelector('[data-slot="table-scroll-hint"]');
      const hintRect = hint?.getBoundingClientRect();
      const overflowing =
        scroll != null ? scroll.scrollWidth > scroll.clientWidth + 1 : null;
      return {
        archetype: shellEl.getAttribute("data-table-archetype"),
        tier: shellEl.getAttribute("data-table-tier"),
        containerWidth: shellEl.getBoundingClientRect().width,
        clientWidth: scroll?.clientWidth ?? null,
        scrollWidth: scroll?.scrollWidth ?? null,
        overflowing,
        atStart: scroll?.getAttribute("data-scroll-start") ?? null,
        atEnd: scroll?.getAttribute("data-scroll-end") ?? null,
        hintRect: hintRect
          ? {
              x: hintRect.x,
              y: hintRect.y,
              width: hintRect.width,
              height: hintRect.height,
            }
          : null,
        hintInViewport:
          hintRect != null &&
          hintRect.y + hintRect.height > 0 &&
          hintRect.y < window.innerHeight,
      };
    });

    const doc = document.documentElement;
    return {
      nav: navFacts,
      tables,
      document: {
        clientWidth: doc.clientWidth,
        scrollWidth: doc.scrollWidth,
        horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      },
    };
  });
}
