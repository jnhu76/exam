import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    patch: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("PasswordChangeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("renders without card wrapper", () => {
    render(<PasswordChangeForm cardWrapper={false} />);
    expect(screen.getByText("修改密码")).toBeInTheDocument();
  });

  it("renders with card wrapper by default", () => {
    render(<PasswordChangeForm />);
    expect(screen.getAllByText("修改密码").length).toBeGreaterThanOrEqual(1);
  });

  it("shows error when passwords do not match", async () => {
    render(<PasswordChangeForm cardWrapper={false} />);
    const { toast } = await import("sonner");
    await userEvent.type(screen.getByLabelText("当前密码"), "old123");
    await userEvent.type(screen.getByLabelText("新密码"), "new123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "different");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(toast.error).toHaveBeenCalledWith("两次输入的新密码不一致");
  });

  it("submits and shows success toast", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ ok: true });
    render(<PasswordChangeForm cardWrapper={false} />);
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
  });

  it("rejects new password shorter than the policy minimum", async () => {
    render(<PasswordChangeForm cardWrapper={false} />);
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
    render(<PasswordChangeForm cardWrapper={false} />);
    const { toast } = await import("sonner");
    await userEvent.type(screen.getByLabelText("当前密码"), "old12345");
    await userEvent.type(screen.getByLabelText("新密码"), "newpass123");
    await userEvent.type(screen.getByLabelText("确认新密码"), "newpass123");
    await userEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(toast.error).toHaveBeenCalledWith("密码错误");
  });
});
