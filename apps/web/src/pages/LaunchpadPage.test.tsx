import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchpadPage } from "./LaunchpadPage";

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

function renderLaunchpad() {
  return render(
    <MemoryRouter initialEntries={["/launchpad"]}>
      <Routes>
        <Route path="/launchpad" element={<LaunchpadPage />} />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LaunchpadPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  it("redirects to /login when the installation is already initialized", async () => {
    apiGet.mockResolvedValueOnce({ initialized: true });

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/login");
    });
  });

  it("renders the first-Admin setup form when uninitialized", async () => {
    apiGet.mockResolvedValueOnce({ initialized: false });

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("管理员姓名")).toBeInTheDocument();
    expect(screen.getByLabelText("管理员用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("管理员密码")).toBeInTheDocument();
    expect(screen.getByLabelText("初始化令牌")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "完成初始化" }),
    ).toBeInTheDocument();
  });

  it("shows field validation errors and does not submit when fields are empty", async () => {
    apiGet.mockResolvedValueOnce({ initialized: false });
    const user = userEvent.setup();

    renderLaunchpad();
    await waitFor(() =>
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "完成初始化" }));

    expect(screen.getByText("请输入组织名称")).toBeInTheDocument();
    expect(screen.getByText("请输入管理员姓名")).toBeInTheDocument();
    expect(screen.getByText("请输入管理员用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入管理员密码")).toBeInTheDocument();
    expect(screen.getByText("请输入初始化令牌")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("submits the bootstrap payload and redirects to /login on success", async () => {
    apiGet.mockResolvedValueOnce({ initialized: false });
    apiPost.mockResolvedValueOnce({
      ok: true,
      organizationSlug: "default",
      adminUsername: "newadmin",
    });
    const user = userEvent.setup();

    renderLaunchpad();
    await waitFor(() =>
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText("组织名称"), "Fresh Org");
    await user.type(screen.getByLabelText("管理员姓名"), "New Admin");
    await user.type(screen.getByLabelText("管理员用户名"), "newadmin");
    await user.type(screen.getByLabelText("管理员密码"), "Strong-Admin-1!");
    await user.type(screen.getByLabelText("初始化令牌"), "the-setup-token");

    await user.click(screen.getByRole("button", { name: "完成初始化" }));

    // The payload excludes organizationDisplayName when left blank and sends
    // the canonical field names the backend expects.
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/launchpad/bootstrap", {
        organizationName: "Fresh Org",
        adminName: "New Admin",
        adminUsername: "newadmin",
        adminPassword: "Strong-Admin-1!",
        setupToken: "the-setup-token",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent("/login");
    });
  });

  it("shows an error banner and stays on /launchpad when bootstrap fails", async () => {
    apiGet.mockResolvedValueOnce({ initialized: false });
    apiPost.mockRejectedValueOnce(new Error("初始化令牌无效或未配置"));
    const user = userEvent.setup();

    renderLaunchpad();
    await waitFor(() =>
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText("组织名称"), "Fresh Org");
    await user.type(screen.getByLabelText("管理员姓名"), "New Admin");
    await user.type(screen.getByLabelText("管理员用户名"), "newadmin");
    await user.type(screen.getByLabelText("管理员密码"), "Strong-Admin-1!");
    await user.type(screen.getByLabelText("初始化令牌"), "wrong-token");

    await user.click(screen.getByRole("button", { name: "完成初始化" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "初始化令牌无效或未配置",
      );
    });
    // Still on /launchpad (no redirect).
    expect(screen.queryByTestId("current-path")).not.toBeInTheDocument();
    await act(async () => {});
  });
});
