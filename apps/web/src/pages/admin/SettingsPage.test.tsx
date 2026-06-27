import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { api } from "@/lib/api";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      productName: "Test Platform",
      productSubtitle: "Test Subtitle",
    }),
    patch: vi.fn().mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      productName: "Updated",
    }),
  },
  setNavigate: () => {},
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/settings"]}>
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
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({
      productName: "Test Platform",
      productSubtitle: "Test Subtitle",
    });
    vi.mocked(api.patch).mockResolvedValue({
      id: "s1",
      organizationId: "org1",
      productName: "Updated",
    });
  });

  it("renders page title", async () => {
    renderPage();
    expect(await screen.findByText("平台与机构设置")).toBeInTheDocument();
  });

  it("renders tab triggers for profile, branding, and security", async () => {
    renderPage();
    expect(
      await screen.findByRole("tab", { name: "个人信息" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "品牌设置" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "账号安全" })).toBeInTheDocument();
  });

  it("renders product name field after switching to branding tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("tab", { name: "品牌设置" });
    await user.click(screen.getByRole("tab", { name: "品牌设置" }));
    const input = await screen.findByLabelText("产品标题");
    expect(input).toHaveValue("Test Platform");
  });

  it("renders save button in branding tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("tab", { name: "品牌设置" });
    await user.click(screen.getByRole("tab", { name: "品牌设置" }));
    expect(
      await screen.findByRole("button", { name: "保存设置" }),
    ).toBeInTheDocument();
  });

  it("strips empty strings from save payload", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("tab", { name: "品牌设置" });
    await user.click(screen.getByRole("tab", { name: "品牌设置" }));

    const input = await screen.findByLabelText("产品标题");
    await user.clear(input);

    const button = await screen.findByRole("button", { name: "保存设置" });
    await user.click(button);

    await vi.waitFor(() => {
      expect(api.patch).toHaveBeenCalled();
    });

    const patchCall = vi.mocked(api.patch).mock.calls[0];
    expect(patchCall).toBeDefined();
    const payload = patchCall![1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("productName");
    expect(payload.productSubtitle).toBe("Test Subtitle");
  });

  it("shows branding save error inline", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("品牌保存失败"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("tab", { name: "品牌设置" });
    await user.click(screen.getByRole("tab", { name: "品牌设置" }));

    await screen.findByLabelText("产品标题");
    await user.click(await screen.findByRole("button", { name: "保存设置" }));

    expect(await screen.findByText("品牌保存失败")).toBeInTheDocument();
  });
});
