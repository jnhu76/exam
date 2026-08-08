/**
 * J5-I1D — Recovery Attempt Detail: operator time grant (Workflow C).
 *
 * Seeds an `operator_incident` exam (the canonical grant seam), starts a
 * real attempt, then grants time from the Recovery Attempt Detail operations
 * UI. The grant is confirmed against the REAL recovery aggregate: exactly one
 * new operator adjustment (+N seconds) and the effective deadline shifted by
 * exactly N seconds (server-side computation is the authority — the client
 * never derives deadlines).
 *
 * Test 2 (review P1 reload recovery): the server COMMITS but the response is
 * masked as 500 via page.route — the dialog classifies `indeterminate` and the
 * frozen operationId is persisted in localStorage (the shared
 * PendingGrantCoordinator). After a PAGE RELOAD the reopened dialog restores the
 * SAME operationId (not a fresh one), the retry is an idempotent_replay, and
 * the authoritative aggregate shows exactly ONE adjustment (+600s, NOT +1200s)
 * and exactly ONE audit — proving the duplicate-grant hole is closed.
 */
import { test, expect } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminGet(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  path: string,
) {
  const res = await request.get(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

test.describe("Recovery attempt time grant (J5-I1D)", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let adminToken: string;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    seeded = await seedExam(request, `time-grant-${Date.now()}`, {
      interruptionTimePolicy: "operator_incident",
    });
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

  test("grants 10 minutes from the operations UI; ledger + effective deadline move by exactly 600s", async ({
    page,
    request,
  }) => {
    const before = (await adminGet(
      request,
      adminToken,
      `/api/admin/recovery/attempts/${attemptId}`,
    )) as {
      attempt: { effectiveDeadlineAt: string };
      timeAdjustments: Array<{ source: string; addedSeconds: number }>;
    };
    const beforeAdjustments = before.timeAdjustments.length;

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${attemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", { timeout: 15_000 });

    // Operations section renders time_grant for an in_progress attempt.
    await expect(
      page.getByRole("button", { name: "延长答题时间" }),
    ).toBeVisible({
      timeout: 15_000,
    });

    // The grant dialog requires a reason (canonical, trimmed by the server).
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

    // The aggregate reload is authoritative: one new operator adjustment of
    // exactly 600s, and the effective deadline advanced by exactly 600s.
    const after = (await adminGet(
      request,
      adminToken,
      `/api/admin/recovery/attempts/${attemptId}`,
    )) as {
      attempt: { effectiveDeadlineAt: string };
      timeAdjustments: Array<{
        source: string;
        addedSeconds: number;
        reasonText: string;
      }>;
    };
    expect(after.timeAdjustments.length).toBe(beforeAdjustments + 1);
    const operatorAdjustment = after.timeAdjustments.find(
      (a) => a.source === "operator",
    );
    expect(operatorAdjustment).toBeTruthy();
    expect(operatorAdjustment!.addedSeconds).toBe(600);
    expect(operatorAdjustment!.reasonText).toBe("网络中断补偿");

    const beforeMs = new Date(before.attempt.effectiveDeadlineAt).getTime();
    const afterMs = new Date(after.attempt.effectiveDeadlineAt).getTime();
    expect(afterMs - beforeMs).toBe(600_000);
  });

  // ── Review P1: reload recovery. The time grant now reuses the shared
  //    PendingGrantCoordinator, so the frozen operationId is persisted in
  //    localStorage BEFORE the POST. After a commit + masked-500 (indeterminate)
  //    a PAGE RELOAD must NOT mint a fresh identity — the reopened dialog
  //    restores the SAME operationId and the retry is an idempotent_replay,
  //    producing exactly ONE adjustment (NOT a real second +600s grant) and
  //    exactly ONE audit. This is the regression test the human reviewer asked
  //    for: without the coordinator wiring, a reload lost the operationId and a
  //    new "+10 min" applied a real second time adjustment.
  test("lost response + reload: restores the SAME operationId → idempotent_replay → exactly one adjustment + 600s", async ({
    page,
    request,
  }) => {
    const unique = `recovery-tg-reload-${Date.now()}`;
    const s = await seedExam(request, unique, {
      interruptionTimePolicy: "operator_incident",
    });
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
      body: {
        operationId?: unknown;
        addedSeconds?: unknown;
        reasonCode?: unknown;
        reasonText?: unknown;
      };
      parsed: {
        outcome?: string;
        adjustment?: { createdAt?: string } | null;
      };
    }
    const captured: CapturedPost[] = [];
    const firstResponseRef: { value: { createdAt?: string } | null } = {
      value: null,
    };

    // Route the time-grant POST: let the server REALLY commit, then mask the
    // FIRST response as 500 (indeterminate). Subsequent (retry) responses pass
    // through unchanged.
    await page.route("**/api/admin/attempts/*/time-grants", async (route) => {
      const postBody = route.request().postDataJSON() as CapturedPost["body"];
      const response = await route.fetch();
      let parsed: CapturedPost["parsed"] = {};
      try {
        parsed = (await response.json()) as CapturedPost["parsed"];
      } catch {
        // keep parsed empty
      }
      if (captured.length === 0) {
        firstResponseRef.value = parsed.adjustment?.createdAt
          ? { createdAt: parsed.adjustment.createdAt }
          : null;
        captured.push({ body: postBody, parsed });
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
        contentType: "application/json",
        body: JSON.stringify(parsed),
      });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${targetAttemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", {
      timeout: 15_000,
    });

    // The frozen operationId is persisted in localStorage (the coordinator)
    // before the first POST. Capture the ledger count + deadline before grant.
    const before = (await adminGet(
      request,
      token,
      `/api/admin/recovery/attempts/${targetAttemptId}`,
    )) as {
      attempt: { effectiveDeadlineAt: string };
      timeAdjustments: Array<{ source: string; addedSeconds: number }>;
    };
    const beforeAdjustments = before.timeAdjustments.length;
    const beforeMs = new Date(before.attempt.effectiveDeadlineAt).getTime();

    // First submit: server commits, response masked as 500 → indeterminate.
    await page.getByRole("button", { name: "延长答题时间" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("延长时间（分钟）").fill("10");
    await dialog.getByLabel("原因说明").fill("网络中断补偿");
    await dialog.getByRole("button", { name: "延长答题时间" }).click();

    // Indeterminate: the dialog stays open with the retry affordance + the
    // ambiguity hint (InlineErrorBanner → role=alert).
    await expect(
      dialog.getByText("服务器未能确认结果，重试不会重复执行。"),
    ).toBeVisible({ timeout: 15_000 });

    // The frozen command was persisted in localStorage (the coordinator) with
    // the attempt id + the exact payload.
    const storedBefore = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith("exam.pendingGrantAuthority:"),
      );
      return keys.map((k) => ({
        key: k,
        value: JSON.parse(localStorage.getItem(k) ?? "null"),
      }));
    });
    expect(storedBefore.length).toBe(1);
    expect(storedBefore[0]!.value.command.attemptId).toBe(targetAttemptId);
    expect(storedBefore[0]!.value.command.addedSeconds).toBe(600);

    // ── The reload recovery path. A real lost-response reload is simulated:
    //    reload the page (localStorage survives), then reopen the dialog. The
    //    coordinator authority is restored, so the dialog reopens in the
    //    indeterminate phase (retry affordance) using the SAME operationId.
    await page.reload();
    await page.waitForURL("**/admin/recovery/attempts/**", {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "延长答题时间" }).click();
    const restoredDialog = page.getByRole("dialog");
    // The restored dialog shows the retry affordance (indeterminate phase).
    await expect(
      restoredDialog.getByRole("button", { name: /重试/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Retry with the SAME frozen identity → idempotent_replay.
    await restoredDialog.getByRole("button", { name: /重试/ }).click();
    await expect(page.getByText("已延长答题时间").first()).toBeVisible({
      timeout: 15_000,
    });

    // The coordinator authority is cleared after the confirmed outcome.
    const storedAfter = await page.evaluate(() => {
      return Object.keys(localStorage).filter((k) =>
        k.startsWith("exam.pendingGrantAuthority:"),
      ).length;
    });
    expect(storedAfter).toBe(0);

    // Evidence: exactly two POSTs with identical identity + payload; the retry
    // is a true idempotent_replay.
    await expect.poll(() => captured.length).toBe(2);
    const first = captured[0]!;
    const retry = captured[1]!;
    expect(first.body.operationId).toEqual(retry.body.operationId);
    expect(first.body.addedSeconds).toEqual(retry.body.addedSeconds);
    expect(first.body.reasonText).toEqual(retry.body.reasonText);
    expect(retry.parsed.outcome).toBe("idempotent_replay");
    expect(firstResponseRef.value?.createdAt).toBeTruthy();
    expect(retry.parsed.adjustment?.createdAt).toBe(
      firstResponseRef.value?.createdAt,
    );

    // Exactly ONE adjustment (NOT +2) + exactly ONE audit (a replay writes no
    // new audit) + the effective deadline advanced by exactly 600s (NOT 1200s).
    const after = (await adminGet(
      request,
      token,
      `/api/admin/recovery/attempts/${targetAttemptId}`,
    )) as {
      attempt: { effectiveDeadlineAt: string };
      timeAdjustments: Array<{ source: string; addedSeconds: number }>;
    };
    expect(after.timeAdjustments.length).toBe(beforeAdjustments + 1);
    const operatorAdjustment = after.timeAdjustments.find(
      (a) => a.source === "operator",
    );
    expect(operatorAdjustment).toBeTruthy();
    expect(operatorAdjustment!.addedSeconds).toBe(600);

    const afterMs = new Date(after.attempt.effectiveDeadlineAt).getTime();
    expect(afterMs - beforeMs).toBe(600_000);

    const auditRes = await request.get(
      `/api/admin/audit-logs?action=attempt.timeGrant&targetId=${targetAttemptId}&pageSize=50`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(auditRes.ok()).toBe(true);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ targetId: string; action: string }>;
    };
    expect(
      auditBody.items.filter(
        (i) =>
          i.action === "attempt.timeGrant" && i.targetId === targetAttemptId,
      ).length,
    ).toBe(1);
  });
});
