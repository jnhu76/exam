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
      lastScanAt: null,
      disruptedCount: 0,
    },
    deadlineScannerStatus: {
      interval: 2000,
      lastScanAt: null,
      autoSubmitCount: 0,
    },
    // P3-M5B: email infrastructure status (M5A contract).
    emailStatus: {
      status: "available" as const,
      enabled: true,
      worker: {
        status: "available" as const,
        lastPollAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
      },
      outbox: { pending: 0, processing: 0, retryWait: 0, sent: 0, dead: 0 },
      oldestPendingAge: null,
      lastSuccessfulDeliveryAt: null,
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
    // mockReset on the api.get mock (beyond clearAllMocks) ensures the
    // mockResolvedValueOnce queue is fully drained between tests — otherwise a
    // prior test's leftover once-resolvers shift the [health, diag] pairing in
    // later tests, causing the page to receive a health object where it expects
    // diagnostics (and crash on diag.redisStatus/emailStatus).
    getMock.mockReset();
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
    expect(
      document.querySelectorAll('[data-diagnostic-role="kpi"]'),
    ).toHaveLength(3);
  });

  // Characterization (UI-MIGRATE-N-W4B): the diagnostic info/metric cards are
  // Card-primitive containers that own their elevation. After the business
  // `shadow-sm` is removed (the Card primitive already supplies it), each card
  // title must still sit inside a `data-slot="card"` region holding its value.
  // Asserts the durable container role, not the raw shadow token.
  it("keeps each diagnostic card title inside a Card region holding its value", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    const dbLabel = await screen.findByText("数据库状态");
    const card = dbLabel.closest("[data-slot='card']");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("5ms");
  });

  it("renders DB status card with latency and Redis connected status", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce(diag());
    renderPage();
    expect(await screen.findByText("数据库状态")).toBeInTheDocument();
    expect(screen.getByText("5ms")).toBeInTheDocument();
    // Redis ready state renders infra-available badge; email also renders
    // "可用" so assert count >= 2 (one Redis + at least one email).
    expect(screen.getAllByText("可用").length).toBeGreaterThanOrEqual(2);
  });

  it("shows Redis as degraded when state is degraded", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      redisStatus: {
        mode: "optional",
        state: "degraded",
        connected: false,
        latencyMs: 0,
        degradedReason: "connection_lost",
      },
    });
    renderPage();
    expect(await screen.findByText("数据库状态")).toBeInTheDocument();
    expect(screen.getByText("降级")).toBeInTheDocument();
  });

  it("shows Redis as disabled when mode is off", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      redisStatus: {
        mode: "off",
        state: "disabled",
        connected: false,
        latencyMs: null,
        degradedReason: null,
      },
    });
    renderPage();
    expect(await screen.findByText("数据库状态")).toBeInTheDocument();
    // StatusBadge renders the infra-disabled label
    expect(screen.getByText("已禁用")).toBeInTheDocument();
    expect(screen.queryByText("未连接")).not.toBeInTheDocument();
  });

  it("shows Redis as connecting while the client is connecting", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      redisStatus: {
        mode: "optional",
        state: "connecting",
        connected: false,
        latencyMs: null,
        degradedReason: null,
      },
    });
    renderPage();
    expect(await screen.findByText("数据库状态")).toBeInTheDocument();
    expect(screen.getByText("连接中")).toBeInTheDocument();
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
    expect(
      document.querySelectorAll('[data-diagnostic-role="scanner"]'),
    ).toHaveLength(2);
    // Timestamp rows: each scanner card has a "上次扫描" row
    expect(screen.getAllByText("上次扫描")).toHaveLength(2);
    // Signal rows: heartbeat has "已中断", deadline has "自动提交"
    expect(screen.getByText("已中断")).toBeInTheDocument();
    expect(screen.getByText("自动提交")).toBeInTheDocument();
  });

  it("emits distinct information, scanner, disabled, and raised metric roles", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      emailStatus: {
        status: "disabled" as const,
        enabled: false,
        worker: { status: "disabled" as const },
        outbox: { pending: 0, processing: 0, retryWait: 0, sent: 0, dead: 0 },
      },
    });
    renderPage();
    expect(await screen.findByText("服务器信息")).toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-diagnostic-role="information"]'),
    ).toHaveLength(3);
    expect(
      document.querySelectorAll('[data-diagnostic-role="scanner"]'),
    ).toHaveLength(2);
    expect(
      document.querySelectorAll('[data-diagnostic-role="disabled"]'),
    ).toHaveLength(2);
    for (const metric of document.querySelectorAll(
      '[data-diagnostic-role="kpi"]',
    )) {
      expect(metric.querySelector('[data-slot="stats-card"]')).toHaveClass(
        "surface-content",
      );
    }
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

  // ── P3-M5B: email infrastructure status surface ───────────────────
  it("renders email infrastructure status, worker status, and outbox counts", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      emailStatus: {
        status: "degraded",
        enabled: true,
        worker: { status: "unknown" },
        outbox: { pending: 2, processing: 0, retryWait: 0, sent: 10, dead: 1 },
      },
    });
    renderPage();
    expect(await screen.findByText("邮件基础设施")).toBeInTheDocument();
    // overall email status badge (degraded label) + worker status badge.
    expect(screen.getByText("降级")).toBeInTheDocument();
    expect(screen.getByText("邮件状态")).toBeInTheDocument();
    expect(screen.getByText("工作进程")).toBeInTheDocument();
    expect(screen.getByText("未知")).toBeInTheDocument();
    // outbox counts card.
    expect(screen.getByText("邮件发件箱")).toBeInTheDocument();
    expect(screen.getByText("待发送")).toBeInTheDocument();
    expect(screen.getByText("已发送")).toBeInTheDocument();
    expect(screen.getByText("发送失败")).toBeInTheDocument();
    // count values render at least once (numbers may repeat elsewhere on the
    // page; assert presence via getAllByText, not uniqueness).
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("10").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders email disabled label when emailStatus.status is disabled", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      emailStatus: {
        status: "disabled",
        enabled: false,
        worker: { status: "disabled" },
        outbox: { pending: 0, processing: 0, retryWait: 0, sent: 0, dead: 0 },
      },
    });
    renderPage();
    expect(await screen.findByText("邮件基础设施")).toBeInTheDocument();
    // "已禁用" appears on the email status badge, the email-enabled badge,
    // and the worker badge when everything is disabled — assert presence.
    expect(screen.getAllByText("已禁用").length).toBeGreaterThanOrEqual(2);
    expect(
      document.querySelectorAll('[data-diagnostic-role="disabled"]'),
    ).toHaveLength(2);
  });

  it("does not expose SMTP secrets, recipients, or raw email body in diagnostics", async () => {
    getMock.mockResolvedValueOnce(health());
    getMock.mockResolvedValueOnce({
      ...diag(),
      emailStatus: {
        status: "available",
        enabled: true,
        worker: { status: "available" },
        outbox: { pending: 1, processing: 0, retryWait: 0, sent: 5, dead: 0 },
      },
    });
    renderPage();
    await screen.findByText("邮件基础设施");
    // The diagnostics surface must never leak these — even if they existed in
    // the response, the UI must not render them.
    expect(screen.queryByText(/SMTP_/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument(); // no recipient emails
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
  });
});
