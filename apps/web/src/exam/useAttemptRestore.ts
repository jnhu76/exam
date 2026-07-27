import { useCallback, useEffect, useRef, useState } from "react";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { api } from "@/lib/api";
import { trackExamEvent } from "@/lib/examTelemetry";

/**
 * REC-I3 — Disrupted-attempt direct restore UX (ADR-012 §Recovery Semantics).
 *
 * The frontend recovery flow frozen by ADR-012:
 *
 *   1. GET authoritative CandidateTakeSnapshot
 *   2. IF canResume === true → POST explicit restore command exactly once
 *   3. GET authoritative CandidateTakeSnapshot AGAIN — the restore response is
 *      only a command acknowledgement, NOT the page authority
 *
 * Capability fields — NOT raw status — govern the action. The page must not
 * infer restore legality from `attemptStatus === "disrupted"` alone; it must
 * read `snapshot.canResume`.
 *
 * Race-safety model (revised after the PR #219 review):
 * - A **monotonic generation token** + **`currentAttemptIdRef`** isolate
 *   asynchronous generations. The old shared-boolean `cancelledRef` could be
 *   reset by a new effect setup before a stale async chain resumed; a token
 *   cannot.
 * - After the POST restore — whether it succeeded, returned 409 (e.g. the
 *   server's own deadline reconciliation already submitted the attempt), or
 *   the response was lost — the hook ALWAYS re-reads the authoritative
 *   snapshot. The POST ack is never trusted as the page state.
 * - `fetchSnapshot` is required to THROW on failure (the page's catch-all
 *   `loadSnapshot` wrapper that swallows+sets `loadError` is NOT acceptable
 *   here); a reload failure must surface as a real restore failure.
 *
 * This hook owns ONLY the restore UI state. `CandidateTakeSnapshot` remains
 * the page authority, applied through `applySnapshot`.
 */

/** Restore UI state — narrow, separate from save/submit UI state. */
export type RestoreState = "idle" | "restoring" | "failed";

/**
 * Classified outcome of a restore attempt. Internal — used only to pick the
 * correct telemetry event and to decide whether the authoritative snapshot
 * was applied.
 */
type RestoreOutcome =
  | { kind: "restored"; snapshot: CandidateTakeSnapshot }
  | { kind: "terminal"; snapshot: CandidateTakeSnapshot }
  | { kind: "still_resumable"; snapshot: CandidateTakeSnapshot }
  | { kind: "unavailable"; errorCode: string };

export interface UseAttemptRestoreOptions {
  attemptId: string | undefined;
  examId: string | undefined;
  /** True iff the authoritative snapshot says the attempt may be resumed. */
  canResume: boolean;
  /**
   * Fetches the authoritative CandidateTakeSnapshot for an attempt id.
   * MUST throw on failure — this hook does not tolerate a wrapper that
   * swallows errors and resolves to undefined. The page's general-purpose
   * loader (which sets `loadError` on failure) is a separate code path.
   */
  fetchSnapshot: (attemptId: string) => Promise<CandidateTakeSnapshot>;
  /**
   * Applies a reloaded authoritative snapshot to page state. Called only when
   * the snapshot is for the attempt this hook is still bound to (generation +
   * identity check). The caller MUST trust whatever lifecycle state the
   * snapshot reports — including a terminal/deadline-locked one.
   */
  applySnapshot: (snapshot: CandidateTakeSnapshot) => void;
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
  fetchSnapshot,
  applySnapshot,
}: UseAttemptRestoreOptions) {
  const [restoreState, setRestoreState] = useState<RestoreState>("idle");

  // Monotonic generation token. Bumped ONLY on a real attemptId change
  // (render-time prev-value check below) — not on StrictMode re-mount of the
  // same attempt, which would falsely cancel a legitimate in-flight restore.
  const generationRef = useRef(0);
  // Latest attemptId this hook is bound to. Compared at async-resolution time
  // so a stale POST/GET chain from a previous route cannot mutate state.
  const currentAttemptIdRef = useRef<string | undefined>(attemptId);
  // In-flight promise ref — the synchronous guard against duplicate concurrent
  // requests from Strict Mode effect re-execution, snapshot updates, or a
  // user double-clicking retry.
  const restoreInFlightRef = useRef(false);
  // Identity of the attempt for which auto-restore has already fired, so a
  // snapshot update (e.g. a successful reload) does not re-trigger restore for
  // the same attempt.
  const restoredForAttemptRef = useRef<string | undefined>(undefined);

  // Bump the generation on a genuine attemptId change. Done at render time
  // (not in an effect) so the new generation is visible to any effect that
  // fires for the new attempt in the same commit. The previous attempt's
  // in-flight work captures its own generation value and will see the bump.
  const prevAttemptIdRef = useRef<string | undefined>(attemptId);
  if (prevAttemptIdRef.current !== attemptId) {
    prevAttemptIdRef.current = attemptId;
    currentAttemptIdRef.current = attemptId;
    generationRef.current += 1;
    // A new attempt must be allowed to auto-restore even if the previous
    // attempt's restore fired; clear the dedup identity on route change.
    restoredForAttemptRef.current = undefined;
    // Reset the restore UI state so a leftover restoring/failed surface from
    // the PREVIOUS attempt does not leak onto the new route. The new attempt's
    // authoritative snapshot + auto-restore effect drive the correct UI.
    setRestoreState("idle");
    // Do NOT reset restoreInFlightRef here — the previous attempt's POST may
    // still be settling; it checks generation/identity before touching state.
    // The new attempt's performRestore will set it when it starts.
  }

  /**
   * True iff the calling async generation is still the current one AND the
   * route attemptId has not changed since the restore started.
   */
  const isStale = useCallback(
    (generation: number, restoringAttemptId: string) =>
      generation !== generationRef.current ||
      currentAttemptIdRef.current !== restoringAttemptId,
    [],
  );

  /**
   * Runs the explicit POST restore command and re-reads the authoritative
   * snapshot. The POST response is treated only as a command acknowledgement;
   * the reloaded snapshot — NOT the POST result — drives UI state. Never
   * throws to the caller — failures are surfaced via `restoreState === "failed"`.
   */
  const performRestore = useCallback(
    async (opts?: { isRetry?: boolean }): Promise<void> => {
      if (!attemptId) {
        return;
      }
      // Synchronous deduplication guard — at most one concurrent restore per
      // mounted attempt. A `disabled` flag alone is not a sufficient guard
      // (ADR-012 §11).
      if (restoreInFlightRef.current) {
        return;
      }

      const generation = generationRef.current;
      const restoringAttemptId = attemptId;
      restoreInFlightRef.current = true;
      setRestoreState("restoring");

      const startedAt = Date.now();
      trackExamEvent(
        "restore_started",
        { attempt: opts?.isRetry ? "retry" : "initial" },
        { attemptId, examId },
      );

      // POST /api/attempts/:attemptId/restore is a command acknowledgement.
      // Per ADR-012, the restore response is NOT the canonical take-page
      // state — the reloaded snapshot is. We swallow ANY post error and let
      // the authoritative GET decide: a 409 may mean the server already
      // reconciled (deadline won); a network failure may mean the response
      // was lost even though the server restored successfully.
      let postErrorCode: string | undefined;
      try {
        await api.post(`/api/attempts/${restoringAttemptId}/restore`);
      } catch (err) {
        if (isStale(generation, restoringAttemptId)) {
          restoreInFlightRef.current = false;
          return;
        }
        postErrorCode =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : err instanceof Error && err.message
              ? "NETWORK"
              : "UNKNOWN";
      }

      // Always re-read the authoritative snapshot — the POST ack is never the
      // page authority, and a POST failure may be ambiguous (deadline won,
      // response lost). `fetchSnapshot` MUST throw on failure.
      let outcome: RestoreOutcome;
      try {
        const snapshot = await fetchSnapshot(restoringAttemptId);
        if (isStale(generation, restoringAttemptId)) {
          restoreInFlightRef.current = false;
          return;
        }
        if (snapshot.attemptId !== restoringAttemptId) {
          // Defensive: the GET returned a snapshot for a different attempt
          // (should not happen with a correct backend). Treat as stale.
          restoreInFlightRef.current = false;
          return;
        }
        if (snapshot.isEditable) {
          outcome = { kind: "restored", snapshot };
        } else if (!snapshot.canResume) {
          // Terminal: deadline won during restore, or already submitted. The
          // terminal snapshot is the correct outcome — not a failure.
          outcome = { kind: "terminal", snapshot };
        } else {
          // Still resumable + non-editable: the restore did not take effect.
          // Keep the existing disrupted snapshot; surface a recovery failure.
          outcome = { kind: "still_resumable", snapshot };
        }
      } catch {
        if (isStale(generation, restoringAttemptId)) {
          restoreInFlightRef.current = false;
          return;
        }
        outcome = {
          kind: "unavailable",
          errorCode: postErrorCode ?? "RELOAD_FAILED",
        };
      }

      // Final stale check before mutating page state.
      if (isStale(generation, restoringAttemptId)) {
        restoreInFlightRef.current = false;
        return;
      }

      const durationMs = Date.now() - startedAt;
      switch (outcome.kind) {
        case "restored":
          applySnapshot(outcome.snapshot);
          trackExamEvent(
            "restore_succeeded",
            { durationMs },
            { attemptId, examId },
          );
          setRestoreState("idle");
          break;
        case "terminal":
          // Terminal snapshot wins. The recovery completed correctly — the
          // server-side deadline reconciliation / submit is the authoritative
          // outcome. Apply the terminal snapshot and clear restore UI.
          applySnapshot(outcome.snapshot);
          trackExamEvent(
            "restore_succeeded",
            { durationMs, outcome: "terminal" },
            { attemptId, examId },
          );
          setRestoreState("idle");
          break;
        case "still_resumable":
          // Restore did not take effect — keep the existing disrupted snapshot
          // (do NOT apply the still-disrupted one; it is identical anyway) and
          // surface a recovery failure so the candidate can retry.
          trackExamEvent(
            "restore_failed",
            {
              durationMs,
              errorCode: postErrorCode ?? "STILL_RESUMABLE",
              attempt: opts?.isRetry ? "retry" : "initial",
            },
            { attemptId, examId, level: "warn" },
          );
          setRestoreState("failed");
          break;
        case "unavailable":
          trackExamEvent(
            "restore_failed",
            {
              durationMs,
              errorCode: outcome.errorCode,
              attempt: opts?.isRetry ? "retry" : "initial",
            },
            { attemptId, examId, level: "warn" },
          );
          setRestoreState("failed");
          break;
      }
      restoreInFlightRef.current = false;
    },
    [attemptId, examId, fetchSnapshot, applySnapshot, isStale],
  );

  /**
   * Auto-initializes restore when the authoritative snapshot reports the
   * attempt as resumable. Fires at most once per attempt identity.
   */
  useEffect(() => {
    if (!attemptId || !canResume) {
      // Nothing to restore — leave the page to initialize normally.
      return;
    }
    // Only the FIRST authoritative snapshot for this attempt drives the
    // auto-restore. A genuine retry is an explicit user action.
    if (restoredForAttemptRef.current === attemptId) {
      return;
    }
    restoredForAttemptRef.current = attemptId;
    // Fire-and-forget: the hook surfaces success/failure via restoreState.
    void performRestore();
    // NOTE: no cleanup function. The previous implementation's `cancelledRef`
    // cleanup was a shared boolean that the next effect setup reset to false,
    // leaking stale async into the new route. The generation token +
    // currentAttemptIdRef checks inside performRestore are the correct,
    // race-free cancellation mechanism (and they survive StrictMode's
    // setup→cleanup→setup replay because the token is only bumped on a real
    // attemptId change, not on remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, canResume]);

  /** User-triggered retry after a genuine failure. */
  const retryRestore = useCallback(async () => {
    void performRestore({ isRetry: true });
  }, [performRestore]);

  return { restoreState, retryRestore };
}
