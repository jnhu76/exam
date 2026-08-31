/**
 * Same-tab pending force-submit authority.
 *
 * A force-submit is an operationId-keyed durable command: a lost response
 * after the server committed must NOT cause a blind retry to mint a NEW
 * operationId, or the server treats the retry as a fresh command and applies
 * the effect twice. The fix is to freeze the command before the first POST
 * and reuse the SAME operationId + reason on every retry until a confirmed
 * outcome (success or definitive rejection) arrives.
 *
 * Scope: SAME-TAB persistence via sessionStorage. At most ONE pending
 * force-submit per (organizationId, actorId). Cross-tab parity (the time-grant
 * coordinator's localStorage + navigator.locks + BroadcastChannel machinery)
 * is explicitly out of scope here; a second tab can still mint a new
 * operationId.
 *
 * Fail-closed persistence: `savePendingForceSubmit` returns an explicit
 * result and VERIFIES the write by reading it back and requiring
 * byte-for-byte equality with the exact string written. Full-string equality
 * is the strongest fail-closed check: a hand-picked field comparison would
 * silently accept damage to fields the loader treats as mandatory
 * (schemaVersion, createdAt), while byte equality covers every field. A
 * command that cannot be durably persisted must NOT be sent — the retry-
 * identity contract includes refresh recovery, so an unpersisted operationId
 * would be lost on reload and a later retry would mint a duplicate identity.
 * Callers must not POST when the save result is not ok.
 *
 * Strict authority validation: `loadPendingForceSubmit` validates the FULL
 * record — schema version, query-key match (the record's
 * organizationId/actorId must equal the lookup key), finite createdAt,
 * non-empty attemptId, RFC-4122 operationId, a canonical (already-trimmed,
 * 1..500) reason mirroring the wire schema (`z.string().uuid()` +
 * `z.string().trim().min(1).max(500)` in `@exam/contracts`), and the command's
 * exam scope + candidate label: a pending command without its target exam
 * identity cannot be safely surfaced. A damaged record is cleared AND
 * surfaced via `{ kind: "corrupt" }` — never silently treated as "no pending"
 * (a hidden corrupt command could block every other force-submit for the
 * admin without any way to reach it).
 */

/**
 * A frozen force-submit command — the exact identity to (re)send on retry.
 * The wire payload is `{ operationId, reason }` with `attemptId` in the URL;
 * `examId` / `candidateName` are NOT sent — they are stored context that lets
 * a recovery surface identify the command's target. A pending command for a
 * DIFFERENT exam must never be retried from the current exam's page: a
 * contextless destructive retry on the wrong exam would force-submit the
 * other exam's candidate.
 */
export interface PendingForceSubmitCommand {
  attemptId: string;
  operationId: string;
  reason: string;
  /** The exam the target attempt belongs to (page scope of the retry surface). */
  examId: string;
  /** Presentation snapshot of the target candidate (recovery surface label). */
  candidateName: string;
}

/** The durable authority record stored in sessionStorage. */
export interface PendingForceSubmitAuthority {
  schemaVersion: 2;
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
  | "readback_mismatch"
  | "invalid_authority";

/** Explicit result of {@link savePendingForceSubmit}. */
export type SavePendingForceSubmitResult =
  | { ok: true }
  | { ok: false; error: SavePendingForceSubmitError };

/**
 * Explicit result of {@link clearPendingForceSubmit}. The UI
 * must never assume a clear succeeded silently — a record that is still
 * present must keep its recovery surface (banner / indeterminate state), or
 * the admin would believe the slot is free while a stale command reappears
 * on the next load and blocks every later force-submit.
 */
export type ClearPendingForceSubmitResult =
  | { ok: true }
  | { ok: false; error: "storage_unavailable" | "remove_failed" };

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
 * Strict full-record validation. The record's
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
  if (a.schemaVersion !== 2) return false;
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
  if (
    typeof reason !== "string" ||
    reason.length < 1 ||
    reason.length > 500 ||
    reason.trim() !== reason
  ) {
    return false;
  }
  // Target identity: a command without its exam scope cannot be safely
  // surfaced (a contextless retry could target the wrong exam), and a
  // candidate label is required for the recovery banner to identify the
  // command instead of showing a generic destructive retry.
  if (typeof command.examId !== "string" || command.examId.length === 0) {
    return false;
  }
  const candidateName = command.candidateName;
  return (
    typeof candidateName === "string" &&
    candidateName.length >= 1 &&
    candidateName.length <= 200
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
 * read-backs and VERIFIES the write by requiring byte-for-byte equality with
 * the exact serialized string that was written. A string-level comparison is
 * strictly stronger than comparing individual fields: it also covers
 * `schemaVersion` and `createdAt`, which the loader treats as mandatory
 * authority fields (`isValidAuthority`), and any future field — no field can
 * be damaged without breaking equality.
 *
 * The authority is ALSO validated with the SAME full validator the loader
 * uses BEFORE the write: the byte read-back only proves the write stuck — it
 * cannot catch a semantically invalid record (e.g. an empty candidateName
 * snapshot from a stale candidate projection), which the loader would then
 * treat as corrupt and DELETE, silently destroying the operation identity
 * this save was meant to protect. "Writer can write" and "reader can read"
 * can never diverge: a record that passes here always passes
 * `loadPendingForceSubmit`.
 *
 * Returns `{ ok: true }` only when the verified record is durably stored.
 * Returns `{ ok: false, error }` when:
 *   - the authority fails `isValidAuthority`      → `invalid_authority`
 *     (nothing is written; the caller must fix the record, not the storage);
 *   - storage is unavailable / blocked             → `storage_unavailable`;
 *   - `setItem` threw (quota, blocked, ...)        → `write_failed`;
 *   - the read-back is missing                     → `write_failed` (the write
 *     did not stick);
 *   - the read-back differs from the written
 *     bytes                                        → `readback_mismatch` (the
 *     bad bytes are removed so the next save starts clean).
 *
 * Callers MUST NOT send the POST when the result is not ok — the retry-
 * identity contract includes refresh recovery, so an unpersisted command
 * cannot be safely retried (React state holding the command is not
 * persistence). Never throws.
 */
export function savePendingForceSubmit(
  authority: PendingForceSubmitAuthority,
): SavePendingForceSubmitResult {
  // Same validator the loader runs — fail closed BEFORE any write so a record
  // that could never be read back (corrupt → cleared) is never persisted.
  if (
    !isValidAuthority(authority, authority.organizationId, authority.actorId)
  ) {
    return { ok: false, error: "invalid_authority" };
  }
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
    if (readBack === null) return { ok: false, error: "write_failed" };
    if (readBack !== serialized) {
      // The storage layer returned bytes we did not write — remove them.
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
 * Called on a confirmed outcome (success or definitive rejection) or on an
 * explicit user dismissal. Returns an explicit result: the caller must NOT
 * switch the UI to "cleared" when the removal failed — a stale record that is
 * still present would otherwise resurface on the next load and block every
 * later force-submit. Never throws.
 */
export function clearPendingForceSubmit(
  organizationId: string,
  actorId: string,
): ClearPendingForceSubmitResult {
  const storage = getStorage();
  if (!storage) return { ok: false, error: "storage_unavailable" };
  const key = storageKey(organizationId, actorId);
  try {
    storage.removeItem(key);
  } catch {
    return { ok: false, error: "remove_failed" };
  }
  // Verify the record is actually gone — a removeItem that
  // reports success but silently fails (storage eviction, quota rollback,
  // or restrictive sandbox) would leave a stale record that resurfaces on
  // the next load and blocks every later force-submit.
  try {
    if (storage.getItem(key) !== null) {
      return { ok: false, error: "remove_failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "storage_unavailable" };
  }
}
