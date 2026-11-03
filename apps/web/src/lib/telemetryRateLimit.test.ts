import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelemetryRateLimiter } from "./telemetryRateLimit";

describe("createTelemetryRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to maxPerWindow then blocks the key", () => {
    const limiter = createTelemetryRateLimiter({
      maxPerWindow: 3,
      windowMs: 1_000,
    });
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
    // Other keys are unaffected by one key's exhausted window.
    expect(limiter.allow("other")).toBe(true);
  });

  it("restores the key after the window elapses", () => {
    vi.useFakeTimers();
    const limiter = createTelemetryRateLimiter({
      maxPerWindow: 1,
      windowMs: 1_000,
    });
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(limiter.allow("k")).toBe(true);
  });

  it("reset forgets all windows", () => {
    const limiter = createTelemetryRateLimiter({ maxPerWindow: 1 });
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
    limiter.reset();
    expect(limiter.allow("k")).toBe(true);
  });
});
