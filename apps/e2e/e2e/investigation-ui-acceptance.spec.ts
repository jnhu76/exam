import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  answerTrueFalse,
  candidateApiToken,
  candidateLogin,
  candidateStartAttempt,
  loginAsCandidate,
  startExamFromList,
} from "../lib/flow";

/**
 * Posts one client event through the REAL ingestion endpoint with a
 * candidate-controlled occurredAt (advisory claim — #874).
 */
async function postClientEvent(
  request: APIRequestContext,
  candidateToken: string,
  event: {
    name: string;
    occurredAt: string;
    attemptId: string;
    examId: string;
  },
): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/client-events`, {
    headers: { Cookie: `auth-token=${candidateToken}` },
    data: {
      events: [
        {
          kind: "exam_telemetry",
          level: "info",
          metadata: {},
          ...event,
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  expect(((await res.json()) as { accepted: number }).accepted).toBe(1);
}

/**
 * #856 browser acceptance for PR-C (#851).
 *
 * The component suites prove the filter controls are wired to the query
 * builder at the DOM boundary. This spec proves the same predicates reach the
 * real API and change what the browser renders, against real PostgreSQL:
 *
 * - A3-F2: AuditLogPage targetId/actorId exact filters + targetType vocabulary
 *   (the original gate is filters + vocabulary; A3-F7 owns navigation links);
 * - A3-F3: RecoveryQueuePage attemptId / incidentType / assignedProctorUserId;
 * - A3-F7: monitoring → attempt detail → recovery → candidate profile links;
 * - Layout: both surfaces stay inside a 390px viewport (AGENTS.md §7).
 *
 * Every negative assertion uses a value that cannot match, so a filter that
 * silently degrades to a no-op fails the test instead of passing it.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * PR-T evidence screenshots (M3, #860/#874 adjudication). Overridable so CI
 * keeps the zero-artifact contract; the local adjudication run points this at
 * the evidence directory it owns.
 */
const SHOT_DIR = process.env.E2E_PRT_SHOT_DIR ?? "test-results/pr-t-evidence";

/**
 * The data surfaces render their desktop and mobile realizations together and
 * hide one by CSS. A bare `getByText(...).first()` can therefore bind to the
 * hidden copy; assertions must target the realization the current viewport
 * actually shows.
 */
function visibleText(
  page: Page,
  text: string,
  options: { exact?: boolean } = {},
): Locator {
  return page
    .getByText(text, { exact: options.exact ?? false })
    .filter({ visible: true })
    .first();
}

async function createIncident(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
  input: { attemptId: string; candidateId: string; type: string },
): Promise<string> {
  const res = await request.post(
    `${BASE_URL}/api/admin/exams/${examId}/incidents`,
    {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        operationId: crypto.randomUUID(),
        description: `E2E 调查 UI 验收 ${crypto.randomUUID()}`,
        severity: "major",
        ...input,
      },
    },
  );
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { incident: { id: string } };
  return body.incident.id;
}

/** Page-level horizontal overflow, not a scroll container's local scroll. */
async function expectNoPageOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        return metrics.scrollWidth - metrics.clientWidth;
      },
      {
        timeout: 5_000,
        message: "page must not overflow horizontally at this viewport",
      },
    )
    .toBeLessThanOrEqual(1);
}

test.describe("investigation UI browser acceptance (#856)", () => {
  test("A3-F2: audit exact filters reach the server and narrow visible rows", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "audit-ui");
    const adminToken = await adminApiToken(request);

    // Oracle from the real endpoint: the seed must have produced the row we
    // will look for, including the actor id the UI filter needs.
    const auditRes = await request.get(
      `${BASE_URL}/api/admin/audit-logs?targetType=question&targetId=${seeded.questionId}&limit=10`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(auditRes.ok(), await auditRes.text()).toBe(true);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ action: string; actorId: string; targetId: string }>;
    };
    const questionRow = auditBody.items.find(
      (item) => item.action === "question.create",
    );
    expect(
      questionRow,
      "seed must emit a question.create audit row",
    ).toBeTruthy();
    expect(questionRow!.targetId).toBe(seeded.questionId);

    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");
    await expect(visibleText(page, "创建考试", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // targetType vocabulary: "question" is selectable, not a UI-chosen subset.
    await page.getByRole("combobox", { name: "全部目标" }).click();
    await page.getByRole("option", { name: "题目", exact: true }).click();

    await page.getByLabel("对象 ID").fill(seeded.questionId);
    await page.getByLabel("对象 ID").press("Enter");

    await expect(visibleText(page, "创建题目", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("创建考试", { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);

    // actorId is the second exact-predicate channel.
    await page.getByLabel("操作者 ID").fill(questionRow!.actorId);
    await page.getByLabel("操作者 ID").press("Enter");
    await expect(visibleText(page, "创建题目", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("创建考试", { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);

    // A non-matching actor must empty the list. If the predicate were ignored
    // the question row would survive and this assertion would fail.
    await page.getByLabel("操作者 ID").fill(crypto.randomUUID());
    await page.getByLabel("操作者 ID").press("Enter");
    await expect(visibleText(page, "暂无审计日志")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "清空筛选" }).click();
    await expect(visibleText(page, "创建考试", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("A3-F3: recovery queue filters are real server predicates", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "recovery-ui");
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );
    await createIncident(request, adminToken, seeded.examId, {
      attemptId,
      candidateId: seeded.candidate.profileId,
      type: "network_interruption",
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery?attemptId=${attemptId}`);
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });

    // Non-matching attempt id => explicit empty state (predicate applied).
    await page.getByLabel("答卷 ID").fill(crypto.randomUUID());
    await page.getByLabel("答卷 ID").press("Enter");
    await expect(
      visibleText(page, "当前筛选条件下没有匹配的中断事件。"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("答卷 ID").fill(attemptId);
    await page.getByLabel("答卷 ID").press("Enter");
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });

    // incidentType: matching type keeps the row...
    await page.getByRole("combobox", { name: "全部类型" }).click();
    await page.getByRole("option", { name: "网络中断", exact: true }).click();
    await expect(page).toHaveURL(/incidentType=network_interruption/);
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });

    // ...a different type removes it, and the state is URL-addressable.
    await page.getByRole("combobox", { name: "全部类型" }).click();
    await page.getByRole("option", { name: "设备故障", exact: true }).click();
    await expect(
      visibleText(page, "当前筛选条件下没有匹配的中断事件。"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("combobox", { name: "全部类型" }).click();
    await page.getByRole("option", { name: "全部类型", exact: true }).click();
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });

    // assignedProctorUserId: the unassigned id must not match this incident.
    await page.getByLabel("监考人员 ID").fill(crypto.randomUUID());
    await page.getByLabel("监考人员 ID").press("Enter");
    await expect(
      visibleText(page, "当前筛选条件下没有匹配的中断事件。"),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("监考人员 ID").fill("");
    await page.getByLabel("监考人员 ID").press("Enter");
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("A3-F7: investigation surfaces deep-link into one investigation chain", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "deeplink-ui");
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );
    const incidentId = await createIncident(
      request,
      adminToken,
      seeded.examId,
      {
        attemptId,
        candidateId: seeded.candidate.profileId,
        type: "network_interruption",
      },
    );

    await loginAsAdmin(page);

    // attempt detail -> recovery attempt archive
    await page.goto(`/admin/attempts/${attemptId}`);
    await page.getByRole("button", { name: "恢复档案" }).click();
    await page.waitForURL(`**/admin/recovery/attempts/${attemptId}`);
    await expect(visibleText(page, "答题操作详情")).toBeVisible({
      timeout: 30_000,
    });

    // monitoring row -> recovery attempt archive
    await page.goto(`/admin/exams/${seeded.examId}/proctor/monitor`);
    const monitorRow = page
      .getByRole("row")
      .filter({ hasText: seeded.candidate.name });
    await expect(monitorRow).toBeVisible({ timeout: 30_000 });
    await monitorRow.getByRole("button", { name: "恢复档案" }).click();
    await page.waitForURL(`**/admin/recovery/attempts/${attemptId}`);

    // recovery queue row -> incident detail
    await page.goto(`/admin/recovery?attemptId=${attemptId}`);
    const recoveryRow = page
      .getByRole("row")
      .filter({ hasText: seeded.examTitle });
    await expect(recoveryRow).toBeVisible({ timeout: 30_000 });
    await recoveryRow.getByRole("link").first().click();
    await page.waitForURL(`**/admin/recovery/incidents/${incidentId}`);
    await expect(visibleText(page, "事件详情")).toBeVisible({
      timeout: 30_000,
    });

    // candidate profile -> recovery queue filtered by candidate
    await page.goto("/admin/candidates");
    await page.getByLabel("搜索考生").fill(seeded.candidate.name);
    const candidateRow = page
      .getByRole("row")
      .filter({ hasText: seeded.candidate.name });
    await expect(candidateRow).toBeVisible({ timeout: 30_000 });
    await candidateRow.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "恢复事件" }).click();
    await page.waitForURL(
      `**/admin/recovery?candidateId=${seeded.candidate.profileId}`,
    );
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("390px: audit and recovery surfaces stay inside the viewport", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "narrow-ui");
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );
    await createIncident(request, adminToken, seeded.examId, {
      attemptId,
      candidateId: seeded.candidate.profileId,
      type: "network_interruption",
    });

    await loginAsAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/admin/audit-logs");
    await expect(page.getByLabel("对象 ID")).toBeVisible({ timeout: 30_000 });
    await expectNoPageOverflow(page);
    await expect(page.getByLabel("操作者 ID")).toBeVisible();

    // The exact filter must stay operable at this width, not merely present.
    await page.getByLabel("对象 ID").fill(seeded.questionId);
    await page.getByLabel("对象 ID").press("Enter");
    await expect(visibleText(page, "创建题目", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expectNoPageOverflow(page);

    await page.goto(`/admin/recovery?attemptId=${attemptId}`);
    await expect(visibleText(page, seeded.examTitle)).toBeVisible({
      timeout: 30_000,
    });
    await expectNoPageOverflow(page);
    await expect(page.getByLabel("答卷 ID")).toBeVisible();
  });

  // #874 PR-R (temporal read totality) browser acceptance: rows already
  // stored with extreme client-claimed occurredAt (1900 / 0001) used to 500
  // the whole timeline endpoint, so the attempt page rendered a load-failure
  // state. They must now render — with the year exact and the claim shown as
  // the raw UTC ISO text under a client-declared (UTC) label — and the page
  // must stay operable (no overflow, no uncaught Date parse errors), with the
  // monitoring dialog still anchored on the server receive instant.
  test("extreme client-claimed dates render as exact UTC text without breaking the attempt page", async ({
    page,
    request,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const seeded = await seedExam(request, "extreme-date");
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );

    // Extreme claims first POSTed through the real ingestion endpoint (the
    // write path keeps accepting 0001–9999; PR-W owns the year-0000 guard).
    await postClientEvent(request, candidateToken, {
      name: "visibility_lost",
      occurredAt: "1900-01-01T00:00:00.000Z",
      attemptId,
      examId: seeded.examId,
    });
    await postClientEvent(request, candidateToken, {
      name: "browser_offline",
      occurredAt: "0001-01-01T00:00:00.000000Z",
      attemptId,
      examId: seeded.examId,
    });
    // A current, client-valid date shares the timeline with the extremes.
    await postClientEvent(request, candidateToken, {
      name: "heartbeat_ok",
      occurredAt: new Date().toISOString(),
      attemptId,
      examId: seeded.examId,
    });

    // Endpoint oracle: the timeline API must serve the attempt (no 500).
    const adminToken = await adminApiToken(request);
    const apiRes = await request.get(
      `${BASE_URL}/api/admin/attempts/${attemptId}/proctor-events?limit=50&page=1`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(apiRes.ok(), await apiRes.text()).toBe(true);
    const apiBody = (await apiRes.json()) as {
      items: Array<{ name: string; occurredAt: string; source: string }>;
    };
    const apiByName = new Map(apiBody.items.map((i) => [i.name, i]));
    expect(apiByName.get("visibility_lost")!.occurredAt).toBe(
      "1900-01-01T00:00:00.000000Z",
    );
    expect(apiByName.get("browser_offline")!.occurredAt).toBe(
      "0001-01-01T00:00:00.000000Z",
    );
    expect(apiByName.get("heartbeat_ok")!.source).toBe("client_event");

    // Browser: the extreme rows render with the exact stored year, and the
    // claim is labeled as a client-declared UTC value next to the server
    // receive instant (the primary row time).
    await loginAsAdmin(page);
    await page.goto(`/admin/attempts/${attemptId}`);
    await expect(page.getByText("遥测时间线")).toBeVisible({
      timeout: 30_000,
    });

    const clientRow = page
      .getByText("visibility_lost")
      .locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' flex flex-wrap ')]",
      )
      .first();
    await expect(clientRow).toBeVisible({ timeout: 30_000 });
    const clientRowText = (await clientRow.textContent()) ?? "";
    // Year exact (the old decoder turned 0001 into 2001); µs wire text
    // verbatim, never re-formatted through a timezone formatter.
    expect(clientRowText).toContain("客户端声明（UTC）");
    expect(clientRowText).toContain("1900-01-01T00:00:00.000000Z");
    expect(clientRowText).not.toContain("2001");
    expect(clientRowText).toMatch(/服务端接收.*客户端声明（UTC）/);

    const offlineRowText =
      (await page
        .getByText("browser_offline")
        .locator(
          "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' flex flex-wrap ')]",
        )
        .first()
        .textContent()) ?? "";
    expect(offlineRowText).toContain("0001-01-01T00:00:00.000000Z");

    // Scrolling to the timeline footer works — the page is not wedged.
    await page.getByText(/已显示 3 \/ 3 条事件/).scrollIntoViewIfNeeded();
    await expect(page.getByText(/已显示 3 \/ 3 条事件/)).toBeVisible();

    await expect.poll(() => pageErrors, { timeout: 5_000 }).toEqual([]);

    // Desktop screenshot evidence (kept in the Playwright output dir; copied
    // out of band for the adjudication record).
    await page.getByText("遥测时间线").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("pr-r-attempt-extreme-dates.png"),
      fullPage: true,
    });

    // Narrow viewport: the long µs ISO text must wrap, not overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoPageOverflow(page);
    await expect(clientRow).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pr-r-attempt-extreme-dates-390px.png"),
      fullPage: true,
    });

    // The monitoring dialog keeps the server receive instant as the row time
    // and does not re-sort or break on the extreme claims (no client
    // occurredAt is shown there at all).
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/admin/exams/${seeded.examId}/proctor/monitor`);
    const monitorRow = page
      .getByRole("row")
      .filter({ hasText: seeded.candidate.name });
    await expect(monitorRow).toBeVisible({ timeout: 30_000 });
    await monitorRow.getByRole("button", { name: "时间线" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/事件时间线/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(dialog.getByText("visibility_lost")).toBeVisible();
    await expect(dialog.getByText("browser_offline")).toBeVisible();
    // The dialog shows no client-claimed label and no extreme-year text: its
    // row time is exclusively the server receive instant.
    await expect(dialog.getByText(/客户端声明/)).toHaveCount(0);
    await expect(dialog.getByText(/1900-01-01/)).toHaveCount(0);
    await expect(dialog.getByText(/0001-01-01/)).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("pr-r-monitor-dialog-extreme-dates.png"),
    });
  });

  // #874 PR-W browser acceptance: the candidate take page runs the REAL
  // logger → ClientEventBuffer → postClientEvents chain, so (1) events queued
  // while the browser context is offline must reach the server after reconnect
  // (bounded-backoff recovery, no loss), and (2) a year-0000 poison batch
  // posted from the page's own session must be rejected ATOMICALLY by the
  // real server with the standard 400 naming events.<index>.occurredAt, leave
  // zero rows, and leave the ingestion channel fully usable for the valid
  // remainder resent under the SAME eventIds (first-write-wins dedup absorbs
  // an ACK-loss resend without extra rows).
  test("#874 PR-W: offline recovery sending and atomic year-0000 poison-batch rejection", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    const seeded = await seedExam(request, "poison-batch");
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    const adminToken = await adminApiToken(request);

    // Real candidate page (real buffer/transport bundled in the web app).
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    // Restore-start over the API returns the SAME in-flight attempt id.
    const attemptId = await candidateStartAttempt(
      request,
      candidateToken,
      seeded.examId,
    );

    const timelineNames = async (): Promise<string[]> => {
      const res = await request.get(
        `${BASE_URL}/api/admin/attempts/${attemptId}/proctor-events?limit=50&page=1`,
        { headers: { Cookie: `auth-token=${adminToken}` } },
      );
      expect(res.ok(), await res.text()).toBe(true);
      return (
        (await res.json()) as { items: Array<{ name: string }> }
      ).items.map((i) => i.name);
    };

    // --- 1. Browser recovery flow: offline queueing → reconnect → delivery.
    await page.context().setOffline(true);
    // Keep the offline window long enough for one real failed flush attempt
    // (the buffer timer fires every 5s), so recovery also exercises the
    // bounded-backoff path, not just a first-try success.
    await page.waitForTimeout(6_500);
    await page.context().setOffline(false);

    await expect
      .poll(
        async () =>
          (await timelineNames()).some((n) => n === "browser_offline"),
        {
          timeout: 90_000,
          message:
            "the event buffered while offline must reach the server after reconnect",
        },
      )
      .toBe(true);
    await expect
      .poll(
        async () => (await timelineNames()).some((n) => n === "browser_online"),
        {
          timeout: 30_000,
          message: "the reconnect event must reach the server too",
        },
      )
      .toBe(true);

    // --- 2. Poison batch through the page's own session (real cookies, real
    // Fastify schema serializer, real PostgreSQL): mixed [valid, year-0000,
    // valid] must return the standard 400 VALIDATION_ERROR naming the exact
    // sub-batch index, and store zero rows.
    const postFromPage = (
      events: unknown[],
    ): Promise<{
      status: number;
      body: {
        accepted?: number;
        error?: {
          code?: string;
          details?: { fields?: Array<{ field: string }> };
        };
      };
    }> =>
      page.evaluate(async (payload) => {
        const res = await fetch("/api/client-events", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: payload }),
        });
        return { status: res.status, body: await res.json() };
      }, events);

    const validBefore = {
      kind: "exam_telemetry",
      level: "info",
      name: "poison_batch_mix_valid_before",
      occurredAt: new Date().toISOString(),
      attemptId,
      examId: seeded.examId,
      eventId: "e2e-poison-batch-valid-a-00000001",
    };
    const validAfter = {
      kind: "exam_telemetry",
      level: "info",
      name: "poison_batch_mix_valid_after",
      occurredAt: new Date().toISOString(),
      attemptId,
      examId: seeded.examId,
      eventId: "e2e-poison-batch-valid-b-00000001",
    };
    const poison = {
      kind: "exam_telemetry",
      level: "info",
      name: "poison_batch_mix_year0000",
      occurredAt: "0000-01-01T00:00:00.000Z",
      attemptId,
      examId: seeded.examId,
      eventId: "e2e-poison-batch-year0000-00000001",
    };

    const mixed = await postFromPage([validBefore, poison, validAfter]);
    expect(mixed.status).toBe(400);
    expect(mixed.body.error?.code).toBe("VALIDATION_ERROR");
    const fieldPaths = (mixed.body.error?.details?.fields ?? []).map(
      (f) => f.field,
    );
    expect(fieldPaths).toContain("events.1.occurredAt");

    // Atomic batch: not a single event of the rejected batch reached storage.
    const afterRejection = await timelineNames();
    expect(afterRejection).not.toContain("poison_batch_mix_valid_before");
    expect(afterRejection).not.toContain("poison_batch_mix_year0000");
    expect(afterRejection).not.toContain("poison_batch_mix_valid_after");

    // --- 3. Isolation + resend: a conforming client drops ONLY the named
    // event and resends the valid remainder with the SAME eventIds.
    const resend = await postFromPage([validBefore, validAfter]);
    expect(resend.status).toBe(200);
    expect(resend.body.accepted).toBe(2);
    const afterResend = await timelineNames();
    expect(afterResend).toContain("poison_batch_mix_valid_before");
    expect(afterResend).toContain("poison_batch_mix_valid_after");

    // --- 4. ACK loss: the identical resend is absorbed by the (org, user,
    // eventId) dedup key — accepted stays 2 and no extra rows appear.
    const ackLossResend = await postFromPage([validBefore, validAfter]);
    expect(ackLossResend.status).toBe(200);
    expect(ackLossResend.body.accepted).toBe(2);
    const finalNames = await timelineNames();
    expect(
      finalNames.filter((n) => n === "poison_batch_mix_valid_before"),
    ).toHaveLength(1);
    expect(
      finalNames.filter((n) => n === "poison_batch_mix_valid_after"),
    ).toHaveLength(1);
    expect(finalNames).not.toContain("poison_batch_mix_year0000");

    // --- 5. Visual evidence: the attempt timeline shows the recovered rows
    // and stays operable at desktop and 390px widths.
    await loginAsAdmin(page);
    await page.goto(`/admin/attempts/${attemptId}`);
    await expect(page.getByText("遥测时间线")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByText("遥测时间线").scrollIntoViewIfNeeded();
    await expect(page.getByText("poison_batch_mix_valid_before")).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({
      path: testInfo.outputPath("pr-w-attempt-poison-recovery.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoPageOverflow(page);
    await expect(page.getByText("poison_batch_mix_valid_before")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pr-w-attempt-poison-recovery-390px.png"),
      fullPage: true,
    });
  });

  // ── M3 (#860 PR-T): correlation trust in one real investigation flow ──
  // One focused browser journey covering the whole trust chain end-to-end:
  //
  // 1. A save that fails with a SERVER-fault envelope (the test intercepts
  //    the answer-save POST and answers a real-shaped 500 carrying a FORGED
  //    requestId) surfaces the 错误编号 banner for support correlation;
  // 2. the client's own telemetry row (client_event, allowlisted
  //    requestId/status/errorCode) reaches the real server and is rendered in
  //    BOTH admin surfaces ONLY inside the explicit
  //    "客户端声明，未经服务端核验" group — a forged/claimed value is
  //    visible as a correlation CANDIDATE, never as a verified identity;
  // 3. the monitoring dialog badges rows by their REAL source (server
  //    audit rows show 操作, not the kind-derived 前端);
  // 4. server audit rows (attempt.misconductFlagged → mark_misconduct) are
  //    never marked as client claims;
  // 5. the detail surface stays inside a 390px viewport.
  test("M3: save-fault banner, client-claimed telemetry labels, and monitoring dialog source badges", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const seeded = await seedExam(request, "trust-ui");
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateApiToken(request, seeded.candidate);

    await loginAsCandidate(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);

    const detailRes = await request.get(
      `${BASE_URL}/api/candidate/exams/${seeded.examId}`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(detailRes.ok(), await detailRes.text()).toBe(true);
    const attemptId = ((await detailRes.json()) as { activeAttemptId?: string })
      .activeAttemptId;
    expect(
      attemptId,
      "seeded candidate must have an active attempt",
    ).toBeTruthy();

    // Inject a real-shaped server-fault envelope with a FORGED requestId.
    // The value is a syntactically valid RFC 4122 UUIDv4 (version 4 /
    // RFC variant bits set) so it survives the timeline's UUID shape gate;
    // shape legality is form only, not verification — it stays a forged,
    // unverified client claim and must never be promoted to server
    // authority. The page's own save path, banner logic, and telemetry
    // recorder run for real against it; only the network answer is the
    // injected fault.
    const forgedRequestId = "00000000-0000-4000-8000-000000000bad";
    await page.route("**/api/attempts/*/answers/*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "内部错误",
              requestId: forgedRequestId,
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    const telemetryAccepted = page.waitForResponse(
      (res) =>
        res.url().includes("/api/client-events") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 30_000 },
    );
    await answerTrueFalse(page, true);

    // 1. Server-fault banner: the envelope requestId is the candidate-facing
    //    support correlation clue.
    const banner = page.getByTestId("server-fault-alert");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText("服务器错误");
    await expect(banner).toContainText(`错误编号：${forgedRequestId}`);
    await page.screenshot({
      path: `${SHOT_DIR}/01-save-fault-banner.png`,
      fullPage: true,
    });

    // 2. The client's telemetry row (with the claimed requestId/status in its
    //    allowlisted metadata) reached the real server.
    const telemetryRes = await telemetryAccepted;
    expect(
      ((await telemetryRes.json()) as { accepted: number }).accepted,
    ).toBeGreaterThanOrEqual(1);

    // Server-authoritative audit row for the same attempt (real API).
    const misconduct = await request.post(
      `${BASE_URL}/api/admin/attempts/${attemptId}/misconduct`,
      {
        headers: { Cookie: `auth-token=${adminToken}` },
        data: {
          operationId: crypto.randomUUID(),
          severity: "warning",
          notes: "PR-T 调查流验收",
        },
      },
    );
    expect(misconduct.ok(), await misconduct.text()).toBe(true);

    // 3. Monitoring dialog: client telemetry labeled unverified, audit row
    //    badged from its real source.
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${seeded.examId}/proctor/monitor`);
    const monitorRow = page
      .getByRole("row")
      .filter({ hasText: seeded.candidate.name });
    await expect(monitorRow).toBeVisible({ timeout: 30_000 });
    await monitorRow.getByRole("button", { name: "时间线" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("answer_autosave_failed")).toBeVisible({
      timeout: 30_000,
    });

    const clientDialogRow = dialog
      .locator("div.rounded-md.border", { hasText: "answer_autosave_failed" })
      .first();
    const clientDialogText = (await clientDialogRow.innerText()) ?? "";
    expect(clientDialogText).toContain("客户端声明，未经服务端核验");
    expect(clientDialogText).toContain(forgedRequestId);

    const auditDialogRow = dialog
      .locator("div.rounded-md.border", { hasText: "mark_misconduct" })
      .first();
    const auditDialogText = (await auditDialogRow.innerText()) ?? "";
    // Real-source badge: the server audit row shows 操作, never the
    // kind-derived 前端, and is never marked as a client claim.
    expect(auditDialogText).toContain("操作");
    expect(auditDialogText).not.toContain("前端");
    expect(auditDialogText).not.toContain("客户端声明，未经服务端核验");
    await page.screenshot({
      path: `${SHOT_DIR}/02-monitoring-dialog-source-labels.png`,
      fullPage: true,
    });
    // No explicit close: the next page.goto() replaces the document, so the
    // dialog (and its 15s poll timer) is torn down with it.

    // Terminal attempt so the admin detail telemetry section composes.
    const submit = await request.post(
      `${BASE_URL}/api/attempts/${attemptId}/submit`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(submit.ok(), await submit.text()).toBe(true);
    await expect
      .poll(
        async () => {
          const res = await request.get(
            `${BASE_URL}/api/admin/attempts/${attemptId}/result`,
            { headers: { Cookie: `auth-token=${adminToken}` } },
          );
          return res.status();
        },
        { timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(200);

    await page.goto(`/admin/attempts/${attemptId}`);
    await expect(page.getByText("遥测时间线")).toBeVisible({
      timeout: 30_000,
    });

    // 4. Detail page: same trust semantics — claimed values visible only
    //    inside the unverified group; audit row unmarked.
    const clientDetailRow = page
      .locator("div.rounded-md.border", { hasText: "answer_autosave_failed" })
      .first();
    const clientDetailText = (await clientDetailRow.innerText()) ?? "";
    expect(clientDetailText).toContain("客户端声明，未经服务端核验");
    expect(clientDetailText).toContain(forgedRequestId);
    expect(clientDetailText).toContain("前端遥测");

    const auditDetailRow = page
      .locator("div.rounded-md.border", { hasText: "mark_misconduct" })
      .first();
    const auditDetailText = (await auditDetailRow.innerText()) ?? "";
    expect(auditDetailText).toContain("审计记录");
    expect(auditDetailText).not.toContain("客户端声明，未经服务端核验");
    await page.screenshot({
      path: `${SHOT_DIR}/03-attempt-detail-client-claimed-label.png`,
      fullPage: true,
    });

    // 5. Narrow viewport operability without page-level overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoPageOverflow(page);
    await expect(
      page.getByText("客户端声明，未经服务端核验").first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${SHOT_DIR}/04-attempt-detail-390px-no-overflow.png`,
      fullPage: true,
    });
  });

  /**
   * PR-A (EXAM-860/874 adjudication §C2): system audit identity semantics.
   * The System incident delivery's audit row must carry its operation
   * identity under metadata.operationId and never a fabricated HTTP
   * requestId, while HTTP rows keep requestId. (The CSV column projection
   * for these keys is owned by the routes/audit.test.ts integration suite.)
   * The system row is identified by its writer identity (system actor) + the
   * seeded exam — never by the string shape of an id value.
   */
  test("PR-A: system audit carries operationId, HTTP audit keeps requestId", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const seeded = await seedExam(request, "audit-identity");
    const candidateToken = await candidateApiToken(request, seeded.candidate);

    // Abandon an in-progress attempt: with the E2E scanner env
    // (HEARTBEAT_TIMEOUT_MS=15000, HEARTBEAT_SCAN_INTERVAL_MS=5000) the
    // heartbeat scan commits a detected episode and the reconciliation leg
    // delivers the System incident with its canonical atomic audit row.
    await candidateStartAttempt(request, candidateToken, seeded.examId);

    const adminToken = await adminApiToken(request);
    const systemRow = await pollSystemIncidentAuditRow(
      request,
      adminToken,
      seeded.examId,
    );

    await loginAsAdmin(page);
    await page.goto("/admin/audit-logs");
    await expect(page.getByLabel("对象 ID")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("对象 ID").fill(systemRow.targetId);
    await page.getByLabel("对象 ID").press("Enter");
    await expect(visibleText(page, "创建事件", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await visibleText(page, "创建事件", { exact: true }).click();
    const detail = page.locator("pre").first();
    await expect(detail).toContainText('"operationId"');
    await expect(detail).not.toContainText('"requestId"');
    await page.screenshot({
      path: "test-results/pr-a-system-audit-metadata.png",
      fullPage: true,
    });

    // HTTP rows keep their request identity under the HTTP writer's key.
    await page.getByRole("button", { name: "清空筛选" }).click();
    await page.getByLabel("对象 ID").fill(seeded.questionId);
    await page.getByLabel("对象 ID").press("Enter");
    await expect(visibleText(page, "创建题目", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await visibleText(page, "创建题目", { exact: true }).click();
    await expect(detail).toContainText('"requestId"');
    await expect(detail).not.toContainText('"operationId"');
    await page.screenshot({
      path: "test-results/pr-a-http-audit-metadata.png",
      fullPage: true,
    });
  });
});

/**
 * One System incident delivery audit row as the audit search projects it.
 */
interface IncidentAuditItem {
  id: string;
  actorId: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

/**
 * Polls the admin audit search until the System incident delivery's canonical
 * `incident.created` audit row for `examId` appears (heartbeat timeout + scan
 * interval + reconciliation all run inside the server). Returns the row.
 */
async function pollSystemIncidentAuditRow(
  request: APIRequestContext,
  adminToken: string,
  examId: string,
): Promise<IncidentAuditItem> {
  let found: IncidentAuditItem | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${BASE_URL}/api/admin/audit-logs?action=incident.created&limit=100`,
          { headers: { Cookie: `auth-token=${adminToken}` } },
        );
        expect(res.ok(), await res.text()).toBe(true);
        const body = (await res.json()) as { items: IncidentAuditItem[] };
        found = body.items.find(
          (row) =>
            row.actorId === "system:incident-detector" &&
            row.metadata.examId === examId,
        );
        return found ?? null;
      },
      {
        timeout: 60_000,
        intervals: [5_000],
        message: "system incident.created audit row must appear",
      },
    )
    .not.toBeNull();
  if (!found) throw new Error("system incident audit row did not appear");
  return found;
}
