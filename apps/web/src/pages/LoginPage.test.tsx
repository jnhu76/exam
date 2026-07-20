import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";
import { permissionsForRole } from "@exam/authz";
import { LoginPage } from "./LoginPage";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/dashboard" element={<LocationProbe />} />
          <Route path="/exam/list" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage smoke", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  it("renders username and password fields and login button", () => {
    renderLogin();

    expect(screen.getByLabelText("用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("does not show login submitting state during session restore", () => {
    apiGet.mockImplementationOnce(() => new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider restoreSession>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "登录中..." }),
    ).not.toBeInTheDocument();
  });

  it("uses the shared primary button color", () => {
    renderLogin();

    expect(screen.getByRole("button", { name: "登录" })).toHaveClass(
      "bg-primary",
    );
  });

  it("uses comfortable spacing between login fields and submit button", () => {
    renderLogin();

    expect(screen.getByTestId("login-field-group")).toHaveClass("gap-4");
  });

  it("shows dark product title text on the login card", () => {
    renderLogin();

    expect(screen.getByText("考试平台")).toHaveClass("text-foreground");
  });

  it("shows error message when login fails", async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValueOnce(new Error("用户名或密码错误"));

    renderLogin();

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "wrong");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("用户名或密码错误");
    });
  });

  it("disables submit button while loading", async () => {
    const user = userEvent.setup();
    let resolveLogin!: (v: unknown) => void;
    apiPost.mockImplementationOnce(
      () => new Promise((resolve) => (resolveLogin = resolve)),
    );

    renderLogin();

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("button", { name: "登录中..." })).toBeDisabled();

    resolveLogin!({
      id: "u1",
      username: "admin",
      name: "Admin",
      role: "Admin",
      organizationId: "org1",
      capabilities: [...permissionsForRole("Admin")],
    });
    await act(async () => {});
  });

  it("navigates to admin dashboard on admin login", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({
      id: "u1",
      username: "admin",
      name: "Admin",
      role: "Admin",
      organizationId: "org1",
      capabilities: [...permissionsForRole("Admin")],
    });

    renderLogin();

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "admin123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/admin/dashboard",
      );
    });
  });

  it("navigates to exam list on candidate login", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({
      id: "c1",
      username: "candidate",
      name: "Candidate",
      role: "Candidate",
      organizationId: "org1",
      capabilities: [...permissionsForRole("Candidate")],
    });

    renderLogin();

    await user.type(screen.getByLabelText("用户名"), "candidate");
    await user.type(screen.getByLabelText("密码"), "cand123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/exam/list",
      );
    });
  });

  it("clears field error when user types after validation failure", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();

    await user.type(screen.getByLabelText("用户名"), "admin");
    expect(screen.queryByText("请输入用户名")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("密码"), "pass");
    expect(screen.queryByText("请输入密码")).not.toBeInTheDocument();
  });
});
