import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { UsersPage } from "./UsersPage";
import { permissionsForRole } from "@exam/authz";

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockUsers = [
  {
    id: "u3",
    username: "admin1",
    name: "Admin One",
    role: "Admin",
    isActive: true,
  },
];

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <AuthProvider
        initialUser={{
          id: "u3",

          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
          capabilities: [...permissionsForRole("Admin")],
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
    expect(await screen.findByText("admin1")).toBeInTheDocument();
    expect(screen.getByText("考试管理员")).toBeInTheDocument();
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
    await screen.findByText("admin1");
    const toggleBtn = screen.getByRole("button", { name: "禁用" });
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

  it("filters out Candidate role from display", async () => {
    apiGet.mockResolvedValue({
      items: [
        ...mockUsers,
        {
          id: "u5",
          username: "cand1",
          name: "Candidate",
          role: "Candidate",
          isActive: true,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    renderPage();
    await screen.findByText("admin1");
    expect(screen.queryByText("cand1")).not.toBeInTheDocument();
  });
});
