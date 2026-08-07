/**
 * J5-I1D — Recovery Attempt Detail: operator time grant (Workflow C).
 *
 * Seeds an `operator_incident` exam (the canonical grant seam), starts a
 * real attempt, then grants time from the Recovery Attempt Detail operations
 * UI. The grant is confirmed against the REAL recovery aggregate: exactly one
 * new operator adjustment (+N seconds) and the effective deadline shifted by
 * exactly N seconds (server-side computation is the authority — the client
 * never derives deadlines).
 */
import { test, expect } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function adminGet(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  path: string,
) {
  const res = await request.get(`${BASE_URL}${path}`, {
    headers: { Cookie: `auth-token=${token}` },
  });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

test.describe("Recovery attempt time grant (J5-I1D)", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededExam;
  let adminToken: string;
  let attemptId: string;

  test.beforeAll(async ({ request }) => {
    seeded = await seedExam(request, `time-grant-${Date.now()}`, {
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

  test("grants 10 minutes from the operations UI; ledger + effective deadline move by exactly 600s", async ({
    page,
    request,
  }) => {
    const before = (await adminGet(
      request,
      adminToken,
      `/api/admin/recovery/attempts/${attemptId}`,
    )) as {
      attempt: { effectiveDeadlineAt: string };
      timeAdjustments: Array<{ source: string; addedSeconds: number }>;
    };
    const beforeAdjustments = before.timeAdjustments.length;

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/attempts/${attemptId}`);
    await page.waitForURL("**/admin/recovery/attempts/**", { timeout: 15_000 });

    // Operations section renders time_grant for an in_progress attempt.
    await expect(
      page.getByRole("button", { name: "延长答题时间" }),
    ).toBeVisible({
      timeout: 15_000,
    });

    // The grant dialog requires a reason (canonical, trimmed by the server).
    await page.getByRole("button", { name: "延长答题时间" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(/为 .+ 的第 1 次答题延长 10 分钟/),
    ).toBeVisible();
    await dialog.getByLabel("原因说明").fill("网络中断补偿");
    await dialog.getByRole("button", { name: "延长答题时间" }).click();

    await expect(page.getByText("已延长答题时间").first()).toBeVisible({
      timeout: 15_000,
    });

    // The aggregate reload is authoritative: one new operator adjustment of
    // exactly 600s, and the effective deadline advanced by exactly 600s.
    const after = (await adminGet(
      request,
      adminToken,
      `/api/admin/recovery/attempts/${attemptId}`,
    )) as {
      attempt: { effectiveDeadlineAt: string };
      timeAdjustments: Array<{
        source: string;
        addedSeconds: number;
        reasonText: string;
      }>;
    };
    expect(after.timeAdjustments.length).toBe(beforeAdjustments + 1);
    const operatorAdjustment = after.timeAdjustments.find(
      (a) => a.source === "operator",
    );
    expect(operatorAdjustment).toBeTruthy();
    expect(operatorAdjustment!.addedSeconds).toBe(600);
    expect(operatorAdjustment!.reasonText).toBe("网络中断补偿");

    const beforeMs = new Date(before.attempt.effectiveDeadlineAt).getTime();
    const afterMs = new Date(after.attempt.effectiveDeadlineAt).getTime();
    expect(afterMs - beforeMs).toBe(600_000);
  });
});
