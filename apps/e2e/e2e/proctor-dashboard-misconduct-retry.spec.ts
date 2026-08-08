/**
 * J5-I1C1 review P1 — ProctorDashboard misconduct lost-response retry identity.
 *
 * The original P1: after an indeterminate failure the ProctorDashboard
 * misconduct dialog froze ONLY the operationId — severity + notes stayed
 * editable, so a retry could drift the payload under the SAME operationId
 * (silently turning an idempotent replay into a different command).
 *
 * This spec drives the REAL ProctorDashboard misconduct dialog + the real
 * misconduct endpoint and proves the fix end-to-end:
 *
 *   1. Admin marks 违规 (severity warning, notes "A"); the server COMMITS but
 *      the response is masked as a 500 — the UI classifies `indeterminate`
 *      and freezes the FULL command (operationId + severity + notes),
 *      persisted to sessionStorage (fail-closed).
 *   2. Visual/deterministic inspection of the dialog in `indeterminate`: the
 *      severity Select is disabled and the notes Textarea is disabled with
 *      the frozen value still "A" (read-only — no drift).
 *   3. Retry from the dialog; the SAME operationId + severity + notes are
 *      sent (captured POST bodies); the server answers `idempotent_replay`
 *      with the SAME receipt createdAt — exactly ONE receipt, ONE audit, and
 *      the recovery projection shows the flag.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("ProctorDashboard misconduct lost-response retry identity (J5-I1C1 review P1)", () => {
  test("commit + masked 5xx → dialog freezes severity+notes → retry replays SAME payload → idempotent_replay", async ({
    page,
    request,
  }) => {
    const unique = `proctor-mis-retry-${Date.now()}`;
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
        // The server committed; mask the response as a 500 → indeterminate.
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "masked-for-indeterminate" }),
        });
        return;
      }
      // RETRY POST: pass through the REAL response (idempotent_replay).
      captured.push({ body: postBody, parsed });
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(parsed),
      });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${s.examId}/proctor`);
    await page.waitForURL("**/proctor**", { timeout: 15_000 });

    // ── Open the misconduct dialog from the candidate card. Default severity
    //    is warning; enter notes "A".
    const flagBtn = page.getByRole("button", { name: "标记违规" });
    await expect(flagBtn.first()).toBeVisible({ timeout: 15_000 });
    await flagBtn.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByLabel("违规说明").fill("A");
    await dialog.getByRole("button", { name: "确认标记" }).click();

    // ── Indeterminate: the dialog keeps the frozen command and the inputs
    //    become read-only (review P1: severity + notes must NOT drift).
    await expect(dialog.getByText(/提交状态未确认/).first()).toBeVisible({
      timeout: 15_000,
    });

    // (a) Severity Select is disabled — the frozen severity cannot change.
    await expect(dialog.getByLabel("严重程度")).toBeDisabled();

    // (b) Notes Textarea is disabled AND still shows the frozen value "A" —
    //     read-only under the same operationId.
    const notesInput = dialog.getByLabel("违规说明");
    await expect(notesInput).toBeDisabled();
    await expect(notesInput).toHaveValue("A");

    // Visual evidence: screenshot of the frozen dialog for human review.
    await page.screenshot({
      path: "test-results/proctor-misconduct-indeterminate.png",
    });

    // The page-level banner is the recovery surface even if the candidate
    // card later disappears from the live projection.
    await expect(page.getByTestId("pending-misconduct-banner")).toBeVisible({
      timeout: 15_000,
    });

    // The frozen command is persisted (fail-closed).
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

    // ── Retry from the dialog: replays the frozen command verbatim.
    await dialog.getByRole("button", { name: "重试违规标记" }).click();
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

    // ── Evidence: identical command identity + payload on both POSTs; the
    //    retry is a true idempotent_replay referencing the SAME receipt.
    await expect.poll(() => captured.length).toBe(2);
    const first = captured[0]!;
    const retry = captured[1]!;

    expect(first.body.operationId).toEqual(retry.body.operationId);
    expect(first.body.severity).toEqual(retry.body.severity);
    expect(first.body.notes).toEqual(retry.body.notes);
    expect(first.body.severity).toBe("warning");
    expect(first.body.notes).toBe("A");
    expect(typeof first.body.operationId).toBe("string");
    expect(retry.parsed.disposition).toBe("idempotent_replay");
    expect(firstResponseRef.value?.createdAt).toBeTruthy();
    expect(retry.parsed.createdAt).toBe(firstResponseRef.value?.createdAt);

    // Belt-and-suspenders: exactly ONE audit row; the recovery projection
    // shows the flag (a replay writes no new audit).
    const auditRes = await request.get(
      `/api/admin/audit-logs?action=attempt.misconductFlagged&pageSize=50`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(auditRes.ok()).toBe(true);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ targetId: string; action: string }>;
    };
    const auditCount = auditBody.items.filter(
      (i) =>
        i.action === "attempt.misconductFlagged" &&
        i.targetId === targetAttemptId,
    ).length;
    expect(auditCount).toBe(1);

    const projRes = await request.get(
      `/api/admin/recovery/attempts/${targetAttemptId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    expect(projRes.ok()).toBe(true);
    const projection = (await projRes.json()) as {
      attempt: { misconduct: boolean };
    };
    expect(projection.attempt.misconduct).toBe(true);
  });
});
