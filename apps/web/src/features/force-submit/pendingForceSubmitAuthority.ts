/**
 * J5-I1C Slice 2 review P1-2 — Same-tab pending force-submit authority.
 *
 * A force-submit is an operationId-keyed durable command: a lost response
 * after the server committed must NOT cause a blind retry to mint a NEW
 * operationId, or the server treats the retry as a fresh command and applies
 * the effect twice. The fix is to freeze the command before the first POST
 * and reuse the SAME operationId + reason on every retry until a confirmed
 * outcome (success or definitive rejection) arrives.
 *
 * Scope (per the review's stated minimum): SAME-TAB persistence via
 * sessionStorage. At most ONE pending force-submit per (organizationId,
 * actorId). Cross-tab parity (the time-grant coordinator's
 * localStorage + navigator.locks + BroadcastChannel machinery) is explicitly
 * out of scope here; a second tab can still mint a new operationId, which
 * matches the reviewer's "minimum" bar.
 *
 * The record survives a refresh (sessionStorage persists across a reload
 * within the tab) and is cleared on a confirmed outcome. It is intentionally
 * minimal — no leases, no broadcast — because the single-tab invariant is
 * enough to close the lost-response duplicate-effect hole for the only
 * production caller.
 */

/** A frozen force-submit command — the exact bytes to (re)send on retry. */
export interface PendingForceSubmitCommand {
  attemptId: string;
  operationId: string;
  reason: string;
}

/** The durable authority record stored in sessionStorage. */
export interface PendingForceSubmitAuthority {
  schemaVersion: 1;
  organizationId: string;
  actorId: string;
  command: PendingForceSubmitCommand;
  createdAt: number;
}

const STORAGE_KEY_PREFIX = "exam.pendingForceSubmit";

function storageKey(organizationId: string, actorId: string): string {
  return `${STORAGE_KEY_PREFIX}:${organizationId}:${actorId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // sessionStorage can throw under restrictive contexts; treat as unavailable.
    return null;
  }
}

function isValidAuthority(
  parsed: unknown,
): parsed is PendingForceSubmitAuthority {
  if (!parsed || typeof parsed !== "object") return false;
  const a = parsed as Record<string, unknown>;
  return (
    a.schemaVersion === 1 &&
    typeof a.organizationId === "string" &&
    typeof a.actorId === "string" &&
    typeof a.createdAt === "number" &&
    a.command !== null &&
    typeof a.command === "object"
  );
}

/**
 * Loads the pending force-submit authority for (organizationId, actorId), or
 * null if none is stored (or storage is unavailable). Never throws.
 */
export function loadPendingForceSubmit(
  organizationId: string,
  actorId: string,
): PendingForceSubmitAuthority | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(organizationId, actorId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidAuthority(parsed)) {
      // Corrupt record — clear it so the next save starts clean.
      storage.removeItem(storageKey(organizationId, actorId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persists a pending force-submit command BEFORE the POST is sent (fail-closed:
 * the command is durable before any network attempt). Overwrites any prior
 * pending command for the same (organizationId, actorId) — the caller is
 * responsible for checking {@link loadPendingForceSubmit} first to detect a
 * pre-existing pending command for a DIFFERENT attempt and blocking the user.
 * Never throws.
 */
export function savePendingForceSubmit(
  authority: PendingForceSubmitAuthority,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      storageKey(authority.organizationId, authority.actorId),
      JSON.stringify(authority),
    );
  } catch {
    // If sessionStorage is full or blocked, the retry-identity guarantee
    // degrades to in-memory (the component still holds the frozen command in
    // state for the lifetime of the dialog). Do not throw — the command can
    // still be retried within the session.
  }
}

/**
 * Clears the pending force-submit authority for (organizationId, actorId).
 * Called on a confirmed outcome (success or definitive rejection). Never
 * throws.
 */
export function clearPendingForceSubmit(
  organizationId: string,
  actorId: string,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(organizationId, actorId));
  } catch {
    // best-effort
  }
}
