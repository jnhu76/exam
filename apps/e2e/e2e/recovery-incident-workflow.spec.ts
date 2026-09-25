/**
 * Recovery Incident Detail operations workflows.
 *
 * Drives the REAL Recovery Incident Detail page operations UI and proves the
 * browser composition: which actions render per status, the required fields
 * in each terminal-judgment dialog, the success toasts, and the post-reload
 * action set (resolve/dismiss gone once terminal, append-only note remains).
 *
 * Aggregate/receipt semantics (status transitions, version arithmetic,
 * allowedActions composition) are owned at the API layer by
 * routes/incidents.proctorRecovery.test.ts and routes/recovery.admin.test.ts
 * and are deliberately not duplicated here.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminPost(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  path: string,
  data: unknown,
) {
  const res = await request.post(`${BASE_URL}${path}`, {
    data,
    headers: { Cookie: `auth-token=${token}` },
  });
  expect(res.ok(), `POST ${path} → ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  return res.json();
}

/** Creates an incident via the real Admin API (operationId-keyed command). */
async function createIncident(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  examId: string,
  description: string,
) {
  return adminPost(request, token, `/api/admin/exams/${examId}/incidents`, {
    operationId: crypto.randomUUID(),
    type: "network_interruption",
    severity: "major",
    description,
  });
}

test.describe("Recovery incident detail operations", () => {
  test.describe.configure({ mode: "serial" });

  let adminToken: string;
  let incidentId: string;

  test.beforeAll(async ({ request }) => {
    const seeded = await seedExam(request, `incident-ops-${Date.now()}`);
    adminToken = await adminApiToken(request);
    const created = await createIncident(
      request,
      adminToken,
      seeded.examId,
      "E2E 网络中断事件",
    );
    incidentId = created.incident.id as string;
  });

  test("Workflow A: investigate → add note → change severity, each confirmed in the UI", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/incidents/${incidentId}`);
    await page.waitForURL("**/admin/recovery/incidents/**", {
      timeout: 15_000,
    });

    // Operations section renders with the full open-status action set.
    await expect(page.getByRole("button", { name: "开始调查" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "添加备注" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "修改严重程度" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "解决事件" })).toBeVisible();
    await expect(page.getByRole("button", { name: "驳回事件" })).toBeVisible();

    // ── Investigate ──
    await page.getByRole("button", { name: "开始调查" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/开始调查事件/)).toBeVisible();
    await dialog.getByRole("button", { name: "开始调查" }).click();

    await expect(page.getByText("已开始调查").first()).toBeVisible({
      timeout: 15_000,
    });
    // ── Add note ──
    await page.getByRole("button", { name: "添加备注" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("备注内容")
      .fill("已联系考生，考生请求继续");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加备注" })
      .click();
    await expect(page.getByText("已添加备注").first()).toBeVisible({
      timeout: 15_000,
    });
    // ── Change severity (major → minor) ──
    await page.getByRole("button", { name: "修改严重程度" }).click();
    const severityDialog = page.getByRole("dialog");
    await severityDialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "轻微" }).click();
    await severityDialog.getByRole("button", { name: "修改严重程度" }).click();
    await expect(page.getByText("已修改严重程度").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Workflow B: resolve requires a summary, reaches terminal status, and reload hides terminal actions", async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/incidents/${incidentId}`);
    await page.waitForURL("**/admin/recovery/incidents/**", {
      timeout: 15_000,
    });

    // investigating: resolve + dismiss available, no investigate.
    await expect(page.getByRole("button", { name: "解决事件" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: "开始调查" }),
    ).not.toBeVisible();

    // Resolve REQUIRES the resolution summary (terminal judgment).
    await page.getByRole("button", { name: "解决事件" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/解决为终态判断/)).toBeVisible();
    const resolveConfirm = dialog.getByRole("button", { name: "解决事件" });
    await expect(resolveConfirm).toBeDisabled();
    await dialog
      .getByLabel("解决说明")
      .fill("网络已恢复，考生继续作答并正常交卷");
    await resolveConfirm.click();

    await expect(page.getByText("事件已解决").first()).toBeVisible({
      timeout: 15_000,
    });
    // Reload the page — the terminal actions are NOT rendered anymore.
    await page.reload();
    await page.waitForURL("**/admin/recovery/incidents/**", {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "添加备注" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: "解决事件" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "驳回事件" }),
    ).not.toBeVisible();
  });

  test("Dismiss requires a reason and reaches terminal status", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, `incident-dismiss-${Date.now()}`);
    const token = await adminApiToken(request);
    const created = await createIncident(
      request,
      token,
      seeded.examId,
      "E2E 误报事件",
    );
    const dismissId = created.incident.id as string;

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/incidents/${dismissId}`);
    await page.waitForURL("**/admin/recovery/incidents/**", {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "驳回事件" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/驳回为终态判断/)).toBeVisible();
    const dismissConfirm = dialog.getByRole("button", { name: "驳回事件" });
    await expect(dismissConfirm).toBeDisabled();
    await dialog.getByLabel("原因说明").fill("经核实为误报，考生无异常");
    await dismissConfirm.click();

    await expect(page.getByText("事件已驳回").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("stale expectedVersion surfaces INCIDENT_VERSION_CONFLICT (reload and retry)", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, `incident-conflict-${Date.now()}`);
    const token = await adminApiToken(request);
    const created = await createIncident(
      request,
      token,
      seeded.examId,
      "E2E 版本冲突事件",
    );
    const conflictId = created.incident.id as string;

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/incidents/${conflictId}`);
    await page.waitForURL("**/admin/recovery/incidents/**", {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: "修改严重程度" }),
    ).toBeVisible({
      timeout: 15_000,
    });

    // The page snapshot now carries version 1. Advance the incident
    // server-side (investigate → version 2) so the page's frozen
    // expectedVersion becomes stale.
    await adminPost(
      request,
      token,
      `/api/admin/incidents/${conflictId}/investigate`,
      {
        operationId: crypto.randomUUID(),
        expectedVersion: 1,
      },
    );

    // change_severity carries expectedVersion — the stale page version must
    // 409 INCIDENT_VERSION_CONFLICT.
    await page.getByRole("button", { name: "修改严重程度" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "轻微" }).click();
    await dialog.getByRole("button", { name: "修改严重程度" }).click();

    // The version-conflict toast instructs reload and retry.
    await expect(page.getByText(/版本冲突/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
