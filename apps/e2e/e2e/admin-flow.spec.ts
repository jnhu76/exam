import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedExam, type SeededExam } from "../lib/seed";
import { loginAsAdmin } from "../lib/login";
import {
  adminApiToken,
  candidateLogin,
  startExamFromList,
  answerTrueFalse,
  waitForSaveSaved,
  submitExam,
  candidateApiToken,
  startAndSubmitAttempt,
  closeExamApi,
  exportScoresCsv,
} from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Create a single candidate with a distinctive name so the enrollment picker
 * can select it deterministically (independent of demo seed accounts). Returns
 * the candidate profile id + the visible name shown in the picker/table.
 */
async function createNamedCandidate(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<{ profileId: string; name: string }> {
  const stamp = Date.now();
  const res = await request.post(`${BASE_URL}/api/candidates`, {
    headers: { Cookie: `auth-token=${token}` },
    data: {
      username: `e2e-enr-${stamp}`,
      password: "candidate123",
      name,
      // demo-seed requires + uniquely constrains `candidateNo`.
      fields: { candidateNo: `E2E-ENR-${stamp}` },
    },
  });
  if (!res.ok()) {
    throw new Error(
      `create candidate failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { id: string };
  return { profileId: body.id, name };
}

/**
 * P2B-J1 / P2B-J2 — Admin Operation Flow E2E.
 *
 * Drives the full admin setup -> assignment -> publish -> result -> export loop
 * against the ADR-005 exam-operation baseline. Uses the REAL close route
 * (POST /api/exams/:id/close) — no `endingSoonSec` timing workaround.
 *
 * seedExam() (apps/e2e/lib/seed.ts) already performs the API-side setup in one
 * call: admin login -> create course -> create question -> create exam ->
 * publish -> create candidate -> enroll. The tests below then drive the
 * admin/candidate UI and API for the part each test is proving.
 *
 * Run isolated, never against exam-test-pg (:5432):
 *   COMPOSE_FILE=docker-compose.test.yml:docker-compose.test.override.yml \
 *     COMPOSE_PROJECT_NAME=exam-e2e-p2b APP_PORT=3300 DB_HOST_PORT=5433 \
 *     bash scripts/e2e/run.sh admin-flow
 */
test.describe("admin operation flow", () => {
  test.describe.configure({ mode: "serial" });

  /**
   * Slice 1 — Publish lifecycle: candidate take+submit, then admin close+archive.
   *
   * Proves the full deterministic admin loop that P2B-J1 originally had no path
   * for (and the `endingSoonSec` E2E workaround ADR-005 Slice 1 replaced).
   *
   * Why the candidate take+submit runs first: no GET route reconciles the exam
   * lifecycle, so a published exam whose `openAt` has passed is persisted as
   * `published` until a write touches it. The candidate `startAttempt` write is
   * what reconciles it to `open`; submitting then resolves the attempt, leaving
   * the exam `open` with zero unresolved attempts — the exact precondition the
   * close guard (ADR-005 §3.3) requires. This mirrors the real admin full loop.
   */
  test("candidate submits, then admin closes + archives via UI", async ({
    page,
    request,
  }) => {
    const seeded = await seedExam(request, "lifecycle", {
      questionAnswer: true,
      questionScore: 100,
    });

    // Candidate takes and submits — reconciles the exam to `open` and leaves
    // no unresolved attempt so the admin close guard can pass.
    await candidateLogin(page, seeded.candidate);
    await startExamFromList(page, seeded.examId);
    await answerTrueFalse(page, true);
    await waitForSaveSaved(page);
    await submitExam(page);
    await expect(page.getByText("已通过")).toBeVisible({ timeout: 15_000 });

    // Admin closes via the REAL close button (no endingSoonSec workaround).
    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${seeded.examId}`);
    await expect(page.getByText("开放中").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("exam-detail-close-btn").click();
    // ConfirmDialog is built on shadcn AlertDialog (role=alertdialog).
    const closeDialog = page.getByRole("alertdialog");
    await closeDialog.waitFor({ state: "visible" });
    await closeDialog.getByRole("button", { name: /^确认$/ }).click();

    // Status badge flips to closed.
    await expect(page.getByText("已关闭").first()).toBeVisible({
      timeout: 15_000,
    });

    // Archive (available when closed) + confirm.
    await page.getByRole("button", { name: /归档/ }).click();
    const archiveDialog = page.getByRole("alertdialog");
    await archiveDialog.waitFor({ state: "visible" });
    await archiveDialog.getByRole("button", { name: /^确认$/ }).click();
    await expect(page.getByText("已归档").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  /**
   * Slice 2 — Enrollment add/remove via the admin UI.
   *
   * Proves: the enrollment picker (EnrollmentPicker) adds a candidate through
   * the 添加考生 dialog and the row appears with `已分配`; removing via the row
   * confirm dialog deletes it. Uses a freshly-created, distinctly-named
   * candidate so the test is independent of demo-seed candidate state.
   */
  test("admin enrolls and removes a candidate via UI", async ({
    page,
    request,
  }) => {
    const seeded: SeededExam = await seedExam(request, "enroll");
    const token = await adminApiToken(request);
    // Distinctive name so the picker + enrollment table row is unambiguous.
    const extraName = `E2E-Enroll-${Date.now()}`;
    const extra = await createNamedCandidate(request, token, extraName);

    await loginAsAdmin(page);
    await page.goto(`/admin/exams/${seeded.examId}`);

    // The 报考 tab is the default; the 考生资格 table is where rows appear.
    await page.getByRole("button", { name: "添加考生" }).click();
    await page.getByRole("dialog").waitFor({ state: "visible" });

    // Select the freshly-created candidate by its name label.
    await page.getByLabel(extraName).scrollIntoViewIfNeeded();
    await page.getByLabel(extraName).click();

    // Submit; the button label reflects the selection count.
    await page.getByRole("button", { name: /^添加\s*\(/ }).click();
    await expect(page.getByText(extraName).first()).toBeVisible({
      timeout: 15_000,
    });

    // Remove via the row's 移除考生 icon button + confirm dialog (AlertDialog).
    const row = page.locator("tr", { hasText: extraName });
    await row.getByRole("button", { name: "移除考生" }).click();
    const removeDialog = page.getByRole("alertdialog");
    await removeDialog.waitFor({ state: "visible" });
    await removeDialog.getByRole("button", { name: /^确认$/ }).click();

    // Row is gone (the candidate name no longer appears in the table).
    await expect(page.getByText(extraName)).toHaveCount(0, { timeout: 15_000 });
  });

  /**
   * Slice 3 — Scores guard + visibility (API).
   *
   * Proves ADR-005 §Close & export policy: GET /api/exams/:id/scores rejects
   * while the exam is not ended (409), then returns the graded row (200) after
   * the admin closes the exam via the REAL close route. This is the guard that
   * makes export correctness provable and that the old `endingSoonSec` timing
   * workaround obscured.
   *
   * After the candidate starts+submits, the exam is `open` with a graded
   * attempt but the window has not ended, so scores stay 409. Once the admin
   * closes (no unresolved attempts remain), the guard opens.
   */
  test("scores 409 before close, 200 with row after close (API)", async ({
    request,
  }) => {
    const seeded = await seedExam(request, "scores");
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateApiToken(request, seeded.candidate);

    // Candidate takes + submits — exam reconciles to `open`, attempt is graded.
    await startAndSubmitAttempt(request, candidateToken, seeded.examId);

    // Scores are gated while the exam window is still live: 409.
    const before = await request.get(
      `${BASE_URL}/api/exams/${seeded.examId}/scores`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(before.status()).toBe(409);

    // Admin closes via the real close route — no unresolved attempts remain.
    const closeRes = await closeExamApi(request, adminToken, seeded.examId);
    expect(closeRes.status()).toBe(200);

    // Scores now open (200) and the graded row for the candidate is present.
    const after = await request.get(
      `${BASE_URL}/api/exams/${seeded.examId}/scores`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(after.status()).toBe(200);
    const body = (await after.json()) as { items: { candidateId: string }[] };
    expect(
      body.items.some((it) => it.candidateId === seeded.candidate.profileId),
    ).toBe(true);
  });

  /**
   * Slice 4 — CSV export (API).
   *
   * Proves GET /api/exams/:id/export/scores returns 200 text/csv with a row
   * for the candidate after the exam is closed. Mirrors the ScoreListPage
   * 导出CSV button. Closes via the admin API to isolate the export behavior.
   */
  test("CSV export returns 200 text/csv with candidate row after close (API)", async ({
    request,
  }) => {
    const seeded = await seedExam(request, "export");
    const adminToken = await adminApiToken(request);
    const candidateToken = await candidateApiToken(request, seeded.candidate);

    await startAndSubmitAttempt(request, candidateToken, seeded.examId);
    const closeRes = await closeExamApi(request, adminToken, seeded.examId);
    expect(closeRes.status()).toBe(200);

    const csvRes = await exportScoresCsv(request, adminToken, seeded.examId);
    expect(csvRes.status()).toBe(200);
    expect(csvRes.headers()["content-type"]).toContain("text/csv");

    const csv = await csvRes.text();
    // Header row + the candidate's display name appear in the exported CSV.
    expect(csv).toContain("考生姓名");
    expect(csv).toContain("E2E Candidate export");
  });
});
