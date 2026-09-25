/**
 * Recovery Attempt Detail: operator time grant — real browser vertical.
 *
 * Proves the browser composition of the Recovery Attempt Detail time-grant
 * flow on an in_progress attempt: the action renders for the operator, the
 * confirmation dialog names the operator consequence (为 … 的第 1 次答题延长
 * 10 分钟), the minutes + reason fields are filled, and the success toast
 * surfaces after confirming.
 *
 * The wire-level facts are owned at the API layer and are deliberately not
 * duplicated here: adjustment-ledger rows, effective-deadline arithmetic and
 * idempotent replay by routes/attempts/admin-time-grants.test.ts. The
 * lost-response / reload / same-operationId replay PROTOCOL is owned by the
 * shared PendingGrantCoordinator (unit tests + cross-tab-pending-grant E2E)
 * and the RecoveryAttemptDetailPage component tests.
 */
import { test, expect } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { candidateLoginApi, candidateStartAttempt } from "../lib/flow";

test.describe("Recovery attempt time grant", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    seeded = await seedExam(request, `time-grant-${Date.now()}`, {
      interruptionTimePolicy: "operator_incident",
    });
    const candidateToken = await candidateLoginApi(
      request,
      seeded.candidate.username,
      seeded.candidate.password,
    );
    attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );
  });

  test("grants 10 minutes from the operations UI with a required reason and success toast", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${attemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", { timeout: 15_000 });

    // Operations section renders time_grant for an in_progress attempt.
    await expect(
      page.getByRole("button", { name: "延长答题时间" }),
    ).toBeVisible({
      timeout: 15_000,
    });

    // The grant dialog names the operator consequence.
    await page.getByRole("button", { name: "延长答题时间" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(/为 .+ 的第 1 次答题延长 10 分钟/),
    ).toBeVisible();
    // Explicitly fill the minutes field (do not rely on the page default).
    await dialog.getByLabel("延长时间（分钟）").fill("10");
    await dialog.getByLabel("原因说明").fill("网络中断补偿");
    await dialog.getByRole("button", { name: "延长答题时间" }).click();

    await expect(page.getByText("已延长答题时间").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
