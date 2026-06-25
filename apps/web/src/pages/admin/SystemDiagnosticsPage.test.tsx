import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { SystemDiagnosticsPage } from "./SystemDiagnosticsPage";

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
const warnMock = vi.mocked(logger.warn);
const infoMock = vi.mocked(logger.info);
const debugMock = vi.mocked(logger.debug);

/** Health response shape used by the page. */
function health() {
  return { status: "ok", cpu: 10, memory: 20, dbResponseMs: 5 };
}
/** Diagnostics response shape used by the page. */
function diag() {
  return {
    version: "1.0.0",
    uptime: 100,
    dbLatency: 5,
    redisStatus: { connected: true, latencyMs: 1 },
    config: {
      heartbeatInterval: 1000,
      heartbeatTimeout: 5000,
      deadlineScanInterval: 2000,
    },
    heartbeatStatus: {
      interval: 1000,
      timeout: 5000,
      lastScanAt: null,
      disruptedCount: 0,
    },
    deadlineScannerStatus: {
      interval: 2000,
      lastScanAt: null,
      autoSubmitCount: 0,
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemDiagnosticsPage />
    </MemoryRouter>,
  );
}

describe("SystemDiagnosticsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders normally and logs refresh on successful initial load (debug level)", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("系统监控")).toBeInTheDocument();
    // Routine successful refreshes are debug-level telemetry (S3): polling
    // fires health every 10s and diag every 30s, so info would flood the table.
    await waitFor(() => {
      expect(debugMock).toHaveBeenCalledWith(
        "system_diagnostics.refreshed",
        expect.objectContaining({ source: "health" }),
      );
    });
    expect(debugMock).toHaveBeenCalledWith(
      "system_diagnostics.refreshed",
      expect.objectContaining({ source: "diagnostics" }),
    );
    // info is NOT used for routine refreshes.
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("emits logger.warn and renders the stale-warning Alert on a subsequent poll failure", async () => {
    // Initial load: both succeed. The page fires Promise.all([health, diag])
    // so the call order matches the array order ([health, diag]).
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("系统监控")).toBeInTheDocument();
    await waitFor(() => expect(debugMock).toHaveBeenCalled());

    // Subsequent scheduled poll: health fails, diagnostics ok. Order again
    // follows the page's call sequence (health first).
    getMock.mockRejectedValueOnce(new Error("network down"));
    getMock.mockResolvedValueOnce(diag());

    // The health poll runs on a 10s interval; wait for it to fire and log.
    await vi.waitFor(
      () => {
        expect(warnMock).toHaveBeenCalledWith(
          "system_diagnostics.poll_failed",
          expect.objectContaining({ source: "health" }),
        );
      },
      { timeout: 15000 },
    );

    // S5: the stale warning must actually render in the DOM — the user sees a
    // visible "stale data" Alert, not just a swallowed log.
    expect(
      await screen.findByText("系统状态刷新失败，当前显示上次成功数据"),
    ).toBeInTheDocument();
  }, 20000);
});
