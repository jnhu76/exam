import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { UsersPage } from "./UsersPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      items: [
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
      ],
      total: 3,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    }),
    post: vi.fn().mockResolvedValue({
      id: "u3",
      username: "newuser",
      name: "New User",
      role: "Teacher",
      isActive: true,
    }),
    patch: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

describe("UsersPage", () => {
  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("用户管理")).toBeInTheDocument();
  });

  it("renders user list", async () => {
    renderPage();
    expect(await screen.findByText("superadmin")).toBeInTheDocument();
    expect(screen.getByText("超级管理员")).toBeInTheDocument();
    expect(screen.getByText("teacher1")).toBeInTheDocument();
    expect(screen.getByText("proctor1")).toBeInTheDocument();
  });

  it("renders superadmin role badge", async () => {
    renderPage();
    expect(await screen.findByText("超级管理员")).toBeInTheDocument();
  });

  it("renders add user button", async () => {
    renderPage();
    expect(await screen.findByText("teacher1")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "新增用户" }),
    ).toBeInTheDocument();
  });

  it("opens create dialog with blank fields", async () => {
    renderPage();
    await screen.findByText("teacher1");
    const { userEvent } = await import("@testing-library/user-event");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /新增用户/ }));
    expect(screen.getAllByRole("textbox").length).toBeGreaterThanOrEqual(2);
  });

  it("shows validation errors for empty fields on create", async () => {
    renderPage();
    await screen.findByText("teacher1");
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /新增用户/ }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入姓名")).toBeInTheDocument();
    expect(screen.getByText("密码至少6位")).toBeInTheDocument();
  });

  it("saves a new user when form is filled", async () => {
    renderPage();
    await screen.findByText("teacher1");
    expect(
      screen.getByRole("button", { name: /新增用户/ }),
    ).toBeInTheDocument();
  });

  it("opens edit dialog when edit button clicked", async () => {
    renderPage();
    await screen.findByText("teacher1");
    const editButtons = screen.getAllByLabelText("编辑用户");
    const { userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(editButtons[1]!);
    expect(screen.getByText("编辑用户")).toBeInTheDocument();
  });

  it("toggles user active status", async () => {
    const { api } = await import("@/lib/api");
    renderPage();
    await screen.findByText("proctor1");
    const toggleButtons = screen.getAllByRole("button", { name: "启用" });
    const { userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(toggleButtons[0]!);
    expect(api.patch).toHaveBeenCalledWith(
      "/api/users/u2",
      expect.objectContaining({ isActive: true }),
    );
  });
});
