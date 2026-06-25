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

  it("does not throw and drops the batch when send fails", async () => {
    const send = vi.fn().mockResolvedValue(false);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("x"));
    await expect(buf.flush()).resolves.toBe(0);
    // Failed batch is dropped, not re-enqueued.
    expect(buf.size).toBe(0);
    // Does not throw / reject.
    expect(true).toBe(true);
  });

  it("does not throw when send rejects (defensive)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("y"));
    await expect(buf.flush()).resolves.toBe(0);
    expect(buf.size).toBe(0);
  });

  it("backs off after a failed flush", async () => {
    const send = vi.fn().mockResolvedValue(false);
    const buf = makeBuffer({ send, batchSize: 100, flushIntervalMs: 0 });
    buf.push(makeEvent("f1"));
    await buf.flush();
    expect(send).toHaveBeenCalledTimes(1);
    // Immediately after a failure, backoff skips the next flush.
    buf.push(makeEvent("f2"));
    const sent = await buf.flush();
    expect(sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1); // still only the first attempt
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
