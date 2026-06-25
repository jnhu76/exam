import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClientEvent } from "@exam/contracts";
import { ClientEventBuffer } from "./clientEventBuffer";
import { setBuffer, logger } from "./logger";

function makeEvent(name = "test.event"): ClientEvent {
  return {
    kind: "log",
    level: "info",
    name,
    occurredAt: "2026-06-25T00:00:00.000Z",
  };
}

describe("ClientEventBuffer", () => {
  let buffers: ClientEventBuffer[] = [];

  beforeEach(() => {
    buffers = [];
    // Reset the logger singleton so tests don't share state.
    setBuffer(null);
  });

  afterEach(() => {
    for (const b of buffers) b.dispose();
    setBuffer(null);
    vi.useRealTimers();
  });

  function makeBuffer(
    opts: ConstructorParameters<typeof ClientEventBuffer>[0],
  ) {
    const b = new ClientEventBuffer(opts);
    buffers.push(b);
    return b;
  }

  it("queues events until batch size triggers a flush", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const buf = makeBuffer({
      send,
      batchSize: 3,
      flushIntervalMs: 0,
    });
    buf.push(makeEvent("e1"));
    buf.push(makeEvent("e2"));
    // Below batch size: no flush yet.
    expect(send).not.toHaveBeenCalled();
    expect(buf.size).toBe(2);

    buf.push(makeEvent("e3"));
    // Batch size reached → flush scheduled; let microtasks settle.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0]).toHaveLength(3);
    expect(buf.size).toBe(0);
  });

  it("flush sends the current queue and reports count", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("a"));
    buf.push(makeEvent("b"));
    const sent = await buf.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(2);
    expect(sent).toBe(2);
    expect(buf.size).toBe(0);
  });

  it("flush on empty queue is a no-op", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    const sent = await buf.flush();
    expect(send).not.toHaveBeenCalled();
    expect(sent).toBe(0);
  });

  it("does not throw and requeues the batch on transient send failure", async () => {
    // H-requeue: a failed flush re-enqueues the batch to the FRONT of the
    // queue so the next (post-backoff) flush retries it, instead of silently
    // dropping it. Combined with maxBufferSize this stays memory-bounded.
    const send = vi.fn().mockResolvedValue(false);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("x"));
    await buf.flush();
    // Batch survives in the queue for retry.
    expect(buf.size).toBe(1);
  });

  it("retried batch is sent again once backoff elapses (transient recovery)", async () => {
    // First flush fails (transient), second succeeds -> data not lost.
    const send = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("keep"));
    await buf.flush(); // fails, requeued
    expect(buf.size).toBe(1);
    // Force the backoff window to be in the past so the next flush can run.
    buf.clearBackoffForTest();
    const sent = await buf.flush();
    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not throw when send rejects (defensive)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("y"));
    await expect(buf.flush()).resolves.toBe(0);
    // Requeued for retry (same as a boolean failure).
    expect(buf.size).toBe(1);
  });

  it("backs off after a failed flush (skips retries within backoff window)", async () => {
    const send = vi.fn().mockResolvedValue(false);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("f1"));
    await buf.flush(); // fails, requeued to front
    expect(send).toHaveBeenCalledTimes(1);
    // Immediately after a failure, backoff skips the next flush attempt even
    // though the batch is still queued.
    buf.push(makeEvent("f2"));
    const sent = await buf.flush();
    expect(sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1); // still only the first attempt
    // The failed batch remains queued for a later retry.
    expect(buf.size).toBe(2);
  });

  it("grows backoff exponentially across consecutive failures (M12)", async () => {
    // Exponential backoff: each consecutive failure roughly doubles the wait.
    const send = vi.fn().mockResolvedValue(false);
    const buf = makeBuffer({
      send,
      batchSize: 100,
      flushIntervalMs: 0,
      // Tiny base so the test runs fast; doubling still observable.
      failureBackoffBaseMs: 10,
    });
    buf.push(makeEvent("b1"));
    await buf.flush();
    const firstBackoff = buf.currentBackoffForTest();
    expect(firstBackoff).toBeGreaterThanOrEqual(10);

    // Second consecutive failure should produce a larger backoff than the first.
    buf.clearBackoffForTest();
    buf.push(makeEvent("b2"));
    await buf.flush();
    const secondBackoff = buf.currentBackoffForTest();
    expect(secondBackoff).toBeGreaterThan(firstBackoff);
  });

  it("resets backoff to zero after a successful flush", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const buf = makeBuffer({
      send,
      batchSize: 100,
      flushIntervalMs: 0,
      failureBackoffBaseMs: 10,
    });
    buf.push(makeEvent("r"));
    await buf.flush(); // fail
    expect(buf.currentBackoffForTest()).toBeGreaterThan(0);
    buf.clearBackoffForTest();
    await buf.flush(); // success
    expect(buf.currentBackoffForTest()).toBe(0);
  });

  it("bounds memory: requeued batch is still subject to max buffer size", async () => {
    // Requeue must not grow the queue beyond maxBufferSize even under failures.
    const send = vi.fn().mockResolvedValue(false);
    const buf = makeBuffer({
      send,
      batchSize: 2,
      flushIntervalMs: 0,
      maxBufferSize: 3,
    });
    buf.push(makeEvent("1"));
    buf.push(makeEvent("2")); // triggers flush (batchSize 2), fails, requeued
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    buf.push(makeEvent("3"));
    buf.push(makeEvent("4"));
    buf.push(makeEvent("5")); // over cap regardless of requeue
    expect(buf.size).toBeLessThanOrEqual(3);
  });

  it("drops oldest events when exceeding max buffer size", () => {
    const send = vi.fn().mockResolvedValue(true);
    const buf = makeBuffer({
      send,
      batchSize: 1000, // never auto-flush
      flushIntervalMs: 0,
      maxBufferSize: 3,
    });
    buf.push(makeEvent("1"));
    buf.push(makeEvent("2"));
    buf.push(makeEvent("3"));
    buf.push(makeEvent("4")); // overflow by 1
    expect(buf.size).toBe(3); // capped
  });
});

describe("logger → buffer integration", () => {
  beforeEach(() => setBuffer(null));
  afterEach(() => setBuffer(null));

  it("logger routes events through the buffer and sanitizes metadata", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const buf = new ClientEventBuffer({
      send,
      batchSize: 100,
      flushIntervalMs: 0,
    });
    setBuffer(buf);

    logger.warn("test.warn.event", { password: "secret", keep: 1 });
    expect(buf.size).toBe(1);

    await buf.flush();
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0] as ClientEvent[];
    expect(sent[0]!.level).toBe("warn");
    expect(sent[0]!.name).toBe("test.warn.event");
    // Sanitized before reaching the transport.
    expect(sent[0]!.metadata).toEqual({ password: "[redacted]", keep: 1 });
  });

  it("logger never throws even if the buffer is broken", () => {
    // Inject a buffer whose push throws; the logger must swallow it.
    const buf = new ClientEventBuffer({
      send: vi.fn().mockResolvedValue(true),
      batchSize: 100,
      flushIntervalMs: 0,
    });
    buf.push = () => {
      throw new Error("boom");
    };
    setBuffer(buf);
    expect(() => logger.error("no.throw")).not.toThrow();
  });
});
