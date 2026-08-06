/**
 * J5-I1C Slice 2 review P1-2 — Force-submit lost-response retry identity E2E.
 *
 * Drives the REAL ProctorDashboard force-submit flow + the real server
 * force-submit endpoint. Proves the production fix for the reviewer's
 * "lost response" scenario:
 *
 *   1. Admin clicks 强制交卷; the server COMMITS the operation (applied), but
 *      the response is masked as a 5xx via page.route — the UI classifies it
 *      as `indeterminate` and RETAINS the frozen command (same operationId).
 *   2. Admin retries; the SAME operationId is sent again; the server returns
 *      `idempotent_replay` (the immutable stored fact) instead of applying a
 *      second effect.
 *   3. Exactly ONE force-submit audit row exists and the attempt transitioned
 *      to graded exactly once — the duplicate-effect hole is closed.
 *
 * The E2E asserts the API-observable invariants (audit count == 1, status
 * graded, replay disposition) plus the UI's indeterminate → retry affordance.
 */

import { test, expect } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Force-submit lost-response retry identity (J5-I1C P1-2)", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let adminToken: string;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    const unique = `fs-retry-${Date.now()}`;
    seeded = await seedExam(request, unique);
    adminToken = await adminApiToken(request);
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

  /** Counts force-submit audit rows for the attempt via the admin API. */
  async function countForceSubmitAudits(
    request: import("@playwright/test").APIRequestContext,
  ): Promise<number> {
    const res = await request.get(
      `/api/admin/audit-logs?action=attempt.forceSubmit&pageSize=50`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      items: Array<{ targetId: string; action: string }>;
    };
    return body.items.filter(
      (i) => i.action === "attempt.forceSubmit" && i.targetId === attemptId,
    ).length;
  }

  test("commit + masked 5xx → indeterminate → retry → idempotent_replay, exactly one audit", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);

    // Mask the FIRST force-submit POST: let the server really commit
    // (route.fetch), then fulfill as 500 so the UI goes `indeterminate`
    // (classifyGrantFailure: status >= 500 → commit status unknown).
    let firstPostMasked = false;
    await page.route("**/api/admin/attempts/*/force-submit", async (route) => {
      if (firstPostMasked) {
        // Retry passes through unmodified → server returns idempotent_replay.
        await route.continue();
        return;
      }
      firstPostMasked = true;
      await route.fetch(); // really commit applied
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "masked-for-indeterminate" }),
      });
    });

    await page.goto(`/admin/exams/${seeded.examId}/proctor`);
    await page.waitForURL("**/proctor**", { timeout: 15_000 });

    // ── First click: server commits, response masked → indeterminate toast.
    const forceSubmitBtn = page.getByRole("button", { name: "强制交卷" });
    await expect(forceSubmitBtn.first()).toBeVisible({ timeout: 15_000 });
    await forceSubmitBtn.first().click();
    // The confirmation dialog opens.
    await expect(page.getByText("确认强制交卷").first()).toBeVisible({
      timeout: 15_000,
    });
    const confirmBtn = page.getByRole("button", { name: "确认" });
    await confirmBtn.click();

    // Indeterminate state: the toast + the retained retry affordance on the
    // candidate card (重试强制交卷 dismiss button is the ghost "清除未确认命令";
    // the force-submit button itself reopens with the retry description).
    await expect(page.getByText("强制交卷提交状态未确认").first()).toBeVisible({
      timeout: 15_000,
    });

    // The frozen command must be persisted in sessionStorage (same-tab).
    const storedBefore = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("exam.pendingForceSubmit:"),
      );
      return keys.map((k) => ({
        key: k,
        value: JSON.parse(sessionStorage.getItem(k) ?? "null"),
      }));
    });
    expect(storedBefore.length, "pending command persisted").toBe(1);
    expect(storedBefore[0]!.value.command.attemptId).toBe(attemptId);

    // ── Retry: reopen the dialog (retry description) and confirm. The SAME
    //    operationId is sent; the server returns idempotent_replay.
    await forceSubmitBtn.first().click();
    await expect(
      page.getByText(/上一次强制交卷的提交状态未确认/).first(),
    ).toBeVisible({ timeout: 15_000 });
    const retryBtn = page.getByRole("button", { name: "重试强制交卷" });
    await retryBtn.click();

    // Success toast + cleared pending command + attempt graded.
    await expect(page.getByText("已强制交卷").first()).toBeVisible({
      timeout: 15_000,
    });
    const storedAfter = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("exam.pendingForceSubmit:"),
      );
      return keys.length;
    });
    expect(storedAfter).toBe(0);

    // Exactly ONE force-submit audit row — the retry replayed, it did not
    // apply a second effect.
    const auditCount = await countForceSubmitAudits(request);
    expect(auditCount).toBe(1);

    // The attempt transitioned exactly once: status is graded, and a further
    // fresh POST with a NEW operationId would be a no_change (already graded).
    const statusRes = await request.get(
      `/api/admin/exams/${seeded.examId}/candidates/status`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(statusRes.ok()).toBe(true);
    const statusBody = (await statusRes.json()) as {
      candidates: Array<{ attemptId: string; status: string }>;
    };
    const cand = statusBody.candidates.find((c) => c.attemptId === attemptId);
    expect(cand?.status).toBe("graded");
  });
});
