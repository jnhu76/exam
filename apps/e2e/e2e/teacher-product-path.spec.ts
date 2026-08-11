/**
 * P4-C3 — Teacher positive product-path E2E.
 *
 * Proves the real Admin → Teacher → authoring → publish → result-surface
 * product path through SUPPORTED product interfaces (P4-G-01). The Teacher
 * account is created via POST /api/users { role: "Teacher" } authenticated as
 * Admin (NOT direct DB insertion, NOT a demo seed — task §6.2), then logged in
 * via the real /login UI.
 *
 * Allowed representative flow (task §6.3): use an existing seeded course (the
 * Teacher holds CourseView/QuestionCreate/ExamCreate globally in the MVP), or
 * create an already-supported objective question + exam via the real supported
 * API as the Teacher. No text_response/rubric authoring (removed P2-1 scope);
 * no manual/after_grading publication semantics; result access only verifies
 * the permitted results surface, not P3 publication timing.
 *
 * CORR1 (F-1): the representative Teacher authoring mutation now travels
 * through the rendered browser UI. After API setup (course + objective
 * question), the Teacher clicks the capability-gated 创建考试 action, fills the
 * real ExamCreatePage form, submits as draft, opens the created exam's detail
 * page, and clicks the real 发布考试 action. The exam creation AND publication
 * mutations both travel through the browser UI; only prerequisite fixture data
 * (course, question) uses the real supported API.
 *
 * CORR1 (F-2): the result-surface assertion now pins the explicit contract
 * (200 or 409 RESOURCE_CONFLICT with details.reason === "EXAM_NOT_FINISHED"),
 * failing on 401/403/404/422/500/503.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsTeacher } from "../lib/login";
import { createTeacherViaApi, teacherApiToken } from "../lib/teacher";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Create a course as the Teacher through the real /api/courses API
 * (Teacher holds CourseCreate). Returns the course id. API SETUP ONLY —
 * not a representative authoring mutation (see F-1: the exam create/publish
 * mutation is driven through the browser UI).
 */
async function teacherCreateCourse(
  request: APIRequestContext,
  teacherToken: string,
  unique: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/courses`, {
    headers: { Cookie: `auth-token=${teacherToken}` },
    data: {
      name: `Teacher课程-${unique}`,
      code: `TCH-${unique}-${Date.now()}`,
      description: "",
    },
  });
  if (!res.ok()) {
    throw new Error(
      `Teacher create course failed: ${res.status()} ${await res.text()}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
}

/**
 * Create an objective (true_false) question as the Teacher through the real
 * /api/questions API (Teacher holds QuestionCreate). No text_response/rubric.
 * API SETUP ONLY — not the representative authoring mutation (F-1).
 */
async function teacherCreateObjectiveQuestion(
  request: APIRequestContext,
  teacherToken: string,
  courseId: string,
  unique: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/questions`, {
    headers: { Cookie: `auth-token=${teacherToken}` },
    data: {
      courseId,
      type: "true_false",
      content: `教师判断题-${unique}`,
      standardAnswer: true,
      score: 100,
    },
  });
  if (!res.ok()) {
    throw new Error(
      `Teacher create question failed: ${res.status()} ${await res.text()}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
}

test.describe("P4-C3 Teacher positive product path", () => {
  test("Admin creates Teacher → Teacher logs in → Teacher authors + publishes via browser UI → Teacher reaches results surface", async ({
    page,
    request,
  }) => {
    // ── Step 1: Admin creates a Teacher via the SUPPORTED product interface ──
    // (POST /api/users { role: "Teacher" }), not direct DB insertion.
    const teacher = await createTeacherViaApi(request, {
      name: "P4C3教师-正向",
      usernamePrefix: "p4c3-tpos",
    });

    // ── Step 2: Teacher logs in through the REAL /login UI ──
    // Teacher lands on its capability-driven console surface (/admin/exams —
    // the first permitted surface in adminLandingPath, not a role string).
    await loginAsTeacher(page, teacher.username, teacher.password);
    await expect(page).toHaveURL(/\/admin\/exams(?:$|[/?#])/);

    // ── Step 3: Teacher sees the capability-driven navigation ──
    // ALLOWED nav: Courses, Questions (+ Import), Exams, Results.
    await expect(page.getByRole("link", { name: "课程管理" })).toBeVisible();
    await expect(page.getByRole("link", { name: "题目管理" })).toBeVisible();
    await expect(page.getByRole("link", { name: "题目导入" })).toBeVisible();
    await expect(page.getByRole("link", { name: "考试管理" })).toBeVisible();
    await expect(page.getByRole("link", { name: "成绩查询" })).toBeVisible();

    // DENIED nav (not rendered): Dashboard, Grading, Proctor, Users/Settings/etc.
    await expect(page.getByRole("link", { name: "仪表盘" })).not.toBeVisible();
    await expect(page.getByText("待评分")).not.toBeVisible();
    await expect(page.getByText("监考工作台")).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "用户管理" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "平台设置" }),
    ).not.toBeVisible();

    // ── Step 4a (API setup): prerequisite fixture data only ──
    // Course + objective question are created via the real supported API as
    // the Teacher. These are SETUP for the browser mutation, NOT the
    // representative authoring mutation itself (F-1): the exam create + publish
    // mutations below are driven through the rendered browser UI.
    const teacherToken = await teacherApiToken(request, teacher);
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const courseId = await teacherCreateCourse(request, teacherToken, unique);
    const questionId = await teacherCreateObjectiveQuestion(
      request,
      teacherToken,
      courseId,
      unique,
    );
    expect(questionId).toBeTruthy();

    // ── Step 4b (F-1 browser mutation): Teacher creates an exam through the ──
    // rendered ExamCreatePage. The 创建考试 button is capability-gated
    // (canCreateExam === ExamCreate, which the Teacher preset holds); it only
    // renders for capability holders, so its visibility itself proves admission.
    await expect(
      page.getByRole("button", { name: "创建考试" }),
      "Teacher must see the capability-gated create-exam action",
    ).toBeVisible();
    await page.getByRole("button", { name: "创建考试" }).click();
    await expect(page).toHaveURL(/\/admin\/exams\/new(?:$|[/?#])/);

    // Fill the exam title through the rendered wizard. The course Select is
    // auto-defaulted to the first course by ExamCreatePage.loadData (the
    // Teacher-created course is the only course in this org after API setup,
    // so it is the selected value). The new ExamCreatePage is a 5-step wizard
    // (P7-M): 基本信息 → 考试策略 → 题目与分数 → 时间安排 → 检查并创建.
    const examTitle = `Teacher考试-${unique}`;
    await page.getByPlaceholder("请输入考试名称").fill(examTitle);

    // Step 1 → 2 (policy): accept profile-free defaults.
    await page.getByRole("button", { name: /下一步/ }).click();
    // Step 2 → 3 (questions + scores).
    await page.getByRole("button", { name: /下一步/ }).click();

    // Pick a question through the rendered 手动选题 dialog. The dialog lists
    // the first page of /api/questions; the first available question belongs
    // to the auto-selected (first) course, so it satisfies the
    // "questions must belong to its course" publish invariant. We add it. The
    // Teacher-created course + question remain prerequisite fixture data; the
    // representative mutation is the exam create + publish, not which question
    // is attached.
    await page.getByRole("button", { name: "手动选题" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加" })
      .first()
      .click();
    await page.getByRole("button", { name: "关闭" }).click();

    // Lower 及格分 (passingScore) through the rendered form so it stays <= the
    // auto-computed totalScore. The selected question may carry a small demo
    // score (totalScore auto-calculates from it), while passingScore defaults
    // to 60; without this the client-side "passingScore > totalScore" guard
    // would block the save. Set it to 1 (min allowed). Reach the input through
    // a dedicated data-testid rather than a fragile sibling XPath, so the
    // locator survives Field-wrapper DOM changes.
    await page.getByTestId("passingScore-input").fill("1");

    // Step 3 → 4 (schedule): set an explicit open/close so the per-step gate
    // passes. The wizard requires both fields to advance.
    await page.getByRole("button", { name: /下一步/ }).click();
    const openAt = "2026-09-01T09:00";
    const closeAt = "2026-09-01T11:00";
    await page.getByLabel("开始时间").fill(openAt);
    await page.getByLabel("结束时间").fill(closeAt);

    // Step 4 → 5 (review).
    await page.getByRole("button", { name: /下一步/ }).click();

    // Create the draft exam through the rendered UI (wizard final step).
    // Capture the created exam id from the POST /api/exams response so we can
    // open its detail page next.
    const createResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/exams$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole("button", { name: "创建草稿" }).click();
    const createResponse = await createResponsePromise;
    expect(
      createResponse.ok(),
      `Teacher create exam through UI: ${createResponse.status()}`,
    ).toBe(true);
    const examId = ((await createResponse.json()) as { id: string }).id;
    expect(examId).toBeTruthy();

    // Submission succeeds → observable navigation to the exam DETAIL page
    // (the wizard routes to /admin/exams/:id for draft review, not the list).
    await expect(page).toHaveURL(
      new RegExp(`/admin/exams/${examId}(?:$|[/?#])`),
    );

    // ── Step 4c (F-1 browser mutation): Teacher publishes the exam through ──
    // the rendered ExamDetailPage. Open the created exam's detail page, then
    // click the capability-gated 发布考试 action (canPublishExam === ExamPublish,
    // which the Teacher preset holds). The button only renders for draft exams
    // held by capability holders, so its visibility proves admission.
    await page.goto(`${BASE_URL}/admin/exams/${examId}`);
    await expect(page).toHaveURL(
      new RegExp(`/admin/exams/${examId}(?:$|[/?#])`),
    );
    // The created exam identity is observable: its title renders on the detail
    // page header.
    await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();

    const publishBtn = page.getByRole("button", { name: "发布考试" });
    await expect(
      publishBtn,
      "Teacher must see the capability-gated publish action on the draft exam",
    ).toBeVisible();

    const publishResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /\/api\/exams\/[^/]+\/publish$/.test(new URL(res.url()).pathname),
    );
    // ExamDetailPage.handlePublish refetches the exam after a successful POST;
    // wait for that GET so the status badge re-renders before we assert it.
    const refetchPromise = page.waitForResponse(
      (res) =>
        res.request().method() === "GET" &&
        /\/api\/exams\/[^/]+$/.test(new URL(res.url()).pathname),
    );
    await publishBtn.click();
    const publishResponse = await publishResponsePromise;
    expect(publishResponse.status(), `Teacher publish exam through UI`).toBe(
      200,
    );
    await refetchPromise;

    // Publication succeeds through the rendered UI. The publish action
    // disappears (status is no longer draft) and the status badge re-renders
    // as "已发布" (status.exam.published). The Teacher preset lacks
    // ExamClose/ExamUnpublish, so no post-publish action button is expected to
    // render for the Teacher — the badge + publish-action disappearance are the
    // observable publication-success signals. We wait for handlePublish's
    // refetch (already awaited above) so the badge assertion sees the updated
    // status, not the stale draft. Assert the observable UI state, not just the
    // network status.
    await expect(publishBtn).toHaveCount(0);
    await expect(
      page.locator('[data-slot="status-badge"]'),
      "published exam must surface the 已发布 status badge",
    ).toContainText("已发布");

    // ── Step 5: Teacher reaches the permitted result surface ──
    // Teacher holds ScoreAllView → /admin/exams/:id/scores is permitted. We
    // verify AUTHORIZATION with an explicit contract (F-2): the response is
    // either 200 (scores ready) or 409 RESOURCE_CONFLICT with
    // details.reason === "EXAM_NOT_FINISHED" (the freshly-published exam has
    // no attempts yet — a post-gate business state owned by P3). Any other
    // status (401/403/404/422/500/503) fails the assertion. No P3 publication
    // timing / visibility semantics are asserted here.
    const resultsRes = await request.get(
      `${BASE_URL}/api/exams/${examId}/scores`,
      {
        headers: { Cookie: `auth-token=${teacherToken}` },
      },
    );
    const status = resultsRes.status();
    expect(
      [200, 409],
      `Teacher view exam scores must be authorized (200 or 409 EXAM_NOT_FINISHED), got ${status}`,
    ).toContain(status);
    if (status === 409) {
      const body = (await resultsRes.json()) as {
        error: { code: string; details?: { reason?: string } };
      };
      expect(body.error.code).toBe("RESOURCE_CONFLICT");
      expect(body.error.details?.reason).toBe("EXAM_NOT_FINISHED");
    }

    // The /admin/results page is reachable by the Teacher (direct URL renders,
    // not a 403 — P4-C2 route guard admits ScoreAllView holders).
    await page.goto(`${BASE_URL}/admin/results`);
    await expect(page.getByText("您没有权限访问该页面。")).not.toBeVisible();
  });
});
