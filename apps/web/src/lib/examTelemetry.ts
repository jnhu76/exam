import type { ClientEvent, ClientEventLevel } from "@exam/contracts";
import { getBuffer } from "./logger";
import { logger } from "./logger";
import { sanitizeClientEvent } from "./sanitizeClientEvent";
import { getClientSessionId } from "./clientSessionId";

/**
 * Frontend exam-attempt telemetry.
 *
 * This module is the ONLY business-facing API for recording a candidate's
 * exam-session frontend flow (page load, question browsing, saves, submits,
 * browser state, heartbeat health). It builds {@link ClientEvent} records of
 * `kind: "exam_telemetry"` and routes them through the SAME shared client-event
 * buffer used by the generic logger — it does not open a second transport.
 *
 * Why a dedicated module (and not `logger.*`): the exported `logger` API
 * cannot set `kind`, `attemptId`, `examId`, `questionId`, or
 * `clientSessionId`. Exam telemetry needs all of those, so we build the event
 * directly and push it via {@link getBuffer}.
 *
 * Safety:
 * - Metadata is always run through {@link sanitizeClientEvent}, so answer /
 *   question content, tokens, and credentials are redacted before they leave
 *   the browser.
 * - `trackExamEvent` never throws: a telemetry failure must never disturb the
 *   exam flow (save / submit / navigation).
 */

/** Options shaping where an event belongs in the exam flow. */
export interface TrackExamEventOptions {
  /** Attempt the event belongs to. */
  attemptId?: string;
  /** Exam the event belongs to. */
  examId?: string;
  /** Question the event is about (e.g. question_viewed, save events). */
  questionId?: string;
  /** Severity. `warn`/`error` are ALSO emitted via `logger.*` (dual-emit). */
  level?: ClientEventLevel;
}

/**
 * Coalescing window for high-frequency event names. The first occurrence
 * within an idle window is held; subsequent occurrences increment a counter;
 * when the window expires (no new occurrence for this long) a single event is
 * emitted carrying `coalescedCount`. This prevents the client_events table
 * from being flooded by e.g. rapid question re-views or repeated autosave
 * successes, while preserving how many times each occurred.
 */
const DEDUP_WINDOW_MS = 5_000;

/**
 * Event names that are coalesced within {@link DEDUP_WINDOW_MS}. These are the
 * high-frequency, low-information events identified during instrumentation.
 * Failures are intentionally NOT here — every failure is recorded.
 */
const THROTTLED_NAMES = new Set<string>([
  "question_viewed",
  "answer_autosave_success",
]);

/** Pending coalesced event: everything needed to emit it on window expiry. */
interface PendingCoalesced {
  name: string;
  metadata: Record<string, unknown>;
  opts: TrackExamEventOptions;
  count: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Per-key pending coalesced event. Keyed by `${name}|${questionId ?? ""}`. */
const pending = new Map<string, PendingCoalesced>();

/** Returns the current route pathname (no query string — queries may carry tokens). */
function currentRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.pathname;
}

/**
 * Emits a coalesced event now, attaching the accumulated count, then clears the
 * pending entry. Guarded so a timer firing after unmount/test teardown is safe.
 */
function flushCoalesced(key: string): void {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  entry.metadata.coalescedCount = entry.count;
  emitOne(entry.name, entry.metadata, entry.opts);
}

/**
 * Pushes one fully-formed exam_telemetry event into the shared buffer. Shared by
 * the immediate (non-coalesced) path and {@link flushCoalesced}.
 */
function emitOne(
  name: string,
  metadata: Record<string, unknown>,
  opts: TrackExamEventOptions,
): void {
  const sanitized = sanitizeClientEvent(metadata);
  const event: ClientEvent = {
    kind: "exam_telemetry",
    level: opts.level ?? "info",
    name,
    occurredAt: new Date().toISOString(),
    route: currentRoute(),
    clientSessionId: getClientSessionId(),
    ...(opts.attemptId !== undefined ? { attemptId: opts.attemptId } : {}),
    ...(opts.examId !== undefined ? { examId: opts.examId } : {}),
    ...(opts.questionId !== undefined ? { questionId: opts.questionId } : {}),
    metadata: sanitized,
  };
  try {
    getBuffer().push(event);
  } catch {
    // Telemetry must never disturb the exam flow.
  }

  // Dual-emit fail-critical events into the generic 'log' category too, so
  // they surface in both views without the caller needing two call sites.
  const level = opts.level ?? "info";
  if (level === "error") logger.error(name, sanitized);
  else if (level === "warn") logger.warn(name, sanitized);
}

/**
 * Records one exam-attempt frontend event. Never throws.
 *
 * High-frequency names (see {@link THROTTLED_NAMES}) are coalesced: repeats
 * within {@link DEDUP_WINDOW_MS} collapse into a single emitted event carrying
 * a `coalescedCount`. All other names (notably failures) are emitted on every
 * call.
 *
 * @param name - stable machine-friendly event name (snake_case).
 * @param metadata - non-sensitive context (ids, counts, durations, error
 *   codes). Sensitive keys (answer/content/token/...) are redacted.
 * @param opts - attempt/exam/question ids and severity.
 */
export function trackExamEvent(
  name: string,
  metadata: Record<string, unknown> = {},
  opts: TrackExamEventOptions = {},
): void {
  if (THROTTLED_NAMES.has(name)) {
    const key = `${name}|${opts.questionId ?? ""}`;
    const existing = pending.get(key);
    if (existing) {
      existing.count += 1;
      return; // folded into the pending coalesced event
    }
    const entry: PendingCoalesced = {
      name,
      metadata,
      opts,
      count: 1,
      timer: setTimeout(() => flushCoalesced(key), DEDUP_WINDOW_MS),
    };
    pending.set(key, entry);
    return;
  }
  emitOne(name, metadata, opts);
}

/**
 * Cleans up all pending coalesced events for a given attempt, clearing their
 * timers to prevent memory leaks. Call this when an exam session unmounts
 * (e.g. in TakeExamPage's unmount effect) so any in-flight coalesced events
 * for that attempt are discarded rather than firing their timers after the
 * page is gone.
 *
 * Note: events are NOT flushed here — they are discarded. Unmount typically
 * means the session is over and a deferred coalesced event is no longer
 * meaningful.
 */
export function clearPendingForAttempt(attemptId: string): void {
  for (const [key, entry] of pending.entries()) {
    if (entry.opts.attemptId === attemptId) {
      clearTimeout(entry.timer);
      pending.delete(key);
    }
  }
}

/** Test-only: flushes all pending coalesced events. */
export function __flushPendingForTest(): void {
  for (const key of [...pending.keys()]) flushCoalesced(key);
}

/** Test-only: discards pending coalesced events (clears timers) without emitting. */
export function __resetExamTelemetryForTest(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}
