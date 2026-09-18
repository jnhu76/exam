import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { UsersPage } from "./UsersPage";
import { Permission, permissionsForRole } from "@exam/authz";

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const mockUsers = [
  {
    id: "u3",
    username: "admin1",
    name: "Admin One",
    role: "Admin",
    activeRoles: ["Admin"],
    isActive: true,
  },
];

// issue 548 assignment-affordance fixtures: target eligibility is derived from
// activeRoles (assignment truth), never from the primary-role cache.
const teacherTarget = {
  id: "u-t",
  username: "teacher1",
  name: "Teacher One",
  role: "Teacher",
  activeRoles: ["Teacher"],
  isActive: true,
};
const candidateTeacherTarget = {
  id: "u-ct",
  username: "cand-teacher",
  name: "Cand+Teach",
  role: "Candidate",
  activeRoles: ["Teacher", "Candidate"],
  isActive: true,
};
const staleTeacherTarget = {
  id: "u-st",
  username: "stale-teacher",
  name: "Stale Teacher",
  role: "Teacher",
  activeRoles: [],
  isActive: true,
};
const graderTarget = {
  id: "u-g",
  username: "grader1",
  name: "Grader One",
  role: "Grader",
  activeRoles: ["Grader"],
  isActive: true,
};
const candidateGraderTarget = {
  id: "u-cg",
  username: "cand-grader",
  name: "Cand+Grader",
  role: "Candidate",
  activeRoles: ["Grader", "Candidate"],
  isActive: true,
};

const mockCourseOptions = [
  { id: "c1", name: "数学", code: "MATH-101" },
  { id: "c2", name: "物理", code: "PHYS-101" },
];
const mockExamOptions = [{ id: "e1", title: "期末考试" }];

/**
 * Assignable-role authority returned by GET /roles/assignable (F-01: the
 * selector is driven by the backend, not a frontend hardcoded closed set).
 */
const mockAssignableRoles = [
  { key: "Admin", label: "Admin", purpose: "Exam administrator" },
  { key: "Teacher", label: "Teacher", purpose: "Course/exam authoring" },
  { key: "Proctor", label: "Proctor", purpose: "Exam-room runtime" },
  { key: "Grader", label: "Grader", purpose: "Manual scoring" },
  { key: "Candidate", label: "Candidate", purpose: "Examinee" },
  {
    key: "Maintainer",
    label: "Maintainer",
    purpose: "System operations observer",
  },
];

/** Routes api.get by URL: /api/roles/assignable vs the users list. */
function mockApiGet(usersOverride?: {
  items: unknown[];
  total: number;
  totalPages: number;
}) {
  apiGet.mockImplementation(async (url: string) => {
    if (url === "/api/roles/assignable") return { items: mockAssignableRoles };
    // #297: the invitations panel loads its own list inside the page.
    if (url.startsWith("/api/invitations")) {
      return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    }
    return (
      usersOverride ?? {
        items: mockUsers,
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      }
    );
  });
}

function renderPage(capabilities?: string[]) {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <AuthProvider
        initialUser={{
          id: "u3",

          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          // Explicit capability sets model View/Manage splits (issue 548); the
          // default is the full Admin preset.
          capabilities: capabilities ?? [...permissionsForRole("Admin")],
        }}
      >
        <BrandProvider>
          <Routes>
            <Route path="/admin/users" element={<UsersPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Routes the assignment-management GET endpoints (issue 548): the users list plus
 * the per-user assignment lists and the course/exam option lists, so
 * lifecycle tests can drive the dialogs against canonical routes.
 */
function mockAssignmentApi(options?: {
  users?: unknown[];
  courseAssignments?: unknown[];
  examAssignments?: unknown[];
  courses?: unknown[];
  exams?: unknown[];
}) {
  apiGet.mockImplementation(async (url: string) => {
    if (url === "/api/roles/assignable") return { items: mockAssignableRoles };
    if (url.startsWith("/api/invitations")) {
      return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    }
    if (url.includes("/course-assignments")) {
      return { items: options?.courseAssignments ?? [] };
    }
    if (url.includes("/exam-assignments")) {
      return { items: options?.examAssignments ?? [] };
    }
    if (url.startsWith("/api/courses")) {
      return { items: options?.courses ?? mockCourseOptions };
    }
    if (url.startsWith("/api/exams")) {
      return { items: options?.exams ?? mockExamOptions };
    }
    return {
      items: options?.users ?? [mockUsers[0], teacherTarget],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };
  });
}

/** Opens a row's kebab overflow menu and returns its scoped menu element. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  const table = await screen.findByRole("table");
  const kebab = within(table).getAllByRole("button", {
    name: "更多操作",
  })[0]!;
  await user.click(kebab);
  return screen.getByRole("menu");
}

function getDialogInputs(dialog: HTMLElement) {
  return dialog.querySelectorAll("input");
}

describe("UsersPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    mockApiGet();
    apiPost.mockResolvedValue({ id: "u4" });
    apiPatch.mockResolvedValue({ ok: true });
  });

  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("用户管理")).toBeInTheDocument();
  });

  it("renders user list with Admin role", async () => {
    renderPage();
    // Row content renders twice by design (desktop table + mobile cards);
    // scope to the desktop table representation.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("admin1")).toBeInTheDocument();
    expect(within(table).getByText("考试管理员")).toBeInTheDocument();
  });

  it("renders add user button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "新增用户" }),
    ).toBeInTheDocument();
  });

  it("create dialog shows the staff role options sourced from /roles/assignable (F-01)", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    const dialog = await screen.findByRole("dialog");
    const trigger = within(dialog).getByRole("combobox");
    await user.click(trigger);
    // The selector is driven by GET /roles/assignable (the backend
    // @exam/authz ROLE_PRESETS authority), not a frontend hardcoded set.
    expect(
      await screen.findByRole("option", { name: "考试管理员" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "教师" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "监考员" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "阅卷员" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "系统运维" }),
    ).toBeInTheDocument();
    // Candidate is NOT offered (managed via candidate routes); System is never
    // assignable; SuperAdmin is never defined (no ADR).
    expect(
      screen.queryByRole("option", { name: "候选人" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "超级管理员" }),
    ).not.toBeInTheDocument();
  });

  it("role selector reflects exactly what /roles/assignable returns (F-01 catalog authority)", async () => {
    // If the backend assignable authority returns only [Admin, Teacher], the
    // selector must show only those — proving it is not a hardcoded set.
    apiGet.mockImplementation(async (url: string) =>
      url === "/api/roles/assignable"
        ? {
            items: [
              { key: "Admin", label: "Admin", purpose: "x" },
              { key: "Teacher", label: "Teacher", purpose: "x" },
            ],
          }
        : { items: mockUsers, total: 1, page: 1, pageSize: 20, totalPages: 1 },
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    expect(
      await screen.findByRole("option", { name: "考试管理员" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "教师" })).toBeInTheDocument();
    // The selector does NOT offer roles the backend did not return.
    expect(
      screen.queryByRole("option", { name: "监考员" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "系统运维" }),
    ).not.toBeInTheDocument();
  });

  it("shows validation errors for empty fields on create", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入姓名")).toBeInTheDocument();
    expect(screen.getByText("密码至少 8 位")).toBeInTheDocument();
  });

  it("creates a new Admin user with valid data", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    const dialog = await screen.findByRole("dialog");
    const inputs = getDialogInputs(dialog);
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "New User");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPost).toHaveBeenCalledWith("/api/users", {
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "Admin",
    });
  });

  it("disables save button while saving", async () => {
    let resolveSave: (value: unknown) => void;
    apiPost.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    const dialog = await screen.findByRole("dialog");
    const inputs = getDialogInputs(dialog);
    await user.type(inputs[0]!, "newuser");
    await user.type(inputs[1]!, "password123");
    await user.type(inputs[2]!, "New User");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.dblClick(saveBtn);
    expect(
      within(dialog).getByRole("button", { name: "保存中..." }),
    ).toBeDisabled();
    expect(apiPost).toHaveBeenCalledTimes(1);
    resolveSave!({ id: "u4" });
    await act(async () => {});
  });

  it("opens edit dialog for Admin", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[0]!);
    expect(screen.getByText("编辑用户")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });

  it("edits a user", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    const nameInput = getDialogInputs(dialog)[0]!;
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPatch).toHaveBeenCalledWith("/api/users/u3", {
      name: "Updated Name",
      role: "Admin",
    });
  });

  it("opens confirmation before toggling user active status", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table");
    const toggleBtn = within(table).getByRole("button", { name: "禁用" });
    await user.click(toggleBtn);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Admin One/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "确认" });
    expect(confirm).toHaveAttribute("data-variant", "destructive");
    await user.click(confirm);
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/users/u3",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("closes dialog on cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    const dialog = screen.getByRole("dialog");
    const cancelBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "取消")!;
    await user.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows error state when loading fails", async () => {
    apiGet.mockRejectedValue(new Error("fail"));
    renderPage();
    expect(await screen.findByText("加载用户列表失败")).toBeInTheDocument();
  });

  it("shows empty state when no users", async () => {
    apiGet.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    renderPage();
    expect(await screen.findByText("暂无用户")).toBeInTheDocument();
  });

  it("renders exactly what the server returns — no client-side role post-filter (F-03)", async () => {
    // The server applies the staff filter BEFORE pagination. The client must
    // not re-filter by `users.role`: a Candidate-primary user with a staff
    // secondary assignment (compatibility role "Candidate") must stay visible.
    apiGet.mockResolvedValue({
      items: [
        ...mockUsers,
        {
          id: "u6",
          username: "cand-teacher",
          name: "Candidate+Teacher",
          role: "Candidate",
          activeRoles: ["Teacher", "Candidate"],
          isActive: true,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    renderPage();
    const tables = await screen.findAllByRole("table");
    const table = tables.find((t) => within(t).queryByText("admin1"))!;
    expect(within(table).getByText("admin1")).toBeInTheDocument();
    expect(within(table).getByText("cand-teacher")).toBeInTheDocument();
  });

  it("edit dialog never silently falls back to Admin when the current role is not in the assignable catalog (P7 review #6)", async () => {
    // Catalog drift / future-compatible state: the editing user's current
    // role (Maintainer) is missing from GET /roles/assignable.
    apiGet.mockImplementation(async (url: string) =>
      url === "/api/roles/assignable"
        ? {
            items: [
              { key: "Admin", label: "Admin", purpose: "x" },
              { key: "Teacher", label: "Teacher", purpose: "x" },
              { key: "Candidate", label: "Candidate", purpose: "x" },
            ],
          }
        : {
            items: [
              {
                id: "u9",
                username: "maint1",
                name: "Maint One",
                role: "Maintainer",
                activeRoles: ["Maintainer"],
                isActive: true,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          },
    );
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    // Read-only hint shows the ORIGINAL role (its zh label), not a silently
    // selected Admin.
    expect(screen.getByTestId("locked-role")).toHaveTextContent("系统运维");
    const nameInput = getDialogInputs(dialog)[0]!;
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    // PATCH omits `role` entirely — the save cannot flip the user to Admin.
    expect(apiPatch).toHaveBeenCalledWith("/api/users/u9", {
      name: "Updated Name",
    });
    expect(apiPatch.mock.calls[0]![1]).not.toHaveProperty("role");
  });

  it("edit dialog locks the role for a Candidate-primary + staff-secondary user (F-03 safe path)", async () => {
    // The user is a staff member via a secondary assignment, so the server
    // returns them in the staff list with the compatibility role "Candidate".
    // "Candidate" is NOT selectable in the staff dialog → the role must be
    // read-only and PATCH must omit `role` (no silent flip, no unmappable
    // Select value).
    apiGet.mockResolvedValue({
      items: [
        ...mockUsers,
        {
          id: "u11",
          username: "cand-teacher2",
          name: "Cand+Teacher",
          role: "Candidate",
          activeRoles: ["Teacher", "Candidate"],
          isActive: true,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[1]!);
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByTestId("locked-role")).toHaveTextContent("候选人");
    const nameInput = getDialogInputs(dialog)[0]!;
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPatch).toHaveBeenCalledWith("/api/users/u11", {
      name: "Renamed",
    });
    expect(apiPatch.mock.calls[0]![1]).not.toHaveProperty("role");
  });

  it("role label falls back to the generic Chinese label when the local i18n key is missing", async () => {
    // Backend returns a role the frontend locale has no `roleLabels` entry
    // for; the UI must render the generic `unknown` label (zh-CN), never the
    // API-provided English label or the raw i18n key path.
    apiGet.mockImplementation(async (url: string) =>
      url === "/api/roles/assignable"
        ? {
            items: [
              {
                key: "Auditor",
                label: "Auditor 审计员",
                purpose: "future role",
              },
              { key: "Admin", label: "Admin", purpose: "x" },
              { key: "Candidate", label: "Candidate", purpose: "x" },
            ],
          }
        : url.startsWith("/api/invitations")
          ? // #297: the invitations panel renders its own role badges; keep
            // the list empty so the single-fallback assertion below only sees
            // the users-table badge.
            { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
          : {
              items: [
                {
                  id: "u10",
                  username: "aud1",
                  name: "Aud One",
                  role: "Auditor",
                  activeRoles: ["Admin"],
                  isActive: true,
                },
              ],
              total: 1,
              page: 1,
              pageSize: 20,
              totalPages: 1,
            },
    );
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("aud1")).toBeInTheDocument();
    expect(within(table).getByText("未知角色")).toBeInTheDocument();
    expect(
      screen.queryByText(/admin\.users\.roleLabels\./),
    ).not.toBeInTheDocument();
  });

  it("renders a Candidate-only row exactly as the server returns it (server-side staff filter is the contract)", async () => {
    // The server owns staff membership; the client renders the page as-is.
    // A Candidate-only row would only reach this page if the server filter
    // regressed — displaying it (instead of silently hiding it) makes that
    // regression visible rather than masked by a client-side post-filter.
    apiGet.mockResolvedValue({
      items: [
        ...mockUsers,
        {
          id: "u5",
          username: "cand1",
          name: "Candidate",
          role: "Candidate",
          activeRoles: ["Candidate"],
          isActive: true,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    renderPage();
    const tables = await screen.findAllByRole("table");
    const table = tables.find((t) => within(t).queryByText("admin1"))!;
    expect(within(table).getByText("admin1")).toBeInTheDocument();
    expect(within(table).getByText("cand1")).toBeInTheDocument();
  });

  describe("Teacher course-assignment affordance (issue 548)", () => {
    it("offers the action for a Candidate-primary + Teacher-secondary target (active-role truth, not users.role)", async () => {
      mockAssignmentApi({ users: [mockUsers[0], candidateTeacherTarget] });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      expect(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      ).toBeInTheDocument();
    });

    it("does NOT offer the action when the cached primary role is Teacher but no Teacher assignment is active", async () => {
      // The stale-cache shape (F-06): users.role keeps "Teacher" while the
      // active set is empty. The compatibility cache must never substitute
      // for assignment truth. With the assignment action gated off the row
      // keeps only edit + toggle (≤2 actions) — no overflow kebab exists and
      // the affordance is unreachable in any representation.
      mockAssignmentApi({ users: [mockUsers[0], staleTeacherTarget] });
      renderPage();
      const table = await screen.findByRole("table");
      expect(
        within(table).queryByRole("button", { name: "授课课程" }),
      ).not.toBeInTheDocument();
      expect(
        within(table).queryAllByRole("button", { name: "更多操作" }),
      ).toHaveLength(0);
    });

    it("full lifecycle: open → GET assignments + courses → POST assign → refresh → revoke → refresh → removal", async () => {
      // Mutable server-side state: assign/revoke mutate the fixture so the
      // dialog's post-mutation refresh renders the new truth.
      const courseAssignments: {
        id: string;
        courseId: string;
        status: "active" | "revoked";
        assignedAt: string;
        revokedAt: string | null;
      }[] = [];
      mockAssignmentApi({
        users: [mockUsers[0], teacherTarget],
        courseAssignments: [],
        courses: mockCourseOptions,
      });
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.includes("/course-assignments")) {
          return { items: [...courseAssignments] };
        }
        return origImpl(url);
      });
      apiPost.mockImplementation(async (url: string, body?: unknown) => {
        if (
          url === "/api/admin/users/u-t/course-assignments" &&
          typeof body === "object"
        ) {
          courseAssignments.push({
            id: "a1",
            courseId: (body as { courseId: string }).courseId,
            status: "active",
            assignedAt: "2026-09-18T00:00:00Z",
            revokedAt: null,
          });
          return { outcome: "applied" };
        }
        if (url === "/api/admin/users/u-t/course-assignments/c1/revoke") {
          const idx = courseAssignments.findIndex((a) => a.courseId === "c1");
          if (idx >= 0) {
            courseAssignments[idx]!.status = "revoked";
            courseAssignments[idx]!.revokedAt = "2026-09-18T01:00:00Z";
          }
          return { outcome: "applied" };
        }
        return { ok: true };
      });
      const user = userEvent.setup();
      renderPage();

      // Open the dialog from the row's kebab menu.
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText("管理「Teacher One」的授课课程"),
      ).toBeInTheDocument();
      // Both canonical GETs fired.
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledWith(
          "/api/admin/users/u-t/course-assignments?status=all",
        );
      });
      expect(apiGet).toHaveBeenCalledWith("/api/courses?page=1&pageSize=100");
      // Empty start.
      expect(
        await within(dialog).findByText("尚未分配任何课程。"),
      ).toBeInTheDocument();

      // Select the course and assign.
      await user.click(within(dialog).getByRole("combobox"));
      await user.click(
        await screen.findByRole("option", { name: "数学 (MATH-101)" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-t/course-assignments",
        { courseId: "c1" },
      );
      // Post-mutation refresh rendered the active assignment.
      expect(
        await within(dialog).findByText("数学 (MATH-101)"),
      ).toBeInTheDocument();

      // Revoke it and observe removal.
      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/admin/users/u-t/course-assignments/c1/revoke",
        );
      });
      await waitFor(() => {
        expect(
          within(dialog).queryByRole("button", { name: "撤销" }),
        ).not.toBeInTheDocument();
      });
      expect(
        await within(dialog).findByText("尚未分配任何课程。"),
      ).toBeInTheDocument();
    });

    it("surfaces the no_change outcome from a duplicate assignment", async () => {
      const { toast } = await import("sonner");
      mockAssignmentApi({ users: [mockUsers[0], teacherTarget] });
      apiPost.mockResolvedValue({ outcome: "no_change" });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox"));
      await user.click(
        await screen.findByRole("option", { name: "数学 (MATH-101)" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith("该课程已在授课列表中");
      });
    });

    it("busy protection: a double click issues exactly one assign POST", async () => {
      let resolveAssign: (value: unknown) => void;
      apiPost.mockReturnValue(
        new Promise((resolve) => {
          resolveAssign = resolve;
        }),
      );
      mockAssignmentApi({ users: [mockUsers[0], teacherTarget] });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("combobox"));
      await user.click(
        await screen.findByRole("option", { name: "数学 (MATH-101)" }),
      );
      const assignBtn = within(dialog).getByRole("button", { name: "分配" });
      await user.dblClick(assignBtn);
      const assignCalls = apiPost.mock.calls.filter(
        (c) => c[0] === "/api/admin/users/u-t/course-assignments",
      );
      expect(assignCalls).toHaveLength(1);
      resolveAssign!({ outcome: "applied" });
      await act(async () => {});
    });

    it("actor without CourseTeacherAssignmentView sees no action (capability, not role label)", async () => {
      mockAssignmentApi({ users: [mockUsers[0], teacherTarget] });
      renderPage(
        [...permissionsForRole("Admin")].filter(
          (p) => p !== Permission.CourseTeacherAssignmentView,
        ),
      );
      const table = await screen.findByRole("table");
      expect(
        within(table).queryByRole("button", { name: "授课课程" }),
      ).not.toBeInTheDocument();
      expect(
        within(table).queryAllByRole("button", { name: "更多操作" }),
      ).toHaveLength(0);
    });

    it("View without Manage renders the dialog read-only (no assign/revoke affordances)", async () => {
      mockAssignmentApi({
        users: [mockUsers[0], teacherTarget],
        courseAssignments: [
          {
            id: "a1",
            courseId: "c1",
            status: "active",
            assignedAt: "2026-09-18T00:00:00Z",
            revokedAt: null,
          },
        ],
      });
      const user = userEvent.setup();
      renderPage(
        [...permissionsForRole("Admin")].filter(
          (p) => p !== Permission.CourseTeacherAssignmentManage,
        ),
      );
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      // The read-only projection still lists the active assignment…
      expect(
        await within(dialog).findByText("数学 (MATH-101)"),
      ).toBeInTheDocument();
      // …but exposes no mutation affordances.
      expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "分配" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "撤销" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Grader exam-assignment affordance (issue 548)", () => {
    it("offers the action for a Candidate-primary + Grader-secondary target", async () => {
      mockAssignmentApi({ users: [mockUsers[0], candidateGraderTarget] });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      expect(
        within(menu).getByRole("menuitem", { name: "评卷考试" }),
      ).toBeInTheDocument();
    });

    it("full lifecycle: open → GET assignments + exams → POST assign → refresh → revoke → refresh → removal", async () => {
      const examAssignments: {
        id: string;
        examId: string;
        status: "active" | "revoked";
        assignedAt: string;
        revokedAt: string | null;
      }[] = [];
      mockAssignmentApi({
        users: [mockUsers[0], graderTarget],
        examAssignments: [],
        exams: mockExamOptions,
      });
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.includes("/exam-assignments")) {
          return { items: [...examAssignments] };
        }
        return origImpl(url);
      });
      apiPost.mockImplementation(async (url: string, body?: unknown) => {
        if (
          url === "/api/admin/users/u-g/exam-assignments" &&
          typeof body === "object"
        ) {
          examAssignments.push({
            id: "ea1",
            examId: (body as { examId: string }).examId,
            status: "active",
            assignedAt: "2026-09-18T00:00:00Z",
            revokedAt: null,
          });
          return { outcome: "applied" };
        }
        if (url === "/api/admin/users/u-g/exam-assignments/e1/revoke") {
          const idx = examAssignments.findIndex((a) => a.examId === "e1");
          if (idx >= 0) {
            examAssignments[idx]!.status = "revoked";
            examAssignments[idx]!.revokedAt = "2026-09-18T01:00:00Z";
          }
          return { outcome: "applied" };
        }
        return { ok: true };
      });
      const user = userEvent.setup();
      renderPage();

      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "评卷考试" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText("管理「Grader One」的评卷考试"),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledWith(
          "/api/admin/users/u-g/exam-assignments?status=all",
        );
      });
      expect(apiGet).toHaveBeenCalledWith("/api/exams?page=1&pageSize=100");
      expect(
        await within(dialog).findByText("尚未分配任何考试。"),
      ).toBeInTheDocument();

      await user.click(within(dialog).getByRole("combobox"));
      await user.click(await screen.findByRole("option", { name: "期末考试" }));
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-g/exam-assignments",
        { examId: "e1" },
      );
      expect(await within(dialog).findByText("期末考试")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/admin/users/u-g/exam-assignments/e1/revoke",
        );
      });
      await waitFor(() => {
        expect(
          within(dialog).queryByRole("button", { name: "撤销" }),
        ).not.toBeInTheDocument();
      });
      expect(
        await within(dialog).findByText("尚未分配任何考试。"),
      ).toBeInTheDocument();
    });

    it("actor without ExamGraderAssignmentView sees no action", async () => {
      mockAssignmentApi({ users: [mockUsers[0], graderTarget] });
      renderPage(
        [...permissionsForRole("Admin")].filter(
          (p) => p !== Permission.ExamGraderAssignmentView,
        ),
      );
      const table = await screen.findByRole("table");
      expect(
        within(table).queryByRole("button", { name: "评卷考试" }),
      ).not.toBeInTheDocument();
      expect(
        within(table).queryAllByRole("button", { name: "更多操作" }),
      ).toHaveLength(0);
    });

    it("View without Manage renders the dialog read-only (no assign/revoke affordances)", async () => {
      mockAssignmentApi({
        users: [mockUsers[0], graderTarget],
        examAssignments: [
          {
            id: "ea1",
            examId: "e1",
            status: "active",
            assignedAt: "2026-09-18T00:00:00Z",
            revokedAt: null,
          },
        ],
      });
      const user = userEvent.setup();
      renderPage(
        [...permissionsForRole("Admin")].filter(
          (p) => p !== Permission.ExamGraderAssignmentManage,
        ),
      );
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "评卷考试" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText("期末考试")).toBeInTheDocument();
      expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "分配" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "撤销" }),
      ).not.toBeInTheDocument();
    });
  });
});
