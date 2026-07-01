import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // Safety net: the poll-failure test below switches to fake timers; restore
  // real timers so sibling tests in this file aren't affected. The global
  // setup.ts afterEach also calls useRealTimers, but this is explicit.
  afterEach(() => {
    vi.useRealTimers();
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

  it("renders health metric cards (CPU, memory, DB response time)", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("系统监控")).toBeInTheDocument();
    expect(await screen.findByText("CPU 使用率")).toBeInTheDocument();
    expect(screen.getByText("内存使用率")).toBeInTheDocument();
    expect(screen.getByText("数据库响应时间")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders DB status card with latency and Redis connected status", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("数据库状态")).toBeInTheDocument();
    expect(screen.getByText("5ms")).toBeInTheDocument();
    expect(screen.getByText("已连接 (1ms)")).toBeInTheDocument();
  });

  it("shows Redis as disconnected when redisStatus.connected is false", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      redisStatus: { connected: false, latencyMs: 0 },
    });
    renderPage();
    expect(await screen.findByText("数据库状态")).toBeInTheDocument();
    expect(screen.getByText("未连接")).toBeInTheDocument();
  });

  it("renders heartbeat scanner and deadline scanner status cards", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("心跳扫描器")).toBeInTheDocument();
    expect(screen.getByText("截止扫描器")).toBeInTheDocument();
    expect(screen.getByText("已中断")).toBeInTheDocument();
    expect(screen.getByText("自动提交")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("renders server info with version", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("服务器信息")).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
  });

  it("renders runtime config card with heartbeat and deadline intervals", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("运行时配置")).toBeInTheDocument();
    expect(screen.getByText("心跳间隔")).toBeInTheDocument();
    expect(screen.getByText("心跳超时")).toBeInTheDocument();
    expect(screen.getByText("截止扫描间隔")).toBeInTheDocument();
  });

  it("renders page when health fails but diag succeeds (no white screen)", async () => {
    getMock.mockRejectedValueOnce(new Error("health down"));
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("系统监控")).toBeInTheDocument();
    expect(screen.getByText("服务器信息")).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
  });

  it("renders page when diag fails but health succeeds (no white screen)", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockRejectedValueOnce(new Error("diag down"));
    renderPage();
    expect(await screen.findByText("系统监控")).toBeInTheDocument();
    expect(screen.getByText("CPU 使用率")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("shows refresh button that triggers data reload", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("系统监控")).toBeInTheDocument();
    expect(debugMock).toHaveBeenCalled();

    vi.clearAllMocks();
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    const refreshBtn = screen.getByRole("button", { name: "刷新系统数据" });
    // Click inside act: handleRefresh calls setIsLoading(true) synchronously,
    // which is an out-of-act state update if the native .click() runs bare.
    await act(async () => {
      refreshBtn.click();
    });
    await waitFor(() => {
      expect(debugMock).toHaveBeenCalled();
    });
  });

  it("emits logger.warn and renders the stale-warning Alert on a subsequent poll failure", async () => {
    // Use fake timers so the 10s HEALTH_REFRESH_MS poll fires synchronously
    // instead of waiting real wall-clock. This removes both the ~10s test
    // duration and the act() warnings (a real pending poll firing setState
    // after the test body was the warning source). No userEvent is used in
    // this test; if one were added, it must be configured with
    // userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).
    vi.useFakeTimers({ shouldAdvanceTime: false });

    // Initial load: both succeed. The page fires Promise.all([health, diag])
    // so the call order matches the array order ([health, diag]).
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());

    // Render + flush the initial load's microtasks inside one act so the
    // resulting setHealth/setDiag/setIsLoading state updates are batched and
    // observed. The page has an infinite 1s uptime interval, so
    // runAllTimers would loop; render() mounts and synchronously schedules
    // the Promise.all microtasks, which the awaited act then drains without
    // advancing timers. Using findByText/waitFor here would spin on
    // fake-timer polling, so we flush then assert with a sync query.
    await act(async () => {
      renderPage();
      // Drain the initial Promise.all microtasks; the awaited empty promise
      // yields to the queue so the mock .then callbacks run inside this act.
      await Promise.resolve();
    });
    expect(screen.getByText("系统监控")).toBeInTheDocument();
    expect(debugMock).toHaveBeenCalled();

    // Subsequent scheduled poll: health fails, diagnostics ok. Order again
    // follows the page's call sequence (health first).
    getMock.mockRejectedValueOnce(new Error("network down"));
    getMock.mockResolvedValueOnce(diag());

    // Advance the fake 10s health poll interval; the rejected poll resolves
    // and the component sets staleWarning + logs. Wrapped in act because
    // this drives React state updates from the poll callbacks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(warnMock).toHaveBeenCalledWith(
      "system_diagnostics.poll_failed",
      expect.objectContaining({ source: "health" }),
    );

    // S5: the stale warning must actually render in the DOM — the user sees a
    // visible "stale data" Alert, not just a swallowed log.
    expect(
      screen.getByText("系统状态刷新失败，当前显示上次成功数据"),
    ).toBeInTheDocument();
  });
});
