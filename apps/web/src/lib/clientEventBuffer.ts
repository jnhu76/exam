import type { ClientEvent } from "@exam/contracts";
import { postClientEvents } from "./clientEvents";

/** Maximum events buffered before a forced flush. */
const FLUSH_BATCH_SIZE = 20;

/** Interval between automatic background flushes. */
const FLUSH_INTERVAL_MS = 5_000;

/** Maximum events retained in memory; oldest are dropped on overflow. */
const MAX_BUFFER_SIZE = 200;

/** Base backoff after a failed flush; doubles per consecutive failure. */
const FAILURE_BACKOFF_BASE_MS = 10_000;

/** Upper bound on exponential backoff (caps retry pressure). */
const FAILURE_BACKOFF_MAX_MS = 5 * 60_000; // 5 min

export interface ClientEventBufferOptions {
  /** Override the transport (defaults to {@link postClientEvents}). */
  send?: (events: ClientEvent[]) => Promise<boolean>;
  /** Override the flush batch size (testing). */
  batchSize?: number;
  /** Override the flush interval in ms; 0 disables the timer (testing). */
  flushIntervalMs?: number;
  /** Override the max buffer size (testing). */
  maxBufferSize?: number;
  /** Override the base failure backoff in ms (testing). */
  failureBackoffBaseMs?: number;
}

/**
 * In-memory buffer for client events. Pushes are synchronous and never throw;
 * flushing is best-effort and decoupled from the caller.
 *
 * The buffer guards the rest of the application from telemetry concerns:
 * - It never lets a flush failure escape (the transport is non-throwing and
 *   returns a boolean).
 * - On transient failure it RE-ENQUEUES the batch to the front of the queue so
 *   the next (post-backoff) flush retries it, rather than dropping data. This
 *   requeue is bounded by {@link MAX_BUFFER_SIZE} — if the queue is full, the
 *   oldest events are dropped to make room, so memory stays capped even under
 *   sustained failure.
 * - It flushes on a timer and on `visibilitychange` / `pagehide`.
 * - It uses exponential backoff (base → 2x … up to a cap) across consecutive
 *   failures, so prolonged outages do not cause a tight retry loop. A success
 *   resets the backoff.
 *
 * The class is environment-agnostic: DOM listeners are only attached when
 * `window` is available, so it can be instantiated and exercised under jsdom
 * or in tests with no DOM.
 */
export class ClientEventBuffer {
  private queue: ClientEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly send: (events: ClientEvent[]) => Promise<boolean>;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private readonly failureBackoffBaseMs: number;
  private flushing = false;
  /** Wall-clock time before which a flush should be skipped (backoff). */
  private flushBlockedUntil = 0;
  /** Number of consecutive failures; drives exponential backoff. */
  private consecutiveFailures = 0;
  private boundOnVisibilityChange: (() => void) | null = null;
  private boundOnPageHide: (() => void) | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(options: ClientEventBufferOptions = {}) {
    this.send = options.send ?? postClientEvents;
    this.batchSize = options.batchSize ?? FLUSH_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.maxBufferSize = options.maxBufferSize ?? MAX_BUFFER_SIZE;
    this.failureBackoffBaseMs =
      options.failureBackoffBaseMs ?? FAILURE_BACKOFF_BASE_MS;
    this.attachLifecycleListeners();
    this.startTimer();
  }

  /**
   * Adds an event to the buffer. Never throws. When the buffer reaches the
   * batch size a flush is scheduled (non-blocking).
   */
  push(event: ClientEvent): void {
    this.queue.push(event);
    this.enforceMaxSize();
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flushes the current buffer to the server. Resolves with the number of
   * events successfully sent. Never rejects.
   */
  async flush(): Promise<number> {
    if (this.flushing) return 0;
    if (Date.now() < this.flushBlockedUntil) return 0;
    if (this.queue.length === 0) return 0;

    const batch = this.queue.splice(0, this.batchSize);
    this.flushing = true;
    let ok = false;
    try {
      ok = await this.send(batch);
    } catch {
      // Transport contract is non-throwing, but defend against any override.
      ok = false;
    } finally {
      this.flushing = false;
    }

    if (ok) {
      this.consecutiveFailures = 0;
      this.flushBlockedUntil = 0;
      // If more events accumulated during the flush, keep draining.
      if (this.queue.length > 0) {
        void this.flush();
      }
      return batch.length;
    }

    // Failure: re-enqueue the batch to the front for retry after backoff. This
    // recovers transient failures (the common case) without data loss. The
    // requeue is bounded by enforceMaxSize(), which drops oldest entries, so a
    // sustained outage cannot grow memory unboundedly. Critically, we do NOT
    // log this failure into our own buffer — that would create a recursive
    // logging loop.
    this.consecutiveFailures += 1;
    const backoff = this.computeBackoff();
    this.flushBlockedUntil = Date.now() + backoff;
    this.queue.unshift(...batch);
    this.enforceMaxSize();
    return 0;
  }

  /** Stops timers and removes DOM listeners. Safe to call multiple times. */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.cleanups.length > 0) {
      const cleanup = this.cleanups.pop();
      cleanup?.();
    }
    this.boundOnVisibilityChange = null;
    this.boundOnPageHide = null;
  }

  /** Current number of buffered events (testing / diagnostics). */
  get size(): number {
    return this.queue.length;
  }

  /** Current computed backoff window in ms (testing only). */
  currentBackoffForTest(): number {
    const remaining = this.flushBlockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /** Forces the backoff window to be in the past (testing only). */
  clearBackoffForTest(): void {
    this.flushBlockedUntil = 0;
  }

  /** Exponential backoff: base * 2^(failures-1), capped at the max. */
  private computeBackoff(): number {
    const exp = this.consecutiveFailures - 1;
    const raw = this.failureBackoffBaseMs * 2 ** exp;
    return Math.min(raw, FAILURE_BACKOFF_MAX_MS);
  }

  /** Drops oldest entries until the queue is within maxBufferSize. */
  private enforceMaxSize(): void {
    if (this.queue.length > this.maxBufferSize) {
      const overflow = this.queue.length - this.maxBufferSize;
      this.queue.splice(0, overflow);
    }
  }

  private startTimer(): void {
    if (this.flushIntervalMs <= 0) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  private attachLifecycleListeners(): void {
    if (typeof window === "undefined") return;
    // On tab hide / page hide, attempt a best-effort flush before unload.
    this.boundOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void this.flush();
      }
    };
    this.boundOnPageHide = () => {
      void this.flush();
    };
    window.addEventListener("visibilitychange", this.boundOnVisibilityChange);
    window.addEventListener("pagehide", this.boundOnPageHide);
    this.cleanups.push(() => {
      if (this.boundOnVisibilityChange) {
        window.removeEventListener(
          "visibilitychange",
          this.boundOnVisibilityChange,
        );
      }
      if (this.boundOnPageHide) {
        window.removeEventListener("pagehide", this.boundOnPageHide);
      }
    });
  }
}
