import type { ClientEvent } from "@exam/contracts";
import { postClientEvents } from "./clientEvents";

/** Maximum events buffered before a forced flush. */
const FLUSH_BATCH_SIZE = 20;

/** Interval between automatic background flushes. */
const FLUSH_INTERVAL_MS = 5_000;

/** Maximum events retained in memory; oldest are dropped on overflow. */
const MAX_BUFFER_SIZE = 200;

/** Cooldown after a failed flush before another flush is attempted. */
const FAILURE_BACKOFF_MS = 10_000;

export interface ClientEventBufferOptions {
  /** Override the transport (defaults to {@link postClientEvents}). */
  send?: (events: ClientEvent[]) => Promise<boolean>;
  /** Override the flush batch size (testing). */
  batchSize?: number;
  /** Override the flush interval in ms; 0 disables the timer (testing). */
  flushIntervalMs?: number;
  /** Override the max buffer size (testing). */
  maxBufferSize?: number;
}

/**
 * In-memory buffer for client events. Pushes are synchronous and never
 * throw; flushing is best-effort and decoupled from the caller.
 *
 * The buffer guards the rest of the application from telemetry concerns:
 * - It never lets a flush failure escape (the transport is non-throwing and
 *   returns a boolean; failures trigger backoff + drop, never a re-log).
 * - It bounds memory via {@link MAX_BUFFER_SIZE}, dropping the oldest events.
 * - It flushes on a timer and on `visibilitychange` / `pagehide`.
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
  private flushing = false;
  private lastFlushFailedAt = 0;
  private boundOnVisibilityChange: (() => void) | null = null;
  private boundOnPageHide: (() => void) | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(options: ClientEventBufferOptions = {}) {
    this.send = options.send ?? postClientEvents;
    this.batchSize = options.batchSize ?? FLUSH_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.maxBufferSize = options.maxBufferSize ?? MAX_BUFFER_SIZE;
    this.attachLifecycleListeners();
    this.startTimer();
  }

  /**
   * Adds an event to the buffer. Never throws. When the buffer reaches the
   * batch size a flush is scheduled (non-blocking).
   */
  push(event: ClientEvent): void {
    this.queue.push(event);
    if (this.queue.length > this.maxBufferSize) {
      // Drop the oldest entries to bound memory.
      const overflow = this.queue.length - this.maxBufferSize;
      this.queue.splice(0, overflow);
    }
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
    // Backoff: skip flushes shortly after a failure to avoid retry storms.
    if (
      this.lastFlushFailedAt > 0 &&
      Date.now() - this.lastFlushFailedAt < FAILURE_BACKOFF_MS
    ) {
      return 0;
    }
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
      this.lastFlushFailedAt = 0;
      // If more events accumulated during the flush, keep draining.
      if (this.queue.length > 0) {
        void this.flush();
      }
      return batch.length;
    }

    // Failure: drop the batch (do NOT re-enqueue — that risks unbounded
    // growth and, if the failure persists, a tight retry loop). Record the
    // failure time for backoff. Critically, we do not log this failure into
    // our own buffer, which would create a recursive logging loop.
    this.lastFlushFailedAt = Date.now();
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
