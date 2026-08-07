/**
 * J5-I1D — Recovery Attempt Detail: misconduct mark (Workflow E).
 *
 * Closes the J5-I1C0 Slice 3 + J5-I1C1 vertical slice end-to-end through the
 * REAL recovery attempt page + the REAL misconduct durable-command endpoint:
 *
 *   Test 1 (happy path): a misconduct mark with severity + notes applies; the
 *     receipt disposition is `applied`, the recovery aggregate projection
 *     shows the flag (server truth), the `attempt.misconductFlagged` audit
 *     exists, and the attempt remains live.
 *   Test 2 (lost-response retry): the server COMMITS but the response is
 *     masked as 500 — the dialog classifies `indeterminate`, keeps the frozen
 *     command (persisted in sessionStorage), and the retry resends the SAME
 *     operationId; the server answers `idempotent_replay` with the SAME
 *     receipt createdAt (exactly ONE receipt) and NO duplicate audit.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Recovery attempt misconduct mark (J5-I1D)", () => {
  test.describe.configure({ mode: "serial" });

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

  test("happy path: misconduct mark applies with a receipt, projection + audit, attempt stays live", async ({
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
        headers: response.headers(),
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

  test("lost response: commit + masked 500 → same-operationId retry → idempotent_replay, one receipt, one audit", async ({
    page,
    request,
  }) => {
    const unique = `recovery-mis-retry-${Date.now()}`;
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

    interface CapturedPost {
      body: { operationId?: unknown; severity?: unknown; notes?: unknown };
      parsed: { disposition?: string; createdAt?: string };
    }
    const captured: CapturedPost[] = [];
    const firstResponseRef: { value: { createdAt?: string } | null } = {
      value: null,
    };

    await page.route("**/api/admin/attempts/*/misconduct", async (route) => {
      const postBody = route.request().postDataJSON() as {
        operationId?: unknown;
        severity?: unknown;
        notes?: unknown;
      };
      const response = await route.fetch();
      let parsed: CapturedPost["parsed"] = {};
      try {
        parsed = (await response.json()) as CapturedPost["parsed"];
      } catch {
        // keep parsed empty
      }
      if (captured.length === 0) {
        firstResponseRef.value = parsed.createdAt
          ? { createdAt: parsed.createdAt }
          : null;
        captured.push({ body: postBody, parsed });
        // Mask the committed response as a 500 → indeterminate.
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "masked-for-indeterminate" }),
        });
        return;
      }
      captured.push({ body: postBody, parsed });
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: JSON.stringify(parsed),
      });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${targetAttemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", { timeout: 15_000 });

    await page.getByRole("button", { name: "标记违规" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("违规说明").fill("E2E 重试违规标记");
    await dialog.getByRole("button", { name: "标记违规" }).click();

    // Indeterminate — the dialog keeps the frozen command + retry affordance.
    await expect(
      dialog.getByText("服务器未能确认结果，重试不会重复执行。"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: "重试" })).toBeVisible();

    const storedBefore = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("exam.pendingMisconduct:"),
      );
      return keys.map((k) => ({
        key: k,
        value: JSON.parse(sessionStorage.getItem(k) ?? "null"),
      }));
    });
    expect(storedBefore.length).toBe(1);
    expect(storedBefore[0]!.value.command.attemptId).toBe(targetAttemptId);

    // Retry with the SAME frozen identity → idempotent_replay.
    await dialog.getByRole("button", { name: "重试" }).click();
    await expect(page.getByText("已标记违规").first()).toBeVisible({
      timeout: 15_000,
    });

    const storedAfter = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("exam.pendingMisconduct:"),
      );
      return keys.length;
    });
    expect(storedAfter).toBe(0);

    // Evidence: identical command identity on both POSTs; the retry is a true
    // idempotent_replay referencing the SAME receipt (createdAt equal).
    await expect.poll(() => captured.length).toBe(2);
    const first = captured[0]!;
    const retry = captured[1]!;
    expect(first.body.operationId).toEqual(retry.body.operationId);
    expect(first.body.severity).toEqual(retry.body.severity);
    expect(first.body.notes).toEqual(retry.body.notes);
    expect(retry.parsed.disposition).toBe("idempotent_replay");
    expect(firstResponseRef.value?.createdAt).toBeTruthy();
    expect(retry.parsed.createdAt).toBe(firstResponseRef.value?.createdAt);

    // One audit (a replay writes no new audit); projection shows the flag.
    expect(await countMisconductAudits(request, token, targetAttemptId)).toBe(
      1,
    );
    const projection = await attemptProjection(request, token, targetAttemptId);
    expect(projection.attempt.misconduct).toBe(true);
  });
});
