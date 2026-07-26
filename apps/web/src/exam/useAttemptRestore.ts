import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { trackExamEvent } from "@/lib/examTelemetry";

/**
 * REC-I3 — Disrupted-attempt direct restore UX (ADR-012 §Recovery Semantics).
 *
 * The frontend recovery flow frozen by ADR-012:
 *
 *   1. GET authoritative CandidateTakeSnapshot
 *   2. IF canResume === true → POST explicit restore command exactly once
 *   3. reload CandidateTakeSnapshot (the restore response is only a command
 *      acknowledgement, NOT the page authority)
 *
 * Capability fields — NOT raw status — govern the action. The page must not
 * infer restore legality from `attemptStatus === "disrupted"` alone; it must
 * read `snapshot.canResume`.
 *
 * This hook owns ONLY the restore UI state. It is intentionally NOT a second
 * source of attempt business truth: the authoritative snapshot stays the page
 * authority. `CandidateTakeSnapshot` is the business truth source, and the
 * page reloads it after every restore attempt.
 */

/** Restore UI state — narrow, separate from save/submit UI state. */
export type RestoreState = "idle" | "restoring" | "failed";

/** Result of a single restore attempt for the caller to act on. */
export interface RestoreAttemptResult {
  /** Whether the POST restore network request itself succeeded (2xx). */
  ok: boolean;
  /**
   * Whether the caller should reload the authoritative snapshot. Always true
   * after a successful restore, regardless of what lifecycle state the server
   * ultimately produced (the reload — not the restore response — is the
   * authority; the server may itself report a terminal snapshot because
   * deadline reconciliation ran first).
   */
  shouldReload: boolean;
  /** Stable error code for telemetry when the POST failed. */
  errorCode?: string;
}

export interface UseAttemptRestoreOptions {
  attemptId: string | undefined;
  examId: string | undefined;
  /** True iff the authoritative snapshot says the attempt may be resumed. */
  canResume: boolean;
  /**
   * Reloads the authoritative CandidateTakeSnapshot. Called exactly once per
   * successful restore attempt. The caller MUST honor the reloaded snapshot,
   * even if it reports a terminal/deadline-locked state (deadline may have
   * won between GET and POST restore).
   */
  reloadSnapshot: () => Promise<void>;
}

/**
 * Returns the current restore UI state plus a user-triggered retry entry
 * point. Auto-restore is fired by this hook exactly once per attempt per
 * genuine initialization; a network failure surfaces a `failed` state and
 * a `retryRestore` callback for an explicit second attempt.
 */
export function useAttemptRestore({
  attemptId,
  examId,
  canResume,
  reloadSnapshot,
}: UseAttemptRestoreOptions) {
  const [restoreState, setRestoreState] = useState<RestoreState>("idle");

  // Identity of the attempt currently being restored, so we never re-fire
  // restore for a snapshot update on the same attempt and so route changes
  // reset the guards.
  const restoreAttemptIdRef = useRef<string | undefined>(attemptId);
  // In-flight promise ref — the synchronous guard against duplicate
  // concurrent requests from Strict Mode effect re-execution, snapshot
  // updates, or translation re-renders.
  const restoreInFlightRef = useRef(false);
  // Boolean cleanup flag — guards stale async work after route change or
  // unmount. Proven by Context7 for React 19 effect patterns.
  const cancelledRef = useRef(false);

  /**
   * Fires the explicit POST restore command and reloads the authoritative
   * snapshot. Returns a structured result so callers can react without
   * re-deriving UI state. Never throws to the caller — failures are surfaced
   * via `restoreState === "failed"`.
   */
  const performRestore = useCallback(
    async (opts?: { isRetry?: boolean }): Promise<RestoreAttemptResult> => {
      if (!attemptId) {
        return { ok: false, shouldReload: false, errorCode: "NO_ATTEMPT_ID" };
      }
      // Synchronous deduplication guard — fires at most one concurrent
      // restore per mounted attempt. A `disabled` flag alone is not a
      // sufficient guard (ADR-012 §11).
      if (restoreInFlightRef.current) {
        return { ok: false, shouldReload: false, errorCode: "IN_FLIGHT" };
      }

      restoreInFlightRef.current = true;
      restoreAttemptIdRef.current = attemptId;
      // The hook transitions to "restoring" for both initial and retry paths;
      // telemetry metadata distinguishes the two.
      setRestoreState("restoring");

      const startedAt = Date.now();
      trackExamEvent(
        "restore_started",
        { attempt: opts?.isRetry ? "retry" : "initial" },
        { attemptId, examId },
      );

      let result: RestoreAttemptResult;
      try {
        // POST /api/attempts/:attemptId/restore is a command
        // acknowledgement. Per ADR-012, the restore response is NOT the
        // canonical take-page state — the reloaded snapshot is.
        await api.post(`/api/attempts/${attemptId}/restore`);
        if (cancelledRef.current) {
          // Route changed or unmounted while in flight — discard.
          restoreInFlightRef.current = false;
          return { ok: true, shouldReload: false };
        }
        trackExamEvent(
          "restore_succeeded",
          { durationMs: Date.now() - startedAt },
          { attemptId, examId },
        );
        result = { ok: true, shouldReload: true };
      } catch (err) {
        if (cancelledRef.current) {
          restoreInFlightRef.current = false;
          return { ok: false, shouldReload: false };
        }
        const errorCode =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "NETWORK";
        trackExamEvent(
          "restore_failed",
          {
            durationMs: Date.now() - startedAt,
            errorCode,
            attempt: opts?.isRetry ? "retry" : "initial",
          },
          { attemptId, examId, level: "warn" },
        );
        // Restore failure must NOT be represented as a save failure. The
        // authoritative disrupted snapshot is retained (caller owns it) and
        // a dedicated failure state is surfaced.
        setRestoreState("failed");
        restoreInFlightRef.current = false;
        return { ok: false, shouldReload: false, errorCode };
      }

      // Reload the authoritative snapshot. The reload is allowed to fail
      // (uncertain state); the page must not invent in_progress from the
      // restore response alone.
      try {
        await reloadSnapshot();
      } catch {
        // Reload failure is an uncertain state. Surface a reload/retry path
        // rather than assuming in_progress from the restore acknowledgement.
        // The caller retains the last authoritative (disrupted) snapshot
        // and is expected to render its existing locked/non-editable state;
        // the loadError path is owned by the caller's snapshot loader.
        setRestoreState("failed");
        restoreInFlightRef.current = false;
        return { ok: true, shouldReload: false, errorCode: "RELOAD_FAILED" };
      }

      if (cancelledRef.current) {
        restoreInFlightRef.current = false;
        return result;
      }
      // Success: clear the restore UI state so the reloaded snapshot renders
      // normally. The reloaded snapshot — whether editable in_progress or a
      // terminal/deadline-locked state (deadline may have won during
      // restore) — is the page authority and renders through the existing
      // derived view. The restoring/failed UI overlays MUST NOT persist.
      setRestoreState("idle");
      restoreInFlightRef.current = false;
      return result;
    },
    [attemptId, examId, reloadSnapshot],
  );

  /**
   * Auto-initializes restore when the authoritative snapshot reports the
   * attempt as resumable. Fires at most once per attempt identity.
   */
  useEffect(() => {
    cancelledRef.current = false;
    if (!attemptId || !canResume) {
      // Nothing to restore — leave the page to initialize normally.
      return;
    }
    // Only the FIRST authoritative snapshot for this attempt drives the
    // auto-restore. Subsequent snapshot updates (e.g. from a successful
    // reload) must not re-fire restore for the same attempt.
    if (
      restoreAttemptIdRef.current === attemptId &&
      restoreInFlightRef.current
    ) {
      return;
    }
    restoreAttemptIdRef.current = attemptId;

    // Fire-and-forget: the hook surfaces success/failure via restoreState.
    void performRestore();

    return () => {
      // Strict Mode: mark this render's async work as cancelled. The next
      // setup will start fresh; the in-flight guard prevents duplicates.
      cancelledRef.current = true;
    };
    // We intentionally depend on attemptId + canResume only — performRestore
    // is stable per (attemptId, examId, reloadSnapshot) and would re-fire
    // restore if added to deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, canResume]);

  /**
   * Resets restore guards when attemptId changes so the new attempt
   * initializes independently. Stale async results from the old attempt
   * cannot overwrite the new page.
   */
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      restoreInFlightRef.current = false;
    };
  }, [attemptId]);

  /** User-triggered retry after a genuine failure. */
  const retryRestore = useCallback(async () => {
    // Reset the attempt-identity guard so a genuine retry is allowed even
    // if the prior attempt set it.
    void performRestore({ isRetry: true });
  }, [performRestore]);

  return { restoreState, retryRestore };
}
