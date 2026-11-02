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

  it("cleanup removes the listeners", () => {
    const stop = registerGlobalErrorCapture();
    stop();
    cleanup = null;

    dispatchUnhandledRejection(new TypeError("after cleanup"));

    expect(recording.events).toHaveLength(0);
  });
});
