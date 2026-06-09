import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { UsersPage } from "./UsersPage";

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
    id: "u0",
    username: "superadmin",
    name: "Super Admin",
    role: "SuperAdmin",
    isActive: true,
  },
  {
    id: "u1",
    username: "teacher1",
    name: "Teacher One",
    role: "Teacher",
    isActive: true,
  },
  {
    id: "u2",
    username: "proctor1",
    name: "Proctor One",
    role: "Proctor",
    isActive: false,
  },
  {
    id: "u3",
    username: "admin1",
    name: "Admin One",
    role: "Admin",
    isActive: true,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <AuthProvider
        initialUser={{
          id: "1",
          username: "admin",
          name: "Admin",
          role: "Admin",
          organizationId: "org1",
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
    apiGet.mockResolvedValue({
      items: mockUsers,
      total: 4,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    apiPost.mockResolvedValue({ id: "u4" });
    apiPatch.mockResolvedValue({ ok: true });
  });

  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("用户管理")).toBeInTheDocument();
  });

  it("renders user list with roles", async () => {
    renderPage();
    expect(await screen.findByText("superadmin")).toBeInTheDocument();
    expect(screen.getByText("超级管理员")).toBeInTheDocument();
    expect(screen.getByText("teacher1")).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
  });

  it("renders add user button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "新增用户" }),
    ).toBeInTheDocument();
  });

  it("renders add user button and create dialog opens", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("textbox").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows validation errors for empty fields on create", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /新增用户/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入姓名")).toBeInTheDocument();
    expect(screen.getByText("密码至少6位")).toBeInTheDocument();
  });

  it("creates a new user with valid data", async () => {
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
      role: "Teacher",
    });
  });

  it("opens edit dialog for teacher", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[1]!);
    expect(screen.getByText("编辑用户")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
  });

  it("opens edit dialog for superadmin and shows role lock", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[0]!);
    expect(screen.getByText("编辑用户")).toBeInTheDocument();
    expect(screen.getByText("超级管理员（不可修改）")).toBeInTheDocument();
  });

  it("edits a user", async () => {
    const user = userEvent.setup();
    renderPage();
    const editButtons = await screen.findAllByLabelText("编辑用户");
    await user.click(editButtons[1]!);
    const dialog = await screen.findByRole("dialog");
    const nameInput = getDialogInputs(dialog)[0]!;
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");
    const saveBtn = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent === "保存")!;
    await user.click(saveBtn);
    expect(apiPatch).toHaveBeenCalledWith("/api/users/u1", {
      name: "Updated Name",
      role: "Teacher",
    });
  });

  it("toggles user active status", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("proctor1");
    const toggleBtn = screen.getByRole("button", { name: "启用" });
    await user.click(toggleBtn);
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/users/u2",
      expect.objectContaining({ isActive: true }),
    );
  });

  it("superadmin has no toggle button", async () => {
    renderPage();
    await screen.findByText("superadmin");
    const row = screen.getByText("superadmin").closest("tr")!;
    expect(row.querySelectorAll("button").length).toBeLessThanOrEqual(2);
  });

  it("shows active and inactive status labels", async () => {
    renderPage();
    await screen.findByText("teacher1");
    expect(screen.getAllByText("启用").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("禁用").length).toBeGreaterThanOrEqual(1);
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
      total: 5,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    renderPage();
    await screen.findByText("teacher1");
    expect(screen.queryByText("cand1")).not.toBeInTheDocument();
  });
});
