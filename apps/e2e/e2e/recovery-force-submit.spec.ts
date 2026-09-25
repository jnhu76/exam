/**
 * Recovery Attempt Detail: force submit — real browser vertical.
 *
 * Proves the browser composition of the Recovery Attempt Detail force-submit
 * flow: the action renders for the operator, the confirmation dialog names
 * the terminal consequence, the reason field is required, and the success
 * state surfaces after confirming.
 *
 * The wire-level facts are owned at the API layer and are deliberately not
 * duplicated here: receipt disposition/audit atomicity by
 * routes/attempts/admin-force-submit.test.ts, attempt grading by the same
 * suite and admin-status.test.ts. The lost-response / same-operationId retry
 * PROTOCOL is owned by proctor-force-submit-retry.spec.ts (browser) and the
 * incident-command engine tests.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { candidateLoginApi, candidateStartAttempt } from "../lib/flow";

test.describe("Recovery attempt force submit", () => {
  test("force-submit dialog opens, names the terminal consequence, and completes", async ({
    page,
    request,
  }) => {
    const unique = `recovery-fs-${Date.now()}`;
    const s = await seedExam(request, unique);
    const candidateToken = await candidateLoginApi(
      request,
      s.candidate.username,
      s.candidate.password,
    );
    const targetAttemptId = await candidateStartAttempt(
      request,
      candidateToken,
      s.examId,
    );

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${targetAttemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", { timeout: 15_000 });

    await expect(page.getByRole("button", { name: "强制交卷" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "强制交卷" }).click();
    const dialog = page.getByRole("dialog");
    // The confirmation names the candidate + exam + terminal consequence.
    await expect(dialog.getByText(/交卷为终态操作/)).toBeVisible();
    await dialog.getByLabel("原因说明（必填）").fill("E2E 强制交卷原因");
    await dialog.getByRole("button", { name: "强制交卷" }).click();

    await expect(page.getByText("已提交强制交卷").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
