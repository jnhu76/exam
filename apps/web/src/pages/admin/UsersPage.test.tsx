import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { UsersPage } from "./UsersPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([
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
        isActive: true,
      },
    ]),
    post: vi.fn().mockResolvedValue({
      id: "u3",
      username: "newuser",
      name: "New User",
      role: "Teacher",
      isActive: true,
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  setNavigate: () => {},
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
    expect(await screen.findByText("teacher1")).toBeInTheDocument();
    expect(screen.getByText("proctor1")).toBeInTheDocument();
  });

  it("renders add user button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "新增用户" }),
    ).toBeInTheDocument();
  });
});
