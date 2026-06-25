import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEvent } from "@exam/contracts";
import { ClientEventBuffer } from "./clientEventBuffer";
import { setBuffer, logger, getBuffer } from "./logger";
import {
  trackExamEvent,
  __resetExamTelemetryForTest,
  __flushPendingForTest,
  clearPendingForAttempt,
} from "./examTelemetry";

/** Build a buffer whose transport records every flushed event. */
function recordingBuffer() {
  const send = vi.fn().mockResolvedValue(true);
  const buf = new ClientEventBuffer({
    send,
    batchSize: 100,
    flushIntervalMs: 0,
  });
  return { buf, send };
}

/** Flushes the currently-installed buffer (events then appear in `send`). */
async function flushAll(): Promise<void> {
  await getBuffer().flush();
}

function emitted(send: ReturnType<typeof vi.fn>): ClientEvent[] {
  const all: ClientEvent[] = [];
  for (const call of send.mock.calls) all.push(...(call[0] as ClientEvent[]));
  return all;
}

describe("trackExamEvent — core behavior", () => {
  let send: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
    const rec = recordingBuffer();
    send = rec.send;
    setBuffer(rec.buf);
  });
  afterEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
  });

  it("emits an exam_telemetry event through the shared buffer", async () => {
    trackExamEvent(
      "exam_page_loaded",
      { source: "take" },
      { attemptId: "att-1" },
    );
    await flushAll();
    const ev = emitted(send).find((e) => e.kind === "exam_telemetry")!;
    expect(ev.name).toBe("exam_page_loaded");
    expect(ev.level).toBe("info");
    expect(ev.attemptId).toBe("att-1");
    expect(ev.clientSessionId).toBeTruthy();
  });

  it("attaches route, examId, and questionId when provided", async () => {
    trackExamEvent(
      "question_viewed",
      { index: 2 },
      { attemptId: "att-1", examId: "exam-1", questionId: "q-2" },
    );
    __flushPendingForTest();
    await flushAll();
    const ev = emitted(send).find((e) => e.kind === "exam_telemetry")!;
    expect(ev.examId).toBe("exam-1");
    expect(ev.questionId).toBe("q-2");
    expect(typeof ev.route).toBe("string");
  });

  it("NEVER records answer / question content even if a caller passes it", async () => {
    trackExamEvent(
      "answer_autosave_success",
      {
        answer: "the real answer",
        answerText: "secret text",
        content: "full question body",
        body: "more content",
        questionId: "q-1",
      },
      { attemptId: "att-1" },
    );
    __flushPendingForTest();
    await flushAll();
    const meta = emitted(send).find(
      (e) => e.kind === "exam_telemetry",
    )!.metadata!;
    expect(meta.answer).toBe("[redacted]");
    expect(meta.answerText).toBe("[redacted]");
    expect(meta.content).toBe("[redacted]");
    expect(meta.body).toBe("[redacted]");
    expect(meta.questionId).toBe("q-1");
  });

  it("never throws when the buffer push fails", () => {
    expect(() =>
      trackExamEvent("anything", {}, { attemptId: "att-1" }),
    ).not.toThrow();
  });
});

describe("trackExamEvent — throttle / dedup", () => {
  let send: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
    const rec = recordingBuffer();
    send = rec.send;
    setBuffer(rec.buf);
  });
  afterEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
  });

  it("coalesces rapid repeats of a throttled event within the window", async () => {
    for (let i = 0; i < 4; i++) {
      trackExamEvent(
        "question_viewed",
        { index: 1 },
        { attemptId: "att-1", questionId: "q-1" },
      );
    }
    // Nothing emitted yet — events are held in the coalescing window.
    expect(
      emitted(send).filter((e) => e.name === "question_viewed"),
    ).toHaveLength(0);
    __flushPendingForTest();
    await flushAll();
    const events = emitted(send).filter((e) => e.name === "question_viewed");
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata?.coalescedCount).toBe(4);
  });

  it("does NOT throttle non-throttled event names (e.g. failures)", async () => {
    trackExamEvent(
      "submit_failed",
      { errorCode: "NET" },
      { attemptId: "att-1", level: "error" },
    );
    trackExamEvent(
      "submit_failed",
      { errorCode: "NET" },
      { attemptId: "att-1", level: "error" },
    );
    await flushAll();
    const events = emitted(send).filter(
      (e) => e.name === "submit_failed" && e.kind === "exam_telemetry",
    );
    expect(events).toHaveLength(2);
  });
});

describe("trackExamEvent — dual-emit on warn/error", () => {
  beforeEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
    const rec = recordingBuffer();
    setBuffer(rec.buf);
  });
  afterEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
  });

  it("also calls logger.error when level is 'error'", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    trackExamEvent(
      "submit_failed",
      { errorCode: "NETWORK" },
      { attemptId: "att-1", level: "error" },
    );
    expect(spy).toHaveBeenCalledWith(
      "submit_failed",
      expect.objectContaining({ errorCode: "NETWORK" }),
    );
    spy.mockRestore();
  });

  it("also calls logger.warn when level is 'warn'", () => {
    const spy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    trackExamEvent("heartbeat_failed", {}, { level: "warn" });
    expect(spy).toHaveBeenCalledWith("heartbeat_failed", expect.any(Object));
    spy.mockRestore();
  });

  it("does NOT dual-emit for info/debug levels", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    trackExamEvent("exam_page_loaded", {}, { level: "info" });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("clearPendingForAttempt — unmount cleanup", () => {
  let send: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
    const rec = recordingBuffer();
    send = rec.send;
    setBuffer(rec.buf);
  });
  afterEach(() => {
    setBuffer(null);
    __resetExamTelemetryForTest();
  });

  it("discards pending coalesced events for the given attempt (no emission)", async () => {
    // Queue a coalesced event for att-1 (held in the window, not yet emitted).
    trackExamEvent(
      "question_viewed",
      { index: 1 },
      { attemptId: "att-1", questionId: "q-1" },
    );
    // Simulate unmount of att-1: pending events for att-1 must be discarded.
    clearPendingForAttempt("att-1");
    // Flushing now must NOT emit the discarded event.
    __flushPendingForTest();
    await flushAll();
    expect(
      emitted(send).filter((e) => e.name === "question_viewed"),
    ).toHaveLength(0);
  });

  it("leaves pending events for OTHER attempts untouched", async () => {
    trackExamEvent(
      "question_viewed",
      { index: 1 },
      { attemptId: "att-1", questionId: "q-1" },
    );
    trackExamEvent(
      "question_viewed",
      { index: 2 },
      { attemptId: "att-2", questionId: "q-2" },
    );
    // Unmount att-1 only.
    clearPendingForAttempt("att-1");
    __flushPendingForTest();
    await flushAll();
    const events = emitted(send).filter((e) => e.name === "question_viewed");
    // att-2's event survives; att-1's is gone.
    expect(events).toHaveLength(1);
    expect(events[0]!.attemptId).toBe("att-2");
  });

  it("is a no-op for an attempt with no pending events", () => {
    expect(() => clearPendingForAttempt("no-such-attempt")).not.toThrow();
  });
});
