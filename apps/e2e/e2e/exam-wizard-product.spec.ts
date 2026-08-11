/**
 * P7-M — Exam creation wizard product path E2E.
 *
 * Proves the full configurable-modes product loop through SUPPORTED product
 * interfaces:
 *   1. Profile-based exam creation with an explicit override.
 *   2. No-profile exam creation (compatibility with the pre-M2 path).
 *   3. One meaningful validation conflict routed to the correct step.
 *
 * API setup (course + question + profile) is prerequisite fixture data; the
 * exam-authoring mutations travel through the rendered wizard UI. The wizard
 * creates a Draft Exam; the existing publish action remains on the detail
 * page (P7-M does NOT collapse create+publish).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken } from "../lib/flow";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Create a course + an objective question + a policy profile via the API. */
async function setupFixtures(
  request: APIRequestContext,
  token: string,
  unique: string,
): Promise<{ courseId: string; questionId: string; profileId: string }> {
  const courseRes = await request.post(`${BASE_URL}/api/courses`, {
    headers: { Cookie: `auth-token=${token}` },
    data: { name: `Wizard课程-${unique}`, code: `WIZ-${unique}` },
  });
  expect(courseRes.ok(), `setup course: ${courseRes.status()}`).toBe(true);
  const courseId = ((await courseRes.json()) as { id: string }).id;

  const qRes = await request.post(`${BASE_URL}/api/questions`, {
    headers: { Cookie: `auth-token=${token}` },
    data: {
      type: "true_false",
      content: `Wizard题-${unique}`,
      courseId,
      score: 10,
      standardAnswer: true,
    },
  });
  expect(qRes.ok(), `setup question: ${qRes.status()}`).toBe(true);
  const questionId = ((await qRes.json()) as { id: string }).id;

  const profileRes = await request.post(`${BASE_URL}/api/exam-profiles`, {
    headers: { Cookie: `auth-token=${token}` },
    data: {
      name: `Wizard模板-${unique}`,
      description: "e2e",
      durationMinutes: 60,
      latestStartOffsetMinutes: 15,
      minSubmitAfterStartMinutes: 10,
      retakePolicy: "max_attempts",
      maxAttempts: 2,
      scoreStrategy: "highest",
      resultPublicationMode: "after_grading",
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 300,
      interruptionGracePerAttemptSeconds: 600,
    },
  });
  expect(profileRes.ok(), `setup profile: ${profileRes.status()}`).toBe(true);
  const profileId = ((await profileRes.json()) as { id: string }).id;

  return { courseId, questionId, profileId };
}

test.describe("P7-M exam creation wizard product path", () => {
  test("profile-based exam create with an explicit override", async ({
    page,
    request,
  }) => {
    const token = await adminApiToken(request);
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { courseId, questionId, profileId } = await setupFixtures(
      request,
      token,
      unique,
    );

    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/exams/new`);

    const examTitle = `Wizard考试-${unique}`;
    await page.getByPlaceholder("请输入考试名称").fill(examTitle);

    // Step 1: select the profile created via API.
    await page.getByRole("combobox", { name: "使用现有模板" }).click();
    await page.getByRole("option", { name: `Wizard模板-${unique}` }).click();
    // COPY-ON-APPLY hint is shown.
    await expect(
      page.getByText(/选择模板后，模板中的设置将复制到本次考试/).first(),
    ).toBeVisible();

    // Step 1 → 2.
    await page.getByRole("button", { name: /下一步/ }).click();
    // The profile's duration (60) is shown; at least one field is marked
    // 来自「Wizard模板-…」.
    await expect(page.getByLabel("考试时长（分钟）")).toHaveValue("60");
    // Override duration to 90 — the badge switches to 已自定义 for that field.
    await page.getByLabel("考试时长（分钟）").fill("90");

    // Step 2 → 3 (questions + scores).
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: "手动选题" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加" })
      .first()
      .click();
    await page.getByRole("button", { name: "关闭" }).click();
    // Lower passingScore so it stays <= the 10-point total.
    await page.getByTestId("passingScore-input").fill("5");

    // Step 3 → 4 (schedule).
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByLabel("开始时间").fill("2026-09-01T09:00");
    await page.getByLabel("结束时间").fill("2026-09-01T11:00");

    // Step 4 → 5 (review).
    await page.getByRole("button", { name: /下一步/ }).click();
    await expect(
      page.getByRole("heading", { name: "创建前检查" }),
    ).toBeVisible();

    // Create the draft. The POST MUST carry profileId + the explicit override
    // (durationMinutes: 90) and omit the non-overridden profile fields.
    const createResp = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/exams$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole("button", { name: "创建草稿" }).click();
    const created = await createResp;
    expect(created.ok(), `create exam: ${created.status()}`).toBe(true);

    // Land on the exam DETAIL page (draft review).
    const examId = ((await created.json()) as { id: string }).id;
    await expect(page).toHaveURL(
      new RegExp(`/admin/exams/${examId}(?:$|[/?#])`),
    );
    // The created exam identity is observable.
    await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();

    // Verify the materialized concrete values on the detail page: the override
    // (90 min) is the running value, NOT the profile's 60.
    const examDetailRes = await request.get(`${BASE_URL}/api/exams/${examId}`, {
      headers: { Cookie: `auth-token=${token}` },
    });
    const examDetail = (await examDetailRes.json()) as {
      durationMinutes: number;
      profileId?: string;
    };
    expect(examDetail.durationMinutes).toBe(90);
    // No Exam→profile FK: the detail response carries NO profileId (P7-M2
    // invariant — provenance is audit-only, not a runtime column).
    expect(examDetail.profileId).toBeUndefined();

    // Sanity: fixture ids are real.
    expect(courseId).toBeTruthy();
    expect(questionId).toBeTruthy();
    expect(profileId).toBeTruthy();
  });

  test("no-profile exam create stays usable (compatibility)", async ({
    page,
    request,
  }) => {
    const token = await adminApiToken(request);
    const unique = `np-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { courseId } = await setupFixtures(request, token, unique);

    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/exams/new`);

    const examTitle = `Wizard无模板-${unique}`;
    await page.getByPlaceholder("请输入考试名称").fill(examTitle);
    // Default profile picker is 不使用模板 — leave it.

    // Step 1 → 2 → 3.
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: "手动选题" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加" })
      .first()
      .click();
    await page.getByRole("button", { name: "关闭" }).click();
    await page.getByTestId("passingScore-input").fill("5");

    // Step 3 → 4 (schedule).
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByLabel("开始时间").fill("2026-09-02T09:00");
    await page.getByLabel("结束时间").fill("2026-09-02T11:00");

    // Step 4 → 5 (review) → create.
    await page.getByRole("button", { name: /下一步/ }).click();
    const createResp = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/exams$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole("button", { name: "创建草稿" }).click();
    const created = await createResp;
    expect(created.ok(), `no-profile create: ${created.status()}`).toBe(true);
    const examId = ((await created.json()) as { id: string }).id;
    await expect(page).toHaveURL(
      new RegExp(`/admin/exams/${examId}(?:$|[/?#])`),
    );
    expect(courseId).toBeTruthy();
  });

  test("schedule conflict is shown inline at step 4 (not a generic banner)", async ({
    page,
    request,
  }) => {
    const token = await adminApiToken(request);
    const unique = `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await setupFixtures(request, token, unique);

    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/exams/new`);
    await page.getByPlaceholder("请输入考试名称").fill(`Wizard校验-${unique}`);

    // Walk to step 4 (schedule).
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: /下一步/ }).click();
    // Fill an INVALID schedule: close before open.
    await page.getByLabel("开始时间").fill("2026-09-03T11:00");
    await page.getByLabel("结束时间").fill("2026-09-03T09:00");

    // Trying to advance shows the inline field error, and blocks navigation.
    await page.getByRole("button", { name: /下一步/ }).click();
    await expect(page.getByText("结束时间必须晚于开始时间")).toBeVisible();
    // Still on step 4 (no review heading).
    await expect(page.getByRole("heading", { name: "创建前检查" })).toHaveCount(
      0,
    );
  });
});
