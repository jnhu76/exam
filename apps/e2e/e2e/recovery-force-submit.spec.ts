/**
 * Recovery Attempt Detail: force submit — real browser vertical.
 *
 * Drives the REAL Recovery Attempt Detail operations UI + the REAL
 * force-submit endpoint: a live attempt is force-submitted with a canonical
 * reason; the receipt disposition is `applied`, exactly ONE force-submit
 * audit exists, and the authoritative reload shows the attempt graded.
 *
 * The lost-response / same-operationId retry PROTOCOL is owned by
 * proctor-force-submit-retry.spec.ts (browser) and the incident-command
 * engine tests; this spec only proves the Recovery caller wiring end-to-end.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Recovery attempt force submit", () => {
  async function countForceSubmitAudits(
    request: import("@playwright/test").APIRequestContext,
    token: string,
    targetAttemptId: string,
  ): Promise<number> {
    const res = await request.get(
      `/api/admin/audit-logs?action=attempt.forceSubmit&targetId=${targetAttemptId}&pageSize=50`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      items: Array<{ targetId: string; action: string }>;
    };
    return body.items.filter(
      (i) =>
        i.action === "attempt.forceSubmit" && i.targetId === targetAttemptId,
    ).length;
  }

  async function attemptStatus(
    request: import("@playwright/test").APIRequestContext,
    token: string,
    examId: string,
    targetAttemptId: string,
  ): Promise<string> {
    const res = await request.get(
      `/api/admin/exams/${examId}/candidates/status`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      candidates: Array<{ attemptId: string; status: string }>;
    };
    const cand = body.candidates.find((c) => c.attemptId === targetAttemptId);
    expect(cand, "candidate present in status list").toBeTruthy();
    return cand!.status;
  }

  test("force submit applies the receipt, writes one audit, and the attempt is graded", async ({
    page,
    request,
  }) => {
    const unique = `recovery-fs-${Date.now()}`;
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

    // Capture the real POST response to assert the receipt disposition.
    let capturedDisposition = "";
    await page.route("**/api/admin/attempts/*/force-submit", async (route) => {
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
    expect(capturedDisposition).toBe("applied");

    // Authoritative reload: exactly one force-submit audit + attempt graded.
    expect(await countForceSubmitAudits(request, token, targetAttemptId)).toBe(
      1,
    );
    expect(await attemptStatus(request, token, s.examId, targetAttemptId)).toBe(
      "graded",
    );
  });
});
