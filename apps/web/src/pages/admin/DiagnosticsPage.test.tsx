import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { DiagnosticsPage } from "./DiagnosticsPage";

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
  },
  setNavigate: () => {},
}));

const okDiagnostics = {
  version: "1.0.0",
  uptime: 3600,
  dbLatency: 5,
  heartbeatStatus: {
    interval: 30000,
    timeout: 60000,
    lastScanAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    disruptedCount: 0,
  },
  deadlineScannerStatus: {
    interval: 30000,
    lastScanAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    autoSubmitCount: 0,
  },
  config: {
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
    deadlineScanInterval: 30000,
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/diagnostics"]}>
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
            <Route path="/admin/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </BrandProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("DiagnosticsPage", () => {
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
    expect(await screen.findByText("加载诊断数据失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("renders diagnostics page title", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    expect(await screen.findByText("系统诊断")).toBeInTheDocument();
  });

  it("renders server version and uptime", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    await screen.findByText("系统诊断");
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("3600s")).toBeInTheDocument();
  });

  it("renders DB latency", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    await screen.findByText("系统诊断");
    expect(screen.getByText("5ms")).toBeInTheDocument();
  });

  it("renders heartbeat scanner card", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    await screen.findByText("系统诊断");
    expect(screen.getByText("心跳扫描器")).toBeInTheDocument();
  });

  it("renders deadline scanner card", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    await screen.findByText("系统诊断");
    expect(screen.getByText("截止扫描器")).toBeInTheDocument();
  });

  it("renders runtime config section", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    await screen.findByText("系统诊断");
    expect(screen.getByText("运行时配置")).toBeInTheDocument();
  });

  it("renders config values", async () => {
    apiGet.mockResolvedValue(okDiagnostics);
    renderPage();
    await screen.findByText("系统诊断");
    const vals = screen.getAllByText("30000ms");
    expect(vals.length).toBeGreaterThanOrEqual(2);
  });
});
