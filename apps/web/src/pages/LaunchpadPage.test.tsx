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
  return (
    <span data-testid="current-path">
      {location.pathname}
      {location.state?.launchpadComplete ? "?launchpad-complete" : ""}
    </span>
  );
}

function renderLaunchpad(initialEntries = ["/launchpad"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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

  it("shows loading while the status probe is in flight", () => {
    apiGet.mockImplementationOnce(() => new Promise(() => {}));

    renderLaunchpad();

    expect(screen.getByText("正在检查安装状态…")).toBeInTheDocument();
  });

  it("shows the operator-activation notice when fresh and no token configured", async () => {
    apiGet.mockResolvedValueOnce({ state: "OPERATOR_ACTIVATION_REQUIRED" });

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByText(/LAUNCHPAD_SETUP_TOKEN/)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "前往登录" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("组织名称")).not.toBeInTheDocument();
  });

  it("shows the completed notice and a login link on an initialized installation", async () => {
    apiGet.mockResolvedValueOnce({ state: "COMPLETED" });

    renderLaunchpad();

    await waitFor(() => {
      expect(
        screen.getByText("此安装已完成初始化，请直接登录。"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "前往登录" }),
    ).toBeInTheDocument();
  });

  it("shows the bootstrap form when READY", async () => {
    apiGet.mockResolvedValueOnce({ state: "READY" });

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("管理员用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("姓名")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByLabelText("设置口令")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "完成设置" }),
    ).toBeInTheDocument();
  });

  it("validates required fields before submitting", async () => {
    apiGet.mockResolvedValueOnce({ state: "READY" });
    const user = userEvent.setup();

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "完成设置" }));

    expect(screen.getByText("请输入组织名称")).toBeInTheDocument();
    expect(screen.getByText("用户名至少 3 个字符")).toBeInTheDocument();
    expect(screen.getByText("请输入姓名")).toBeInTheDocument();
    expect(screen.getByText("密码至少 8 个字符")).toBeInTheDocument();
    expect(screen.getByText("请输入设置口令")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("posts the bootstrap payload and navigates to /login with the complete notice", async () => {
    apiGet.mockResolvedValueOnce({ state: "READY" });
    apiPost.mockResolvedValueOnce({
      organizationName: "Test Org",
      username: "firstadmin",
    });
    const user = userEvent.setup();

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText("组织名称"), "Test Org");
    await user.type(screen.getByLabelText("管理员用户名"), "firstadmin");
    await user.type(screen.getByLabelText("姓名"), "First Admin");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("设置口令"), "setup-token");
    await user.click(screen.getByRole("button", { name: "完成设置" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/launchpad/bootstrap", {
        setupToken: "setup-token",
        organizationName: "Test Org",
        username: "firstadmin",
        name: "First Admin",
        password: "password123",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-path")).toHaveTextContent(
        "/login?launchpad-complete",
      );
    });
  });

  it("shows the submit error banner when bootstrap fails", async () => {
    apiGet.mockResolvedValueOnce({ state: "READY" });
    apiPost.mockRejectedValueOnce(new Error("设置口令无效"));
    const user = userEvent.setup();

    renderLaunchpad();

    await waitFor(() => {
      expect(screen.getByLabelText("组织名称")).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText("组织名称"), "Test Org");
    await user.type(screen.getByLabelText("管理员用户名"), "firstadmin");
    await user.type(screen.getByLabelText("姓名"), "First Admin");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("设置口令"), "wrong-token");
    await user.click(screen.getByRole("button", { name: "完成设置" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("设置口令无效");
    });
  });
});
