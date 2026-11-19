import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission, permissionsForRole } from "@exam/authz";
import type { MeResponse } from "@exam/contracts";
import { AuthProvider } from "@/contexts/AuthContext";
import { ApiError, api } from "@/lib/api";
import { logger } from "@/lib/logger";
import { OperationsPage } from "./OperationsPage";
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

/** Operational diagnostics payloads with a unique dbLatency fact. */
function diagOf(dbLatency: number): DiagnosticsResponse {
  return {
    version: "1.0.0",
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

function deniedError(): ApiError {
  return new ApiError(403, "无权执行此操作", "PERMISSION_DENIED");
}

function authRequiredError(): ApiError {
  return new ApiError(401, "请先登录", "AUTH_REQUIRED");
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

/** Deferred reads split by SOURCE. The page polls /api/system/health and
 * /api/system/diagnostics as independent sources; each keeps its own read
 * ownership, so the tests pin settlement order per source. */
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

function adminUser(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: "actor-1",
    username: "actor",
    name: "Actor",
    role: "Admin",
    organizationId: "org1",
    capabilities: [...permissionsForRole("Admin")],
    ...overrides,
  };
}

function renderPage(user: MeResponse = adminUser()) {
  return render(
    <MemoryRouter>
      <AuthProvider initialUser={user}>
        <OperationsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  vi.mocked(logger.warn).mockClear();
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

describe("OperationsPage dual-source independence (#1032)", () => {
  it("health succeeds while diagnostics fails: health data stays visible, diagnostics shows 不可用 with its own retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.reject(new Error("diag down"));
    });
    // The successful source's facts render…
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getAllByText(/最近成功接收/).length).toBe(1);
    // …while the failed source lands on its own unavailable state — no
    // full-page error, no diagnostics rows.
    expect(screen.getByText("运行时诊断当前不可用")).toBeInTheDocument();
    expect(screen.queryByText("5 ms")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试诊断读取" }),
    ).toBeInTheDocument();
  });

  it("diagnostics succeeds while health fails: diagnostics rows render, health shows 不可用", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.reject(new Error("health down"));
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("5 ms")).toBeInTheDocument();
    expect(screen.getAllByText(/最近成功接收/).length).toBe(1);
    expect(screen.getByText("系统健康数据当前不可用")).toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重试健康读取" }),
    ).toBeInTheDocument();
  });

  it("the first source success is visible immediately while the other source is still pending, with independent receive times", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Health lands at t=0; diagnostics is still on the wire.
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
    });
    expect(screen.getByText("10")).toBeInTheDocument();

    // Diagnostics lands 2s later: each source keeps its own receive time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      diagReads[0]!.resolve(diagOf(5));
    });
    const labels = screen
      .getAllByText(/最近成功接收/)
      .map((el) => el.textContent ?? "");
    expect(labels).toHaveLength(2);
    expect(labels[0]).not.toBe(labels[1]);
  });
});

describe("OperationsPage stream read ownership (#1032)", () => {
  it("a superseded read landing last must not overwrite the newer snapshot (overlapping poll ticks)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Initial load: both sources succeed.
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("10")).toBeInTheDocument();

    // t=15s: a poll tick goes out on both streams and hangs (slow server).
    // The retry below lands at t=22s, inside the hung reads' 10s deadline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(22_000);
    });
    expect(healthCalls()).toHaveLength(2);
    expect(diagCalls()).toHaveLength(2);

    // Manual retry supersedes both hanging reads.
    fireEvent.click(screen.getByRole("button", { name: "重试健康读取" }));
    fireEvent.click(screen.getByRole("button", { name: "重试诊断读取" }));
    expect(healthCalls()).toHaveLength(3);
    expect(diagCalls()).toHaveLength(3);

    // The CURRENT reads settle: their facts render.
    await act(async () => {
      healthReads[2]!.resolve(healthOf(20));
      diagReads[2]!.resolve(diagOf(7));
    });
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("7 ms")).toBeInTheDocument();

    // The SUPERSEDED poll reads settle LAST: they must be discarded by
    // their own stream — their facts must not render.
    await act(async () => {
      healthReads[1]!.resolve(healthOf(99));
      diagReads[1]!.resolve(diagOf(99));
    });
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.queryByText("99 ms")).not.toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("7 ms")).toBeInTheDocument();
  });

  it("a superseded read FAILING must not mark its source stale nor release the current read's in-flight slot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });

    // t=15s: poll reads hang on both streams; t=22s: manual retry supersedes
    // them and the new reads stay on the wire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(22_000);
    });
    expect(healthCalls()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "重试健康读取" }));
    fireEvent.click(screen.getByRole("button", { name: "重试诊断读取" }));

    // The superseded poll reads then FAIL. Their failures belong to reads
    // nobody is waiting for: no stale marker may appear and current data
    // stays.
    await act(async () => {
      healthReads[1]!.reject(new Error("stale health failed"));
      diagReads[1]!.reject(new Error("stale diag failed"));
    });
    expect(
      screen.queryByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("运行时诊断已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();

    // The superseded finally (and the superseded reads' own deadlines at
    // t=25s) must NOT release the slot the CURRENT read holds: the t=30s
    // tick stays skipped while the retry reads are in flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(healthCalls()).toHaveLength(3);
    expect(diagCalls()).toHaveLength(3);

    // Once the current reads settle, the streams go idle and the next tick
    // fires on schedule.
    await act(async () => {
      healthReads[2]!.resolve(healthOf(30));
      diagReads[2]!.resolve(diagOf(8));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(healthCalls()).toHaveLength(4);
    expect(diagCalls()).toHaveLength(4);
  });

  it("a hung source does not block the other source's cadence (per-source single-flight)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Health hangs from the start (until its deadline); diagnostics'
    // initial read succeeds.
    await act(async () => {
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("5 ms")).toBeInTheDocument();

    // t=15s: the diagnostics tick fires (its stream is idle) and refreshes;
    // the hung health source cannot delay that read or its commit.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      diagReads[1]!.resolve(diagOf(6));
    });
    expect(diagCalls()).toHaveLength(2);
    expect(screen.getByText("6 ms")).toBeInTheDocument();

    // t=30s: same shape — diagnostics keeps its rhythm under a hung peer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      diagReads[2]!.resolve(diagOf(7));
    });
    expect(diagCalls()).toHaveLength(3);
    expect(screen.getByText("7 ms")).toBeInTheDocument();
  });

  it("a single-source timeout converges as that source's failure, releases the polling slot, and retry works after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      diagReads[0]!.resolve(diagOf(5));
    });

    // The health read hangs past the request deadline (10s): health lands on
    // its unavailable state (first read failed) while diagnostics is intact.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText("系统健康数据当前不可用")).toBeInTheDocument();
    expect(screen.getByText("5 ms")).toBeInTheDocument();

    // The slot was released by the timeout: the t=15s tick fires a fresh
    // health read.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(healthCalls()).toHaveLength(2);
    await act(async () => {
      healthReads[1]!.resolve(healthOf(42));
    });
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("a snapshot past its freshness window is marked stale by age even while the next read is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });

    // t=15s: the poll ticks go out; t=21s: manual retries supersede them and
    // hang (deadlines at t=31s — after the age boundary below).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "重试健康读取" }));
    fireEvent.click(screen.getByRole("button", { name: "重试诊断读取" }));

    // t=29s: the snapshots are 29s old — still inside the 30s window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(
      screen.queryByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();

    // t=30s: the age crosses two polling periods while the reads are STILL
    // pending: both sources show their stale markers, keeping the old values
    // and receive times.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      screen.getByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("运行时诊断已过期，显示上次成功接收的结果"),
    ).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5 ms")).toBeInTheDocument();
    expect(screen.getAllByText(/最近成功接收/).length).toBe(2);
  });

  it("stale age counts from each source's own receive time, not the poll grid (off-beat receive)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
    });
    // Diagnostics lands at t=2s — off the 15s poll grid — so ITS receive time
    // anchors the freshness window at t=32s, not at any grid tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("5 ms")).toBeInTheDocument();

    // t=15s: both ticks fire; health commits immediately, the diagnostics
    // read hangs (its own 10s deadline would land at t=25s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13_000);
      healthReads[1]!.resolve(healthOf(11));
    });

    // t=23s: a manual retry supersedes the hanging read BEFORE its deadline,
    // replacing it with a read whose deadline (t=33s) sits AFTER the age
    // boundary. What follows therefore witnesses the AGE branch alone: no
    // read has ever failed, and the t=30s tick skips (single-flight).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "重试诊断读取" }));
    expect(diagCalls()).toHaveLength(3);

    // t=31s: diagnostics is 29s old — inside the window; health (received
    // t=15s) is fresh. Neither source shows a stale marker.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(
      screen.queryByText("运行时诊断已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();

    // t=32s: exactly 30s after the t=2s receive — diagnostics goes stale by
    // age while health (17s old, its t=30s read in flight within its
    // deadline) does not.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      screen.getByText("运行时诊断已过期，显示上次成功接收的结果"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("5 ms")).toBeInTheDocument();
    expect(screen.getAllByText(/最近成功接收/).length).toBe(2);
  });

  it("recovery clears only the failing source's stale marker and updates only that source's receive time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });

    // t=15s: the health poll fails, the diagnostics poll succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      healthReads[1]!.reject(new Error("health down"));
      diagReads[1]!.resolve(diagOf(6));
    });
    expect(
      screen.getByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("运行时诊断已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();
    // Old health value and time are kept.
    expect(screen.getByText("10")).toBeInTheDocument();

    // t=30s: health recovers — only the health stale marker clears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      healthReads[2]!.resolve(healthOf(12));
    });
    expect(
      screen.queryByText("系统健康数据已过期，显示上次成功接收的结果"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("manual retry supersedes only its own source's in-flight read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    // Both initial reads hang.
    expect(healthCalls()).toHaveLength(1);
    expect(diagCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "重试健康读取" }));
    expect(healthCalls()).toHaveLength(2);
    expect(diagCalls()).toHaveLength(1);

    await act(async () => {
      healthReads[1]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5 ms")).toBeInTheDocument();
  });

  it("unmount clears timers and late settlements commit nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { unmount } = renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });
    unmount();
    // No poll ticks fire after unmount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(healthCalls()).toHaveLength(1);
    expect(diagCalls()).toHaveLength(1);
  });
});

describe("OperationsPage permission & session matrix (#1032)", () => {
  it("a Teacher holding an active secondary Maintainer assignment sees the same operational projection as Admin", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage({
      id: "actor-1",
      username: "actor",
      name: "Actor",
      role: "Teacher",
      organizationId: "org1",
      // Secondary Maintainer assignment: the capability union carries the
      // operational view permissions.
      capabilities: [
        ...permissionsForRole("Teacher"),
        Permission.SystemHealthView,
        Permission.SystemDiagnosticsView,
      ],
    });
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5 ms")).toBeInTheDocument();
  });

  it("does not send the diagnostics request when the capability set lacks system.diagnostics.view", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage({
      id: "actor-1",
      username: "actor",
      name: "Actor",
      role: "Admin",
      organizationId: "org1",
      capabilities: [Permission.SystemHealthView],
    });
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
    });
    expect(healthCalls()).toHaveLength(1);
    expect(diagCalls()).toHaveLength(0);
    // The diagnostics section is absent for a viewer without the capability.
    expect(screen.queryByText("运行状态")).not.toBeInTheDocument();

    // Nor does a later tick introduce one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      healthReads[1]!.resolve(healthOf(11));
    });
    expect(diagCalls()).toHaveLength(0);
  });

  it("a current diagnostics 403 clears the diagnostics snapshot and receive time, shows 无权访问, and health keeps polling; a superseded 403 changes nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });
    expect(screen.getByText("5 ms")).toBeInTheDocument();

    // t=15s: the diagnostics poll hangs; a manual retry supersedes it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "重试诊断读取" }));

    // The SUPERSEDED poll read lands 403: nobody is waiting for it — the
    // committed snapshot must survive.
    await act(async () => {
      diagReads[1]!.reject(deniedError());
    });
    expect(screen.getByText("5 ms")).toBeInTheDocument();
    expect(screen.queryByText(/无权访问运行时诊断/)).not.toBeInTheDocument();

    // The CURRENT read lands 403: the diagnostics snapshot and receive time
    // are cleared, the denied state shows…
    await act(async () => {
      diagReads[2]!.reject(deniedError());
    });
    expect(screen.queryByText("5 ms")).not.toBeInTheDocument();
    expect(screen.getAllByText(/最近成功接收/).length).toBe(1);
    expect(screen.getByText(/无权访问运行时诊断/)).toBeInTheDocument();

    // …and health keeps its cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      healthReads[2]!.resolve(healthOf(12));
    });
    expect(healthCalls()).toHaveLength(3);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("a current health 403 collapses the protected content to the denied state and stops both sources", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });

    // t=15s: the CURRENT health read lands 403 — the overview entry
    // authorization is gone. Protected content collapses…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      healthReads[1]!.reject(deniedError());
    });
    expect(screen.getByText("您没有权限访问该页面。")).toBeInTheDocument();
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    expect(screen.queryByText("5 ms")).not.toBeInTheDocument();

    // …and neither source polls anymore.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(healthCalls()).toHaveLength(2);
    expect(diagCalls()).toHaveLength(2);
  });

  // NOTE: live session-identity and capability-revoke transitions are
  // witnessed in useOperationsSource.test.tsx — AuthProvider's initialUser
  // only seeds mount state (no in-place identity mutation path exists
  // today), so the page-level rerender cannot observe a user change.

  it("a current 401 invalidates this page's snapshots and in-flight reads (navigation itself is owned by the API client)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderPage();
    await act(async () => {
      healthReads[0]!.resolve(healthOf(10));
      diagReads[0]!.resolve(diagOf(5));
    });

    // t=15s: the CURRENT health read lands 401 — the session is gone. Both
    // sources' snapshots are invalidated and no further polls fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      healthReads[1]!.reject(authRequiredError());
    });
    expect(screen.queryByText("10")).not.toBeInTheDocument();
    expect(screen.queryByText("5 ms")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(healthCalls()).toHaveLength(2);
    expect(diagCalls()).toHaveLength(2);
  });
});
