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
  candidateApiToken,
  candidateLogin,
  candidateStartAttempt,
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
      name: "prw_mix_valid_before",
      occurredAt: new Date().toISOString(),
      attemptId,
      examId: seeded.examId,
      eventId: "prw-e2e-valid-a-00000001",
    };
    const validAfter = {
      kind: "exam_telemetry",
      level: "info",
      name: "prw_mix_valid_after",
      occurredAt: new Date().toISOString(),
      attemptId,
      examId: seeded.examId,
      eventId: "prw-e2e-valid-b-00000001",
    };
    const poison = {
      kind: "exam_telemetry",
      level: "info",
      name: "prw_mix_poison",
      occurredAt: "0000-01-01T00:00:00.000Z",
      attemptId,
      examId: seeded.examId,
      eventId: "prw-e2e-poison-00000001",
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
    expect(afterRejection).not.toContain("prw_mix_valid_before");
    expect(afterRejection).not.toContain("prw_mix_poison");
    expect(afterRejection).not.toContain("prw_mix_valid_after");

    // --- 3. Isolation + resend: a conforming client drops ONLY the named
    // event and resends the valid remainder with the SAME eventIds.
    const resend = await postFromPage([validBefore, validAfter]);
    expect(resend.status).toBe(200);
    expect(resend.body.accepted).toBe(2);
    const afterResend = await timelineNames();
    expect(afterResend).toContain("prw_mix_valid_before");
    expect(afterResend).toContain("prw_mix_valid_after");

    // --- 4. ACK loss: the identical resend is absorbed by the (org, user,
    // eventId) dedup key — accepted stays 2 and no extra rows appear.
    const ackLossResend = await postFromPage([validBefore, validAfter]);
    expect(ackLossResend.status).toBe(200);
    expect(ackLossResend.body.accepted).toBe(2);
    const finalNames = await timelineNames();
    expect(finalNames.filter((n) => n === "prw_mix_valid_before")).toHaveLength(
      1,
    );
    expect(finalNames.filter((n) => n === "prw_mix_valid_after")).toHaveLength(
      1,
    );
    expect(finalNames).not.toContain("prw_mix_poison");

    // --- 5. Visual evidence: the attempt timeline shows the recovered rows
    // and stays operable at desktop and 390px widths.
    await loginAsAdmin(page);
    await page.goto(`/admin/attempts/${attemptId}`);
    await expect(page.getByText("遥测时间线")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByText("遥测时间线").scrollIntoViewIfNeeded();
    await expect(page.getByText("prw_mix_valid_before")).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({
      path: testInfo.outputPath("pr-w-attempt-poison-recovery.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoPageOverflow(page);
    await expect(page.getByText("prw_mix_valid_before")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pr-w-attempt-poison-recovery-390px.png"),
      fullPage: true,
    });
  });
});
