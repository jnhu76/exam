import { test, expect, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { seedExam } from "../lib/seed";
import { candidateLogin, clickExamPrimaryAction } from "../lib/flow";

/**
 * Application-level accessibility smoke. The automated axe scan on the
 * critical candidate take-exam runtime — including its submit dialog — gates
 * critical and serious violations at zero. This is a smoke, not WCAG
 * certification: broader surface-by-surface duplication is deliberately not
 * maintained here.
 *
 * Focus-ring rendering is owned by the surface recipe tests; dialog focus
 * behavior by the dialog component tests and (where the real browser focus
 * mechanism is material) rich-editor-input-boundaries.spec.ts.
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

test.describe("a11y application smoke", () => {
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
});
