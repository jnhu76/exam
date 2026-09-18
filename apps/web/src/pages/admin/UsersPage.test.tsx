import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
// issue 548 corrective: the account is disabled while an ACTIVE role
// assignment remains — assignment write endpoints reject such targets, so
// the UI must not offer the new-assignment mutation (inspect/revoke stay).
const inactiveTeacherTarget = {
  id: "u-it",
  username: "inactive-t",
  name: "Inactive Teacher",
  role: "Teacher",
  activeRoles: ["Teacher"],
  isActive: false,
};
const inactiveGraderTarget = {
  id: "u-ig",
  username: "inactive-g",
  name: "Inactive Grader",
  role: "Grader",
  activeRoles: ["Grader"],
  isActive: false,
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

/** Wraps items in the canonical paginated response shape. */
function paged<T>(items: T[], total = items.length, page = 1) {
  return {
    items,
    total,
    page,
    pageSize: 20,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  };
}

/** Extracts the query string of a mocked api.get URL. */
function queryParams(url: string) {
  return new URLSearchParams(url.split("?")[1] ?? "");
}

/**
 * Routes the assignment-management GET endpoints (issue 548): the users list
 * plus the per-user assignment lists and the course/exam option catalogs, so
 * lifecycle tests can drive the dialogs against canonical routes. Catalog
 * endpoints return the full paginated shape (page/search-aware overrides are
 * layered per-test by wrapping the implementation).
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
      return paged(options?.courses ?? mockCourseOptions);
    }
    if (url.startsWith("/api/exams")) {
      return paged(options?.exams ?? mockExamOptions);
    }
    return paged(options?.users ?? [mockUsers[0], teacherTarget]);
  });
}

/** api.get calls whose URL starts with the given prefix. */
function getCalls(prefix: string) {
  return apiGet.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith(prefix));
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

    it("full lifecycle: open → GET assignments + course catalog → POST assign → refresh → revoke → refresh → removal", async () => {
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
      // Both canonical GETs fired — the read projection and the (mutation
      // support) catalog, as two independent requests.
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledWith(
          "/api/admin/users/u-t/course-assignments?status=all",
        );
      });
      expect(apiGet).toHaveBeenCalledWith("/api/courses?page=1&pageSize=20");
      // Empty start.
      expect(
        await within(dialog).findByText("尚未分配任何课程。"),
      ).toBeInTheDocument();

      // Select the course via the paged radio picker and assign.
      await user.click(
        await within(dialog).findByRole("radio", { name: "数学 (MATH-101)" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-t/course-assignments",
        { courseId: "c1" },
      );
      // Post-mutation refresh rendered the active assignment (the option
      // label appears in the picker AND the assigned row now that the
      // catalog is loaded).
      const matches = await within(dialog).findAllByText("数学 (MATH-101)");
      expect(matches.length).toBeGreaterThanOrEqual(2);

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
      await user.click(
        await within(dialog).findByRole("radio", { name: "数学 (MATH-101)" }),
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
      await user.click(
        await within(dialog).findByRole("radio", { name: "数学 (MATH-101)" }),
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

    it("View without Manage renders the dialog read-only and never fetches the option catalog", async () => {
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
      // The read-only projection still lists the active assignment — as its
      // stable courseId: the catalog is never fetched without Manage, so no
      // option metadata exists to resolve the label.
      expect(await within(dialog).findByText("c1")).toBeInTheDocument();
      // …but exposes no mutation affordances.
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("searchbox")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "分配" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "撤销" }),
      ).not.toBeInTheDocument();
      // The catalog is mutation-support data: assignment View alone must not
      // require CourseView — no /api/courses request is issued at all.
      expect(getCalls("/api/courses")).toHaveLength(0);
    });

    it("inactive target: action + existing assignments stay, assign picker is absent, revoke remains (issue 548 corrective)", async () => {
      mockAssignmentApi({
        users: [mockUsers[0], inactiveTeacherTarget],
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
      renderPage();
      // Surface visibility is View × active role — account activity is NOT
      // part of it: the admin must still reach the projection.
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      // Existing assignment rows stay inspectable (stable courseId fallback:
      // the catalog is not fetched for an inactive target).
      expect(await within(dialog).findByText("c1")).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "撤销" }),
      ).toBeInTheDocument();
      // Assign-new affordance requires target user.isActive — the write
      // endpoint would reject it (TARGET_USER_INACTIVE), so it is absent.
      expect(
        await within(dialog).findByTestId("teacher-assign-inactive"),
      ).toHaveTextContent("该账号已停用");
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("searchbox")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "分配" }),
      ).not.toBeInTheDocument();
      expect(getCalls("/api/courses")).toHaveLength(0);
      // Revoke on the inactive target remains available and issues the
      // canonical write.
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/admin/users/u-it/course-assignments/c1/revoke",
        );
      });
    });

    it("option-catalog failure downgrades only the picker — the assignment read survives (issue 548 corrective)", async () => {
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
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/courses")) {
          throw new Error("catalog unavailable");
        }
        return origImpl(url);
      });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      // The dialog remains open with a readable projection; the row falls
      // back to its stable courseId because option metadata is unavailable.
      expect(await within(dialog).findByText("c1")).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "撤销" }),
      ).toBeInTheDocument();
      // The picker is downgraded to an explicit unavailable hint + retry,
      // not to a crash or a silently empty list.
      expect(
        await within(dialog).findByText("课程列表暂不可用，已有分配不受影响。"),
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      // The transient failure erases neither the list nor the mutation path:
      // revoke still works against the readable rows.
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/admin/users/u-t/course-assignments/c1/revoke",
        );
      });
    });

    it("course picker: server-side search reaches a course beyond the first catalog page (issue 548 corrective)", async () => {
      // 120 courses (6 pages at pageSize 20); c101 lives on page 6 and is
      // NOT on page 1 — only the server-side search path reaches it without
      // paging through.
      const allCourses = Array.from({ length: 120 }, (_, i) => ({
        id: `c${i + 1}`,
        name: `课程${i + 1}`,
        code: `CODE-${i + 1}`,
      }));
      mockAssignmentApi({ users: [mockUsers[0], teacherTarget] });
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/courses")) {
          const params = queryParams(url);
          const page = Number(params.get("page") ?? "1");
          const search = params.get("search") ?? "";
          const filtered = search
            ? allCourses.filter((c) => c.name.includes(search.trim()))
            : allCourses;
          const start = (page - 1) * 20;
          return paged(
            filtered.slice(start, start + 20),
            filtered.length,
            page,
          );
        }
        return origImpl(url);
      });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      // Page 1 renders; the page-6 course is not selectable from it.
      expect(
        await within(dialog).findByRole("radio", { name: "课程1 (CODE-1)" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("radio", { name: "课程101 (CODE-101)" }),
      ).not.toBeInTheDocument();
      // Server-side search (debounced) narrows the catalog to the target.
      await user.type(within(dialog).getByRole("searchbox"), "课程101");
      await waitFor(
        () => {
          expect(
            within(dialog).getByRole("radio", { name: "课程101 (CODE-101)" }),
          ).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
      await user.click(
        within(dialog).getByRole("radio", { name: "课程101 (CODE-101)" }),
      );
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-t/course-assignments",
        { courseId: "c101" },
      );
    });

    it("course picker: catalog pagination reaches page 6 without search (issue 548 corrective)", async () => {
      const allCourses = Array.from({ length: 120 }, (_, i) => ({
        id: `c${i + 1}`,
        name: `课程${i + 1}`,
        code: `CODE-${i + 1}`,
      }));
      mockAssignmentApi({ users: [mockUsers[0], teacherTarget] });
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/courses")) {
          const page = Number(queryParams(url).get("page") ?? "1");
          const start = (page - 1) * 20;
          return paged(allCourses.slice(start, start + 20), 120, page);
        }
        return origImpl(url);
      });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        await within(dialog).findByRole("radio", { name: "课程1 (CODE-1)" }),
      ).toBeInTheDocument();
      // Page through to page 6 — the course beyond the first 100.
      for (let i = 0; i < 5; i++) {
        await user.click(
          within(dialog).getByRole("button", { name: "下一页" }),
        );
      }
      const target = await within(dialog).findByRole("radio", {
        name: "课程101 (CODE-101)",
      });
      await user.click(target);
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-t/course-assignments",
        { courseId: "c101" },
      );
    });

    it("course picker: clearing the search field atomically resets the input, the committed query, and the page (issue 548 corrective)", async () => {
      // 120 courses; searching "课程1" matches 32 of them (2 pages), so the
      // clear can be exercised from page 2 — the state where a clear that
      // only emptied the input would leave a stale filtered server query.
      const allCourses = Array.from({ length: 120 }, (_, i) => ({
        id: `c${i + 1}`,
        name: `课程${i + 1}`,
        code: `CODE-${i + 1}`,
      }));
      mockAssignmentApi({ users: [mockUsers[0], teacherTarget] });
      const origImpl = apiGet.getMockImplementation()!;
      const courseCalls: string[] = [];
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/courses")) {
          courseCalls.push(url);
          const params = queryParams(url);
          const page = Number(params.get("page") ?? "1");
          const search = params.get("search") ?? "";
          const filtered = search
            ? allCourses.filter((c) => c.name.includes(search.trim()))
            : allCourses;
          const start = (page - 1) * 20;
          return paged(
            filtered.slice(start, start + 20),
            filtered.length,
            page,
          );
        }
        return origImpl(url);
      });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      const searchbox = within(dialog).getByRole("searchbox");
      expect(
        await within(dialog).findByRole("radio", { name: "课程1 (CODE-1)" }),
      ).toBeInTheDocument();

      // Search commits a filtered server query...
      await user.type(searchbox, "课程1");
      await waitFor(
        () => {
          expect(queryParams(courseCalls.at(-1)!).get("search")).toBe("课程1");
        },
        { timeout: 3000 },
      );
      // ...then page forward, so the clear must also reset the page.
      await user.click(within(dialog).getByRole("button", { name: "下一页" }));
      await waitFor(() => {
        expect(queryParams(courseCalls.at(-1)!).get("page")).toBe("2");
      });

      const callsBeforeClear = courseCalls.length;
      await user.click(
        within(dialog).getByRole("button", { name: "清除搜索" }),
      );
      // The input empties immediately...
      expect(searchbox).toHaveValue("");
      // ...and every follow-up course request is page 1 with no stale term.
      await waitFor(() => {
        expect(courseCalls.length).toBeGreaterThan(callsBeforeClear);
      });
      for (const url of courseCalls.slice(callsBeforeClear)) {
        expect(queryParams(url).get("search")).toBeNull();
        expect(queryParams(url).get("page")).toBe("1");
      }
      // The unfiltered first page is restored in the picker.
      expect(
        await within(dialog).findByRole("radio", { name: "课程3 (CODE-3)" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("radio", { name: "课程110 (CODE-110)" }),
      ).not.toBeInTheDocument();
    });

    it("assign and revoke failures surface dedicated mutation copy, not the load copy (issue 548 corrective)", async () => {
      const { toast } = await import("sonner");
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
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      );
      const dialog = await screen.findByRole("dialog");
      // Assign failure → assignFailed copy.
      apiPost.mockRejectedValueOnce(new Error("boom"));
      await user.click(
        await within(dialog).findByRole("radio", { name: "数学 (MATH-101)" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("分配课程失败，请稍后重试");
      });
      // Revoke failure → revokeFailed copy.
      apiPost.mockRejectedValueOnce(new Error("boom"));
      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "撤销课程分配失败，请稍后重试",
        );
      });
    });

    it("Esc during a busy assign does not close the dialog, and completion refreshes in place (issue 548 corrective)", async () => {
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
      await user.click(
        await within(dialog).findByRole("radio", { name: "数学 (MATH-101)" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      // Busy: Esc must not change the dialog's open state.
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      resolveAssign!({ outcome: "applied" });
      await act(async () => {});
      // The mutation settled without a close/reopen race — the dialog is
      // still open and now renders the refreshed assignment row.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        await within(screen.getByRole("dialog")).findByText("数学 (MATH-101)"),
      ).toBeInTheDocument();
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

    it("full lifecycle: open → GET assignments + exam catalog → POST assign → refresh → revoke → refresh → removal", async () => {
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
      expect(apiGet).toHaveBeenCalledWith("/api/exams?page=1&pageSize=20");
      expect(
        await within(dialog).findByText("尚未分配任何考试。"),
      ).toBeInTheDocument();

      await user.click(
        await within(dialog).findByRole("radio", { name: "期末考试" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-g/exam-assignments",
        { examId: "e1" },
      );
      const matches = await within(dialog).findAllByText("期末考试");
      expect(matches.length).toBeGreaterThanOrEqual(2);

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

    it("View without Manage renders the dialog read-only and never fetches the option catalog", async () => {
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
      // Stable examId fallback: no catalog is fetched without Manage.
      expect(await within(dialog).findByText("e1")).toBeInTheDocument();
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "分配" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "撤销" }),
      ).not.toBeInTheDocument();
      // Assignment View must not silently require ExamView: the option
      // catalog is mutation-support data and is not fetched at all.
      expect(getCalls("/api/exams")).toHaveLength(0);
    });

    it("inactive target: action + existing assignments stay, assign picker is absent, revoke remains (issue 548 corrective)", async () => {
      mockAssignmentApi({
        users: [mockUsers[0], inactiveGraderTarget],
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
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "评卷考试" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText("e1")).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "撤销" }),
      ).toBeInTheDocument();
      expect(
        await within(dialog).findByTestId("grader-assign-inactive"),
      ).toHaveTextContent("该账号已停用");
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "分配" }),
      ).not.toBeInTheDocument();
      expect(getCalls("/api/exams")).toHaveLength(0);
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/admin/users/u-ig/exam-assignments/e1/revoke",
        );
      });
    });

    it("option-catalog failure downgrades only the picker — the assignment read survives (issue 548 corrective)", async () => {
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
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/exams")) {
          throw new Error("catalog unavailable");
        }
        return origImpl(url);
      });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "评卷考试" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText("e1")).toBeInTheDocument();
      expect(
        await within(dialog).findByText("考试列表暂不可用，已有分配不受影响。"),
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
      // The readable list is not erased and revoke still works.
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "撤销" }));
      await waitFor(() => {
        expect(apiPost).toHaveBeenCalledWith(
          "/api/admin/users/u-g/exam-assignments/e1/revoke",
        );
      });
    });

    it("exam picker: catalog pagination reaches page 6 — an exam beyond the first 100 is assignable (issue 548 corrective)", async () => {
      const allExams = Array.from({ length: 120 }, (_, i) => ({
        id: `e${i + 1}`,
        title: `考试${i + 1}`,
      }));
      mockAssignmentApi({ users: [mockUsers[0], graderTarget] });
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/exams")) {
          const page = Number(queryParams(url).get("page") ?? "1");
          const start = (page - 1) * 20;
          return paged(allExams.slice(start, start + 20), 120, page);
        }
        return origImpl(url);
      });
      const user = userEvent.setup();
      renderPage();
      const menu = await openRowMenu(user);
      await user.click(
        within(menu).getByRole("menuitem", { name: "评卷考试" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).queryByRole("radio", { name: "考试101" }),
      ).not.toBeInTheDocument();
      for (let i = 0; i < 5; i++) {
        await user.click(
          within(dialog).getByRole("button", { name: "下一页" }),
        );
      }
      await user.click(
        await within(dialog).findByRole("radio", { name: "考试101" }),
      );
      apiPost.mockResolvedValue({ outcome: "applied" });
      await user.click(within(dialog).getByRole("button", { name: "分配" }));
      expect(apiPost).toHaveBeenCalledWith(
        "/api/admin/users/u-g/exam-assignments",
        { examId: "e101" },
      );
    });
  });

  describe("Staff-list reachability (issue 548 corrective)", () => {
    it("a staff target beyond the first 100 is reachable through real pagination", async () => {
      // 103 staff (6 pages at pageSize 20): admin + 101 stale-Teacher
      // fillers + the active-Teacher target at position 103 — beyond the
      // old fixed-first-100 truncation, reachable only by paging.
      const filler = Array.from({ length: 101 }, (_, i) => ({
        id: `u-f${i + 1}`,
        username: `filler-${i + 1}`,
        name: `Filler ${i + 1}`,
        role: "Teacher",
        activeRoles: [],
        isActive: true,
      }));
      const allStaff = [mockUsers[0], ...filler, teacherTarget];
      const user = userEvent.setup();
      mockAssignmentApi({ users: allStaff });
      const origImpl = apiGet.getMockImplementation()!;
      apiGet.mockImplementation(async (url: string) => {
        if (url.startsWith("/api/users")) {
          const page = Number(queryParams(url).get("page") ?? "1");
          const start = (page - 1) * 20;
          return paged(
            allStaff.slice(start, start + 20),
            allStaff.length,
            page,
          );
        }
        return origImpl(url);
      });
      renderPage();
      // Page 1 renders without the page-6 target.
      const table = await screen.findByRole("table");
      expect(within(table).queryByText("teacher1")).not.toBeInTheDocument();
      expect(screen.getByText(/共 103 条/)).toBeInTheDocument();
      for (let i = 0; i < 5; i++) {
        await user.click(screen.getByRole("button", { name: "下一页" }));
      }
      await waitFor(() => {
        expect(apiGet).toHaveBeenCalledWith("/api/users?page=6&pageSize=20");
      });
      // The page-6 target renders WITH its assignment affordance.
      const table6 = await screen.findByRole("table");
      expect(within(table6).getByText("teacher1")).toBeInTheDocument();
      const menu = await openRowMenu(user);
      expect(
        within(menu).getByRole("menuitem", { name: "授课课程" }),
      ).toBeInTheDocument();
    });
  });
});
