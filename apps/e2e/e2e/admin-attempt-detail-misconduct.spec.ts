/**
 * Admin attempt detail: misconduct flag — real browser vertical (#524).
 *
 * Drives the REAL admin attempt-detail page (the stale caller that always
 * received 400 VALIDATION_ERROR before the dialog-frozen operationId fix):
 * open the misconduct dialog from `/admin/attempts/:id`, submit, and prove
 * the request now carries an operationId and is ACCEPTED — receipt
 * disposition `applied`, the misconduct projection is set, one
 * `attempt.misconductFlagged` audit exists, and the attempt stays live.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Admin attempt detail misconduct flag (#524)", () => {
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

  test("flag from /admin/attempts/:id carries operationId and is accepted", async ({
    page,
    request,
  }) => {
    const unique = `attempt-detail-mis-${Date.now()}`;
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
    let capturedBody: Record<string, unknown> = {};
    await page.route("**/api/admin/attempts/*/misconduct", async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
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
    await page.goto(`/admin/attempts/${targetAttemptId}`);
    await page.waitForURL("**/admin/attempts/**", { timeout: 15_000 });

    await expect(page.getByRole("button", { name: "标记违规" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "标记违规" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("违规说明").fill("E2E 违规标记说明");
    await dialog.getByRole("button", { name: "确认标记" }).click();

    await expect(page.getByText("已标记违规").first()).toBeVisible({
      timeout: 15_000,
    });
    // The previously-400 request now satisfies the operationId contract.
    expect(typeof capturedBody.operationId).toBe("string");
    expect(capturedBody.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(capturedBody.severity).toBe("warning");
    expect(capturedDisposition).toBe("applied");

    // Server truth: projection shows the flag; one audit; attempt still live.
    const projectionRes = await request.get(
      `/api/admin/recovery/attempts/${targetAttemptId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(projectionRes.ok()).toBe(true);
    const projection = (await projectionRes.json()) as {
      attempt: { misconduct: boolean; status: string };
    };
    expect(projection.attempt.misconduct).toBe(true);
    expect(projection.attempt.status).toBe("in_progress");
    expect(await countMisconductAudits(request, token, targetAttemptId)).toBe(
      1,
    );
  });
});
