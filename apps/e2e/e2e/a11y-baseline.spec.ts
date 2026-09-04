import { test, expect, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { seedExam } from "../lib/seed";
import {
  candidateLogin,
  clickExamPrimaryAction,
  answerTrueFalse,
} from "../lib/flow";
import { loginAsAdmin } from "../lib/login";

/**
 * Product-wide accessibility baseline (Issue #307, UI-STABILIZATION-GOAL-1
 * G3). This is a BASELINE, not WCAG certification: automated axe scans on
 * representative surfaces (login, candidate exam list, take-exam runtime,
 * submit dialog, one admin form, one admin table) assert zero critical or
 * serious violations. Keyboard/focus behavior of the submit dialog is proven
 * in the dedicated keyboard test below; admin-dialog keyboard coverage lives
 * in recovery-operations-a11y.spec.ts.
 *
 * Moderate/minor findings are recorded but do not gate (they accumulate as
 * follow-up backlog); critical/serious gate at zero.
 */

async function scanCriticalAndSerious(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const gating = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  // Full per-node detail (every violation, gating or not) goes to the digest
  // file so non-gating findings surface as backlog without console output.
  const detail = results.violations
    .map((v) =>
      [
        `[a11y][${v.impact ?? "unknown"}] ${v.id}: ${v.nodes.length} node(s) — ${v.help}`,
        ...v.nodes.map((n) => {
          const data = (n as { data?: Record<string, unknown> }).data ?? {};
          const ratio = data.contrastRatio as number | undefined;
          const contrast =
            v.id === "color-contrast" && ratio !== undefined
              ? ` (fg=${String(data.fgColor)} bg=${String(data.bgColor)} ratio=${String(ratio)})`
              : "";
          return `  · target: ${n.target.join(" ")}${contrast} | ${n.html.slice(0, 160)}`;
        }),
      ].join("\n"),
    )
    .join("\n");
  const digest = gating
    .map(
      (v) =>
        `${v.id}[${v.impact}]: ${v.nodes
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
    )
    .join(" ;; ");
  // The blob reporter hides assertion messages in CI logs — persist the
  // violation detail next to the assertion for diagnosis.
  appendFileSync(
    "/tmp/a11y-digest.log",
    `${page.url()}\n${detail || "(clean)"}\n---\n`,
  );
  expect(
    gating,
    `critical/serious a11y violations on ${page.url()} — ${digest}`,
  ).toEqual([]);
}

test.describe("a11y automated baseline (representative surfaces)", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-layout")).toBeVisible();
    await scanCriticalAndSerious(page);
  });

  test("candidate exam list", async ({ page, request }) => {
    const seeded = await seedExam(request, "a11y-list", {
      questionAnswer: true,
    });
    await candidateLogin(page, seeded.candidate);
    await page.waitForURL(/\/exam\/list/);
    await expect(page.getByTestId(`exam-card-${seeded.examId}`)).toBeVisible();
    await scanCriticalAndSerious(page);
  });

  test("take-exam runtime and its submit dialog", async ({ page, request }) => {
    const seeded = await seedExam(request, "a11y-take", {
      questionAnswer: true,
    });
    await candidateLogin(page, seeded.candidate);
    await clickExamPrimaryAction(page, seeded.examId, "start");
    await page.waitForURL(/\/exam\/[^/]+\/start$/);
    await page.getByTestId("exam-start-btn").click();
    await page.waitForURL(/\/exam\/[^/]+\/take$/);
    await page.getByTestId("take-question-section").waitFor({
      state: "visible",
    });

    await scanCriticalAndSerious(page);

    // Open the submit dialog and scan the dialog state (Radix owns the trap).
    // The opening click triggers a pending-save flush: wait for the confirm
    // control to settle so the scan never samples a transient disabled state.
    await page.getByTestId("take-submit-btn").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("confirm-submit-btn")).toBeEnabled();
    // Let the enabled-state color transition (150ms) finish so axe samples a
    // settled paint, not a mid-transition blend.
    await page.waitForTimeout(300);
    await scanCriticalAndSerious(page);
  });

  test("admin settings form", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: /设置/ }).first(),
    ).toBeVisible();
    await scanCriticalAndSerious(page);
  });

  test("admin exam detail (table surface)", async ({ page, request }) => {
    const seeded = await seedExam(request, "a11y-admin", {
      questionAnswer: true,
    });
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${seeded.examId}`);
    await expect(
      page.getByRole("heading", { name: /.*/, level: 1 }),
    ).toBeVisible();
    await scanCriticalAndSerious(page);
  });
});

test.describe("a11y keyboard / focus evidence", () => {
  test("submit dialog: keyboard opens, focus traps inside, Escape restores focus", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const seeded = await seedExam(request, "a11y-kbd", {
      questionAnswer: true,
    });
    await candidateLogin(page, seeded.candidate);
    await clickExamPrimaryAction(page, seeded.examId, "start");
    await page.waitForURL(/\/exam\/[^/]+\/start$/);
    await page.getByTestId("exam-start-btn").click();
    await page.waitForURL(/\/exam\/[^/]+\/take$/);
    await page.getByTestId("take-question-section").waitFor({
      state: "visible",
    });

    // Keyboard-only: reach the submit control via Tab and open the dialog.
    const submitBtn = page.getByTestId("take-submit-btn");
    await expect(submitBtn).toBeVisible();
    for (let i = 0; i < 30; i++) {
      const focusedOnSubmit = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="take-submit-btn"]');
        return el instanceof HTMLElement && document.activeElement === el;
      });
      if (focusedOnSubmit) break;
      await page.keyboard.press("Tab");
    }
    const focusedOnSubmit = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="take-submit-btn"]');
      return el instanceof HTMLElement && document.activeElement === el;
    });
    expect(focusedOnSubmit).toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Focus moved into the dialog (Radix autofocus on first focusable).
    const insideDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(insideDialog).toBe(true);

    // Escape closes and Radix restores focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(submitBtn).toBeFocused();
  });
});
