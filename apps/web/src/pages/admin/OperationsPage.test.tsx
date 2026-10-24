import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "@exam/authz";
import { AuthProvider } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { OperationsPage } from "./OperationsPage";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
  setNavigate: () => {},
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const getMock = vi.mocked(api.get);

/** Health response shape used by the page. */
function health() {
  return { status: "ok", cpu: 10, memory: 20, dbResponseMs: 5 };
}

/** Operational diagnostics response WITHOUT the business-integrity block
 *  (the shape a Maintainer viewer receives — P7-E2A D8). */
function diag() {
  return {
    version: "1.0.0",
    uptime: 100,
    dbLatency: 5,
    redisStatus: {
      mode: "optional",
      state: "ready",
      connected: true,
      latencyMs: 1,
      degradedReason: null,
    },
    config: {
      heartbeatInterval: 1000,
      heartbeatTimeout: 5000,
      deadlineScanInterval: 2000,
    },
    heartbeatStatus: {
      interval: 1000,
      timeout: 5000,
      lastScanAt: "2026-08-12T10:00:00.000Z",
      disruptedCount: 0,
    },
    deadlineScannerStatus: {
      interval: 2000,
      lastScanAt: "2026-08-12T10:00:00.000Z",
      autoSubmitCount: 0,
    },
    emailStatus: {
      status: "available",
      enabled: true,
      worker: {
        status: "available",
        lastPollAt: "2026-08-12T10:00:00.000Z",
        lastSuccessAt: "2026-08-12T10:00:00.000Z",
        lastErrorAt: null,
        lastError: null,
      },
      outbox: { pending: 0, processing: 0, retryWait: 0, sent: 1, dead: 0 },
      oldestPendingAge: null,
      lastSuccessfulDeliveryAt: "2026-08-12T10:00:00.000Z",
    },
  };
}

/** The page polls exactly the two surviving system endpoints, in this order. */
function mockSurvivingEndpoints() {
  getMock.mockResolvedValueOnce(health()).mockResolvedValueOnce(diag());
}

async function renderPage(role: "Admin" | "Maintainer" = "Admin") {
  await act(async () => {
    render(
      <MemoryRouter>
        <AuthProvider
          initialUser={{
            id: "actor-1",
            username: "actor",
            name: "Actor",
            role,
            organizationId: "org1",
            capabilities: [...permissionsForRole(role)],
          }}
        >
          <OperationsPage />
        </AuthProvider>
      </MemoryRouter>,
    );
  });
}

describe("OperationsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders health and runtime diagnostics from exactly the two surviving endpoints", async () => {
    mockSurvivingEndpoints();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("运维总览")).toBeInTheDocument();
    });
    // Health stats (StatsCard renders value + suffix separately)
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // Diagnostics
    expect(screen.getByText("运行状态")).toBeInTheDocument();
    // No dangling fetch to the removed backup-evidence endpoints.
    expect(getMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/system/health",
      "/api/system/diagnostics",
    ]);
  });

  it("renders the operational diagnostics without the business-integrity block", async () => {
    // diag() above has NO `integrity` key — the Maintainer shape. The page
    // must render fine and must not fabricate integrity content.
    mockSurvivingEndpoints();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Redis")).toBeInTheDocument();
      expect(screen.getByText("邮件 Worker")).toBeInTheDocument();
    });
    expect(screen.queryByText(/完整性|异常/)).not.toBeInTheDocument();
  });

  it("never renders host paths or credential-bearing strings", async () => {
    mockSurvivingEndpoints();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("运维总览")).toBeInTheDocument();
    });
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\/var\/|postgresql:\/\/|password|secret/i);
  });

  it("shows an error state when loading fails", async () => {
    getMock.mockRejectedValue(new Error("boom"));
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("运维数据加载失败")).toBeInTheDocument();
    });
  });
});
