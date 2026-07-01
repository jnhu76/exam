import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { LoginPage } from "@/pages/LoginPage";

const server = setupServer(
  http.post("http://localhost:5173/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as {
      username: string;
      password: string;
    };
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (body.username === "admin" && body.password === "password") {
      return HttpResponse.json({
        id: "user-1",
        username: "admin",
        name: "管理员",
        role: "Admin",
        organizationId: "org-1",
      });
    }
    return HttpResponse.json(
      { message: "Invalid username or password", code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }),

  http.post("http://localhost:5173/api/auth/logout", async () => {
    return HttpResponse.json({ success: true });
  }),

  http.get("http://localhost:5173/api/auth/me", async () => {
    return HttpResponse.json({
      id: "user-1",
      username: "admin",
      name: "管理员",
      role: "Admin",
      organizationId: "org-1",
    });
  }),
);

describe("登录流程集成测试", () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterEach(() => {
    server.close();
  });

  const renderLoginPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider restoreSession={false}>
          <LoginPage />
        </AuthProvider>
      </BrowserRouter>,
    );
  };

  it("应该显示登录表单", () => {
    renderLoginPage();
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /登录/ })).toBeInTheDocument();
  });

  it("应该支持正确登录", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/用户名/), "admin");
    await user.type(screen.getByLabelText(/密码/), "password");
    await user.click(screen.getByRole("button", { name: /登录/ }));

    await waitFor(
      () => {
        expect(screen.queryByText(/登录中.../)).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("应该显示登录错误信息", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/用户名/), "invalid");
    await user.type(screen.getByLabelText(/密码/), "wrongpassword");
    await user.click(screen.getByRole("button", { name: /登录/ }));

    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("应该禁用登录按钮在登录过程中", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    const loginButton = screen.getByRole("button", { name: /登录/ });
    expect(loginButton).not.toBeDisabled();

    await user.type(screen.getByLabelText(/用户名/), "admin");
    await user.type(screen.getByLabelText(/密码/), "password");

    await user.click(loginButton);

    await waitFor(() => {
      expect(loginButton).toBeDisabled();
    });

    await waitFor(
      () => {
        expect(screen.queryByText(/登录中.../)).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
