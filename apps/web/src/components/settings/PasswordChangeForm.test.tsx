import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("PasswordChangeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("shows error when passwords do not match", async () => {
    render(<PasswordChangeForm />);
    const { toast } = await import("sonner");
    await userEvent.type(screen.getByLabelText("当前密码"), "old123");
    await userEvent.type(screen.getByLabelText("新密码"), "new123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "different");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(toast.error).toHaveBeenCalledWith("两次输入的新密码不一致");
  });

  it("submits, shows success toast, logs out and redirects to /login", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ ok: true });
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { assign },
      writable: true,
    });
    render(<PasswordChangeForm />);
    const { toast } = await import("sonner");
    await userEvent.type(screen.getByLabelText("当前密码"), "old12345");
    await userEvent.type(screen.getByLabelText("新密码"), "newpass123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "newpass123");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(api.patch).toHaveBeenCalledWith("/api/auth/me/password", {
      currentPassword: "old12345",
      newPassword: "newpass123",
    });
    expect(toast.success).toHaveBeenCalledWith("密码修改成功");
    // Token revocation: a successful change ends the session client-side too.
    expect(api.post).toHaveBeenCalledWith("/api/auth/logout");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });

  it("rejects new password shorter than the policy minimum", async () => {
    render(<PasswordChangeForm />);
    const { toast } = await import("sonner");
    await userEvent.type(screen.getByLabelText("当前密码"), "old12345");
    await userEvent.type(screen.getByLabelText("新密码"), "short12");
    await userEvent.type(screen.getByLabelText("确认新密码"), "short12");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(toast.error).toHaveBeenCalledWith("新密码至少 8 位");
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("shows error toast on API failure", async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("密码错误"));
    render(<PasswordChangeForm />);
    const { toast } = await import("sonner");
    await userEvent.type(screen.getByLabelText("当前密码"), "old12345");
    await userEvent.type(screen.getByLabelText("新密码"), "newpass123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "newpass123");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(toast.error).toHaveBeenCalledWith("密码错误");
  });
});
