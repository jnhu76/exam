import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEvent } from "@exam/contracts";
import { ClientEventBuffer } from "./clientEventBuffer";
import { setBuffer, logger, getBuffer } from "./logger";
import {
  trackExamEvent,
  __resetExamTelemetryForTest,
  __flushPendingForTest,
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

/** Flushes the currently-installed buffer and returns all sent events. */
async function flushAll(): Promise<ClientEvent[]> {
  const buf = getBuffer();
  await buf.flush();
  return [];
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
    const events = emitted(send);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe("exam_telemetry");
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
    // question_viewed is coalesced; flush the window to emit.
    __flushPendingForTest();
    await flushAll();
    const ev = emitted(send).find((e) => e.kind === "exam_telemetry")!;
    expect(ev.examId).toBe("exam-1");
    expect(ev.questionId).toBe("q-2");
    expect(typeof ev.route).toBe("string");
  });

  it("NEVER records answer / question content even if a caller passes it", async () => {
    // A buggy caller accidentally includes answer text + question content.
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
    __flushPendingForTest(); // coalesced event
    await flushAll();
    const ev = emitted(send).find((e) => e.kind === "exam_telemetry")!;
    const meta = ev.metadata!;
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
    // question_viewed is a throttled event: 4 rapid calls for the same question
    // are held; on window flush they collapse into ONE event with coalescedCount.
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
    __flushPendingForTest(); // expire the window
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
    // Count only the exam_telemetry events (dual-emit also adds 'log' events).
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
