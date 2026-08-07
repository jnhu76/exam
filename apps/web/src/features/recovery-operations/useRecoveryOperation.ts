import { useCallback, useRef, useState } from "react";
import { createContextSafeUuid } from "@/lib/uuid";

/**
 * J5-I1C1 — generic dangerous-command controller for the Recovery Center
 * operations surfaces (attempt / incident / exam).
 *
 * One dangerous command = one frozen operationId. The hook owns the command
 * lifecycle:
 *
 *   `begin()` mints the identity when a dialog session starts (or restores a
 *   durable identity from a pending authority — see below); `run()` POSTs the
 *   command; a CONFIRMED outcome (2xx success or definitive 4xx rejection)
 *   ends the session; an INDETERMINATE failure (network / 5xx — the server
 *   may or may not have committed) retains the SAME operationId so the retry
 *   is an idempotent replay (J5-R0 §8.2: never mint a new identity for a
 *   retry of an unconfirmed dangerous command).
 *
 * Same-tab retry identity: the frozen operationId survives retries for the
 * lifetime of the dialog session; only `reset()` (confirmed outcome or dialog
 * dismissal) ends it. Reload recovery is the per-command pending authority's
 * job (`pendingForceSubmitAuthority` / `pendingMisconductAuthority`): the page
 * restores that durable identity via `begin(restoreOperationId)`, which puts
 * the hook into `indeterminate` — a durable record exists only when the
 * original outcome was never confirmed, so a restored command is by
 * definition unresolved (retry or dismiss).
 *
 * Failure classification mirrors the proctor dashboard's `classifyGrantFailure`
 * contract: status 0 / 5xx → indeterminate (unconfirmed); definitive 4xx →
 * confirmed rejection; `IDEMPOTENCY_CONFLICT` → confirmed rejection with its
 * own kind. The hook never assumes a failed request did not commit.
 */

export type RecoveryOperationFailureKind =
  | "confirmed_rejection"
  | "indeterminate"
  | "idempotency_conflict";

/**
 * Classifies a failed dangerous command. Mirrors the proctor dashboard's
 * `classifyGrantFailure`: status 0 (fetch threw) and 5xx are UNCONFIRMED —
 * the server may have committed — so the caller must retry with the SAME
 * operationId. A definitive 4xx is a confirmed rejection. Non-ApiError throws
 * are treated as unconfirmed (defensive).
 */
export function classifyOperationFailure(
  error: unknown,
): RecoveryOperationFailureKind {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    const code = (error as { code?: string }).code;
    if (code === "IDEMPOTENCY_CONFLICT") return "idempotency_conflict";
    if (status === 0 || status >= 500) return "indeterminate";
    return "confirmed_rejection";
  }
  return "indeterminate";
}

export type RecoveryOperationPhase = "idle" | "submitting" | "indeterminate";

export interface UseRecoveryOperationOptions {
  /** Executes the POST with the frozen operationId; any 2xx = confirmed. */
  submit: (operationId: string) => Promise<unknown>;
  /** Confirmed success — reload the authoritative projection. */
  onSuccess: () => void;
  /** Confirmed rejection (definitive 4xx, incl. idempotency conflict). */
  onConfirmedRejection?: (error: unknown) => void;
  /** Unconfirmed failure — the same operationId must be retried. */
  onIndeterminate?: (error: unknown) => void;
  /**
   * Fail-closed guard: returning `false` SUPPRESSES the POST entirely (e.g.
   * the pending-authority persistence failed — an identity that cannot be
   * durably persisted must not be sent, because a lost response would lose
   * it forever). The session stays active so a corrected retry reuses the
   * same identity; nothing was sent, so there is no replay risk.
   */
  beforeSubmit?: (operationId: string) => boolean;
}

export interface UseRecoveryOperationResult {
  phase: RecoveryOperationPhase;
  /** Frozen command identity; null when no session is active. */
  operationId: string | null;
  /**
   * Starts a command session (call on dialog open). Mints a fresh identity,
   * or — when `restoreOperationId` is given (a durable pending authority) —
   * restores it and enters `indeterminate`. No-op while a session is active:
   * the frozen identity must never drift mid-session.
   */
  begin: (restoreOperationId?: string) => void;
  /** Submits the frozen command (no-op without an identity / while submitting). */
  run: () => Promise<void>;
  /** Ends the session (confirmed outcome or dialog dismissal). */
  reset: () => void;
}

export function useRecoveryOperation(
  options: UseRecoveryOperationOptions,
): UseRecoveryOperationResult {
  const {
    submit,
    onSuccess,
    onConfirmedRejection,
    onIndeterminate,
    beforeSubmit,
  } = options;
  const [phase, setPhase] = useState<RecoveryOperationPhase>("idle");
  const [operationId, setOperationId] = useState<string | null>(null);

  // Refs so `begin`/`run`/`reset` stay stable while always reading the latest
  // phase/identity (the callbacks are wired once per page lifecycle).
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const idRef = useRef(operationId);
  idRef.current = operationId;

  const begin = useCallback((restoreOperationId?: string) => {
    if (phaseRef.current !== "idle") return;
    const id = restoreOperationId ?? createContextSafeUuid();
    setOperationId(id);
    setPhase(restoreOperationId ? "indeterminate" : "idle");
  }, []);

  const reset = useCallback(() => {
    setOperationId(null);
    setPhase("idle");
  }, []);

  const run = useCallback(async () => {
    const id = idRef.current;
    if (!id || phaseRef.current === "submitting") return;
    if (beforeSubmit && !beforeSubmit(id)) return;
    setPhase("submitting");
    try {
      await submit(id);
      onSuccess();
      reset();
    } catch (err) {
      const kind = classifyOperationFailure(err);
      if (kind === "indeterminate") {
        // Unconfirmed — keep the frozen identity for the idempotent retry.
        setPhase("indeterminate");
        onIndeterminate?.(err);
        return;
      }
      // Confirmed rejection — the command with this identity is dead.
      onConfirmedRejection?.(err);
      reset();
    }
  }, [
    submit,
    onSuccess,
    onConfirmedRejection,
    onIndeterminate,
    beforeSubmit,
    reset,
  ]);

  return { phase, operationId, begin, run, reset };
}
