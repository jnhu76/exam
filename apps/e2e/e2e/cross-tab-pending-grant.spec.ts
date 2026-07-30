/**
 * REC-I4-C1 — Dual-tab cross-tab pending grant coordination E2E.
 *
 * Drives the REAL production PendingGrantCoordinator (singleton) + the real
 * ProctorDashboard UI + the real server time-grants endpoint. It does NOT
 * hand-write localStorage or mint operationIds in-test — every authority
 * write/read goes through the production coordinator that the page uses.
 *
 * Two traces:
 *
 *   1. Tab A reserves a command and submits; the server commits but the
 *      response is masked as a 5xx so the dialog goes `indeterminate` (the
 *      coordinator KEEPS the frozen authority). Tab A is closed. Tab B opens
 *      the same attempt, the coordinator's getCurrent restores the frozen
 *      command, Tab B retries → server returns idempotent_replay → authority
 *      is cleared → the deadline increased EXACTLY ONCE (600s).
 *
 *   2. Tab A has a pending command for attempt A1. Tab B opens a DIFFERENT
 *      attempt (A2) and clicks 延长时间. The coordinator detects the pending
 *      command for a different attempt → warning toast → dialog does NOT open
 *      → NO time-grants POST is sent.
 *
 * CI fix history: this spec previously never logged the Playwright page into
 * the admin UI (only the API token was obtained), so every page.goto to
 * /admin/.../proctor hit the auth guard and redirected to the candidate list;
 * the 延长时间 button never rendered and the spec failed deterministically.
 * loginAsAdmin(page) now runs before every goto, BEFORE any localStorage write
 * (loginViaUi clears storage on /login).
 */

import { test, expect, type Request } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

/**
 * Fetches a candidate's deadlineAt (ms since epoch) from the proctor status
 * endpoint as the admin. Used to prove a single deadline effect (before vs
 * after == 600s).
 */
async function readDeadlineMs(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  examId: string,
  attemptId: string,
): Promise<number> {
  const res = await request.get(
    `${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/admin/exams/${examId}/candidates/status`,
    { headers: { Cookie: `auth-token=${token}` } },
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    candidates: Array<{ attemptId: string; deadlineAt: string | null }>;
  };
  const cand = body.candidates.find((c) => c.attemptId === attemptId);
  expect(cand, "seeded attempt must appear in candidates/status").toBeTruthy();
  expect(cand!.deadlineAt, "attempt must have a deadlineAt").toBeTruthy();
  return Date.parse(cand!.deadlineAt!);
}

test.describe("Dual-tab cross-tab pending grant (REC-I4-C1)", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let adminToken: string;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    const unique = `c1-dual-${Date.now()}`;
    // Operator time-grant requires operator_incident policy.
    seeded = await seedExam(request, unique, {
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

  /**
   * Helper: as the admin UI on `page`, open the grant dialog for the seeded
   * candidate, fill 10 minutes + a reason, and click the confirm button.
   * Assumes the page is already logged in as admin and on the proctor page.
   */
  async function submitTenMinuteGrant(page: import("@playwright/test").Page) {
    const extendBtn = page.getByRole("button", { name: "延长时间" });
    await expect(extendBtn.first()).toBeVisible({ timeout: 15_000 });
    await extendBtn.first().click();
    // Dialog title appears once the coordinator's getCurrent resolves.
    await expect(page.getByText("延长考试时间").first()).toBeVisible({
      timeout: 15_000,
    });
    // 10 minutes is the default; fill the reason and confirm.
    const reason = page.getByPlaceholder("请说明延长原因");
    await reason.fill("网络中断");
    const confirm = page.getByRole("button", { name: "延长 10 分钟" });
    await confirm.click();
  }

  /**
   * Trace 1: Tab A submits → server commits but response masked as 5xx →
   * dialog `indeterminate` (authority KEPT). Tab A closed. Tab B restores the
   * frozen command via getCurrent → retries → idempotent_replay → authority
   * cleared → deadline increased EXACTLY ONCE (600s).
   */
  test("Tab A lost-response → Tab B restores + retries → idempotent_replay, single deadline effect", async ({
    page,
    context,
    request,
  }) => {
    // IMPORTANT ordering: loginViaUi clears localStorage on /login. Because
    // localStorage is SHARED across pages in one browser context, logging in
    // Tab B AFTER Tab A has written the pending authority would wipe it. So
    // both tabs are logged in UP FRONT, before any authority is created.

    // ── Tab B: create + log in first (navigates to /admin/dashboard), so its
    //    login-time localStorage.clear() runs while there is no authority yet.
    const pageB = await context.newPage();
    await loginAsAdmin(pageB);

    // ── Tab A: log in, capture the baseline deadline, then submit with the
    //    response masked as a 5xx so the dialog goes `indeterminate` (the
    //    production coordinator KEEPS the authority; it is NOT cleared).
    await loginAsAdmin(page);
    const deadlineBefore = await readDeadlineMs(
      request,
      adminToken,
      seeded.examId,
      attemptId,
    );

    // Intercept the FIRST time-grants POST on Tab A: let the server really
    // commit (route.fetch), then mask the response as 500 so the page's
    // classifyGrantFailure maps it to `indeterminate` (status >= 500). The
    // coordinator does NOT clear the authority on an indeterminate failure,
    // so the frozen command stays persisted for Tab B to discover.
    let tabAGrantHappened = false;
    await page.route("**/api/admin/attempts/*/time-grants", async (route) => {
      if (tabAGrantHappened) {
        // Subsequent requests (e.g. Tab A retry) pass through unmodified.
        await route.continue();
        return;
      }
      tabAGrantHappened = true;
      // Really commit on the server so a replay returns idempotent_replay.
      await route.fetch();
      // Mask as a 5xx failure to drive the dialog to `indeterminate`. The
      // response body is irrelevant — classifyGrantFailure keys off status.
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "masked-for-indeterminate" }),
      });
    });

    await page.goto(`/admin/exams/${seeded.examId}/proctor`);
    await page.waitForURL("**/proctor**", { timeout: 15_000 });

    await submitTenMinuteGrant(page);

    // The dialog must be in `indeterminate` (warning toast), and the
    // production coordinator must have persisted the authority.
    await expect(page.getByText("未确认加时是否成功").first()).toBeVisible({
      timeout: 15_000,
    });

    // Verify the production coordinator actually wrote the shared authority.
    // The admin's (org, actor) key is built from the logged-in admin's ids.
    const authBefore = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith("exam.pendingGrantAuthority:"),
      );
      return keys.map((k) => ({
        key: k,
        value: JSON.parse(localStorage.getItem(k) ?? "null"),
      }));
    });
    expect(authBefore.length, "authority persisted after indeterminate").toBe(
      1,
    );
    expect(authBefore[0]!.value.command.attemptId).toBe(attemptId);
    expect(authBefore[0]!.value.command.addedSeconds).toBe(600);

    // ── Close Tab A (simulating the proctor walking away / closing the tab
    //    with an unresolved command). Tab B is already logged in and shares
    //    the same localStorage → it can discover the frozen authority.
    await page.close();

    await pageB.goto(`/admin/exams/${seeded.examId}/proctor`);
    await pageB.waitForURL("**/proctor**", { timeout: 15_000 });

    // ── Tab B: open the SAME attempt's grant dialog. The production
    //    coordinator's getCurrent must restore the frozen command
    //    (dialog shows the indeterminate banner + 重试同一加时 button).
    const extendBtnB = pageB.getByRole("button", { name: "延长时间" });
    await expect(extendBtnB.first()).toBeVisible({ timeout: 15_000 });
    await extendBtnB.first().click();
    await expect(pageB.getByText("延长考试时间").first()).toBeVisible({
      timeout: 15_000,
    });
    // The dialog restored to indeterminate (retry affordance visible).
    await expect(
      pageB.getByRole("button", { name: "重试同一加时" }),
    ).toBeVisible({ timeout: 15_000 });

    // ── Tab B retries the frozen command. The server already committed
    //    (from Tab A's route.fetch), so this MUST be idempotent_replay.
    await pageB.getByRole("button", { name: "重试同一加时" }).click();
    await expect(
      pageB.getByText("该加时已处理，未重复延长").first(),
    ).toBeVisible({ timeout: 15_000 });

    // The coordinator must have cleared the authority (compare-and-clear on
    // the confirmed outcome).
    const authAfter = await pageB.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("exam.pendingGrantAuthority:"),
        ).length,
    );
    expect(authAfter, "authority cleared after confirmed replay").toBe(0);

    // ── The deadline increased EXACTLY ONCE: 600s, not 1200s. This is the
    //    real C1 safety proof — server-side idempotency + coordinator both
    //    prevent a duplicate effect.
    const deadlineAfter = await readDeadlineMs(
      request,
      adminToken,
      seeded.examId,
      attemptId,
    );
    const deltaSec = Math.round((deadlineAfter - deadlineBefore) / 1000);
    expect(deltaSec).toBe(600);

    await pageB.close();
  });

  /**
   * Trace 2: Tab A creates a real pending command for attempt A1. Tab B opens a
   * DIFFERENT attempt (A2), clicks 延长时间 → the coordinator detects the
   * pending command for a different attempt → warning toast → the grant dialog
   * does NOT open → NO time-grants POST is sent.
   */
  test("Tab B blocked from granting a different attempt when Tab A has pending", async ({
    page,
    context,
  }) => {
    // Seed a SECOND exam + candidate + attempt for the different-attempt case.
    const seeded2 = await seedExam(page.request, `c1-block-${Date.now()}`, {
      interruptionTimePolicy: "operator_incident",
    });
    const candToken2 = await candidateLoginApi(
      page.request,
      seeded2.candidate.username,
      seeded2.candidate.password,
    );
    const attemptId2 = await candidateStartAttempt(
      page.request,
      candToken2,
      seeded2.examId,
    );

    // Capture every time-grants POST from Tab B so we can assert NONE was sent.
    const grantRequests: Request[] = [];

    // ── Tab B: create + log in FIRST. loginViaUi clears localStorage, and
    //    storage is shared across pages in one context — so Tab B's login must
    //    run BEFORE Tab A writes the pending authority, otherwise Tab B's login
    //    would wipe it.
    const pageB = await context.newPage();
    await loginAsAdmin(pageB);
    pageB.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/time-grants")) {
        grantRequests.push(req);
      }
    });

    // ── Tab A: log in, create a REAL pending command for attempt A1 by
    //    submitting a grant with the response masked as 5xx (indeterminate →
    //    the coordinator keeps the authority for A1).
    const pageA = page;
    await loginAsAdmin(pageA);

    let tabAGrantHappened = false;
    await pageA.route("**/api/admin/attempts/*/time-grants", async (route) => {
      if (tabAGrantHappened) {
        await route.continue();
        return;
      }
      tabAGrantHappened = true;
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "masked-for-indeterminate" }),
      });
    });

    await pageA.goto(`/admin/exams/${seeded.examId}/proctor`);
    await pageA.waitForURL("**/proctor**", { timeout: 15_000 });
    await submitTenMinuteGrant(pageA);
    // Confirm the pending command for A1 is persisted before opening Tab B.
    await expect(pageA.getByText("未确认加时是否成功").first()).toBeVisible({
      timeout: 15_000,
    });

    // ── Tab B: go to the SECOND exam's proctor page, attempt to open the
    //    grant dialog for attempt A2. The coordinator should detect the
    //    pending command for A1 (a different attempt) and block.
    await pageB.goto(`/admin/exams/${seeded2.examId}/proctor`);
    await pageB.waitForURL("**/proctor**", { timeout: 15_000 });

    const extendBtnB = pageB.getByRole("button", { name: "延长时间" });
    await expect(extendBtnB.first()).toBeVisible({ timeout: 15_000 });
    await extendBtnB.first().click();

    // The coordinator detected the pending command for a different attempt and
    // surfaced the blockedByPending warning (存在未确认的加时命令…).
    await expect(pageB.getByText("存在未确认的加时命令").first()).toBeVisible({
      timeout: 15_000,
    });

    // The grant dialog must NOT have opened.
    await expect(pageB.getByText("延长考试时间")).toHaveCount(0);

    // Definitive proof: NO time-grants POST was ever sent from Tab B.
    // Give the async coordinator check a brief window, then assert zero.
    await pageB.waitForTimeout(500);
    expect(grantRequests, "no second time-grants request").toHaveLength(0);

    await pageB.close();
  });
});
