/**
 * J5-I1D — Recovery operations accessibility + responsive closeout.
 *
 * Light automated checks over the REAL operations dialogs (J5-I1C1):
 *   - keyboard operability: focus moves INTO the dialog on open, Escape
 *     closes it, focus returns to the trigger button;
 *   - confirm buttons carry the OPERATION as accessible name (never a bare
 *     "确认"), and required-field errors surface via `role="alert"`
 *     (FieldError);
 *   - the operations section + dialogs render usable at mobile (390×844)
 *     and desktop (1440×1000).
 *
 * Deep workflow behavior (confirmation content, version conflict, retry
 * identity) is covered by the workflow specs; this spec covers the a11y
 * contract only.
 */
import { test, expect } from "@playwright/test";
import { seedExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLoginApi,
  candidateStartAttempt,
} from "../lib/flow";

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
  expect(res.ok(), `POST ${path} → ${res.status()}`).toBe(true);
  return res.json();
}

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

test.describe("Recovery operations a11y + responsive (J5-I1D)", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: Awaited<ReturnType<typeof seedExam>>;
  let adminToken: string;
  let attemptId: string;
  let incidentId: string;

  test.beforeAll(async ({ request }) => {
    seeded = await seedExam(request, `recovery-a11y-${Date.now()}`);
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
    const incident = await adminPost(
      request,
      adminToken,
      `/api/admin/exams/${seeded.examId}/incidents`,
      {
        operationId: crypto.randomUUID(),
        type: "network_interruption",
        severity: "major",
        description: "a11y 事件",
      },
    );
    incidentId = incident.incident.id as string;
  });

  test("attempt operations dialog: focus-in, Escape close, focus-return, operation accessible names (mobile + desktop)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    for (const viewport of [DESKTOP, MOBILE]) {
      await page.setViewportSize(viewport);
      await page.goto(`/admin/recovery/attempts/${attemptId}`);
      await page.waitForURL("**/admin/recovery/attempts/**", {
        timeout: 15_000,
      });

      // Operations section renders at both sizes.
      const grantButton = page.getByRole("button", { name: "延长答题时间" });
      await expect(grantButton).toBeVisible({ timeout: 15_000 });

      // Open the grant dialog: focus moves INSIDE the dialog (content node
      // or a focusable descendant); the confirm button's accessible name is
      // the operation (never a bare "确认").
      await grantButton.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Focus moved inside the dialog: document.activeElement is the dialog
      // itself or a descendant (content node), not a stray outside element.
      await expect
        .poll(() =>
          dialog.evaluate((el) => {
            const active = el.ownerDocument.activeElement;
            return active === el || el.contains(active);
          }),
        )
        .toBe(true);
      await expect(
        dialog.getByRole("button", { name: "延长答题时间" }),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "确认" })).toHaveCount(0);

      // Escape closes; focus returns to the trigger button.
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(grantButton).toBeFocused();
    }
  });

  test("required-field errors surface via role=alert (FieldError), operation button is the confirm name", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`/admin/recovery/incidents/${incidentId}`);
    await page.waitForURL("**/admin/recovery/incidents/**", {
      timeout: 15_000,
    });

    // Resolve: confirm disabled until the REQUIRED summary is entered; the
    // empty-field error is announced via role=alert (FieldError).
    await page.getByRole("button", { name: "解决事件" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "解决事件" });
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole("alert")).toContainText("请输入解决说明");

    // Keyboard: the first tabbable (the summary textarea) receives focus on
    // open; typing enables the confirm — no mouse required.
    await expect(dialog.getByLabel("解决说明")).toBeFocused();
    await page.keyboard.type("a11y 解决说明");
    await expect(confirm).toBeEnabled();
  });

  test("operations section + dialogs are usable at mobile width", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`/admin/recovery/exams/${seeded.examId}`);
    await page.waitForURL("**/admin/recovery/exams/**", { timeout: 15_000 });

    // Assign-proctor dialog fits the mobile viewport (scrollable content).
    await page.getByRole("button", { name: "指派监考" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("监考用户 ID").fill("unused-in-a11y");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
    // Escape closes (no command was sent — the input is only a draft).
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
});
