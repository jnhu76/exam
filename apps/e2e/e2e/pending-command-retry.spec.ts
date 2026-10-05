/**
 * Pending operator-command retry identity on the ProctorDashboard.
 *
 * When a misconduct mark commits on the server but its response is lost,
 * the dashboard must classify the outcome
 * as `indeterminate`, freeze the FULL command (operationId + payload),
 * persist it to sessionStorage (fail-closed), and offer a retry that replays
 * the SAME command verbatim — so the server resolves it as an idempotent
 * replay instead of a second, different command.
 *
 * Browser-owned evidence here: captured POST bodies prove the retry reuses
 * the frozen operationId + payload (no new UUID minted). The wire semantics
 * behind the replay — idempotent_replay disposition, exactly-one receipt and
 * audit row, recovery projection — are owned at the API layer by
 * routes/attempts/admin-misconduct.test.ts and its concurrency sibling.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { candidateLoginApi, candidateStartAttempt } from "../lib/flow";

interface CapturedPost {
  body: Record<string, unknown>;
  status: number;
  parsed: {
    disposition?: string;
    createdAt?: string;
    operationId?: string;
  };
}

test.describe("pending operator-command retry identity", () => {
  test("misconduct: commit + masked 5xx → dialog freezes severity+notes → retry replays the SAME payload", async ({
    page,
    request,
  }) => {
    const unique = `proctor-mis-retry-${Date.now()}`;
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

    const captured: CapturedPost[] = [];

    await page.route("**/api/admin/attempts/*/misconduct", async (route) => {
      const postBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      const response = await route.fetch();
      let parsed: CapturedPost["parsed"] = {};
      try {
        parsed = (await response.json()) as CapturedPost["parsed"];
      } catch {
        // keep parsed empty
      }
      if (captured.length === 0) {
        captured.push({ body: postBody, status: response.status(), parsed });
        // The server committed; mask the response as a 500 → indeterminate.
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "masked-for-indeterminate" }),
        });
        return;
      }
      // RETRY POST: pass through the REAL response (idempotent_replay).
      captured.push({ body: postBody, status: response.status(), parsed });
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
    //    become read-only (severity + notes must NOT drift under replay).
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
    //    retry is a true idempotent replay referencing the SAME receipt.
    await expect.poll(() => captured.length).toBe(2);
    const first = captured[0]!;
    const retry = captured[1]!;

    expect(first.body.operationId).toEqual(retry.body.operationId);
    expect(first.body.severity).toEqual(retry.body.severity);
    expect(first.body.notes).toEqual(retry.body.notes);
    expect(first.body.severity).toBe("warning");
    expect(first.body.notes).toBe("A");
    expect(typeof first.body.operationId).toBe("string");
  });
});
