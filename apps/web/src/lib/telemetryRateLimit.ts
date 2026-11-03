/**
 * Simple fixed-window rate limiter for high-frequency telemetry sources
 * (global error capture, transport-level network failures). A storm of
 * same-category failures must stay a bounded number of persisted rows, not
 * one row per occurrence.
 *
 * A fixed window (not sliding / token bucket) is intentional: keys are small
 * bounded sets (error categories, route patterns), so per-key memory is tiny
 * and the allow/block decision needs no bookkeeping beyond one entry per key.
 */

/** Default cap: 5 reports per key per 60s fixed window. */
const DEFAULT_MAX_PER_WINDOW = 5;
/** Default fixed window length in ms. */
const DEFAULT_WINDOW_MS = 60_000;

export interface TelemetryRateLimiterOptions {
  /** Reports allowed per key within one window. */
  maxPerWindow?: number;
  /** Window length in ms. */
  windowMs?: number;
}

export interface TelemetryRateLimiter {
  /**
   * Returns whether `key` may report at this time. The first call in a fresh
   * window consumes one slot.
   */
  allow(key: string): boolean;
  /** Forgets all windows (testing). */
  reset(): void;
}

export function createTelemetryRateLimiter(
  options: TelemetryRateLimiterOptions = {},
): TelemetryRateLimiter {
  const maxPerWindow = options.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const windows = new Map<string, { windowStart: number; count: number }>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      const entry = windows.get(key);
      if (entry === undefined || now - entry.windowStart >= windowMs) {
        windows.set(key, { windowStart: now, count: 1 });
        return true;
      }
      if (entry.count >= maxPerWindow) {
        return false;
      }
      entry.count += 1;
      return true;
    },
    reset(): void {
      windows.clear();
    },
  };
}
