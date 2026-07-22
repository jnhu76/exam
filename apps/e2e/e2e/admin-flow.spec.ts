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
  candidateLoginApi,
  loginAsCandidate,
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
): Promise<{ profileId: string; name: string; username: string }> {
  const stamp = Date.now();
  const username = `e2e-enr-${stamp}`;
  const res = await request.post(`${BASE_URL}/api/candidates`, {
    headers: { Cookie: `auth-token=${token}` },
    data: {
      username,
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
  return { profileId: body.id, name, username };
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

    // Select the freshly-created candidate. The dialog's candidate list is
    // paginated (pageSize=50) and searchable. Wait for the first page to
    // render, then filter by the distinctive name so the target checkbox is
    // immediately visible without scrolling through unrelated candidates. If the
    // target has not been loaded yet (very long candidate list), load more pages
    // while waiting for the real network response instead of sleeping.
    await expect(
      page
        .locator("label")
        .filter({ has: page.getByRole("checkbox") })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    const searchInput = page.getByPlaceholder("搜索考生");
    const targetCheckbox = page.getByRole("checkbox", { name: extraName });
    const loadMore = page.getByRole("button", { name: "加载更多" });
    for (let i = 0; i < 10; i += 1) {
      await searchInput.fill(extraName);
      if (await targetCheckbox.isVisible().catch(() => false)) break;

      if (await loadMore.isEnabled().catch(() => false)) {
        const responsePromise = page.waitForResponse(
          /\/api\/candidates\?page=\d+&pageSize=50/,
        );
        await loadMore.click();
        await responsePromise;
        continue;
      }

      break; // no more pages and target not found
    }
    await expect(targetCheckbox).toBeVisible({ timeout: 5_000 });
    await targetCheckbox.click();

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
    expect(csvRes.headers()["content-disposition"]).toContain("attachment");
    expect(csvRes.headers()["content-disposition"]).toContain(seeded.examId);

    const csv = await csvRes.text();
    // UTF-8 BOM for Excel compatibility
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // Required columns present
    expect(csv).toContain("考生姓名");
    expect(csv).toContain("成绩");
    expect(csv).toContain("及格状态");
    expect(csv).toContain("尝试次数");
    expect(csv).toContain("提交时间");
    // Candidate row present
    expect(csv).toContain("E2E Candidate export");
    // At least header + 1 data row
    const lines = csv.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  // ── P2 publish-to-candidate ──────────────────────────────────────
  // P3-MOD-P2-3. Proves the publish STATE TRANSITION produces candidate
  // runtime availability — NOT just that a seed fixture is visible. The
  // exam is created as draft, the candidate enrolled, draft-proven
  // un-startable, THEN published via the real endpoint, THEN the candidate
  // starts it for real through the UI, and the authoritative take snapshot
  // confirms the in-progress attempt + frozen text_response question.
  //
  // Does NOT use seedExam() (it auto-publishes and hides the transition).
  test("P2 publish-to-candidate: admin publishes an exam and enrolled candidate can start it", async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const examTitle = `P2 Publish E2E ${suffix}`;
    const questionContent = `P2 text response ${suffix}`;
    const rubric = "关键概念正确：10 分\n论证结构完整：10 分";

    // ── 1. Admin API: build the question + a DRAFT exam (no publish). ──
    const adminToken = await adminApiToken(request);

    const courseRes = await request.post(`${BASE_URL}/api/courses`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        name: `P2 Course ${suffix}`,
        code: `P2C-${suffix}`,
        description: "",
      },
    });
    expect(courseRes.ok()).toBeTruthy();
    const courseId = ((await courseRes.json()) as { id: string }).id;

    // Legal text_response with a non-empty multiline rubric (P2-1C boundary).
    const questionRes = await request.post(`${BASE_URL}/api/questions`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        courseId,
        type: "text_response",
        content: questionContent,
        options: [],
        standardAnswer: null,
        rubric,
        score: 20,
        difficulty: 3,
      },
    });
    expect(questionRes.ok()).toBeTruthy();
    const questionId = ((await questionRes.json()) as { id: string }).id;

    // Create as a genuine DRAFT (no asDraft=false shortcut, no publish here).
    const now = Date.now();
    const openAt = new Date(now - 10 * 60_000).toISOString();
    const closeAt = new Date(now + 60 * 60_000).toISOString();
    const examRes = await request.post(`${BASE_URL}/api/exams`, {
      headers: { Cookie: `auth-token=${adminToken}` },
      data: {
        title: examTitle,
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt,
        closeAt,
        passingScore: 10,
        totalScore: 20,
        questionSelectionMode: "manual",
        questionIds: [questionId],
        resultPublicationMode: "immediate",
        controlFlags: {
          shuffleQuestions: false,
          shuffleOptions: false,
          detectTabSwitch: false,
          disableCopyPaste: false,
          showResultImmediately: true,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 1,
      },
    });
    expect(examRes.ok()).toBeTruthy();
    const examId = ((await examRes.json()) as { id: string; status: string })
      .id;

    // Confirm the created exam is genuinely a draft.
    const draftDetail = await request.get(`${BASE_URL}/api/exams/${examId}`, {
      headers: { Cookie: `auth-token=${adminToken}` },
    });
    expect(draftDetail.ok()).toBeTruthy();
    expect(((await draftDetail.json()) as { status: string }).status).toBe(
      "draft",
    );

    // ── 2. Create + enroll a candidate via the real API. ──
    const candidate = await createNamedCandidate(
      request,
      adminToken,
      `P2 Publish Candidate ${suffix}`,
    );
    const enrollRes = await request.post(
      `${BASE_URL}/api/exams/${examId}/enrollments`,
      {
        headers: { Cookie: `auth-token=${adminToken}` },
        data: { candidateIds: [candidate.profileId] },
      },
    );
    expect(enrollRes.ok()).toBeTruthy();

    const candidateToken = await candidateLoginApi(
      request,
      candidate.username,
      "candidate123",
    );

    // ── 3. Pre-publish: candidate CANNOT start the draft exam. ──
    const listBefore = await request.get(`${BASE_URL}/api/candidate/exams`, {
      headers: { Cookie: `auth-token=${candidateToken}` },
    });
    expect(listBefore.ok()).toBeTruthy();
    const listBeforeItems = (
      (await listBefore.json()) as Array<{
        examId: string;
        primaryAction: string;
      }>
    ).filter((e) => e.examId === examId);
    // The draft enrollment may surface as `unavailable` (primaryAction none) —
    // the required proof is "not startable", NOT "absent from the list".
    const before = listBeforeItems[0];
    expect(before).toBeDefined();
    expect(before!.primaryAction).not.toBe("start");

    // ── 4. Explicit publish via the real endpoint. ──
    const publishRes = await request.post(
      `${BASE_URL}/api/exams/${examId}/publish`,
      { headers: { Cookie: `auth-token=${adminToken}` }, data: {} },
    );
    expect(publishRes.ok()).toBeTruthy();
    // Confirm the transition actually persisted via the detail API.
    const publishedDetail = await request.get(
      `${BASE_URL}/api/exams/${examId}`,
      { headers: { Cookie: `auth-token=${adminToken}` } },
    );
    expect(publishedDetail.ok()).toBeTruthy();
    const publishedBody = (await publishedDetail.json()) as {
      status: string;
    };
    expect(publishedBody.status).toBe("published");
    // questionSnapshot materialization is proven later via the authoritative
    // take endpoint (the frozen text_response appears there); the exam detail
    // response does not project the snapshot by contract.

    // ── 5. Candidate UI: real login, list shows the exam, start enabled. ──
    await loginAsCandidate(page, {
      profileId: candidate.profileId,
      userId: "",
      username: candidate.username,
      name: candidate.name,
      password: "candidate123",
    });
    const card = page.getByTestId(`exam-card-${examId}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const startAction = card.getByTestId("exam-primary-action");
    await expect(startAction).toBeVisible();
    // The card's primary action is now "start" (data-action reflects the
    // availability projection; this is the runtime-availability proof).
    await expect(startAction).toHaveAttribute("data-action", "start");

    // ── 6. Real UI start: card action → /start page → exam-start-btn → POST. ──
    // The card action navigates to the StartExamPage; the attempt is only
    // created when the candidate confirms on that page (exam-start-btn).
    await startAction.click();
    await page.waitForURL((url) => /\/exam\/[^/]+\/start$/.test(url.pathname), {
      timeout: 15_000,
    });

    // Capture the real start-attempt POST so the attemptId is provably the one
    // THIS click produced (not a seed/legacy attempt).
    const startResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/attempts/") &&
        res.url().includes("/start") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 15_000 },
    );
    await page.getByTestId("exam-start-btn").click();
    const startResponse = await startResponsePromise;
    const attemptId = ((await startResponse.json()) as { id: string }).id;

    // Wait for the take page to render this exam's question (UI proof).
    await page.waitForURL((url) => /\/exam\/[^/]+\/take$/.test(url.pathname), {
      timeout: 15_000,
    });
    await expect(page.getByText(questionContent)).toBeVisible({
      timeout: 15_000,
    });

    // ── 7. Authoritative take snapshot: in-progress attempt, frozen question. ──
    const takeRes = await request.get(
      `${BASE_URL}/api/candidate/attempts/${attemptId}/take`,
      { headers: { Cookie: `auth-token=${candidateToken}` } },
    );
    expect(takeRes.ok()).toBeTruthy();
    const take = (await takeRes.json()) as {
      examId: string;
      attemptStatus: string;
      questions: Array<{ type: string; prompt: string }>;
    };
    expect(take.examId).toBe(examId);
    expect(take.attemptStatus).toBe("in_progress");
    expect(take.questions.length).toBe(1);
    expect(take.questions[0]!.type).toBe("text_response");
    expect(take.questions[0]!.prompt).toBe(questionContent);
  });
});
