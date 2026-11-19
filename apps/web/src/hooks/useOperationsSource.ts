import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";

/**
 * Failure classification for one operations-source read (#1032).
 *
 * - `network` / `timeout`: the source's DATA availability degraded — an
 *   existing snapshot is kept and marked stale; polling continues.
 * - `denied`: a proven 403 PERMISSION_DENIED on the CURRENT request — the
 *   source's snapshot is cleared and polling stops until the session changes
 *   or a manual refresh re-requests.
 * - `auth`: a 401 — the session is gone; the API client owns the login
 *   redirect, the page owns invalidating its snapshots.
 */
export type OperationsSourceFailureKind =
  | "network"
  | "timeout"
  | "denied"
  | "auth";

/** Render-facing state of one polled operations source. */
export interface OperationsSourceView<T> {
  /** Last committed successful snapshot; null until the first success. */
  snapshot: T | null;
  /** Epoch ms of the last successful receive; null while snapshot is null. */
  receivedAt: number | null;
  /** Classification of the CURRENT request's failure, null when healthy. */
  failure: OperationsSourceFailureKind | null;
  /** True while this source's current read is on the wire. */
  inFlight: boolean;
  /** True once the first read of this session has settled (ok or failed). */
  settled: boolean;
}

/** Deadline sentinel rejected by the page-owned request timeout. */
const REQUEST_DEADLINE = Symbol("operations-source-deadline");

function freshView<T>(): OperationsSourceView<T> {
  return {
    snapshot: null,
    receivedAt: null,
    failure: null,
    inFlight: false,
    settled: false,
  };
}

function classifyFailure(err: unknown): OperationsSourceFailureKind {
  if (err === REQUEST_DEADLINE) return "timeout";
  if (err instanceof ApiError) {
    // A proven permission denial is only ever the CURRENT request's fact —
    // superseded reads never reach this classification.
    if (err.status === 403 && err.code === "PERMISSION_DENIED") {
      return "denied";
    }
    if (err.status === 401) return "auth";
    return "network";
  }
  return "network";
}

export interface UseOperationsSourceOptions<T> {
  /** The source read; the signal must be forwarded to the transport so a
   * superseded or invalidated request is cancelled at the wire. */
  read: (signal: AbortSignal) => Promise<T>;
  /** False → the source never reads (capability gate) and stays pristine. */
  enabled?: boolean;
  /** Identity of the consumer: a change aborts in-flight reads, discards the
   * previous identity's snapshot on the first frame, and restarts polling. */
  sessionKey: string;
  /** Scheduled poll cadence. */
  pollMs: number;
  /** Per-request deadline; a hung read converges as this source's failure
   * and releases its polling slot. */
  timeoutMs: number;
  /** Log-source name for bounded poll-failure warns. */
  logSource: string;
}

/**
 * One independently-polled operations source (#1032): snapshot + receive
 * time, single-flight scheduled polling, manual superseding refresh, bounded
 * requests, and per-session read ownership.
 *
 * OWNERSHIP: only the CURRENT request of the CURRENT session may commit. A
 * superseded, invalidated, or unmounted read's success, failure, and finally
 * change nothing — its cleanup is limited to its own timer/controller.
 *
 * Scheduled ticks keep at most one read per source on the wire (a slow or
 * hung source never blocks the page's other sources, which own their own
 * hook instances); a manual refresh supersedes the in-flight read instead of
 * waiting on it.
 */
export function useOperationsSource<T>({
  read,
  enabled = true,
  sessionKey,
  pollMs,
  timeoutMs,
  logSource,
}: UseOperationsSourceOptions<T>) {
  // Mirrored per render (same pattern as useAdminTodoCount): the tick and
  // read guards read the latest values without re-arming the effects.
  const readRef = useRef(read);
  readRef.current = read;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const control = useRef({
    session: sessionKey,
    generation: 0,
    controller: null as AbortController | null,
    pollTimer: null as ReturnType<typeof setInterval> | null,
    ageTimer: null as ReturnType<typeof setInterval> | null,
    inFlight: false,
    stopped: false,
  });

  const [view, setView] = useState<OperationsSourceView<T>>(freshView);

  // Render-time session reset (the React "adjust state on prop change"
  // pattern): the first frame of a new session must not show the previous
  // identity's snapshot, and reads of the old session lose commit rights
  // immediately. Timers and transport cancellation are owned by the session
  // effect below.
  if (control.current.session !== sessionKey) {
    control.current.session = sessionKey;
    control.current.generation += 1;
    control.current.inFlight = false;
    control.current.stopped = false;
    setView(freshView());
  }

  const refresh = useCallback(() => {
    const c = control.current;
    if (!enabledRef.current) return;
    // Manual refresh intentionally proceeds while `stopped` (a denied source
    // is re-requested explicitly); success clears the stop.
    const gen = ++c.generation;
    c.controller?.abort();
    const controller = new AbortController();
    c.controller = controller;
    const session = c.session;
    c.inFlight = true;
    setView((prev) => ({ ...prev, inFlight: true }));

    let deadlineId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      // Page-owned deadline: converges the read even if the transport never
      // settles, and cancels the wire work so requests stay bounded.
      deadlineId = setTimeout(() => {
        controller.abort();
        reject(REQUEST_DEADLINE);
      }, timeoutMs);
    });

    Promise.race([readRef.current(controller.signal), deadline]).then(
      (data) => {
        clearTimeout(deadlineId);
        if (gen !== c.generation || session !== c.session) return;
        c.inFlight = false;
        c.controller = null;
        c.stopped = false;
        setView({
          snapshot: data,
          receivedAt: Date.now(),
          failure: null,
          inFlight: false,
          settled: true,
        });
      },
      (err: unknown) => {
        clearTimeout(deadlineId);
        if (gen !== c.generation || session !== c.session) return;
        const kind = classifyFailure(err);
        c.inFlight = false;
        c.controller = null;
        if (kind === "denied" || kind === "auth") {
          // Proven access loss: the snapshot and its receive time are no
          // longer presentable, and scheduled polling stops.
          c.stopped = true;
          setView({
            snapshot: null,
            receivedAt: null,
            failure: kind,
            inFlight: false,
            settled: true,
          });
        } else {
          // Data-availability failure: keep the old value and time; the
          // stale marker derives from this failure in the view layer.
          setView((prev) => ({
            ...prev,
            failure: kind,
            inFlight: false,
            settled: true,
          }));
        }
        if (kind !== "auth") {
          logger.warn("operations.poll_failed", {
            source: logSource,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
  }, [logSource, timeoutMs]);

  /** Aborts the current read, wipes the snapshot, and suspends scheduled
   * polling — used when page-level access (401/overview 403) is gone. */
  const invalidate = useCallback(() => {
    const c = control.current;
    c.generation += 1;
    c.controller?.abort();
    c.controller = null;
    c.inFlight = false;
    c.stopped = true;
    setView({
      snapshot: null,
      receivedAt: null,
      failure: null,
      inFlight: false,
      settled: true,
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const c = control.current;
    void refresh();
    c.pollTimer = setInterval(() => {
      // Single-flight per source: a tick never stacks onto an in-flight
      // read, and a stopped source (proven denial / invalidated page) stays
      // quiet until the session changes or a manual refresh re-requests.
      if (!control.current.inFlight && !control.current.stopped) {
        void refresh();
      }
    }, pollMs);
    // Freshness is age-based: the stale marker must flip when the snapshot
    // crosses its window even while the next read is still pending, so the
    // view re-renders on a 1s boundary (same pattern as the diagnostics
    // page's uptime ticker).
    c.ageTimer = setInterval(() => {
      setView((prev) => (prev.snapshot === null ? prev : { ...prev }));
    }, 1_000);
    return () => {
      // INVARIANT: cleanup invalidates commits BEFORE cancelling resources —
      // a late settlement after cleanup must be discarded, not merely
      // unrendered.
      control.current.generation += 1;
      control.current.controller?.abort();
      control.current.controller = null;
      control.current.inFlight = false;
      control.current.stopped = false;
      if (control.current.pollTimer) {
        clearInterval(control.current.pollTimer);
        control.current.pollTimer = null;
      }
      if (control.current.ageTimer) {
        clearInterval(control.current.ageTimer);
        control.current.ageTimer = null;
      }
    };
  }, [refresh, pollMs, enabled, sessionKey]);

  return { view, refresh, invalidate };
}
