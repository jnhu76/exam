import { describe, it, expect } from "vitest";
import {
  ClientEventSchema,
  ClientEventBatchSchema,
  CLIENT_EVENT_BATCH_MAX_SIZE,
  CLIENT_EVENT_METADATA_MAX_BYTES,
  CLIENT_EVENT_METADATA_MAX_DEPTH,
  utf8ByteLength,
} from "../clientEvent.js";

/** Minimal valid event factory. */
function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: "log",
    level: "info",
    name: "system_diagnostics.refreshed",
    occurredAt: "2026-06-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("ClientEventSchema", () => {
  it("accepts a minimal valid event", () => {
    const result = ClientEventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = ClientEventSchema.safeParse(
      baseEvent({
        route: "/admin/diagnostics",
        attemptId: "att-1",
        examId: "exam-1",
        questionId: "q-1",
        clientSessionId: "sess-1",
        metadata: { foo: "bar", count: 3 },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid kind", () => {
    const result = ClientEventSchema.safeParse(baseEvent({ kind: "noise" }));
    expect(result.success).toBe(false);
  });

  it("rejects an invalid level", () => {
    const result = ClientEventSchema.safeParse(baseEvent({ level: "fatal" }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const result = ClientEventSchema.safeParse(baseEvent({ name: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 120 chars", () => {
    const result = ClientEventSchema.safeParse({
      ...baseEvent(),
      name: "a".repeat(121),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name with spaces / free-form prose", () => {
    const result = ClientEventSchema.safeParse(
      baseEvent({ name: "刷新失败 提示" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an invalid occurredAt datetime", () => {
    const result = ClientEventSchema.safeParse(
      baseEvent({ occurredAt: "not-a-date" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects metadata nested deeper than the limit", () => {
    // Build an obviously-over-limit chain (8 levels of nesting).
    let nested: unknown = { leaf: true };
    for (let i = 0; i < 8; i++) {
      nested = { nested };
    }
    const result = ClientEventSchema.safeParse(baseEvent({ metadata: nested }));
    expect(result.success).toBe(false);
  });

  it("accepts shallow metadata well within the limit", () => {
    // 3 levels of nesting — comfortably below the depth cap.
    const nested = { a: { b: { c: 1 } } };
    const result = ClientEventSchema.safeParse(baseEvent({ metadata: nested }));
    expect(result.success).toBe(true);
  });

  it("rejects metadata whose serialized size exceeds the limit", () => {
    const big = "x".repeat(CLIENT_EVENT_METADATA_MAX_BYTES + 100);
    const result = ClientEventSchema.safeParse(
      baseEvent({ metadata: { blob: big } }),
    );
    expect(result.success).toBe(false);
  });

  it("measures payload in UTF-8 BYTES, not characters (multi-byte safety)", () => {
    // Each "🚀" is 1 UTF-16 code unit (char) but 4 UTF-8 bytes. A payload that
    // is under the limit by char count but over it by byte count must be rejected.
    // Craft a serialized JSON whose char length is < MAX but byte length > MAX.
    const chars = Math.floor(CLIENT_EVENT_METADATA_MAX_BYTES / 2); // half by char count
    const emojiBlob = "🚀".repeat(chars); // ~2x MAX in bytes
    // Sanity: by characters this is at/under the limit...
    expect(emojiBlob.length).toBeLessThanOrEqual(
      CLIENT_EVENT_METADATA_MAX_BYTES,
    );
    // ...but by bytes it overflows.
    expect(utf8ByteLength(emojiBlob)).toBeGreaterThan(
      CLIENT_EVENT_METADATA_MAX_BYTES,
    );
    const result = ClientEventSchema.safeParse(
      baseEvent({ metadata: { blob: emojiBlob } }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts an event with empty-string name boundaries already covered; name regex is case-insensitive", () => {
    // Documents the deliberate /i behavior (H1): mixed-case names are accepted.
    const result = ClientEventSchema.safeParse(
      baseEvent({ name: "SystemDiagnostics.Refreshed" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("ClientEventBatchSchema", () => {
  it("accepts a valid batch within the size limit", () => {
    const events = Array.from({ length: 5 }, () => baseEvent());
    const result = ClientEventBatchSchema.safeParse({ events });
    expect(result.success).toBe(true);
  });

  it("accepts an empty batch", () => {
    const result = ClientEventBatchSchema.safeParse({ events: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a batch exceeding the max size", () => {
    const events = Array.from({ length: CLIENT_EVENT_BATCH_MAX_SIZE + 1 }, () =>
      baseEvent(),
    );
    const result = ClientEventBatchSchema.safeParse({ events });
    expect(result.success).toBe(false);
  });

  it("rejects a batch containing one invalid event", () => {
    const result = ClientEventBatchSchema.safeParse({
      events: [baseEvent(), baseEvent({ level: "bogus" })],
    });
    expect(result.success).toBe(false);
  });
});

describe("utf8ByteLength", () => {
  it("counts ASCII as 1 byte per char", () => {
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("")).toBe(0);
  });

  it("counts 2-byte UTF-8 (Latin extended)", () => {
    // 'é' is U+00E9 -> 2 bytes in UTF-8.
    expect(utf8ByteLength("ééé")).toBe(6);
  });

  it("counts 3-byte UTF-8 (CJK)", () => {
    // '中' is U+4E2D -> 3 bytes in UTF-8.
    expect(utf8ByteLength("中文")).toBe(6);
  });

  it("counts 4-byte UTF-8 (astral plane / emoji)", () => {
    // '🚀' is U+1F680 -> 4 bytes in UTF-8 (2 UTF-16 code units).
    expect(utf8ByteLength("🚀")).toBe(4);
    expect(utf8ByteLength("🚀🚀")).toBe(8);
  });

  it("handles mixed ASCII / 2-byte / 3-byte / 4-byte content consistently", () => {
    // "a中é🚀" = 1 (a) + 3 (中) + 2 (é) + 4 (🚀) = 10 bytes.
    expect(utf8ByteLength("a中é🚀")).toBe(10);
  });
});
