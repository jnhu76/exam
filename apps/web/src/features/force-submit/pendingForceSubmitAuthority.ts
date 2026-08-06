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
 * Fail-closed persistence (re-review P1-2): `savePendingForceSubmit` returns
 * an explicit result and VERIFIES the write by reading it back and comparing
 * every field of the record (organizationId, actorId, attemptId, operationId,
 * reason). A command that cannot be durably persisted must NOT be sent — the
 * retry-identity contract includes refresh recovery, so an unpersisted
 * operationId would be lost on reload and a later retry would mint a
 * duplicate identity. Callers must not POST when the save result is not ok.
 *
 * Strict authority validation (re-review P2-2): `loadPendingForceSubmit`
 * validates the FULL record — schema version, query-key match (the record's
 * organizationId/actorId must equal the lookup key), finite createdAt,
 * non-empty attemptId, RFC-4122 operationId, and a canonical (already-trimmed,
 * 1..500) reason, mirroring the wire schema (`z.string().uuid()` +
 * `z.string().trim().min(1).max(500)` in `@exam/contracts`). A damaged record
 * is cleared AND surfaced via `{ kind: "corrupt" }` — never silently treated
 * as "no pending" (a hidden corrupt command could block every other
 * force-submit for the admin without any way to reach it).
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

/**
 * Result of {@link loadPendingForceSubmit}. `corrupt` means a damaged record
 * existed, was cleared, and the caller should SURFACE it (a toast) instead of
 * silently treating the admin as having no pending command.
 */
export type PendingForceSubmitLoadResult =
  | { kind: "none" }
  | { kind: "authority"; authority: PendingForceSubmitAuthority }
  | { kind: "corrupt"; cleared: true };

/** Why a pending command could not be persisted. */
export type SavePendingForceSubmitError =
  | "storage_unavailable"
  | "write_failed"
  | "readback_mismatch";

/** Explicit result of {@link savePendingForceSubmit} (re-review P1-2). */
export type SavePendingForceSubmitResult =
  | { ok: true }
  | { ok: false; error: SavePendingForceSubmitError };

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

/**
 * RFC-4122 UUID — mirrors `z.string().uuid()` (the wire operationId schema),
 * so a stored identity that the server would reject is rejected here too.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strict full-record validation (re-review P2-2). The record's
 * organizationId/actorId must equal the lookup key — a record written for
 * another org/actor is a damaged identity, not a valid pending command.
 * `reason` must be canonical: already trimmed (the wire schema trims), non-
 * empty, and <= 500 chars.
 */
function isValidAuthority(
  parsed: unknown,
  organizationId: string,
  actorId: string,
): parsed is PendingForceSubmitAuthority {
  if (!parsed || typeof parsed !== "object") return false;
  const a = parsed as Record<string, unknown>;
  if (a.schemaVersion !== 1) return false;
  if (a.organizationId !== organizationId || a.actorId !== actorId)
    return false;
  if (typeof a.createdAt !== "number" || !Number.isFinite(a.createdAt)) {
    return false;
  }
  const command = a.command as Record<string, unknown> | null | undefined;
  if (!command || typeof command !== "object") return false;
  if (typeof command.attemptId !== "string" || command.attemptId.length === 0) {
    return false;
  }
  if (
    typeof command.operationId !== "string" ||
    !UUID_RE.test(command.operationId)
  ) {
    return false;
  }
  const reason = command.reason;
  return (
    typeof reason === "string" &&
    reason.length >= 1 &&
    reason.length <= 500 &&
    reason.trim() === reason
  );
}

/**
 * Loads the pending force-submit authority for (organizationId, actorId).
 * Never throws.
 *
 *   - nothing stored / storage unavailable → `{ kind: "none" }`;
 *   - a VALID record → `{ kind: "authority", authority }`;
 *   - a DAMAGED record (unparseable, wrong key, invalid fields) → the record
 *     is REMOVED and `{ kind: "corrupt", cleared: true }` is returned so the
 *     caller can surface it instead of silently treating it as "no pending".
 */
export function loadPendingForceSubmit(
  organizationId: string,
  actorId: string,
): PendingForceSubmitLoadResult {
  const storage = getStorage();
  if (!storage) return { kind: "none" };
  const key = storageKey(organizationId, actorId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return { kind: "none" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      storage.removeItem(key);
      return { kind: "corrupt", cleared: true };
    }
    if (!isValidAuthority(parsed, organizationId, actorId)) {
      storage.removeItem(key);
      return { kind: "corrupt", cleared: true };
    }
    return { kind: "authority", authority: parsed };
  } catch {
    // Storage threw mid-read — nothing we can safely verify; treat as none
    // (the caller's fail-closed save path will refuse to POST anyway).
    return { kind: "none" };
  }
}

/**
 * Persists a pending force-submit command BEFORE the POST is sent, then
 * read-backs and VERIFIES the write field-by-field (re-review P1-2):
 * organizationId, actorId, attemptId, operationId, reason must all match the
 * written record exactly.
 *
 * Returns `{ ok: true }` only when the verified record is durably stored.
 * Returns `{ ok: false, error }` when:
 *   - storage is unavailable / blocked         → `storage_unavailable`;
 *   - `setItem` threw (quota, blocked, ...)    → `write_failed`;
 *   - the read-back is missing, unparseable, or differs from the written
 *     record                                  → `readback_mismatch` (the bad
 *     bytes are removed so the next save starts clean).
 *
 * Callers MUST NOT send the POST when the result is not ok — the retry-
 * identity contract includes refresh recovery, so an unpersisted command
 * cannot be safely retried (review P1-2: "不能以当前 React state 里还有
 * command 为理由继续发送"). Never throws.
 */
export function savePendingForceSubmit(
  authority: PendingForceSubmitAuthority,
): SavePendingForceSubmitResult {
  const storage = getStorage();
  if (!storage) return { ok: false, error: "storage_unavailable" };
  const key = storageKey(authority.organizationId, authority.actorId);
  const serialized = JSON.stringify(authority);
  try {
    storage.setItem(key, serialized);
  } catch {
    return { ok: false, error: "write_failed" };
  }
  try {
    const readBack = storage.getItem(key);
    if (!readBack) return { ok: false, error: "write_failed" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readBack) as unknown;
    } catch {
      // The storage layer returned bytes we did not write — remove them.
      storage.removeItem(key);
      return { ok: false, error: "readback_mismatch" };
    }
    const a = parsed as Record<string, unknown>;
    const command = a?.command as Record<string, unknown> | null | undefined;
    const matches =
      a?.organizationId === authority.organizationId &&
      a?.actorId === authority.actorId &&
      command?.attemptId === authority.command.attemptId &&
      command?.operationId === authority.command.operationId &&
      command?.reason === authority.command.reason;
    if (!matches) {
      storage.removeItem(key);
      return { ok: false, error: "readback_mismatch" };
    }
    return { ok: true };
  } catch {
    // The read-back itself threw — the write cannot be verified; fail closed.
    return { ok: false, error: "write_failed" };
  }
}

/**
 * Clears the pending force-submit authority for (organizationId, actorId).
 * Called on a confirmed outcome (success or definitive rejection). Best
 * effort — a failed clear leaves a stale pending command that the page-level
 * banner can still retry or dismiss. Never throws.
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
