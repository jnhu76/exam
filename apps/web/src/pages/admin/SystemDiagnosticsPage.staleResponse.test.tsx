import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { SystemDiagnosticsPage } from "./SystemDiagnosticsPage";
import type {
  SystemHealthResponse,
  DiagnosticsResponse,
} from "@exam/contracts";

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
  api: { get: vi.fn() },
  setNavigate: () => {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getMock = vi.mocked(api.get);

/** Health payloads with a unique CPU reading so a cross-response render is
 * unambiguous. */
function healthOf(cpu: number): SystemHealthResponse {
  return { status: "ok", cpu, memory: 11, dbResponseMs: 3 };
}

/** Diagnostics payloads with unique version + dbLatency facts. */
function diagOf(version: string, dbLatency: number): DiagnosticsResponse {
  return {
    version,
    uptime: 100,
    dbLatency,
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
  } as DiagnosticsResponse;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Held {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/** Deferred reads split by STREAM. The page polls /api/system/health and
 * /api/system/diagnostics independently; each stream keeps its own update
 * ownership, so the tests pin settlement order per stream. */
const healthReads: Held[] = [];
const diagReads: Held[] = [];

function healthCalls() {
  return getMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/system/health"));
}
function diagCalls() {
  return getMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/system/diagnostics"));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemDiagnosticsPage />
    </MemoryRouter>,
  );
}

describe("SystemDiagnosticsPage stream read ownership (R8)", () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.debug).mockClear();
    healthReads.length = 0;
    diagReads.length = 0;
    getMock.mockImplementation((path: string) => {
      const target = String(path);
      const d = deferred<unknown>();
      if (target.includes("/api/system/health")) {
        healthReads.push(d as Held);
      } else if (target.includes("/api/system/diagnostics")) {
        diagReads.push(d as Held);
      } else {
        throw new Error(`unexpected GET ${target}`);
      }
      return d.promise as never;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a superseded read landing last must not update its stream's data (health and diagnostics owned separately)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Initial load: both streams succeed. (Sync queries — waitFor spins on
    // fake timers.)
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf("1.0.0", 5));
    });
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("5ms")).toBeInTheDocument();

    // t=10s: a health poll tick goes out and hangs (the stream is idle, so
    // the tick fires on any implementation).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(healthCalls()).toHaveLength(2);

    // Manual refresh while the poll read is in flight: it supersedes the
    // poll read in the health stream and starts a fresh diagnostics read.
    fireEvent.click(screen.getByRole("button", { name: "刷新系统数据" }));
    expect(healthCalls()).toHaveLength(3);
    expect(diagCalls()).toHaveLength(2);

    // The CURRENT reads settle: their facts render.
    await act(async () => {
      healthReads[2]!.resolve(healthOf(20));
      diagReads[1]!.resolve(diagOf("2.0.0", 77));
    });
    expect(screen.queryByText("1.0.0")).not.toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();

    // The SUPERSEDED health poll read settles LAST: it must be discarded by
    // its own stream — its metrics must not render (and the last-refresh
    // bookkeeping it carries must not fire either).
    await act(async () => {
      healthReads[1]!.resolve(healthOf(99));
    });

    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();
    expect(screen.getByText("77ms")).toBeInTheDocument();
  });

  it("a superseded read FAILING must not raise its stream's stale warning", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf("1.0.0", 5));
    });
    expect(screen.getByText("1.0.0")).toBeInTheDocument();

    // t=10s: health poll read hangs. t=30s: the diagnostics poll tick fires
    // (its stream is idle — the health stream is skipped while in flight).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(healthCalls()).toHaveLength(2);
    expect(diagCalls()).toHaveLength(2);

    // Manual refresh supersedes BOTH hanging poll reads and succeeds.
    fireEvent.click(screen.getByRole("button", { name: "刷新系统数据" }));
    expect(healthCalls()).toHaveLength(3);
    expect(diagCalls()).toHaveLength(3);
    await act(async () => {
      healthReads[2]!.resolve(healthOf(20));
      diagReads[2]!.resolve(diagOf("2.0.0", 77));
    });
    expect(screen.getByText("2.0.0")).toBeInTheDocument();

    // The superseded poll reads then FAIL. Their failures belong to reads
    // nobody is waiting for — neither stream's stale warning may appear, and
    // the current data stays.
    await act(async () => {
      healthReads[1]!.reject(new Error("stale health failed"));
      diagReads[1]!.reject(new Error("stale diag failed"));
    });

    expect(
      screen.queryByText("系统状态刷新失败，当前显示上次成功数据"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("诊断数据刷新失败，当前显示上次成功数据"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2.0.0")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("a poll tick must not stack onto an in-flight read of its stream, and the slow read still refreshes when it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Both initial reads held on the wire (slow server).
    expect(healthCalls()).toHaveLength(1);
    expect(diagCalls()).toHaveLength(1);

    // Advance past the health poll interval (10s): the health tick must be
    // SKIPPED while the initial health read is in flight — a slow read must
    // not cause continuously overlapping requests.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(healthCalls()).toHaveLength(1);
    expect(diagCalls()).toHaveLength(1);

    // The slow reads are still current: landing them refreshes the page.
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf("1.0.0", 5));
    });
    expect(screen.getByText("1.0.0")).toBeInTheDocument();

    // With the streams idle again, the next health tick fires a fresh poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(healthCalls()).toHaveLength(2);
    await act(async () => {
      healthReads[1]!.resolve(healthOf(30));
    });
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("an initial-load failure still surfaces the error state with retry (control)", async () => {
    renderPage();
    // Both initial reads fail before any data exists: the full-page error
    // state is the only honest projection.
    await act(async () => {
      healthReads[0]!.reject(new Error("health down"));
      diagReads[0]!.reject(new Error("diag down"));
    });
    expect(await screen.findByText("加载诊断数据失败")).toBeInTheDocument();
  });
});
