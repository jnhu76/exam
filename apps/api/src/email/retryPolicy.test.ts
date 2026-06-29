import { describe, expect, it } from "vitest";
import { computeNextRetryAt } from "./retryPolicy.js";

describe("computeNextRetryAt (exponential backoff)", () => {
  const base = new Date("2026-01-01T00:00:00Z");

  it("first failure (attempts=1) delays by base seconds", () => {
    // base * 2**(1-1) = 60s
    expect(computeNextRetryAt(base, 1, 60)).toEqual(
      new Date("2026-01-01T00:01:00Z"),
    );
  });

  it("second failure doubles the delay", () => {
    // 60 * 2**(2-1) = 120s
    expect(computeNextRetryAt(base, 2, 60)).toEqual(
      new Date("2026-01-01T00:02:00Z"),
    );
  });

  it("third failure quadruples the delay", () => {
    // 60 * 2**(3-1) = 240s
    expect(computeNextRetryAt(base, 3, 60)).toEqual(
      new Date("2026-01-01T00:04:00Z"),
    );
  });

  it("does not mutate the input Date", () => {
    const input = new Date("2026-01-01T00:00:00Z");
    computeNextRetryAt(input, 1, 60);
    expect(input).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("respects a non-60 base", () => {
    // 30 * 2**0 = 30s
    expect(computeNextRetryAt(base, 1, 30)).toEqual(
      new Date("2026-01-01T00:00:30Z"),
    );
  });
});
