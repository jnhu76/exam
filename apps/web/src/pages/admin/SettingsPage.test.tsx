import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { api, ApiError } from "@/lib/api";
import { SettingsPage } from "./SettingsPage";
import { permissionsForRole } from "@exam/authz";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: unknown;
    readonly requestId?: string;
    readonly serverMessage?: string;
    constructor(
      status: number,
      message: string,
      code?: string,
      details?: unknown,
      requestId?: string,
      serverMessage?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.message = message;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.serverMessage = serverMessage ?? message;
    }
  },
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
          capabilities: [...permissionsForRole("Admin")],
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

  it("renders product name field with loaded value", async () => {
    renderPage();
    const input = await screen.findByLabelText("产品标题");
    expect(input).toHaveValue("Test Platform");
  });

  it("renders save button", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "保存设置" }),
    ).toBeInTheDocument();
  });

  it("shows card headers for branding and security", async () => {
    renderPage();
    expect(await screen.findByText("品牌设置")).toBeInTheDocument();
    expect(screen.getByText("账号安全")).toBeInTheDocument();
  });

  it("renders settings through shared form sections", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "品牌设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "账号安全" }),
    ).toBeInTheDocument();
  });

  it("strips empty strings from save payload", async () => {
    const user = userEvent.setup();
    renderPage();

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
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError(500, "品牌保存失败", "INTERNAL_ERROR"),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("产品标题");
    await user.click(await screen.findByRole("button", { name: "保存设置" }));

    expect(
      await screen.findByText("服务器内部错误，请稍后重试"),
    ).toBeInTheDocument();
  });
});
