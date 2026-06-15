import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { SystemHealthPage } from "./SystemHealthPage";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

const okHealth = {
  cpu: 45,
  memory: 60,
  dbResponseMs: 50,
  status: "ok" as const,
};
const degradedHealth = {
  cpu: 85,
  memory: 90,
  dbResponseMs: 600,
  status: "degraded" as const,
};
const criticalHealth = {
  cpu: 98,
  memory: 99,
  dbResponseMs: 1200,
  status: "critical" as const,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/system"]}>
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
            <Route path="/admin/system" element={<SystemHealthPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("SystemHealthPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading skeleton while fetching data", async () => {
    apiGet.mockImplementation(() => new Promise(() => {}));
    const { container } = renderPage();
    const skeletons = container.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);
    await act(async () => {});
  });

  it("shows error state when API fails", async () => {
    apiGet.mockRejectedValue(new Error("network"));
    renderPage();
    expect(await screen.findByText("加载系统健康数据失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("renders health metrics with correct status labels", async () => {
    apiGet.mockResolvedValue(okHealth);
    renderPage();
    expect(await screen.findByText("系统健康")).toBeInTheDocument();
    expect(screen.getByText("CPU 使用率")).toBeInTheDocument();
    expect(screen.getByText("内存使用率")).toBeInTheDocument();
    expect(screen.getByText("数据库响应时间")).toBeInTheDocument();
    const okLabels = screen.getAllByText("正常");
    expect(okLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("displays critical status for high resource usage", async () => {
    apiGet.mockResolvedValue(criticalHealth);
    renderPage();
    await screen.findByText("系统健康");
    const criticalLabels = screen.getAllByText("严重");
    expect(criticalLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("displays degraded status for moderate resource usage", async () => {
    apiGet.mockResolvedValue(degradedHealth);
    renderPage();
    await screen.findByText("系统健康");
    const warningLabels = screen.getAllByText("连接不稳定");
    expect(warningLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("refresh button reloads health data", async () => {
    apiGet.mockResolvedValue(okHealth);
    renderPage();
    await screen.findByText("系统健康");
    apiGet.mockResolvedValue(criticalHealth);
    await userEvent.click(screen.getByRole("button", { name: /刷新/ }));
    await waitFor(() => {
      expect(screen.getAllByText("严重").length).toBeGreaterThanOrEqual(1);
    });
  });
});
