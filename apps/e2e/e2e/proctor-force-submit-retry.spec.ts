/**
 * J5-I1C Slice 2 re-review P1-1 / P1-2 / P2-3 — Force-submit lost-response
 * retry identity E2E.
 *
 * Drives the REAL ProctorDashboard force-submit flow + the real server
 * force-submit endpoint. Proves the production fix for the reviewer's
 * "lost response" scenario end-to-end, with the evidence the re-review
 * demanded:
 *
 *   1. Admin clicks 强制交卷; the server COMMITS the operation (applied), but
 *      the response is masked as a 5xx via page.route — the UI classifies it
 *      as `indeterminate` and RETAINS the frozen command (same operationId),
 *      persisted to sessionStorage (fail-closed).
 *   2. The next status poll returns the attempt as graded, so the candidate
 *      card loses its force-submit button — but the PAGE-LEVEL pending banner
 *      (independent of live status) still offers retry.
 *   3. Admin retries from the banner; the SAME operationId + reason are sent
 *      (asserted on the captured POST bodies); the server returns
 *      `disposition === "idempotent_replay"` (asserted on the parsed response,
 *      not just an audit count); the response carries the SAME `createdAt` as
 *      the first (applied) response — proving exactly ONE receipt row.
 *
 * This closes the evidence gap the reviewer flagged: "1 audit + graded" alone
 * cannot distinguish a true replay from two separate operationIds; capturing
 * both POST bodies AND parsing the retry's disposition/createdAt does.
 */

import { test, expect } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

test.describe("Force-submit lost-response retry identity (J5-I1C re-review)", () => {
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

  test("commit + masked 5xx → indeterminate → banner retry → idempotent_replay (same operationId, one receipt, one audit)", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);

    // Capture EVERY force-submit POST body + the parsed response so the
    // retry-identity + replay-disposition assertions have full evidence
    // (re-review P2-3: "1 audit + graded" alone is not enough).
    interface CapturedPost {
      body: { operationId?: unknown; reason?: unknown };
      status: number;
      parsed: {
        disposition?: string;
        createdAt?: string;
        operationId?: string;
      };
    }
    const captured: CapturedPost[] = [];
    // The first applied response's createdAt/operationId — captured inside the
    // route handler so we can assert the retry references the SAME receipt
    // (one row). TS cannot narrow this across the closure, so read it via a
    // stable holder typed as the union.
    const firstResponseRef: {
      value: { createdAt?: string; operationId?: string } | null;
    } = { value: null };

    await page.route("**/api/admin/attempts/*/force-submit", async (route) => {
      const request = route.request();
      const postBody = request.postDataJSON() as {
        operationId?: unknown;
        reason?: unknown;
      };
      // Always let the server really process the request so the commit
      // semantics are real; then decide how to fulfill based on index.
      const response = await route.fetch();
      const text = await response.text();
      let parsed: CapturedPost["parsed"] = {};
      try {
        parsed = JSON.parse(text) as CapturedPost["parsed"];
      } catch {
        // keep parsed empty
      }
      if (captured.length === 0) {
        // FIRST POST: the server commits (applied). Remember the real response
        // so we can later assert the retry's createdAt matches (same receipt).
        const firstRecord: { createdAt?: string; operationId?: string } = {};
        if (parsed.createdAt) firstRecord.createdAt = parsed.createdAt;
        if (parsed.operationId) firstRecord.operationId = parsed.operationId;
        firstResponseRef.value = firstRecord;
        captured.push({
          body: postBody,
          status: response.status(),
          parsed,
        });
        // Mask as 500 so the UI classifies the outcome as indeterminate.
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "masked-for-indeterminate" }),
        });
        return;
      }
      // RETRY POST: pass through the REAL response (idempotent_replay) so the
      // UI clears the pending command and we can assert the disposition.
      captured.push({
        body: postBody,
        status: response.status(),
        parsed,
      });
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: text,
      });
    });

    await page.goto(`/admin/exams/${seeded.examId}/proctor`);
    await page.waitForURL("**/proctor**", { timeout: 15_000 });

    // ── First click: server commits, response masked → indeterminate.
    const forceSubmitBtn = page.getByRole("button", { name: "强制交卷" });
    await expect(forceSubmitBtn.first()).toBeVisible({ timeout: 15_000 });
    await forceSubmitBtn.first().click();
    await expect(page.getByText("确认强制交卷").first()).toBeVisible({
      timeout: 15_000,
    });
    const confirmBtn = page.getByRole("button", { name: "确认" });
    await confirmBtn.click();

    // Indeterminate state surfaced (toast).
    await expect(page.getByText("强制交卷提交状态未确认").first()).toBeVisible({
      timeout: 15_000,
    });

    // The frozen command must be persisted in sessionStorage (fail-closed).
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

    // ── Retry from the PAGE-LEVEL banner (re-review P1-1). The status poll
    //    may already show the candidate as graded (the server committed), so
    //    the card's force-submit button may be gone — the banner is the
    //    authoritative recovery surface regardless.
    const banner = page.getByTestId("pending-force-submit-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    const bannerRetry = banner.getByRole("button", {
      name: "重试未确认强制交卷",
    });
    await bannerRetry.click();

    // Success toast + cleared pending command.
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

    // ── Evidence (re-review P2-3): exactly two POSTs, identical command
    //    identity, retry is a true idempotent_replay referencing the SAME
    //    receipt (createdAt matches the first applied response).
    await expect.poll(() => captured.length).toBe(2);

    const first = captured[0]!;
    const retry = captured[1]!;

    // (a) Same operationId + same reason on both POSTs — the retry reused the
    //     frozen command verbatim (no new UUID minted).
    expect(first.body.operationId).toEqual(retry.body.operationId);
    expect(first.body.reason).toEqual(retry.body.reason);
    expect(typeof first.body.operationId).toBe("string");

    // (b) The retry's HTTP response is 200 with disposition idempotent_replay
    //     — parsed from the real server response, not inferred from audit
    //     count. This rules out the "operationId=B → no_change" false pass.
    expect(retry.status).toBe(200);
    expect(retry.parsed.disposition).toBe("idempotent_replay");

    // (c) Exactly ONE receipt: the retry returns the SAME createdAt as the
    //     first applied response (the receipt's immutable creation timestamp).
    //     A second receipt would have a different createdAt.
    expect(firstResponseRef.value?.createdAt).toBeTruthy();
    expect(retry.parsed.createdAt).toBe(firstResponseRef.value?.createdAt);

    // (d) Belt-and-suspenders: exactly one force-submit audit row (a replay
    //     writes no new audit) and the attempt is graded.
    const auditCount = await countForceSubmitAudits(request);
    expect(auditCount).toBe(1);

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
