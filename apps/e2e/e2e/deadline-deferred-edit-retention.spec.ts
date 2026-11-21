import { test, expect, type Request, type Response } from "@playwright/test";
import { seedExam } from "../lib/seed";
import {
  candidateApiToken,
  candidateLogin,
  getAnswer,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
} from "../lib/flow";

/**
 * R-T4-2 (#1051) — the deadline gate's editable-defer branch keeps the
 * candidate's unacknowledged edit, browser-level.
 *
 * Material invariant owned here: when the client wall clock runs ~1h ahead
 * of the server clock, the deadline episode's authoritative verification
 * re-read answers "still editable" and MUST NOT roll the editor back to the
 * server draft, and the window-`online` failed-save retry MUST re-POST the
 * candidate's last input (which then persists). A rollback + stale re-POST
 * is silent candidate data loss at the deadline boundary.
 *
 * The browser↔server composition is the mechanism a lower layer cannot
 * faithfully own: the real save queue (1500ms debounce) against the live
 * server, a genuinely failing save (route-injected HTTP 500), the client
 * clock anomaly (Playwright clock), the real deadline episode's verification
 * GET against the live server clock, and the browser `online` event driving
 * the real retry orchestration. Component-level interleaving
 * (TakeExamPage.deadlineDeferredRetention.test.tsx) owns the branch logic;
 * this spec owns the composed browser behavior.
 *
 * The answer save is faulted with a route-injected HTTP 500. The heartbeat
 * is separately faulted with a transport abort for the duration of the
 * scenario: a SUCCESSFUL heartbeat also re-drives the failed saves from the
 * local drafts, which would race the verification re-read and could mask (or
 * manufacture) the very rollback this spec must observe. Aborting the
 * heartbeat keeps the retry authority with the window-`online` trigger, so
 * the observable outcome is deterministic.
 *
 * Interleaving:
 *   1. answer TRUE → save ACKed (server draft = true, serverVersion 1);
 *   2. answer FALSE → save POST answered with 500 → q1 unacknowledged;
 *   3. fast-forward the client clock past the attempt deadline → the
 *      episode verifies; the live server clock is still before the deadline
 *      → editable defer (no submit);
 *   4. WITNESS 1 — the editor still shows FALSE (not the server draft
 *      TRUE), the page stays on /take, zero submit POSTs;
 *   5. window `online` → WITNESS 2 — the retry POST body carries FALSE and
 *      the server accepts it; the persisted answer becomes FALSE.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("deadline editable-defer keeps unacknowledged edits (R-T4-2)", () => {
  test("client clock ahead of the server: editable defer keeps the editor and the online retry carries the candidate's input", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "rt42-defer", {
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 30,
    });

    await candidateLogin(page, seeded.candidate);
    // The fake clock is installed AFTER login and BEFORE the take page mounts
    // so every TakeExamPage timer (1s tick, 30s heartbeat, 1500ms save
    // debounce) is fake-controlled while all network I/O stays real.
    await page.clock.install();
    await startExamFromList(page, seeded.examId);

    // The network dropout that fails the answer save also fails heartbeats:
    // a SUCCESSFUL heartbeat would re-drive the failed saves from local
    // drafts and race the verification re-read (header note). Fault it as a
    // transport abort so the window-`online` event is the only retry
    // trigger observed.
    await page.route("**/api/attempts/*/heartbeat", (route) =>
      route.abort("failed"),
    );

    const token = await candidateApiToken(request, seeded.candidate);
    const detailRes = await request.get(
      `${BASE_URL}/api/candidate/exams/${seeded.examId}`,
      { headers: { Cookie: `auth-token=${token}` } },
    );
    const attemptId = ((await detailRes.json()) as { activeAttemptId?: string })
      .activeAttemptId;
    if (!attemptId) throw new Error("no activeAttemptId");

    // Observers: every /take verification GET and every submit POST.
    const takeGets: Request[] = [];
    const submitPosts: Request[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "GET" &&
        req.url().includes("/candidate/attempts/") &&
        req.url().endsWith("/take")
      ) {
        takeGets.push(req);
      }
      if (req.method() === "POST" && req.url().includes("/submit")) {
        submitPosts.push(req);
      }
    });

    // ── Step 1: answer TRUE, save ACKed → the confirmed server draft is
    //    true (serverVersion 1).
    await answerTrueFalse(page, true);
    await page.clock.fastForward(2_000); // fire the 1500ms save debounce
    await waitForSaveSaved(page);
    expect(await getAnswer(request, token, attemptId)).toBe(true);

    // ── Step 2: switch to FALSE; this save POST is faulted with a 500, so
    //    the candidate's edit stays UNACKNOWLEDGED and the server draft
    //    stays true.
    let saveFaulted = false;
    const faultedSaveIssued = page.waitForResponse(
      (res: Response) =>
        res.request().method() === "POST" &&
        res.url().includes("/answers/") &&
        res.status() === 500,
      { timeout: 15_000 },
    );
    await page.route("**/api/attempts/*/answers/*", async (route) => {
      if (!saveFaulted) {
        saveFaulted = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "route-injected save fault" }),
        });
        return;
      }
      await route.continue();
    });
    await answerTrueFalse(page, false);
    await page.clock.fastForward(2_000); // fire the faulted save
    const faulted = await faultedSaveIssued;
    await faulted.finished();
    // The failed-save chip is the queue's honest failed state.
    await expect(page.getByText("保存失败").first()).toBeVisible({
      timeout: 15_000,
    });
    // The editor holds the candidate's unacknowledged FALSE; the server
    // draft is still TRUE.
    await expect(page.getByTestId("true-false-false")).toBeChecked();
    expect(await getAnswer(request, token, attemptId)).toBe(true);

    // ── Step 3: the client wall clock jumps past the attempt deadline
    //    (start + 30min) while the LIVE server clock has barely moved. The
    //    deadline episode fires, verifies with the server, and the server
    //    truth is "still editable" → defer.
    await page.clock.fastForward(65 * 60_000);
    // The listener was registered AFTER the initial load GET, so the
    // verification re-read is the first /take request it observes. It is
    // usually issued while the fast-forward fires the expiry tick.
    await expect
      .poll(() => takeGets.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
    // Defer proof: the applied verification snapshot re-based the server
    // clock, so the countdown leaves the client-anomaly 00:00 floor and
    // shows the server's real remaining time. This also orders the editor
    // assertion below strictly after the apply.
    await expect(page.getByRole("timer")).not.toHaveText(/00:00/);

    // ── WITNESS 1 — the editor keeps the candidate's FALSE; the editable
    //    defer did not roll it back to the server draft TRUE.
    await expect(page.getByTestId("true-false-false")).toBeChecked();
    await expect(page.getByTestId("true-false-true")).not.toBeChecked();
    // No submit path fired and the page stays on the editable take surface.
    expect(submitPosts).toHaveLength(0);
    await expect(page.getByTestId("take-submit-btn")).toBeEnabled();

    // ── Steps 4–5: connectivity recovers (window `online`) → the failed
    //    save is retried through the existing orchestration.
    const retrySave = page.waitForResponse(
      (res: Response) =>
        res.request().method() === "POST" &&
        res.url().includes("/answers/") &&
        res.status() === 200,
      { timeout: 15_000 },
    );
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.clock.fastForward(2_000); // fire the retried save's debounce
    const retried = await retrySave;
    await retried.finished();

    // ── WITNESS 2 — the retry POST body carries the candidate's FALSE (a
    //    rollback would have re-POSTed the stale draft TRUE), and the live
    //    server accepted it.
    const retryBody = JSON.parse(retried.request().postData() ?? "{}") as {
      answer?: unknown;
      baseVersion?: number;
      clientSeq?: number;
    };
    expect(retryBody.answer).toBe(false);
    expect(retryBody.baseVersion).toBe(1);
    expect(retryBody.clientSeq).toBeGreaterThanOrEqual(2);
    const retryResponse = (await retried.json()) as {
      accepted?: boolean;
      serverVersion?: number;
    };
    expect(retryResponse.accepted).toBe(true);
    await waitForSaveSaved(page);

    // The persisted truth is the candidate's input — no silent loss.
    expect(await getAnswer(request, token, attemptId)).toBe(false);
    expect(submitPosts).toHaveLength(0);
  });
});
