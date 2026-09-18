import { expect, test } from "@playwright/test";
import { loginAsAdmin, loginAsTeacher } from "../lib/login";
import {
  adminApiToken,
  adminPost,
  candidateApiToken,
  closeExamApi,
  startAndSubmitAttempt,
} from "../lib/flow";
import { assignTeacherToCourse, createTeacherViaApi } from "../lib/teacher";
import { seedExam } from "../lib/seed";

/**
 * issue 548 (C1) — assignment affordances and the score-export capability split,
 * proven in the REAL browser against the canonical APIs.
 *
 * Story A: an Admin manages a Teacher's course assignment through the
 * UsersPage dialog (open → assign → observe → revoke → observe removal).
 * Story A2: the same lifecycle for a Grader's exam assignment.
 * Story B: the F2-04 distinction — a Teacher with a course-scoped
 * ScoreAllView grant reaches the score page but sees NO export action; the
 * Admin sees it and the download returns 200 text/csv.
 *
 * Server authority is untouched: the UI gates are UX truthfulness only, and
 * the direct-API fail-closed proofs live in the vitest route suites.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function stampFor(key: string) {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${key}`;
}

test.describe("issue 548 assignment affordances (C1)", () => {
  test("Story A: Admin assigns then revokes a Teacher's course via the UsersPage dialog", async ({
    page,
    request,
  }) => {
    const stamp = stampFor("a");
    const courseName = `Course-548a-${stamp}`;
    const teacher = await createTeacherViaApi(request, {
      name: `E2E548教师${stamp}`,
      usernamePrefix: "e2e-548-teacher",
    });
    const token = await adminApiToken(request);
    const course = await adminPost(request, token, "/api/courses", {
      name: courseName,
      code: `E2E548A-${stamp}`,
      description: "",
    });
    expect(course.ok()).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: teacher.name }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "授课课程" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`管理「${teacher.name}」的授课课程`);
    await expect(dialog.getByText("尚未分配任何课程。")).toBeVisible();

    // Assign the seeded course through the real Select + 分配 control.
    await dialog.getByRole("combobox").click();
    const courseLabel = new RegExp(courseName);
    await page.getByRole("option", { name: courseLabel }).click();
    await dialog.getByRole("button", { name: "分配" }).click();
    // The post-mutation refresh renders the active assignment in-product.
    await expect(dialog.getByText(courseLabel)).toBeVisible({
      timeout: 15_000,
    });

    // Revoke through the real control; the refreshed projection drops it.
    await dialog.getByRole("button", { name: "撤销" }).click();
    await expect(dialog.getByText("尚未分配任何课程。")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByRole("button", { name: "撤销" })).toHaveCount(0);
  });

  test("Story A2: Admin assigns then revokes a Grader's exam via the UsersPage dialog", async ({
    page,
    request,
  }) => {
    const stamp = stampFor("g");
    const seeded = await seedExam(request, `a548g${stamp}`);
    const token = await adminApiToken(request);
    const graderName = `E2E548阅卷${stamp}`;
    const grader = await adminPost(request, token, "/api/users", {
      username: `e2e-548-grader-${stamp}`,
      password: "grader12345",
      name: graderName,
      role: "Grader",
    });
    expect(grader.ok()).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: graderName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "评卷考试" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`管理「${graderName}」的评卷考试`);
    await expect(dialog.getByText("尚未分配任何考试。")).toBeVisible();

    await dialog.getByRole("combobox").click();
    const examLabel = new RegExp(seeded.examTitle);
    await page.getByRole("option", { name: examLabel }).click();
    await dialog.getByRole("button", { name: "分配" }).click();
    await expect(dialog.getByText(examLabel)).toBeVisible({
      timeout: 15_000,
    });

    await dialog.getByRole("button", { name: "撤销" }).click();
    await expect(dialog.getByText("尚未分配任何考试。")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByRole("button", { name: "撤销" })).toHaveCount(0);
  });

  test("Story B: Teacher (course-scoped ScoreAllView) sees scores without export; Admin exports 200 text/csv", async ({
    browser,
    request,
  }) => {
    const stamp = stampFor("b");
    const seeded = await seedExam(request, `a548b${stamp}`);
    const teacher = await createTeacherViaApi(request, {
      name: `E2E548教师${stamp}`,
      usernamePrefix: "e2e-548-teacher-b",
    });
    // The Teacher's course-scoped ScoreAllView grant exists ONLY through the
    // real Teacher→Course assignment (issue 286).
    await assignTeacherToCourse(request, teacher, seeded.courseId);
    // A submitted attempt + closed exam make the score surface real.
    const candidateToken = await candidateApiToken(request, seeded.candidate);
    await startAndSubmitAttempt(request, candidateToken, seeded.examId);
    const adminToken = await adminApiToken(request);
    const closed = await closeExamApi(request, adminToken, seeded.examId);
    expect(closed.ok()).toBeTruthy();

    const scoresUrl = `/admin/exams/${seeded.examId}/scores`;

    // ── Teacher view: page loads, export affordance absent ──
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await loginAsTeacher(teacherPage, teacher.username, teacher.password);
    await teacherPage.goto(`${BASE_URL}${scoresUrl}`);
    // The page renders both a desktop table and a (CSS-hidden on this
    // viewport) mobile card list — scope row assertions to the table.
    const teacherTable = teacherPage.getByRole("table");
    await expect(teacherTable).toBeVisible({ timeout: 15_000 });
    await expect(teacherTable.getByText(seeded.candidate.name)).toBeVisible();
    await expect(
      teacherPage.getByRole("button", { name: "导出CSV" }),
      "Teacher holds ScoreAllView but NOT ScoreExport — the action the server would 403 must not be offered",
    ).toHaveCount(0);
    // The neighboring Back action stays available.
    await expect(
      teacherPage.getByRole("button", { name: "返回考试详情" }),
    ).toBeVisible();
    await teacherContext.close();

    // ── Admin view: same surface, export present, download 200 text/csv ──
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto(`${BASE_URL}${scoresUrl}`);
    const exportBtn = adminPage.getByRole("button", { name: "导出CSV" });
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });

    const [download, exportResponse] = await Promise.all([
      adminPage.waitForEvent("download"),
      adminPage.waitForResponse(
        (r) =>
          r.url().includes(`/api/exams/${seeded.examId}/export/scores`) &&
          r.request().method() === "GET",
      ),
      exportBtn.click(),
    ]);
    expect(exportResponse.status()).toBe(200);
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    expect(download.suggestedFilename()).toMatch(/^scores-exam-.+\.csv$/);
    await adminContext.close();
  });
});
