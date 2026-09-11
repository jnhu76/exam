/**
 * EXAM-446 — Candidate convergence after Proctor force-submit (empirical probe).
 *
 * RESEARCH PROBE, not a feature test. The product question is:
 *
 *   After the server force-submits an attempt to a terminal state while the
 *   Candidate's TakeExamPage stays open (no refresh), what does the Candidate
 *   browser observe, and how long does convergence take?
 *
 * Design (per issue #446):
 *   - TWO independent browser contexts: A = Candidate (real UI login, real
 *     start/answer/save), B = Admin "proctor" (real ProctorDashboard, real
 *     force-submit dialog). No direct DB mutation, no client fake state.
 *   - T0 is the server force-submit commit, captured from the REAL
 *     force-submit response inside context B.
 *   - All candidate /api/attempts* and /api/candidate/attempts* traffic is
 *     recorded with wall-clock timestamps (no production instrumentation;
 *     pure Playwright network hooks).
 *   - The candidate page is NEVER refreshed or navigated after T0. Only one
 *     in-page probe action is performed: toggling the answer radio to
 *     manufacture a post-terminal save (B6/B14 stale-answer safety).
 *
 * Everything asserted here is a measurement of CURRENT behavior; the spec
 * intentionally does not assert "correct" convergence — it records what
 * happens and independently verifies server truth.
 */
import { test, expect } from "@playwright/test";
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

test.describe("EXAM-446 force-submit convergence probe", () => {
  test.setTimeout(150_000);

  test("measures candidate convergence after proctor force-submit (two contexts, no refresh)", async ({
    page,
    browser,
    request,
  }, testInfo) => {
    // ── Seed a canonical live exam (published, enrolled, 1 true_false Q) ──
    const seeded = await seedExam(request, "fs-converge", {
      questionAnswer: true,
      questionScore: 100,
    });

    // ── Context A: Candidate ──────────────────────────────────────────
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
    const attemptId = page.url().match(/\/exam\/([^/]+)\/take$/)?.[1];
    expect(attemptId, "candidate is on the take page").toBeTruthy();
    // A saved answer exists; the page is fully editable.
    const radioFalse = page.getByTestId("true-false-false");
    await expect(radioFalse).toBeEnabled();
    await expect(page.getByTestId("take-submit-btn")).toBeVisible();

    // ── Context B: Admin (canonical Proctor dashboard) ────────────────
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

    // ── B5: Candidate editable-state probe (immediately after T0) ─────
    const editableProbe = {
      radioFalseEnabled: await radioFalse.isEnabled(),
      radioTrueChecked: await page.getByTestId("true-false-true").isChecked(),
      submitBtnVisible: await page.getByTestId("take-submit-btn").isVisible(),
      lockedOverlayVisible: await page
        .getByTestId("deadline-overlay")
        .isVisible()
        .catch(() => false),
      url: page.url(),
    };

    // ── B6/B14: post-terminal save probe ──────────────────────────────
    // Manufacture a candidate-side save AFTER server terminalization: toggle
    // the answer. The 1500ms autosave debounce then issues a real save POST.
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
    const saveProbe = {
      sent: true,
      status: saveResp.status(),
      body: saveBody,
      clientSeqBody: (await saveResp.request().postDataJSON()) as Record<
        string,
        unknown
      >,
    };

    // Client-visible reaction to the rejected save (isDisconnected is still
    // false here — the heartbeat has not failed yet).
    const endedAlert = page.getByText("答案已提交，考试已结束").first();
    let saveRejectionAlertVisible = false;
    try {
      await endedAlert.waitFor({ state: "visible", timeout: 10_000 });
      saveRejectionAlertVisible = true;
    } catch {
      saveRejectionAlertVisible = false;
    }

    // ── B7: heartbeat probe — wait for the FIRST real heartbeat response
    //    after T0 (period is 30s; bounded by a real response event) ─────
    let hb: TraceRecord | null = null;
    await expect
      .poll(
        () => {
          hb =
            trace.find(
              (t) =>
                t.url === `${BASE}/api/attempts/${attemptId}/heartbeat` &&
                t.method === "POST" &&
                t.at >= T0 &&
                t.status !== undefined,
            ) ?? null;
          return hb !== null;
        },
        { timeout: 45_000 },
      )
      .toBe(true);
    const heartbeatProbe = {
      elapsedMs: hb!.at - T0,
      status: hb!.status,
      body: hb!.body,
    };

    // Client classification: the heartbeat failure flips the UI to the
    // generic disconnect banner ("连接异常" + restore hint).
    let disconnectAlertVisibleAt: number | null = null;
    try {
      await page
        .getByText("连接异常")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
      disconnectAlertVisibleAt = Date.now();
    } catch {
      disconnectAlertVisibleAt = null;
    }

    // ── B8: authoritative reconciliation probe ────────────────────────
    // The take snapshot is the authoritative state the client would need to
    // reconstruct the locked view. Count take GETs issued after T0 (a
    // convergence-capable client would issue one here).
    await page.waitForTimeout(2_000); // bounded settle window after heartbeat
    const takeGetsAfterT0 = trace.filter(
      (t) =>
        t.url === `${BASE}/api/candidate/attempts/${attemptId}/take` &&
        t.method === "GET" &&
        t.at >= T0,
    );
    const finalProbe = {
      urlAfterWindow: page.url(),
      radioTrueCheckedAfter: await page
        .getByTestId("true-false-true")
        .isChecked(),
      radioFalseCheckedAfter: await page
        .getByTestId("true-false-false")
        .isChecked(),
      submitBtnVisibleAfter: await page
        .getByTestId("take-submit-btn")
        .isVisible(),
      lockedOverlayVisibleAfter: await page
        .getByTestId("deadline-overlay")
        .isVisible()
        .catch(() => false),
      disconnectAlertVisible: disconnectAlertVisibleAt !== null,
      endedAlertVisibleAfterHeartbeat: await page
        .getByText("答案已提交，考试已结束")
        .first()
        .isVisible()
        .catch(() => false),
    };

    // ── B9: independent server verification ───────────────────────────
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    // (adminApiToken imported from flow.ts; the status poll above uses it too)
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
    const serverFinal = {
      attemptStatus: serverTruth.attemptStatus,
      gradingStatus: serverTruth.gradingStatus,
      submittedAt: serverTruth.submittedAt,
      savedAnswerValue: serverQuestion?.answerValue,
    };

    // ── Probe record: the whole timeline as executable evidence ───────
    const timeline = trace.map((t) => ({
      url: t.url.replace(`${BASE}`, ""),
      method: t.method,
      status: t.status,
      at: t.at,
      elapsedMs: t.at - T0,
    }));

    await testInfo.attach("exam-446-probe-evidence.json", {
      body: JSON.stringify(
        {
          EXAM_446_PROBE: {
            T0,
            attemptId,
            examId: seeded.examId,
            forceSubmitDisposition: forceSubmitBody,
            editableProbe,
            saveProbe,
            saveRejectionAlertVisible,
            heartbeatProbe,
            disconnectAlertVisibleAt,
            reconciliationProbe: {
              takeGetsAfterT0: takeGetsAfterT0.length,
              takeGetElapsedMs: takeGetsAfterT0.map((t) => t.at - T0),
            },
            finalProbe,
            serverFinal,
            timeline,
          },
        },
        null,
        2,
      ),
    });
    // Durable digest copy: playwright-report/ attachments are not kept for
    // passed tests in this runner, so the probe evidence is also appended to
    // the gitignored test-results dir for post-run inspection.
    mkdirSync("test-results", { recursive: true });
    appendFileSync(
      "test-results/exam-446-probe-evidence.json",
      JSON.stringify({
        EXAM_446_PROBE: {
          T0,
          attemptId,
          examId: seeded.examId,
          forceSubmitDisposition: forceSubmitBody,
          editableProbe,
          saveProbe,
          saveRejectionAlertVisible,
          heartbeatProbe,
          disconnectAlertVisibleAt,
          reconciliationProbe: {
            takeGetsAfterT0: takeGetsAfterT0.length,
            takeGetElapsedMs: takeGetsAfterT0.map((t) => t.at - T0),
          },
          finalProbe,
          serverFinal,
          timeline,
        },
      }) + "\n",
    );

    // ── Hard invariants (B14) ─────────────────────────────────────────
    // A stale post-terminal save must NOT overwrite server truth.
    expect(serverQuestion?.answerValue, "frozen submitted answer intact").toBe(
      true,
    );
    expect(serverTruth.attemptStatus, "no status resurrection").toBe("graded");
    await adminContext.close();
  });
});
