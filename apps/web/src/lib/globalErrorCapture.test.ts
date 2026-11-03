import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { ClientEvent } from "@exam/contracts";
import type { ClientEventBuffer } from "./clientEventBuffer";
import { registerGlobalErrorCapture } from "./globalErrorCapture";
import { setBuffer } from "./logger";

/**
 * Minimal buffer stand-in that records pushed events, so tests can assert
 * the fully-formed event (kind / level / name / metadata) that the logger
 * would hand to the transport.
 */
class RecordingBuffer {
  readonly events: ClientEvent[] = [];
  push(event: ClientEvent): void {
    this.events.push(event);
  }
  dispose(): void {}
}

let recording: RecordingBuffer;
let cleanup: (() => void) | null = null;

beforeEach(() => {
  recording = new RecordingBuffer();
  setBuffer(recording as unknown as ClientEventBuffer);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  setBuffer(null);
});

function dispatchUnhandledRejection(reason: unknown): void {
  // jsdom has no PromiseRejectionEvent constructor; the handler only reads
  // `reason`, so a plain Event carrying it is sufficient.
  const event = new Event("unhandledrejection") as Event & { reason: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

function dispatchWindowError(error: unknown): void {
  window.dispatchEvent(new ErrorEvent("error", { error }));
}

describe("registerGlobalErrorCapture", () => {
  it("records unhandled rejections as category-only error events", () => {
    cleanup = registerGlobalErrorCapture();

    dispatchUnhandledRejection(new TypeError("raw-secret-boom"));

    expect(recording.events).toHaveLength(1);
    const event = recording.events[0]!;
    expect(event.kind).toBe("log");
    expect(event.level).toBe("error");
    expect(event.name).toBe("web.unhandled_rejection");
    expect(event.metadata).toEqual({ errorName: "TypeError" });
    // The raw exception text must never be persisted — category only.
    expect(JSON.stringify(event)).not.toContain("raw-secret-boom");
  });

  it("categorizes non-Error rejection reasons by type", () => {
    cleanup = registerGlobalErrorCapture();

    dispatchUnhandledRejection("plain string failure");

    expect(recording.events).toHaveLength(1);
    expect(recording.events[0]!.metadata).toEqual({
      errorName: "non-error:string",
    });
    expect(JSON.stringify(recording.events[0])).not.toContain(
      "plain string failure",
    );
  });

  it("records window error events as web.unhandled_error", () => {
    cleanup = registerGlobalErrorCapture();

    dispatchWindowError(new RangeError("range boom"));

    expect(recording.events).toHaveLength(1);
    expect(recording.events[0]!.name).toBe("web.unhandled_error");
    expect(recording.events[0]!.metadata).toEqual({ errorName: "RangeError" });
    expect(JSON.stringify(recording.events[0])).not.toContain("range boom");
  });

  it("rate-limits repeated categories within the window", () => {
    cleanup = registerGlobalErrorCapture();

    for (let i = 0; i < 7; i++) {
      dispatchUnhandledRejection(new TypeError("boom"));
    }

    expect(recording.events).toHaveLength(5);
    // A different category is unaffected by the exhausted key.
    dispatchUnhandledRejection(new RangeError("other"));
    expect(recording.events).toHaveLength(6);
    expect(recording.events[5]!.metadata).toEqual({ errorName: "RangeError" });
  });

  it("collapses a forged error name to OtherError without persisting it", () => {
    cleanup = registerGlobalErrorCapture();

    const canary = `SECRET-CANARY-${Math.random().toString(36).slice(2)}`;
    const err = new Error(`boom leaking secret-marker-${canary}`);
    err.name = canary;

    dispatchUnhandledRejection(err);

    expect(recording.events).toHaveLength(1);
    expect(recording.events[0]!.metadata).toEqual({ errorName: "OtherError" });
    // Neither the forged name nor the message content reaches the persisted
    // event — the category whitelist is the only source of errorName.
    expect(JSON.stringify(recording.events[0])).not.toContain(canary);
    expect(JSON.stringify(recording.events[0])).not.toContain("secret-marker");
  });

  it("reports OtherError when reading the forged name getter throws", () => {
    cleanup = registerGlobalErrorCapture();

    const err = new Error("boom");
    Object.defineProperty(err, "name", {
      get() {
        throw new Error("getter-boom");
      },
    });

    dispatchUnhandledRejection(err);

    // The capture must not crash on a hostile getter: exactly one event,
    // categorized as OtherError.
    expect(recording.events).toHaveLength(1);
    expect(recording.events[0]!.metadata).toEqual({ errorName: "OtherError" });
  });

  it("reports OtherError when the name is not a string", () => {
    cleanup = registerGlobalErrorCapture();

    const err = new Error("boom");
    (err as { name: unknown }).name = 42;

    dispatchUnhandledRejection(err);

    expect(recording.events).toHaveLength(1);
    expect(recording.events[0]!.metadata).toEqual({ errorName: "OtherError" });
  });

  it("collapses a storm of unique forged names into one limiter key", () => {
    cleanup = registerGlobalErrorCapture();

    for (let i = 0; i < 100; i++) {
      const err = new Error("storm");
      err.name = `ForgedError${i}`;
      dispatchUnhandledRejection(err);
    }

    // All 100 unique hostile names share the single OtherError key, so the
    // per-category cap still applies (at most 5 rows), and the limiter map
    // cannot grow one entry per forged name.
    expect(recording.events).toHaveLength(5);
    expect(
      recording.events.every((e) => e.metadata?.errorName === "OtherError"),
    ).toBe(true);
  });

  it("passes whitelisted standard error names through verbatim", () => {
    cleanup = registerGlobalErrorCapture();

    dispatchUnhandledRejection(new TypeError("a"));
    dispatchUnhandledRejection(new SyntaxError("b"));
    dispatchWindowError(new AggregateError([new Error("c")], "d"));

    expect(recording.events.map((e) => e.metadata?.errorName)).toEqual([
      "TypeError",
      "SyntaxError",
      "AggregateError",
    ]);
  });

  it("cleanup removes the listeners", () => {
    const stop = registerGlobalErrorCapture();
    stop();
    cleanup = null;

    dispatchUnhandledRejection(new TypeError("after cleanup"));

    expect(recording.events).toHaveLength(0);
  });
});
