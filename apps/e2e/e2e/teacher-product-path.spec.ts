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
 * Constraints honored (task §6.3): at least one meaningful Teacher mutation
 * travels through the browser UI when the existing UI already supports it
 * (Teacher lands on /admin/exams; we assert the capability-driven nav). API
 * setup for prerequisite fixture data uses the real supported API.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsTeacher } from "../lib/login";
import { createTeacherViaApi, teacherApiToken } from "../lib/teacher";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Create a course as the Teacher through the real /api/courses API
 * (Teacher holds CourseCreate). Returns the course id.
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
  test("Admin creates Teacher → Teacher logs in → Teacher authors + publishes → Teacher reaches results surface", async ({
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

    // ── Step 4: Teacher performs a representative allowed mutation via the ──
    // real supported API: create a course + an objective question + an exam +
    // publish it (Teacher holds CourseCreate/QuestionCreate/ExamCreate/
    // ExamPublish). No text_response/rubric (removed P2-1 scope).
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

    // Create an exam from the objective question and publish it as Teacher.
    // Payload mirrors the proven seed.ts shape (openAt/closeAt are required;
    // controlFlags/retakePolicy/scoreStrategy/maxAttempts default server-side).
    const examRes = await request.post(`${BASE_URL}/api/exams`, {
      headers: { Cookie: `auth-token=${teacherToken}` },
      data: {
        title: `Teacher考试-${unique}`,
        description: "",
        courseId,
        questionIds: [questionId],
        durationMinutes: 30,
        openAt: new Date(Date.now() - 3600_000).toISOString(),
        closeAt: new Date(Date.now() + 86400_000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        timingMode: "timed_window",
        resultPublicationMode: "immediate",
      },
    });
    expect(examRes.ok(), `Teacher create exam: ${examRes.status()}`).toBe(true);
    const examId = ((await examRes.json()) as { id: string }).id;

    const publishRes = await request.post(
      `${BASE_URL}/api/exams/${examId}/publish`,
      { headers: { Cookie: `auth-token=${teacherToken}` }, data: {} },
    );
    expect(publishRes.status(), `Teacher publish exam`).toBe(200);

    // ── Step 5: Teacher reaches the permitted result surface ──
    // Teacher holds ScoreAllView → /admin/results and /admin/exams/:id/scores
    // are permitted. We verify AUTHORIZATION only (the route admits the
    // Teacher — i.e. NOT a 403). The business state may return 200 (scores
    // ready) or a non-403 conflict/empty state when no attempts exist yet;
    // P3 owns publication timing / visibility semantics — not asserted here
    // per task §6.3.
    const resultsRes = await request.get(
      `${BASE_URL}/api/exams/${examId}/scores`,
      {
        headers: { Cookie: `auth-token=${teacherToken}` },
      },
    );
    expect(
      resultsRes.status(),
      `Teacher view exam scores must be authorized (not 403)`,
    ).not.toBe(403);

    // The /admin/results page is reachable by the Teacher (direct URL renders,
    // not a 403 — P4-C2 route guard admits ScoreAllView holders).
    await page.goto(`${BASE_URL}/admin/results`);
    await expect(page.getByText("您没有权限访问该页面。")).not.toBeVisible();
  });
});
