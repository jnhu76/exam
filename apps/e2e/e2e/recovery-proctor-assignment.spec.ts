/**
 * J5-I1D — Recovery Exam Detail: proctor assign/revoke (Workflow F).
 *
 * Drives the REAL Recovery Exam Detail proctor commands (J5-I1C1): the assign
 * dialog (userId input + confirmation) completes with a success toast and the
 * reloaded page lists the proctor; the revoke destructive confirmation names
 * proctor + exam and completes with a success toast.
 *
 * The wire-level facts (activeProctors projection before/after each command)
 * are owned by routes/proctorAssignments.admin.test.ts and are deliberately
 * not duplicated here. A proctor USER is created via the real Admin API
 * (`POST /api/users` with role Proctor — the same path the proctor-landing
 * spec uses).
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

test.describe("Recovery exam proctor assignment (J5-I1D)", () => {
  test.describe.configure({ mode: "serial" });

  test("assigns a proctor from the operations UI, then revokes it; the page reflects both transitions", async ({
    page,
    request,
  }) => {
    const unique = `recovery-proctor-${Date.now()}`;
    const seeded = await seedExam(request, unique);
    const token = await adminApiToken(request);

    // Create a real Proctor user via the Admin API (RBAC-M10-E: user +
    // primary active assignment in one transaction).
    const stamp = Date.now();
    const proctorUsername = `e2e-rec-proctor-${stamp}`;
    const created = await adminPost(request, token, "/api/users", {
      username: proctorUsername,
      password: "proctor123",
      name: `E2E Recovery Proctor ${stamp}`,
      role: "Proctor",
    });
    const proctorUserId = created.id as string;

    await loginAsAdmin(page);
    await page.goto(`/admin/recovery/exams/${seeded.examId}`);
    await page.waitForURL("**/admin/recovery/exams/**", { timeout: 15_000 });

    // ── Assign ──
    await expect(page.getByRole("button", { name: "指派监考" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "指派监考" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("监考用户 ID").fill(proctorUserId);
    await dialog.getByRole("button", { name: "指派监考" }).click();

    await expect(page.getByText("已指派监考").first()).toBeVisible({
      timeout: 15_000,
    });

    // The reloaded page lists the proctor (`.first()`: the display name may
    // also appear in the assign dialog or elsewhere on the page).
    await expect(
      page.getByText(`E2E Recovery Proctor ${stamp}`).first(),
    ).toBeVisible({
      timeout: 15_000,
    });

    // ── Revoke (destructive confirmation naming proctor + exam) ──
    await page.getByRole("button", { name: "撤销监考" }).click();
    const revokeDialog = page.getByRole("dialog");
    await expect(
      revokeDialog.getByText(/撤销 .+ 对考试「.+」的监考权限/),
    ).toBeVisible();
    await revokeDialog.getByRole("button", { name: "确认撤销" }).click();

    await expect(page.getByText("已撤销监考").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
