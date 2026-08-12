import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function backup(overrides: Record<string, unknown> = {}) {
  return {
    latest: {
      id: "00000000-0000-4000-8000-000000000001",
      operationId: "logical:2026-08-12",
      backupType: "logical",
      status: "succeeded",
      startedAt: "2026-08-12T10:00:00.000Z",
      completedAt: "2026-08-12T10:05:00.000Z",
      artifactLabel: "exam-2026-08-12.dump",
      artifactSizeBytes: 1024,
      verificationMethod: "pg_restore_list",
      verificationStatus: "verified",
      verifiedAt: "2026-08-12T10:05:00.000Z",
      failureReason: null,
      executorType: "host_script",
    },
    latestVerified: {
      id: "00000000-0000-4000-8000-000000000001",
      operationId: "logical:2026-08-12",
      backupType: "logical",
      status: "succeeded",
      startedAt: "2026-08-12T10:00:00.000Z",
      completedAt: "2026-08-12T10:05:00.000Z",
      artifactLabel: "exam-2026-08-12.dump",
      artifactSizeBytes: 1024,
      verificationMethod: "pg_restore_list",
      verificationStatus: "verified",
      verifiedAt: "2026-08-12T10:05:00.000Z",
      failureReason: null,
      executorType: "host_script",
    },
    lastFailure: null,
    counts: { running: 0, succeeded: 1, failed: 0, abandoned: 0 },
    history: [],
    ...overrides,
  };
}

function restore(overrides: Record<string, unknown> = {}) {
  return {
    latestDrill: {
      id: "00000000-0000-4000-8000-000000000002",
      operationId: "logical-restore:2026-08-11",
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: "2026-08-11T09:00:00.000Z",
      completedAt: "2026-08-11T09:40:00.000Z",
      durationMs: 2400000,
      failureReason: null,
    },
    latestSuccessfulDrill: {
      id: "00000000-0000-4000-8000-000000000002",
      operationId: "logical-restore:2026-08-11",
      backupType: "logical",
      result: "succeeded",
      source: "automated",
      startedAt: "2026-08-11T09:00:00.000Z",
      completedAt: "2026-08-11T09:40:00.000Z",
      durationMs: 2400000,
      failureReason: null,
    },
    drillHistory: [],
    ...overrides,
  };
}

async function renderPage() {
  await act(async () => {
    render(
      <MemoryRouter>
        <OperationsPage />
      </MemoryRouter>,
    );
  });
}

describe("OperationsPage (P7-E2C)", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders health, backup posture, restore readiness, and diagnostics", async () => {
    getMock
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(diag())
      .mockResolvedValueOnce(backup())
      .mockResolvedValueOnce(restore());
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("运维总览")).toBeInTheDocument();
    });
    // Health stats (StatsCard renders value + suffix separately)
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // Backup posture
    expect(screen.getByText("健康")).toBeInTheDocument();
    expect(
      screen.getByText("exam-2026-08-12.dump", { exact: false }),
    ).toBeInTheDocument();
    // Restore readiness
    expect(screen.getByText("已验证")).toBeInTheDocument();
    // Diagnostics
    expect(screen.getByText("运行状态")).toBeInTheDocument();
  });

  it("says NOT VERIFIED when runs exist but none verified (no false green)", async () => {
    getMock
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(diag())
      .mockResolvedValueOnce(
        backup({
          latest: null,
          latestVerified: null,
          lastFailure: null,
          counts: { running: 0, succeeded: 0, failed: 1, abandoned: 0 },
        }),
      )
      .mockResolvedValueOnce(
        restore({ latestDrill: null, latestSuccessfulDrill: null }),
      );
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("backup-status-badge")).toHaveTextContent(
        "未验证",
      );
    });
    expect(screen.getByText("无（从未有已验证备份）")).toBeInTheDocument();
  });

  it("says NO EVIDENCE when the ledger is empty (truthful empty state)", async () => {
    getMock
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(diag())
      .mockResolvedValueOnce(
        backup({
          latest: null,
          latestVerified: null,
          lastFailure: null,
          counts: { running: 0, succeeded: 0, failed: 0, abandoned: 0 },
        }),
      )
      .mockResolvedValueOnce(
        restore({ latestDrill: null, latestSuccessfulDrill: null }),
      );
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("backup-status-badge")).toHaveTextContent(
        "无证据",
      );
    });
    expect(screen.getByTestId("restore-status-badge")).toHaveTextContent(
      "无证据",
    );
  });

  it("shows a warning when the last failure is newer than the last verified backup", async () => {
    getMock
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(diag())
      .mockResolvedValueOnce(
        backup({
          lastFailure: {
            id: "00000000-0000-4000-8000-000000000003",
            operationId: "logical:2026-08-13",
            backupType: "logical",
            status: "failed",
            startedAt: "2026-08-13T10:00:00.000Z",
            completedAt: "2026-08-13T10:01:00.000Z",
            artifactLabel: null,
            artifactSizeBytes: null,
            verificationMethod: null,
            verificationStatus: "failed",
            verifiedAt: null,
            failureReason:
              "verification failed: pg_restore --list rejected the archive",
            executorType: "host_script",
          },
          counts: { running: 0, succeeded: 1, failed: 1, abandoned: 0 },
        }),
      )
      .mockResolvedValueOnce(restore());
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("backup-status-badge")).toHaveTextContent(
        "需要关注",
      );
    });
    expect(
      screen.getByText("最近一次备份失败，且晚于最近一次已验证备份。"),
    ).toBeInTheDocument();
  });

  it("renders the operational diagnostics without the business-integrity block", async () => {
    // diag() above has NO `integrity` key — the Maintainer shape. The page
    // must render fine and must not fabricate integrity content.
    getMock
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(diag())
      .mockResolvedValueOnce(backup())
      .mockResolvedValueOnce(restore());
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Redis")).toBeInTheDocument();
      expect(screen.getByText("邮件 Worker")).toBeInTheDocument();
    });
    expect(screen.queryByText(/完整性|异常/)).not.toBeInTheDocument();
  });

  it("never renders host paths or credential-bearing strings", async () => {
    getMock
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(diag())
      .mockResolvedValueOnce(backup())
      .mockResolvedValueOnce(restore());
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
