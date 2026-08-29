import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { InviteAcceptPage } from "./InviteAcceptPage";
import { ResetPasswordPage } from "./ResetPasswordPage";

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]) => apiPost(...args),
  },
  setNavigate: () => {},
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {path.startsWith("/forgot-password") ? (
        <ForgotPasswordPage />
      ) : path.startsWith("/reset-password") ? (
        <ResetPasswordPage />
      ) : (
        <InviteAcceptPage />
      )}
    </MemoryRouter>,
  );
}

describe("public identity pages (#297)", () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it("forgot-password: empty username shows a field error, valid username sends a request", async () => {
    renderAt("/forgot-password");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "发送重置链接" }));
    expect(await screen.findByText("请输入用户名")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();

    apiPost.mockResolvedValueOnce({ ok: true });
    await user.type(screen.getByLabelText("用户名"), "someone");
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));
    await waitFor(() =>
      expect(screen.getByTestId("forgot-password-sent")).toBeInTheDocument(),
    );
    expect(apiPost).toHaveBeenCalledWith("/api/auth/password-reset/request", {
      username: "someone",
    });
  });

  it("forgot-password keeps the confirmation generic even on rejection", async () => {
    apiPost.mockRejectedValueOnce(new Error("重置链接无效或已过期"));
    renderAt("/forgot-password");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("用户名"), "someone");
    await user.click(screen.getByRole("button", { name: "发送重置链接" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // No success view: a genuine request failure must not fake success.
    expect(screen.queryByTestId("forgot-password-sent")).toBeNull();
  });

  it("invite-accept: posts the URL token and shows the success state", async () => {
    apiPost.mockResolvedValueOnce({
      user: { id: "u1", username: "invited", name: "受邀", role: "Teacher" },
    });
    renderAt("/invite/accept?token=abc123abc123abc123");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("用户名"), "invited");
    await user.type(screen.getByLabelText("姓名"), "受邀");
    await user.type(screen.getByLabelText("设置密码"), "Sup3rSecret!");
    await user.type(screen.getByLabelText("确认密码"), "Sup3rSecret!");
    await user.click(screen.getByRole("button", { name: "激活账号" }));

    await waitFor(() =>
      expect(screen.getByTestId("invite-accept-success")).toBeInTheDocument(),
    );
    expect(apiPost).toHaveBeenCalledWith("/api/auth/invitations/accept", {
      token: "abc123abc123abc123",
      username: "invited",
      name: "受邀",
      password: "Sup3rSecret!",
    });
  });

  it("invite-accept: mismatched confirmation blocks submission", async () => {
    renderAt("/invite/accept?token=abc123abc123abc123");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("用户名"), "invited");
    await user.type(screen.getByLabelText("姓名"), "受邀");
    await user.type(screen.getByLabelText("设置密码"), "Sup3rSecret!");
    await user.type(screen.getByLabelText("确认密码"), "Different1!");
    await user.click(screen.getByRole("button", { name: "激活账号" }));

    expect(await screen.findByText("两次输入的密码不一致")).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("reset-password: posts the URL token and shows the success state", async () => {
    apiPost.mockResolvedValueOnce({ ok: true });
    renderAt("/reset-password?token=tok123tok123tok123");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("新密码"), "NewPassword1!");
    await user.type(screen.getByLabelText("确认新密码"), "NewPassword1!");
    await user.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() =>
      expect(screen.getByTestId("reset-password-success")).toBeInTheDocument(),
    );
    expect(apiPost).toHaveBeenCalledWith("/api/auth/password-reset/consume", {
      token: "tok123tok123tok123",
      password: "NewPassword1!",
    });
  });
});
