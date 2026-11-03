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
  candidateStartAttempt,
} from "../lib/flow";

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
});
