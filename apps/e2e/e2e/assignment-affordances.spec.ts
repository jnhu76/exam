import { expect, test, type Page } from "@playwright/test";
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
 * UsersPage dialog (open → search → assign → observe → revoke → removal).
 * Story A2: the same lifecycle for a Grader's exam assignment; the exam
 * catalog has no server-side search, so the target is reached through the
 * REAL catalog pagination.
 * Story B: the F2-04 distinction — a Teacher with a course-scoped
 * ScoreAllView grant reaches the score page but sees NO export action; the
 * Admin sees it and the download returns 200 text/csv.
 * Story C (corrective): a course positioned beyond the first 100 — beyond
 * the old fixed-first-page truncation — is reachable through the catalog's
 * server-side search and assignable.
 *
 * Server authority is untouched: the UI gates are UX truthfulness only, and
 * the direct-API fail-closed proofs live in the vitest route suites.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function stampFor(key: string) {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${key}`;
}

/**
 * Locates a staff row on the real-paginated UsersPage (issue 548
 * corrective): the staff list pages at 20/page ordered oldest-first, so a
 * freshly created staff member can sit on a later page.
 */
async function findStaffRow(page: Page, name: string) {
  for (let i = 0; i < 15; i++) {
    const row = page.getByRole("row").filter({ hasText: name }).first();
    if (
      await row.waitFor({ state: "visible", timeout: 3_000 }).then(
        () => true,
        () => false,
      )
    ) {
      return row;
    }
    const next = page.getByRole("button", { name: "下一页" });
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  throw new Error(
    `staff row not reachable through UsersPage pagination: ${name}`,
  );
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
    const row = await findStaffRow(page, teacher.name);
    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "授课课程" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`管理「${teacher.name}」的授课课程`);
    await expect(dialog.getByText("尚未分配任何课程。")).toBeVisible();

    // The course catalog is server-side searched (issue 548 corrective): the
    // freshly created course sorts after the seeded catalog, so the debounced
    // search — not any fixed first page — is what makes it selectable.
    await dialog.getByRole("searchbox").fill(courseName);
    const courseRadio = dialog.getByRole("radio", { name: courseName });
    await courseRadio.click({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "分配" }).click();
    // The post-mutation refresh renders the active assignment in-product.
    await expect(dialog.getByRole("button", { name: "撤销" })).toBeVisible({
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
    const row = await findStaffRow(page, graderName);
    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "评卷考试" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`管理「${graderName}」的评卷考试`);
    await expect(dialog.getByText("尚未分配任何考试。")).toBeVisible();

    // The exam catalog offers no search (the route has no search parameter);
    // reachability is REAL pagination — page until the seeded exam is
    // selectable. Each 下一页 click resolves against the canonical
    // /api/exams list response.
    const examRadio = dialog.getByRole("radio", { name: seeded.examTitle });
    for (let guard = 0; guard < 12; guard++) {
      if (
        await examRadio.waitFor({ state: "visible", timeout: 1_000 }).then(
          () => true,
          () => false,
        )
      ) {
        break;
      }
      const next = dialog.getByRole("button", { name: "下一页" });
      expect(
        next.isEnabled(),
        "target exam must stay reachable by paging",
      ).toBeTruthy();
      const [examListResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/api/exams?") && r.request().method() === "GET",
        ),
        next.click(),
      ]);
      expect(examListResponse.ok()).toBeTruthy();
    }
    await examRadio.click();
    await dialog.getByRole("button", { name: "分配" }).click();
    await expect(dialog.getByRole("button", { name: "撤销" })).toBeVisible({
      timeout: 15_000,
    });

    await dialog.getByRole("button", { name: "撤销" }).click();
    await expect(dialog.getByText("尚未分配任何考试。")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByRole("button", { name: "撤销" })).toHaveCount(0);
  });

  test("Story C: a course beyond the first 100 is reachable via catalog search and assignable (issue 548 corrective)", async ({
    page,
    request,
  }) => {
    const stamp = stampFor("c");
    const teacher = await createTeacherViaApi(request, {
      name: `E2E548教师${stamp}`,
      usernamePrefix: "e2e-548-teacher-c",
    });
    const token = await adminApiToken(request);
    // 101 new courses on top of the seeded catalog: the LAST created course
    // sorts after position 100 — invisible to the old fixed-first-100
    // truncation, reachable only through search/pagination.
    const courseCount = 101;
    for (let i = 1; i <= courseCount; i++) {
      const res = await adminPost(request, token, "/api/courses", {
        name: `E2E548C课程${stamp}-${i}`,
        code: `E2E548C-${stamp}-${i}`,
        description: "",
      });
      expect(res.ok(), `course ${i} created`).toBeTruthy();
    }
    const targetName = `E2E548C课程${stamp}-${courseCount}`;

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = await findStaffRow(page, teacher.name);
    await row.getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("menuitem", { name: "授课课程" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`管理「${teacher.name}」的授课课程`);
    // The first catalog page (20 oldest courses) cannot contain the newest
    // course, and real pagination controls are present.
    await expect(dialog.getByRole("radio", { name: targetName })).toHaveCount(
      0,
    );
    await expect(dialog.getByText(/共 \d+ 条/)).toBeVisible();
    // Server-side search reaches beyond the first page AND the old 100 cap.
    await dialog.getByRole("searchbox").fill(targetName);
    await dialog.getByRole("radio", { name: targetName }).click({
      timeout: 10_000,
    });
    await dialog.getByRole("button", { name: "分配" }).click();
    await expect(dialog.getByRole("button", { name: "撤销" })).toBeVisible({
      timeout: 15_000,
    });
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
