/**
 * J5-I1D — Recovery Attempt Detail: force submit (Workflow D).
 *
 * Drives the REAL Recovery Attempt Detail operations UI + the REAL
 * force-submit endpoint:
 *
 *   Test 1 (happy path): a live attempt is force-submitted with a canonical
 *     reason; the receipt disposition is `applied`, exactly ONE force-submit
 *     audit exists, and the authoritative reload shows the attempt graded.
 *   Test 2 (lost-response retry): the server COMMITS but the response is
 *     masked as 500 via page.route — the dialog classifies `indeterminate`
 *     and keeps the frozen command; the retry resends the SAME operationId
 *     (asserted on both POST bodies) and the server answers
 *     `idempotent_replay` with the SAME receipt createdAt — proving exactly
 *     ONE receipt row and no duplicate audit.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("Recovery attempt force submit (J5-I1D)", () => {
  test.describe.configure({ mode: "serial" });

  async function countForceSubmitAudits(
    request: import("@playwright/test").APIRequestContext,
    token: string,
    targetAttemptId: string,
  ): Promise<number> {
    const res = await request.get(
      `/api/admin/audit-logs?action=attempt.forceSubmit&pageSize=50`,
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

  test("happy path: force submit applies the receipt, writes one audit, and the attempt is graded", async ({
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
        headers: response.headers(),
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

  test("lost response: commit + masked 500 → same-operationId retry → idempotent_replay, one receipt, one audit", async ({
    page,
    request,
  }) => {
    const unique = `recovery-fs-retry-${Date.now()}`;
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
      body: { operationId?: unknown; reason?: unknown };
      parsed: { disposition?: string; createdAt?: string };
    }
    const captured: CapturedPost[] = [];
    const firstResponseRef: { value: { createdAt?: string } | null } = {
      value: null,
    };

    await page.route("**/api/admin/attempts/*/force-submit", async (route) => {
      const postBody = route.request().postDataJSON() as {
        operationId?: unknown;
        reason?: unknown;
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

    // First submit: server commits, response masked → indeterminate.
    await page.getByRole("button", { name: "强制交卷" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("原因说明（必填）").fill("E2E 重试原因");
    await dialog.getByRole("button", { name: "强制交卷" }).click();

    // The dialog stays open with the retry affordance + ambiguity hint
    // (InlineErrorBanner → role=alert, announced to assistive tech).
    await expect(
      dialog.getByText("服务器未能确认结果，重试不会重复执行。"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("alert")).toContainText("服务器未能确认结果");
    await expect(dialog.getByRole("button", { name: "重试" })).toBeVisible();

    // The frozen command was persisted (fail-closed) with the attempt id.
    const storedBefore = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("exam.pendingForceSubmit:"),
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
    await expect(page.getByText("已提交强制交卷").first()).toBeVisible({
      timeout: 15_000,
    });

    const storedAfter = await page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("exam.pendingForceSubmit:"),
      );
      return keys.length;
    });
    expect(storedAfter).toBe(0);

    // Evidence: exactly two POSTs with identical identity; the retry is a
    // true idempotent_replay referencing the SAME receipt (createdAt equal).
    await expect.poll(() => captured.length).toBe(2);
    const first = captured[0]!;
    const retry = captured[1]!;
    expect(first.body.operationId).toEqual(retry.body.operationId);
    expect(first.body.reason).toEqual(retry.body.reason);
    expect(retry.parsed.disposition).toBe("idempotent_replay");
    expect(firstResponseRef.value?.createdAt).toBeTruthy();
    expect(retry.parsed.createdAt).toBe(firstResponseRef.value?.createdAt);

    // One audit (a replay writes no new audit) + attempt graded.
    expect(await countForceSubmitAudits(request, token, targetAttemptId)).toBe(
      1,
    );
    expect(await attemptStatus(request, token, s.examId, targetAttemptId)).toBe(
      "graded",
    );
  });
});
