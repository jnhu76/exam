import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { useOperationsSource } from "./useOperationsSource";

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

interface Held {
  signal: AbortSignal;
  resolve: (v: number) => void;
  reject: (e: unknown) => void;
}

/** Controlled source: every read is parked as a deferred so a test resolves
 * or rejects each request explicitly and can hold an older response back to
 * prove the session/generation race contract. */
function makeSource() {
  const calls: Held[] = [];
  const read = (signal: AbortSignal) =>
    new Promise<number>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
    });
  return { read, calls };
}

function baseProps(read: (signal: AbortSignal) => Promise<number>) {
  return {
    read,
    sessionKey: "session-1",
    pollMs: 15_000,
    timeoutMs: 10_000,
    logSource: "test",
  };
}

async function flushMicros() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useOperationsSource session and capability semantics (#1032)", () => {
  it("a session change discards the previous identity's snapshot on the first frame and restarts reads", async () => {
    const { read, calls } = makeSource();
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof baseProps>) =>
        useOperationsSource<number>(props),
      { initialProps: baseProps(read) },
    );
    await flushMicros();
    calls[0]!.resolve(1);
    await flushMicros();
    expect(result.current.view.snapshot).toBe(1);

    rerender({ ...baseProps(read), sessionKey: "session-2" });
    // First frame of the new session: no snapshot of the previous identity.
    expect(result.current.view.snapshot).toBeNull();
    expect(result.current.view.settled).toBe(false);
    // The new session's initial read goes out immediately.
    await flushMicros();
    expect(calls).toHaveLength(2);
    calls[1]!.resolve(2);
    await flushMicros();
    expect(result.current.view.snapshot).toBe(2);
  });

  it("the previous session's in-flight read settling late commits nothing", async () => {
    const { read, calls } = makeSource();
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof baseProps>) =>
        useOperationsSource<number>(props),
      { initialProps: baseProps(read) },
    );
    await flushMicros();
    expect(calls).toHaveLength(1);

    rerender({ ...baseProps(read), sessionKey: "session-2" });
    await flushMicros();
    expect(calls).toHaveLength(2);

    // The OLD session's read settles last — success or failure, it must not
    // touch the new session's view.
    calls[0]!.resolve(99);
    await flushMicros();
    expect(result.current.view.snapshot).toBeNull();
    expect(result.current.view.settled).toBe(false);

    calls[1]!.resolve(2);
    await flushMicros();
    expect(result.current.view.snapshot).toBe(2);
  });

  it("an enabled flip to false stops scheduled reads (known capability revoke)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { read, calls } = makeSource();
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof baseProps> & { enabled?: boolean }) =>
        useOperationsSource<number>(props),
      { initialProps: { ...baseProps(read), enabled: true } },
    );
    await act(async () => {
      calls[0]!.resolve(1);
    });
    expect(result.current.view.snapshot).toBe(1);

    rerender({ ...baseProps(read), enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(calls).toHaveLength(1);
  });

  it("a proven 403 clears the snapshot, stops scheduled polling, and a manual refresh re-requests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { read, calls } = makeSource();
    const { result } = renderHook(
      (props: ReturnType<typeof baseProps>) =>
        useOperationsSource<number>(props),
      { initialProps: baseProps(read) },
    );
    await act(async () => {
      calls[0]!.resolve(1);
    });
    expect(result.current.view.snapshot).toBe(1);

    // t=15s: the current read lands a proven permission denial.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      calls[1]!.reject(
        new ApiError(403, "无权执行此操作", "PERMISSION_DENIED"),
      );
    });
    expect(result.current.view.snapshot).toBeNull();
    expect(result.current.view.receivedAt).toBeNull();
    expect(result.current.view.failure).toBe("denied");

    // Scheduled polling is suspended for the denied source…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(calls).toHaveLength(2);

    // …but an explicit re-request goes out and can recover.
    await act(async () => {
      result.current.refresh();
    });
    expect(calls).toHaveLength(3);
    await act(async () => {
      calls[2]!.resolve(3);
    });
    expect(result.current.view.snapshot).toBe(3);
    expect(result.current.view.failure).toBeNull();
  });

  it("invalidate wipes the snapshot and suspends scheduled polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { read, calls } = makeSource();
    const { result } = renderHook(
      (props: ReturnType<typeof baseProps>) =>
        useOperationsSource<number>(props),
      { initialProps: baseProps(read) },
    );
    await act(async () => {
      calls[0]!.resolve(1);
    });
    expect(result.current.view.snapshot).toBe(1);

    await act(async () => {
      result.current.invalidate();
    });
    expect(result.current.view.snapshot).toBeNull();
    expect(result.current.view.failure).toBeNull();
    expect(result.current.view.settled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(calls).toHaveLength(1);
  });

  it("a 401 failure wipes the snapshot and stops the source (page owns invalidation)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { read, calls } = makeSource();
    const { result } = renderHook(
      (props: ReturnType<typeof baseProps>) =>
        useOperationsSource<number>(props),
      { initialProps: baseProps(read) },
    );
    await act(async () => {
      calls[0]!.resolve(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      calls[1]!.reject(new ApiError(401, "请先登录", "AUTH_REQUIRED"));
    });
    expect(result.current.view.snapshot).toBeNull();
    expect(result.current.view.failure).toBe("auth");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(calls).toHaveLength(2);
  });
});
