import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import auditLifecyclePlugin, {
  AuditWriteRejectedError,
  createAuditWriteLifecycle,
} from "./auditLifecycle.js";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("audit write lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers work synchronously and removes it after settlement", async () => {
    const lifecycle = createAuditWriteLifecycle();
    const gate = createDeferred();
    const onRejected = vi.fn();

    lifecycle.schedule(async () => gate.promise, onRejected);
    expect(lifecycle.pendingCount()).toBe(1);

    gate.resolve();
    await lifecycle.drain();
    expect(lifecycle.pendingCount()).toBe(0);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("waits for multiple writes that finish out of order", async () => {
    const lifecycle = createAuditWriteLifecycle();
    const first = createDeferred();
    const second = createDeferred();
    const secondFinished = createDeferred();
    let drained = false;

    lifecycle.schedule(async () => first.promise, vi.fn());
    lifecycle.schedule(async () => {
      await second.promise;
      secondFinished.resolve();
    }, vi.fn());
    const drain = lifecycle.drain().then(() => {
      drained = true;
    });

    second.resolve();
    await secondFinished.promise;
    expect(drained).toBe(false);

    first.resolve();
    await drain;
    expect(drained).toBe(true);
    expect(lifecycle.pendingCount()).toBe(0);
  });

  it("includes new work scheduled while a drain is active", async () => {
    const lifecycle = createAuditWriteLifecycle();
    const first = createDeferred();
    const second = createDeferred();
    const firstFinished = createDeferred();
    let drained = false;

    lifecycle.schedule(async () => {
      await first.promise;
      firstFinished.resolve();
    }, vi.fn());
    const drain = lifecycle.drain().then(() => {
      drained = true;
    });
    expect(lifecycle.isDraining()).toBe(true);

    lifecycle.schedule(async () => second.promise, vi.fn());
    first.resolve();
    await firstFinished.promise;
    expect(drained).toBe(false);

    second.resolve();
    await drain;
    expect(drained).toBe(true);
    expect(lifecycle.isDraining()).toBe(false);
  });

  it("observes rejection and lets drain settle", async () => {
    const lifecycle = createAuditWriteLifecycle();
    const failure = new Error("audit failed");
    const onRejected = vi.fn();

    lifecycle.schedule(async () => {
      throw failure;
    }, onRejected);

    await expect(lifecycle.drain()).resolves.toEqual({
      timedOut: false,
      pendingCount: 0,
    });
    expect(onRejected).toHaveBeenCalledWith(failure);
    expect(lifecycle.pendingCount()).toBe(0);
  });

  it("bounds a permanently stalled drain and rejects later work", async () => {
    vi.useFakeTimers();
    const lifecycle = createAuditWriteLifecycle();
    const gate = createDeferred();
    const rejected = vi.fn();
    const lateTask = vi.fn(async () => undefined);
    lifecycle.schedule(async () => gate.promise, vi.fn());

    const drain = lifecycle.drain({ timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(drain).resolves.toEqual({ timedOut: true, pendingCount: 1 });
    await expect(lifecycle.drain({ timeoutMs: 25 })).resolves.toEqual({
      timedOut: true,
      pendingCount: 1,
    });
    expect(lifecycle.isAccepting()).toBe(false);
    lifecycle.schedule(lateTask, rejected);
    expect(lateTask).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledWith(expect.any(AuditWriteRejectedError));

    gate.resolve();
    await vi.runAllTimersAsync();
  });

  it("bounds plugin close without mutating process exit policy", async () => {
    vi.useFakeTimers();
    const previousExitCode = process.exitCode;
    const app = Fastify();
    await app.register(auditLifecyclePlugin, { drainTimeoutMs: 25 });
    await app.ready();
    const fatal = vi.spyOn(app.log, "fatal");
    const gate = createDeferred();
    app.auditWrites.schedule(async () => gate.promise, vi.fn());

    try {
      const close = app.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(app.auditWrites.isAccepting()).toBe(false);
      const rejected = vi.fn();
      const lateTask = vi.fn(async () => undefined);
      app.auditWrites.schedule(lateTask, rejected);
      expect(lateTask).not.toHaveBeenCalled();
      expect(rejected).toHaveBeenCalledWith(
        expect.any(AuditWriteRejectedError),
      );
      await vi.advanceTimersByTimeAsync(25);
      await close;

      expect(fatal).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      gate.resolve();
      await vi.runAllTimersAsync();
      process.exitCode = previousExitCode;
    }
  });
});
