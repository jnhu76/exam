/**
 * P4-C3 — Teacher negative-authorization boundary E2E.
 *
 * Proves the Teacher is denied the frozen-P4-matrix-denied surfaces at both
 * the UI boundary (P4-C2 route guard renders the 403 page on direct URL) and
 * the API boundary (backend capability gate returns 403). P4-G-03.
 *
 * Teacher is created via the SUPPORTED product interface (POST /api/users
 * { role: "Teacher" }) and logged in via the real /login UI — same fixture
 * discipline as teacher-product-path.spec.ts (task §6.2).
 *
 * Denied surfaces (frozen P4 matrix, P4-R0 §12):
 *   user management, role assignment, grading, proctoring, diagnostics /
 *   settings / audit, score export.
 */
import { test, expect } from "@playwright/test";
import { loginAsTeacher } from "../lib/login";
import { createTeacherViaApi, teacherApiToken } from "../lib/teacher";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.describe("P4-C3 Teacher negative-authorization boundary", () => {
  test("Teacher is denied admin/grading/proctor/users/settings/diagnostics at the UI and API boundaries", async ({
    page,
    request,
  }) => {
    const teacher = await createTeacherViaApi(request, {
      name: "P4C3教师-负向",
      usernamePrefix: "p4c3-tneg",
    });
    await loginAsTeacher(page, teacher.username, teacher.password);

    // ── UI boundary (P4-C2 route guard): direct-URL → 403 page ──
    // Each denied /admin/* route renders the access-denied page, NOT the
    // privileged page content. The Teacher stays in the authenticated admin
    // shell. F-3 hardening: per route we assert (a) the AccessDenied text, (b)
    // the current URL remains the requested denied route (no silent redirect),
    // (c) the Teacher remains in the authenticated admin shell (admin-layout
    // testid visible), and (d) a representative privileged page control is
    // absent (the privileged <Outlet/> is unmounted by the C2 render-branch).
    const deniedRoutes: ReadonlyArray<{
      path: string;
      privilegedHeading: RegExp;
    }> = [
      {
        path: "/admin/users",
        // UsersPage heading "用户管理".
        privilegedHeading: /用户管理/,
      },
      {
        path: "/admin/grading-queue",
        // GradingQueuePage heading "待评分".
        privilegedHeading: /待评分/,
      },
      {
        path: "/admin/proctor",
        // ProctorWorkspacePage heading "监考工作台".
        privilegedHeading: /监考工作台/,
      },
      {
        path: "/admin/settings",
        // Settings page renders the 平台与机构设置 heading.
        privilegedHeading: /平台与机构设置/,
      },
      {
        path: "/admin/system",
        // SystemPage heading "系统监控".
        privilegedHeading: /系统监控/,
      },
      {
        path: "/admin/audit-logs",
        // AuditLogPage heading "审计日志".
        privilegedHeading: /审计日志/,
      },
    ];
    for (const deniedCase of deniedRoutes) {
      await page.goto(`${BASE_URL}${deniedCase.path}`);

      // (a) AccessDenied text renders.
      await expect(
        page.getByText("您没有权限访问该页面。"),
        `direct URL ${deniedCase.path} must render the 403 page`,
      ).toBeVisible();

      // (b) Current URL remains the requested denied route (no redirect).
      await expect(page).toHaveURL(
        new RegExp(`${deniedCase.path.replace(/\//g, "\\/")}(?:$|[/?#])`),
      );

      // (c) Teacher remains in the authenticated admin shell.
      await expect(
        page.getByTestId("admin-layout"),
        `Teacher must remain in the admin shell on ${deniedCase.path}`,
      ).toBeVisible();

      // (d) Representative privileged page content is absent (the privileged
      // <Outlet/> is unmounted by the C2 render-branch).
      await expect(
        page.getByRole("heading", { name: deniedCase.privilegedHeading }),
        `privileged heading must be absent on denied ${deniedCase.path}`,
      ).toHaveCount(0);
    }

    // ── API boundary (backend capability gate): 403 ──
    const teacherToken = await teacherApiToken(request, teacher);

    // GET /api/users → 403 (UserView denied).
    const usersRes = await request.get(`${BASE_URL}/api/users`, {
      headers: { Cookie: `auth-token=${teacherToken}` },
    });
    expect(usersRes.status(), "GET /api/users as Teacher").toBe(403);

    // GET /api/admin/grading-queue → 403 (GradingQueueView denied).
    const gradingRes = await request.get(
      `${BASE_URL}/api/admin/grading-queue`,
      {
        headers: { Cookie: `auth-token=${teacherToken}` },
      },
    );
    expect(gradingRes.status(), "GET /api/admin/grading-queue as Teacher").toBe(
      403,
    );

    // GET /api/admin/proctor/exams → 403 (ExamRoomView denied).
    const proctorRes = await request.get(
      `${BASE_URL}/api/admin/proctor/exams`,
      { headers: { Cookie: `auth-token=${teacherToken}` } },
    );
    expect(proctorRes.status(), "GET /api/admin/proctor/exams as Teacher").toBe(
      403,
    );

    // GET /api/system/diagnostics → 403 (SystemDiagnosticsView denied).
    const diagRes = await request.get(`${BASE_URL}/api/system/diagnostics`, {
      headers: { Cookie: `auth-token=${teacherToken}` },
    });
    expect(diagRes.status(), "GET /api/system/diagnostics as Teacher").toBe(
      403,
    );

    // GET /api/roles/assignable → 403 (UserRoleAssign denied).
    const rolesRes = await request.get(`${BASE_URL}/api/roles/assignable`, {
      headers: { Cookie: `auth-token=${teacherToken}` },
    });
    expect(rolesRes.status(), "GET /api/roles/assignable as Teacher").toBe(403);

    // Score export requires a real exam id; assert the capability gate denies
    // before the resource check by hitting a synthetic id (expect 403, not 404
    // — the capability gate runs before the resolver). Use a well-formed uuid.
    const exportRes = await request.get(
      `${BASE_URL}/api/exams/00000000-0000-4000-8000-000000000000/export/scores`,
      { headers: { Cookie: `auth-token=${teacherToken}` } },
    );
    expect(
      exportRes.status(),
      "GET /api/exams/:id/export/scores as Teacher",
    ).toBe(403);
  });
});
