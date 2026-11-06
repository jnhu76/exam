import type { ClientEvent } from "@exam/contracts";
import { postClientEvents, type ClientEventPostResult } from "./clientEvents";

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

/**
 * Upper bound on retained rejected-event diagnostics. Only the most recent
 * entries are kept; the running total is kept separately, so the bound is a
 * memory bound, not a loss of the count.
 */
const REJECTED_DIAGNOSTICS_MAX = 50;

/**
 * Local diagnostic for one determinately rejected event (#874 PR-W): the
 * stable identifier and the server-named failing fields ONLY. Never the
 * payload — rejection is a visible-loss semantic, not a persistence channel.
 */
export interface RejectedEventDiagnostic {
  /** Stable identifier: the event's eventId when present, else its name. */
  identifier: string;
  /** Server-reported failing field paths relative to the event. */
  fields: string[];
}

export interface ClientEventBufferOptions {
  /** Override the transport (defaults to {@link postClientEvents}). */
  send?: (events: ClientEvent[]) => Promise<ClientEventPostResult>;
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
 *   returns a classified {@link ClientEventPostResult}).
 * - It classifies each flush outcome: events the server CONFIRMED accepted
 *   are gone; events the server determinately rejected via the standard 400
 *   envelope are removed (poison isolation, #874) and recorded as payload-free
 *   diagnostics; everything unconfirmed is RE-ENQUEUED (front of the queue)
 *   so the next (post-backoff) flush retries it, rather than dropping data.
 *   The requeue is bounded by {@link MAX_BUFFER_SIZE} — if the queue is full,
 *   the oldest events are dropped to make room, so memory stays capped even
 *   under sustained failure.
 * - It flushes on a timer and on `visibilitychange` / `pagehide`.
 * - It uses exponential backoff (base → 2x … up to a cap) across consecutive
 *   failures, so prolonged outages do not cause a tight retry loop. A flush
 *   that leaves nothing pending (all acknowledged, or acknowledged plus
 *   determinate rejections) resets the backoff: the channel answered.
 *
 * The class is environment-agnostic: DOM listeners are only attached when
 * `window` is available, so it can be instantiated and exercised under jsdom
 * or in tests with no DOM.
 */
export class ClientEventBuffer {
  private queue: ClientEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly send: (
    events: ClientEvent[],
  ) => Promise<ClientEventPostResult>;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private readonly failureBackoffBaseMs: number;
  private flushing = false;
  /** Wall-clock time before which a flush should be skipped (backoff). */
  private flushBlockedUntil = 0;
  /** Number of consecutive failures; drives exponential backoff. */
  private consecutiveFailures = 0;
  /** Most recent rejected-event diagnostics (bounded, oldest dropped). */
  private rejectedDiagnostics: RejectedEventDiagnostic[] = [];
  /** Total determinately rejected events over the buffer's lifetime. */
  private rejectedEventTotal = 0;
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
   * events the server CONFIRMED accepted — determinately rejected events are
   * never counted (#874 PR-W). Never rejects.
   *
   * `bypassBackoff` is for the page-unload path only: a candidate closing the
   * tab inside a backoff window would otherwise silently drop the whole
   * in-memory batch (#800). It does not change the regular retry-backoff
   * semantics — timer and visibility flushes still honor
   * {@link flushBlockedUntil}.
   */
  async flush(options: { bypassBackoff?: boolean } = {}): Promise<number> {
    if (this.flushing) return 0;
    if (!options.bypassBackoff && Date.now() < this.flushBlockedUntil) return 0;
    if (this.queue.length === 0) return 0;

    const batch = this.queue.splice(0, this.batchSize);
    this.flushing = true;
    let result: ClientEventPostResult;
    try {
      result = await this.send(batch);
    } catch {
      // Transport contract is non-throwing, but defend against any override:
      // an exception carries no classification, so nothing is resolved.
      result = { acknowledgedCount: 0, rejected: [] };
    } finally {
      this.flushing = false;
    }

    // acknowledgedCount covers a contiguous prefix of the batch (transport
    // contract); clamp so the index arithmetic below stays in range even for
    // a non-conforming override.
    const acknowledged = Math.min(
      Math.max(result.acknowledgedCount, 0),
      batch.length,
    );
    const rejectedFields = new Map<number, string[]>();
    for (const rejection of result.rejected) {
      // A rejection of an already-acknowledged event cannot happen on the
      // wire (ACKed sub-batches returned 200); trust the stronger signal.
      if (
        Number.isInteger(rejection.index) &&
        rejection.index >= acknowledged &&
        rejection.index < batch.length
      ) {
        rejectedFields.set(rejection.index, rejection.fields);
      }
    }

    // Diagnostics: stable identifier + fields + running count. Never the
    // payload, and never re-reported through this same telemetry buffer.
    for (const [index, fields] of rejectedFields) {
      const event = batch[index]!;
      this.rejectedDiagnostics.push({
        identifier: event.eventId ?? event.name,
        fields,
      });
    }
    this.rejectedEventTotal += rejectedFields.size;
    if (this.rejectedDiagnostics.length > REJECTED_DIAGNOSTICS_MAX) {
      this.rejectedDiagnostics.splice(
        0,
        this.rejectedDiagnostics.length - REJECTED_DIAGNOSTICS_MAX,
      );
    }

    // Poison isolation (#874): drop confirmed and determinately rejected
    // events; keep only the unconfirmed remainder, in order, for retry.
    const pending = batch.filter(
      (_, index) => index >= acknowledged && !rejectedFields.has(index),
    );

    if (pending.length === 0) {
      // Every event resolved: acknowledged, or determinately rejected. The
      // server answered definitively, so there is no backoff debt.
      this.consecutiveFailures = 0;
      this.flushBlockedUntil = 0;
      // If more events accumulated during the flush, keep draining.
      if (this.queue.length > 0) {
        void this.flush();
      }
      return acknowledged;
    }

    // Unconfirmed events remain: requeue ONLY them for retry after backoff.
    // Confirmed events never re-enter the queue; a determinate rejection
    // already removed at least one poison event from the batch, so each
    // processing pass strictly shrinks the poison set (no instant retry loop).
    this.consecutiveFailures += 1;
    const backoff = this.computeBackoff();
    this.flushBlockedUntil = Date.now() + backoff;
    this.queue.unshift(...pending);
    this.enforceMaxSize();
    return acknowledged;
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

  /**
   * Determinately rejected events (bounded to the most recent); visible-loss
   * diagnostics (#874 PR-W). Payload-free by construction.
   */
  getRejectedDiagnostics(): readonly RejectedEventDiagnostic[] {
    return this.rejectedDiagnostics;
  }

  /** Total number of determinately rejected events over this buffer's lifetime. */
  get rejectedEventCount(): number {
    return this.rejectedEventTotal;
  }

  /** Current computed backoff window in ms (testing only). */
  currentBackoffForTest(): number {
    const remaining = this.flushBlockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * The backoff that WOULD apply given the current consecutive-failure count
   * (testing only). Pure function of {@link consecutiveFailures} — does NOT
   * depend on {@link Date.now}, so it is stable across wall-clock drift.
   * Prefer this over {@link currentBackoffForTest} when asserting the backoff
   * schedule: `currentBackoffForTest` returns a remaining-time value that
   * shrinks as real time elapses between flush() and the assertion, which
   * flakes as `expected 9 >= 10` under CI coverage instrumentation.
   */
  computeBackoffForTest(): number {
    return this.computeBackoff();
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
      // Unload is the last chance to persist the in-memory queue: send even
      // inside a backoff window. Failure just loses the batch — never blocks
      // the unload.
      void this.flush({ bypassBackoff: true });
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
