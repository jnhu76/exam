/**
 * Recovery Attempt Detail: misconduct mark — real browser vertical.
 *
 * Drives the REAL recovery attempt page + the REAL misconduct
 * durable-command endpoint: a misconduct mark with severity + notes applies;
 * the receipt disposition is `applied`, the recovery aggregate projection
 * shows the flag (server truth), the `attempt.misconductFlagged` audit
 * exists, and the attempt remains live.
 *
 * The lost-response / same-operationId retry PROTOCOL (frozen payload,
 * idempotent replay, one receipt) is owned by
 * proctor-dashboard-misconduct-retry.spec.ts (browser) and the engine tests;
 * this spec only proves the Recovery caller wiring end-to-end.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Recovery attempt misconduct mark", () => {
  async function countMisconductAudits(
    request: import("@playwright/test").APIRequestContext,
    token: string,
    targetAttemptId: string,
  ): Promise<number> {
    const res = await request.get(
      `/api/admin/audit-logs?action=attempt.misconductFlagged&pageSize=50`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      items: Array<{ targetId: string; action: string }>;
    };
    return body.items.filter(
      (i) =>
        i.action === "attempt.misconductFlagged" &&
        i.targetId === targetAttemptId,
    ).length;
  }

  async function attemptProjection(
    request: import("@playwright/test").APIRequestContext,
    token: string,
    targetAttemptId: string,
  ): Promise<{ attempt: { misconduct: boolean; status: string } }> {
    const res = await request.get(
      `/api/admin/recovery/attempts/${targetAttemptId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(res.ok()).toBe(true);
    return res.json() as Promise<{
      attempt: { misconduct: boolean; status: string };
    }>;
  }

  test("misconduct mark applies with a receipt, projection + audit, attempt stays live", async ({
    page,
    request,
  }) => {
    const unique = `recovery-mis-${Date.now()}`;
    const s = await seedExam(request, unique);
    const token = await adminApiToken(request);
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

    let capturedDisposition = "";
    await page.route("**/api/admin/attempts/*/misconduct", async (route) => {
      const response = await route.fetch();
      const parsed = (await response.json()) as { disposition?: string };
      capturedDisposition = parsed.disposition ?? "";
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(parsed),
      });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${targetAttemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", { timeout: 15_000 });

    await expect(page.getByRole("button", { name: "标记违规" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "标记违规" }).click();
    const dialog = page.getByRole("dialog");
    // The confirmation names the candidate + exam.
    await expect(dialog.getByText(/标记为违规/)).toBeVisible();
    await dialog.getByLabel("违规说明").fill("E2E 违规标记说明");
    await dialog.getByRole("button", { name: "标记违规" }).click();

    await expect(page.getByText("已标记违规").first()).toBeVisible({
      timeout: 15_000,
    });
    expect(capturedDisposition).toBe("applied");

    // Server truth: projection shows the flag; one audit; attempt still live.
    const projection = await attemptProjection(request, token, targetAttemptId);
    expect(projection.attempt.misconduct).toBe(true);
    expect(projection.attempt.status).toBe("in_progress");
    expect(await countMisconductAudits(request, token, targetAttemptId)).toBe(
      1,
    );
  });
});
