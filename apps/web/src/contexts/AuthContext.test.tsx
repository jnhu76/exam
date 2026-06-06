import type { MeResponse } from "@exam/contracts";
import { Role } from "@exam/domain";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuthContext } from "./AuthContext";

const adminUser: MeResponse = {
  id: "admin",
  username: "admin",
  name: "管理员",
  role: Role.Admin,
  organizationId: "org",
};

const candidateUser: MeResponse = {
  id: "c1",
  username: "candidate",
  name: "考生",
  role: Role.Candidate,
  organizationId: "org",
};

function AuthProbe() {
  const { user, isLoading, error, login, logout } = useAuthContext();
  return (
    <div>
      <span data-testid="user-name">{user?.name ?? "未登录"}</span>
      <span data-testid="is-loading">{String(isLoading)}</span>
      <span data-testid="error">{error ?? ""}</span>
      <button type="button" onClick={() => void login("admin", "pass")}>
        login
      </button>
      <button type="button" onClick={() => void login("candidate", "pass")}>
        login-candidate
      </button>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderAuth(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthContext", () => {
  describe("initial state", () => {
    it("starts with user as null", () => {
      renderAuth();
      expect(screen.getByTestId("user-name")).toHaveTextContent("未登录");
    });

    it("starts with isLoading as false", () => {
      renderAuth();
      expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
    });
  });

  describe("login", () => {
    it("sets user after successful login", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      renderAuth("/login");

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      expect(screen.getByTestId("user-name")).toHaveTextContent("管理员");
    });

    it("sets isLoading to true during login", async () => {
      let resolveFetch: (value: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveFetch = resolve;
            }),
        ),
      );

      renderAuth("/login");

      await act(async () => {
        userEvent.click(screen.getByText("login"));
        await vi.waitFor(() => {
          expect(screen.getByTestId("is-loading")).toHaveTextContent("true");
        });
        resolveFetch!(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
    });

    it("redirects admin to /admin/dashboard after login", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      render(
        <MemoryRouter initialEntries={["/login"]}>
          <AuthProvider>
            <AuthProbe />
            <Routes>
              <Route path="/login" element={null} />
              <Route path="/admin/dashboard" element={<LocationProbe />} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>,
      );

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/admin/dashboard",
      );
    });

    it("redirects candidate to /exam/list after login", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(candidateUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      render(
        <MemoryRouter initialEntries={["/login"]}>
          <AuthProvider>
            <AuthProbe />
            <Routes>
              <Route path="/login" element={null} />
              <Route path="/exam/list" element={<LocationProbe />} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>,
      );

      await act(async () => {
        await userEvent.click(screen.getByText("login-candidate"));
      });

      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/exam/list",
      );
    });
  });

  describe("logout", () => {
    it("clears user after logout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      renderAuth("/login");

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      expect(screen.getByTestId("user-name")).toHaveTextContent("管理员");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      );

      await act(async () => {
        await userEvent.click(screen.getByText("logout"));
      });

      expect(screen.getByTestId("user-name")).toHaveTextContent("未登录");
    });

    it("sets isLoading to true during logout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      renderAuth("/login");

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      let resolveLogout: (value: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveLogout = resolve;
            }),
        ),
      );

      await act(async () => {
        userEvent.click(screen.getByText("logout"));
        await vi.waitFor(() => {
          expect(screen.getByTestId("is-loading")).toHaveTextContent("true");
        });
        resolveLogout!(new Response(null, { status: 204 }));
      });

      expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
    });

    it("redirects to /login after logout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      render(
        <MemoryRouter initialEntries={["/admin/dashboard"]}>
          <AuthProvider>
            <AuthProbe />
            <Routes>
              <Route path="/admin/dashboard" element={null} />
              <Route path="/login" element={<LocationProbe />} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>,
      );

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      );

      await act(async () => {
        await userEvent.click(screen.getByText("logout"));
      });

      expect(screen.getByTestId("current-path")).toHaveTextContent("/login");
    });
  });

  describe("error handling", () => {
    it("sets error state on login failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      );

      renderAuth("/login");

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      expect(screen.getByTestId("error")).toHaveTextContent("401 Unauthorized");
      expect(screen.getByTestId("user-name")).toHaveTextContent("未登录");
    });

    it("clears error on next login attempt", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      );

      renderAuth("/login");

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      expect(screen.getByTestId("error")).toHaveTextContent("401 Unauthorized");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(adminUser), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await act(async () => {
        await userEvent.click(screen.getByText("login"));
      });

      expect(screen.getByTestId("error")).toHaveTextContent("");
    });
  });

  describe("useAuthContext", () => {
    it("throws when used outside AuthProvider", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        render(
          <MemoryRouter>
            <AuthProbe />
          </MemoryRouter>,
        );
      }).toThrow("useAuth must be used within AuthProvider");

      consoleSpy.mockRestore();
    });
  });
});
