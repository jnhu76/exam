/**
 * EXAM-446 / EXAM-519 — Candidate convergence after Proctor force-submit.
 *
 * Origin: #446 empirical probe (PR #518) measured that a Candidate's open
 * TakeExamPage stayed stale/editable forever after a Proctor force-submit —
 * the heartbeat 409 INVALID_STATE_TRANSITION was classified as a generic
 * disconnect and zero authoritative take GETs were issued. Classification B
 * (HTTP reconciliation gap) → #519 implemented HTTP-only reconciliation:
 * a terminal heartbeat/save signal now triggers ONE authoritative re-read of
 * GET /api/candidate/attempts/:attemptId/take, whose frozen snapshot locks
 * the page through the existing view derivation.
 *
 * This spec is now the REGRESSION asset for that fix. It asserts:
 *   E1 — save-triggered early convergence: a post-terminal save rejection
 *        (ATTEMPT_ALREADY_SUBMITTED) triggers the re-read and locks the UI.
 *   E2 — heartbeat-only natural convergence: with NO candidate action, the
 *        next real heartbeat (409) triggers the re-read; convergence within
 *        one heartbeat period (≤30s + scheduling tolerance).
 * Both paths keep the B14 hard invariant: a stale post-terminal save can
 * NEVER overwrite the server-frozen truth (verified independently).
 *
 * Mechanics (unchanged from the probe): TWO independent browser contexts
 * (A = Candidate real UI, B = Admin real ProctorDashboard force-submit
 * dialog), T0 = the real force-submit commit captured in context B, pure
 * Playwright network hooks (no production instrumentation), and NO candidate
 * page refresh/navigation after T0.
 */
import {
  test,
  expect,
  type Page,
  type Browser,
  type APIRequestContext,
} from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  adminApiToken,
  candidateApiToken,
} from "../lib/flow";

interface TraceRecord {
  url: string;
  method: string;
  status?: number;
  at: number;
  body?: unknown;
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function isCandidateAttemptUrl(url: string): boolean {
  return (
    url.includes("/api/attempts/") || url.includes("/api/candidate/attempts/")
  );
}

function takeGetsAfter(trace: TraceRecord[], attemptId: string, t0: number) {
  return trace.filter(
    (t) =>
      t.url === `${BASE}/api/candidate/attempts/${attemptId}/take` &&
      t.method === "GET" &&
      t.at >= t0,
  );
}

function answerPostsAfter(trace: TraceRecord[], attemptId: string, t0: number) {
  return trace.filter(
    (t) =>
      t.method === "POST" &&
      t.url.includes(`/api/attempts/${attemptId}/answers/`) &&
      t.at >= t0,
  );
}

/**
 * Shared scenario: seed a live exam, put a Candidate on the take page with a
 * saved answer, and force-submit from a REAL Proctor dashboard context.
 * Returns the candidate page + trace, T0 (server commit), and the admin
 * context (caller closes it). No candidate-side action after T0 happens here.
 */
async function setupForceSubmitScenario(
  page: Page,
  browser: Browser,
  request: APIRequestContext,
  seedTag: string,
): Promise<{
  seeded: Awaited<ReturnType<typeof seedExam>>;
  attemptId: string;
  trace: TraceRecord[];
  T0: number;
  adminContext: import("@playwright/test").BrowserContext;
}> {
  const seeded = await seedExam(request, seedTag, {
    questionAnswer: true,
    questionScore: 100,
  });

  // Context A: Candidate (real UI).
  const trace: TraceRecord[] = [];
  page.on("request", (r) => {
    if (isCandidateAttemptUrl(r.url())) {
      trace.push({ url: r.url(), method: r.method(), at: Date.now() });
    }
  });
  page.on("response", (r) => {
    if (!isCandidateAttemptUrl(r.url())) return;
    const rec = trace.find(
      (t) =>
        t.url === r.url() &&
        t.method === r.request().method() &&
        t.status === undefined,
    );
    const target: TraceRecord = rec ?? {
      url: r.url(),
      method: r.request().method(),
      at: Date.now(),
    };
    if (!rec) trace.push(target);
    target.status = r.status();
    target.at = Date.now();
    void r
      .json()
      .then((b) => {
        target.body = b;
      })
      .catch(() => {
        target.body = "non-json";
      });
  });

  await candidateLogin(page, seeded.candidate);
  await startExamFromList(page, seeded.examId);
  await answerTrueFalse(page, true);
  await waitForSaveSaved(page);
  const attemptIdMatch = page.url().match(/\/exam\/([^/]+)\/take$/);
  if (!attemptIdMatch) {
    throw new Error("candidate is not on the take page");
  }
  const attemptId = attemptIdMatch[1]!;
  const radioFalse = page.getByTestId("true-false-false");
  await expect(radioFalse).toBeEnabled();
  await expect(page.getByTestId("take-submit-btn")).toBeVisible();

  // Context B: Admin (canonical Proctor dashboard).
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  let t0: number | null = null;
  let forceSubmitBody: unknown = null;
  await adminPage.route(
    "**/api/admin/attempts/*/force-submit",
    async (route) => {
      const resp = await route.fetch();
      forceSubmitBody = await resp.json();
      t0 = Date.now();
      await route.fulfill({
        status: resp.status(),
        contentType: "application/json",
        body: JSON.stringify(forceSubmitBody),
      });
    },
  );
  await loginAsAdmin(adminPage);
  await adminPage.goto(`/admin/exams/${seeded.examId}/proctor`);
  await adminPage.waitForURL("**/proctor**", { timeout: 15_000 });
  const fsBtn = adminPage.getByRole("button", { name: "强制交卷" });
  await expect(fsBtn.first()).toBeVisible({ timeout: 15_000 });
  await fsBtn.first().click();
  await expect(adminPage.getByText("确认强制交卷").first()).toBeVisible({
    timeout: 15_000,
  });
  await adminPage.getByRole("button", { name: "确认" }).click();
  // T0 = server force-submit commit (response observed inside context B).
  await expect.poll(() => t0, { timeout: 15_000 }).not.toBeNull();
  expect(forceSubmitBody).toMatchObject({ disposition: "applied" });
  const T0 = t0!;

  // Independent server confirmation of the commit (admin status API).
  const adminToken = await adminApiToken(request);
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${BASE}/api/admin/exams/${seeded.examId}/candidates/status`,
          { headers: { Cookie: `auth-token=${adminToken}` } },
        );
        if (!res.ok()) return "error";
        const body = (await res.json()) as {
          candidates: Array<{ attemptId: string | null; status: string }>;
        };
        return (
          body.candidates.find((c) => c.attemptId === attemptId)?.status ??
          "missing"
        );
      },
      { timeout: 15_000 },
    )
    .toBe("graded");

  return { seeded, attemptId, trace, T0, adminContext };
}

/** Waits for the FIRST heartbeat response recorded after T0. */
async function waitForFirstHeartbeatAfter(
  trace: TraceRecord[],
  attemptId: string,
  t0: number,
): Promise<TraceRecord> {
  let hb: TraceRecord | null = null;
  await expect
    .poll(
      () => {
        hb =
          trace.find(
            (t) =>
              t.url === `${BASE}/api/attempts/${attemptId}/heartbeat` &&
              t.method === "POST" &&
              t.at >= t0 &&
              t.status !== undefined,
          ) ?? null;
        return hb !== null;
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  return hb!;
}

/** Independent server-truth verification (B14 hard invariant). */
async function verifyServerTruth(
  request: APIRequestContext,
  seeded: Awaited<ReturnType<typeof seedExam>>,
  attemptId: string,
) {
  const candidateToken = await candidateApiToken(request, seeded.candidate);
  const takeRes = await request.get(
    `${BASE}/api/candidate/attempts/${attemptId}/take`,
    { headers: { Cookie: `auth-token=${candidateToken}` } },
  );
  expect(takeRes.ok()).toBe(true);
  const serverTruth = (await takeRes.json()) as {
    attemptStatus: string;
    gradingStatus: string;
    submittedAt: string | null;
    questions: Array<{ id: string; answerValue: unknown }>;
  };
  const serverQuestion = serverTruth.questions.find(
    (q) => q.id === seeded.questionId,
  );
  return {
    serverTruth,
    frozenAnswerValue: serverQuestion?.answerValue,
  };
}

test.describe("EXAM-519 candidate terminal convergence (regression)", () => {
  test.setTimeout(150_000);

  test("E1: save-triggered early convergence — terminal save rejection re-reads authority and locks the UI", async ({
    page,
    browser,
    request,
  }, testInfo) => {
    const { seeded, attemptId, trace, T0, adminContext } =
      await setupForceSubmitScenario(page, browser, request, "fs-converge-e1");

    // ── Deterministic signal ordering ───────────────────────────────────
    // The 30s heartbeat period has an uncontrolled phase relative to T0: a
    // heartbeat 409 landing inside the 1500ms save debounce would lock the
    // page before the save POST fires (execution-time canSave guard) and
    // flake this scenario. Hold the candidate heartbeat route until the
    // post-terminal save rejection is observed, making the save rejection
    // deterministically the FIRST terminal signal. Heartbeats after release
    // pass through normally (the post-lock no-op assertions still apply).
    const heartbeatGate: {
      promise: Promise<void>;
      resolve: (() => void) | null;
    } = { promise: Promise.resolve(), resolve: null };
    heartbeatGate.promise = new Promise<void>((resolve) => {
      heartbeatGate.resolve = resolve;
    });
    await page.route("**/api/attempts/*/heartbeat", async (route) => {
      await heartbeatGate.promise;
      await route.continue();
    });

    // ── Post-terminal stale save (manufactured in-page, no refresh) ─────
    // The page is still editable at T0 (no convergence yet): toggle the
    // answer; the 1500ms autosave debounce issues a REAL save POST.
    const radioFalse = page.getByTestId("true-false-false");
    const radioTrue = page.getByTestId("true-false-true");
    await radioFalse.check();
    const saveRespPromise = page.waitForResponse(
      (r) =>
        r.url() ===
          `${BASE}/api/attempts/${attemptId}/answers/${seeded.questionId}` &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    );
    const saveResp = await saveRespPromise;
    const saveBody = (await saveResp.json()) as {
      accepted?: boolean;
      reason?: string;
      serverVersion?: number;
    };
    const tSave = Date.now();
    expect(saveBody).toMatchObject({
      accepted: false,
      reason: "ATTEMPT_ALREADY_SUBMITTED",
    });
    // The save rejection is observed: release the held heartbeat(s).
    heartbeatGate.resolve?.();

    // ── E1 convergence: the terminal rejection triggers ONE re-read ─────
    await expect
      .poll(() => takeGetsAfter(trace, attemptId, T0).length, {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1);

    // Frozen snapshot applied → locked terminal UI, stale local edit gone.
    await expect(radioFalse).toBeDisabled();
    await expect(radioTrue).toBeDisabled();
    await expect(radioTrue).toBeChecked(); // frozen server answer wins (B17)
    await expect(radioFalse).not.toBeChecked();
    await expect(page.getByTestId("take-submit-btn")).not.toBeVisible();
    await expect(page.getByTestId("deadline-overlay")).toBeVisible();
    // Accurate terminal feedback retained — NOT suppressed.
    await expect(
      page.getByText("答案已提交，考试已结束").first(),
    ).toBeVisible();

    // ── Post-convergence heartbeat: 409 must NOT re-classify / re-read ──
    const hb = await waitForFirstHeartbeatAfter(trace, attemptId, T0);
    expect(hb.status).toBe(409);
    // No generic disconnect banner for a terminal attempt.
    await page.waitForTimeout(2_000); // bounded settle window after heartbeat
    expect(
      await page.getByText("连接异常").count(),
      "terminal heartbeat must not surface the generic disconnect banner",
    ).toBe(0);
    // The accurate terminal alert survived the heartbeat.
    await expect(
      page.getByText("答案已提交，考试已结束").first(),
    ).toBeVisible();
    // The 409-after-lock is a no-op: still exactly ONE re-read (no loop).
    expect(takeGetsAfter(trace, attemptId, T0)).toHaveLength(1);

    // ── B14: independent server truth — stale save never overwrites ─────
    const { serverTruth, frozenAnswerValue } = await verifyServerTruth(
      request,
      seeded,
      attemptId,
    );
    expect(frozenAnswerValue, "frozen submitted answer intact").toBe(true);
    expect(serverTruth.attemptStatus, "no status resurrection").toBe("graded");
    expect(serverTruth.submittedAt).not.toBeNull();

    await testInfo.attach("exam-519-e1-save-triggered.json", {
      body: JSON.stringify(
        {
          EXAM_519_E1: {
            T0,
            attemptId,
            saveRejection: saveBody,
            saveElapsedMs: tSave - T0,
            takeGetsAfterT0: takeGetsAfter(trace, attemptId, T0).length,
            heartbeatStatus: hb.status,
            // Heartbeats were gated until the save rejection (deterministic
            // signal ordering); elapsed is measured from T0 to the gated
            // response, NOT a natural phase measurement (E2 measures that).
            heartbeatGated: true,
            heartbeatElapsedMs: hb.at - T0,
            serverFinal: {
              attemptStatus: serverTruth.attemptStatus,
              gradingStatus: serverTruth.gradingStatus,
              frozenAnswerValue,
            },
          },
        },
        null,
        2,
      ),
    });
    await adminContext.close();
  });

  test("E2: heartbeat-only natural convergence — no candidate action, locked within one heartbeat period", async ({
    page,
    browser,
    request,
  }, testInfo) => {
    const { seeded, attemptId, trace, T0, adminContext } =
      await setupForceSubmitScenario(page, browser, request, "fs-converge-e2");

    // Candidate does NOTHING after T0: no save must occur on this path.
    const radioFalse = page.getByTestId("true-false-false");
    const radioTrue = page.getByTestId("true-false-true");

    // ── First REAL heartbeat after T0 is the terminal signal (409) ──────
    const hb = await waitForFirstHeartbeatAfter(trace, attemptId, T0);
    expect(hb.status).toBe(409);
    const heartbeatBody = hb.body as { error?: { code?: string } } | undefined;
    expect(heartbeatBody?.error?.code).toBe("INVALID_STATE_TRANSITION");
    // Convergence budget: within one heartbeat period (30s + tolerance).
    expect(
      hb.at - T0,
      "first terminal heartbeat within one period",
    ).toBeLessThanOrEqual(35_000);

    // ── The 409 triggers ONE authoritative re-read → locked UI ──────────
    await expect
      .poll(() => takeGetsAfter(trace, attemptId, T0).length, {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1);
    const takeGets = takeGetsAfter(trace, attemptId, T0);
    const firstTakeGet = takeGets[0];
    const convergenceMs = firstTakeGet ? firstTakeGet.at - T0 : undefined;

    await expect(radioFalse).toBeDisabled();
    await expect(radioTrue).toBeDisabled();
    await expect(radioTrue).toBeChecked(); // frozen answer still displayed
    await expect(page.getByTestId("take-submit-btn")).not.toBeVisible();
    await expect(page.getByTestId("deadline-overlay")).toBeVisible();
    // No generic disconnect messaging at any point on this path.
    expect(
      await page.getByText("连接异常").count(),
      "heartbeat-only convergence must never show the generic disconnect banner",
    ).toBe(0);
    expect(
      await page
        .getByText("系统会在连接恢复后继续保存，请不要关闭页面")
        .count(),
    ).toBe(0);
    // No save was manufactured: convergence was heartbeat-driven.
    expect(answerPostsAfter(trace, attemptId, T0)).toHaveLength(0);

    // ── B14: independent server truth unchanged ─────────────────────────
    const { serverTruth, frozenAnswerValue } = await verifyServerTruth(
      request,
      seeded,
      attemptId,
    );
    expect(frozenAnswerValue, "frozen submitted answer intact").toBe(true);
    expect(serverTruth.attemptStatus, "no status resurrection").toBe("graded");

    await testInfo.attach("exam-519-e2-heartbeat-only.json", {
      body: JSON.stringify(
        {
          EXAM_519_E2: {
            T0,
            attemptId,
            heartbeatStatus: hb.status,
            heartbeatCode: heartbeatBody?.error?.code,
            heartbeatElapsedMs: hb.at - T0,
            takeGetsAfterT0: takeGets.length,
            convergenceMs,
            answerPostsAfterT0: answerPostsAfter(trace, attemptId, T0).length,
            serverFinal: {
              attemptStatus: serverTruth.attemptStatus,
              gradingStatus: serverTruth.gradingStatus,
              frozenAnswerValue,
            },
          },
        },
        null,
        2,
      ),
    });

    // Durable digest copy (playwright-report attachments are not kept for
    // passed tests in this runner).
    mkdirSync("test-results", { recursive: true });
    appendFileSync(
      "test-results/exam-519-convergence-evidence.json",
      JSON.stringify({
        EXAM_519_E2: {
          T0,
          attemptId,
          heartbeatStatus: hb.status,
          heartbeatCode: heartbeatBody?.error?.code,
          heartbeatElapsedMs: hb.at - T0,
          takeGetsAfterT0: takeGets.length,
          convergenceMs,
          answerPostsAfterT0: answerPostsAfter(trace, attemptId, T0).length,
        },
      }) + "\n",
    );
    await adminContext.close();
  });
});
