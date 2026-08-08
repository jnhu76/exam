/**
 * J5-I1C Slice 3 — Same-tab pending misconduct-mark authority.
 *
 * Mirrors {@link pendingForceSubmitAuthority} (J5-I1C Slice 2 review P1-2).
 * A misconduct mark is now an operationId-keyed durable command: a lost
 * response after the server committed must NOT cause a blind retry to mint a
 * NEW operationId (the server would treat the retry as a fresh append receipt
 * + a second audit row). The fix is to freeze the command before the first
 * POST and reuse the SAME operationId + severity + notes on every retry until
 * a confirmed outcome (success or definitive rejection) arrives.
 *
 * Scope: SAME-TAB persistence via sessionStorage. At most ONE pending
 * misconduct mark per (organizationId, actorId). Cross-tab parity is the same
 * P2 follow-up as force-submit (Issue #263), explicitly out of scope here.
 *
 * Fail-closed persistence: `savePendingMisconduct` returns an explicit result
 * and VERIFIES the write by reading it back and requiring byte-for-byte
 * equality with the exact string written (a hand-picked field comparison would
 * silently accept damage to fields the loader treats as mandatory —
 * schemaVersion, createdAt — so the strongest fail-closed check is full-string
 * equality, which covers every field). A command that cannot be durably
 * persisted must NOT be sent — the retry-identity contract includes refresh
 * recovery, so an unpersisted operationId would be lost on reload and a later
 * retry would mint a duplicate identity. Callers must not POST when the save
 * result is not ok.
 *
 * Strict authority validation: `loadPendingMisconduct` validates the FULL
 * record — schema version, query-key match (the record's
 * organizationId/actorId must equal the lookup key), finite createdAt,
 * non-empty attemptId/examId, RFC-4122 operationId, a canonical (already-
 * trimmed, 1..1000) notes mirroring the wire schema, a valid severity literal,
 * and a non-empty candidate label (a pending command without its target
 * identity cannot be safely surfaced). A damaged record is cleared AND
 * surfaced via `{ kind: "corrupt" }` — never silently treated as "no pending".
 */

/**
 * A frozen misconduct-mark command — the exact identity to (re)send on retry.
 * The wire payload is `{ operationId, severity, notes }` with `attemptId` in
 * the URL; `examId` / `candidateName` are NOT sent — they are stored context
 * that lets a recovery surface identify the command's target. A pending command
 * for a DIFFERENT exam must never be retried from the current exam's page (a
 * contextless destructive retry on the wrong exam would mark the other exam's
 * candidate).
 */
export interface PendingMisconductCommand {
  attemptId: string;
  operationId: string;
  severity: "warning" | "serious";
  notes: string;
  /** The exam the target attempt belongs to (page scope of the retry surface). */
  examId: string;
  /** Presentation snapshot of the target candidate (recovery surface label). */
  candidateName: string;
}

/** The durable authority record stored in sessionStorage. */
export interface PendingMisconductAuthority {
  schemaVersion: 2;
  organizationId: string;
  actorId: string;
  command: PendingMisconductCommand;
  createdAt: number;
}

/**
 * Result of {@link loadPendingMisconduct}. `corrupt` means a damaged record
 * existed, was cleared, and the caller should SURFACE it (a toast) instead of
 * silently treating the admin as having no pending command.
 */
export type PendingMisconductLoadResult =
  | { kind: "none" }
  | { kind: "authority"; authority: PendingMisconductAuthority }
  | { kind: "corrupt"; cleared: true };

/** Why a pending command could not be persisted. */
export type SavePendingMisconductError =
  | "storage_unavailable"
  | "write_failed"
  | "readback_mismatch"
  | "invalid_authority";

/** Explicit result of {@link savePendingMisconduct}. */
export type SavePendingMisconductResult =
  | { ok: true }
  | { ok: false; error: SavePendingMisconductError };

/**
 * Explicit result of {@link clearPendingMisconduct}. The UI must never assume a
 * clear succeeded silently — a record that is still present must keep its
 * recovery surface, or the admin would believe the slot is free while a stale
 * command reappears on the next load and blocks every later misconduct mark.
 */
export type ClearPendingMisconductResult =
  | { ok: true }
  | { ok: false; error: "storage_unavailable" | "remove_failed" };

const STORAGE_KEY_PREFIX = "exam.pendingMisconduct";

function storageKey(organizationId: string, actorId: string): string {
  return `${STORAGE_KEY_PREFIX}:${organizationId}:${actorId}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strict full-record validation. The record's organizationId/actorId must equal
 * the lookup key. `notes` must be canonical (already trimmed, non-empty, <=
 * 1000). `severity` must be a valid literal. The target identity (attemptId,
 * examId) must be present and `candidateName` must contain 1–200 characters so
 * a recovery surface can identify the command instead of showing a generic
 * destructive retry.
 */
function isValidAuthority(
  parsed: unknown,
  organizationId: string,
  actorId: string,
): parsed is PendingMisconductAuthority {
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
  if (command.severity !== "warning" && command.severity !== "serious") {
    return false;
  }
  const notes = command.notes;
  if (
    typeof notes !== "string" ||
    notes.length < 1 ||
    notes.length > 1000 ||
    notes.trim() !== notes
  ) {
    return false;
  }
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
 * Loads the pending misconduct-mark authority for (organizationId, actorId).
 * Never throws.
 *
 *   - nothing stored / storage unavailable → `{ kind: "none" }`;
 *   - a VALID record → `{ kind: "authority", authority }`;
 *   - a DAMAGED record → the record is REMOVED and `{ kind: "corrupt", cleared:
 *     true }` is returned so the caller can surface it instead of silently
 *     treating it as "no pending".
 */
export function loadPendingMisconduct(
  organizationId: string,
  actorId: string,
): PendingMisconductLoadResult {
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
    return { kind: "none" };
  }
}

/**
 * Persists a pending misconduct-mark command BEFORE the POST is sent, then
 * read-backs and VERIFIES the write by requiring byte-for-byte equality with
 * the exact serialized string that was written. The authority is ALSO validated
 * with the SAME full validator the loader uses BEFORE the write — the byte
 * read-back only proves the write stuck; it cannot catch a semantically invalid
 * record the loader would then treat as corrupt and DELETE.
 *
 * Returns `{ ok: true }` only when the verified record is durably stored.
 * Callers MUST NOT send the POST when the result is not ok. Never throws.
 */
export function savePendingMisconduct(
  authority: PendingMisconductAuthority,
): SavePendingMisconductResult {
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
      storage.removeItem(key);
      return { ok: false, error: "readback_mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}

/**
 * Clears the pending misconduct-mark authority for (organizationId, actorId).
 * Called on a confirmed outcome or an explicit user dismissal. Returns an
 * explicit result: the caller must NOT switch the UI to "cleared" when the
 * removal failed — a stale record that is still present would otherwise
 * resurface on the next load and block every later misconduct mark. Never
 * throws.
 */
export function clearPendingMisconduct(
  organizationId: string,
  actorId: string,
): ClearPendingMisconductResult {
  const storage = getStorage();
  if (!storage) return { ok: false, error: "storage_unavailable" };
  const key = storageKey(organizationId, actorId);
  try {
    storage.removeItem(key);
  } catch {
    return { ok: false, error: "remove_failed" };
  }
  try {
    if (storage.getItem(key) !== null) {
      return { ok: false, error: "remove_failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "storage_unavailable" };
  }
}
