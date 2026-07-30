/**
 * REC-I4-C1 — Cross-tab pending grant coordinator.
 *
 * Coordinates operator time-grant commands across browser tabs using:
 *   - localStorage  — durable shared authority (survives refresh, cross-tab)
 *   - navigator.locks — atomic read-check-write for the storage key
 *   - BroadcastChannel — real-time UI update notifications
 *   - storage event     — backup notification channel
 *
 * At most one unresolved command per (organizationId, actorId) pair.
 * The command is persisted BEFORE the first HTTP request is sent (fail-closed:
 * no shared authority → no request). Confirmed outcomes use compare-and-clear
 * so stale tabs cannot accidentally delete a newer authority.
 */

import { createContextSafeUuid } from "@/lib/uuid";
import {
  type PendingGrantAuthority,
  type PendingGrantCommand,
  type ReserveResult,
  type TakeOverResult,
  type ClearResult,
  type GetCurrentResult,
  type AuthorityChangeEvent,
  type AuthorityChangeEventType,
  type BroadcastMessage,
  CoordinationUnavailableError,
  AlreadyPendingError,
  LeaseConflictError,
  CompareAndClearMismatchError,
  isLeaseExpired,
  commandsEqual,
} from "./pendingGrantAuthority";

// ── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "exam.pendingGrantAuthority";
const LOCK_NAME_PREFIX = "exam.pendingGrantAuthority";
const DEFAULT_BROADCAST_CHANNEL = "exam.pending-grant-coordinator";
const DEFAULT_LEASE_DURATION_MS = 30_000; // 30 seconds

// ── Dependencies ────────────────────────────────────────────────────────────

export interface CoordinatorDependencies {
  tabId: string;
  leaseDurationMs: number;
  lockRequest: <T>(
    name: string,
    callback: (lock: { name: string } | null) => Promise<T>,
  ) => Promise<T>;
  broadcastChannel: {
    postMessage: (msg: unknown) => void;
    close: () => void;
    onmessage: ((event: MessageEvent) => void) | null;
  };
  storage: Storage;
  now: () => number;
}

// ── Default dependencies ────────────────────────────────────────────────────

/**
 * Lazily accesses `window.localStorage` so that merely constructing the
 * coordinator never throws. Storage unavailability (disabled by browser policy,
 * SecurityError on the getter, or missing implementation) is surfaced on the
 * first read/write and converted into a Result by the public API.
 */
function requireLocalStorage(): Storage {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch (error) {
    throw new CoordinationUnavailableError(
      `localStorage unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!storage) {
    throw new CoordinationUnavailableError(
      "localStorage unavailable: cannot persist shared cross-tab grant authority",
    );
  }
  return storage;
}

function createLazyLocalStorage(): Storage {
  return {
    get length() {
      return requireLocalStorage().length;
    },
    getItem(key: string): string | null {
      return requireLocalStorage().getItem(key);
    },
    setItem(key: string, value: string): void {
      requireLocalStorage().setItem(key, value);
    },
    removeItem(key: string): void {
      requireLocalStorage().removeItem(key);
    },
    key(index: number): string | null {
      return requireLocalStorage().key(index);
    },
    clear(): void {
      requireLocalStorage().clear();
    },
  };
}

function createDefaultDeps(): CoordinatorDependencies {
  let tabId: string;
  try {
    const key = "exam.tabId";
    const stored = sessionStorage.getItem(key);
    if (stored) {
      tabId = stored;
    } else {
      tabId = createContextSafeUuid();
      sessionStorage.setItem(key, tabId);
    }
  } catch {
    tabId = createContextSafeUuid();
  }

  // Fail-closed dependency contract (REC-I4-C1): the cross-tab authority
  // depends on a shared atomic lock + durable shared storage. Without Web
  // Locks the read-check-write is not atomic, and without localStorage the
  // "shared" authority is per-tab — both silently destroy the C1 invariant
  // (two tabs minting different operationIds). We therefore throw instead of
  // degrading; the throw is surfaced to callers as a CoordinationUnavailable
  // Result so the page can refuse to send a grant that could duplicate.
  //
  // BroadcastChannel stays best-effort: the `storage` event is a backup
  // cross-tab notification channel, so a missing BroadcastChannel does not
  // break the authority contract.
  const lockRequest = <T>(
    name: string,
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T> => {
    if (typeof navigator === "undefined" || !navigator.locks) {
      return Promise.reject(
        new CoordinationUnavailableError(
          "Web Locks API unavailable: cannot coordinate cross-tab grants safely",
        ),
      );
    }
    // navigator.locks.request is typed as returning Promise<any>;
    // cast to the expected generic return type.
    return navigator.locks.request(
      name,
      callback as (lock: Lock | null) => Promise<T>,
    ) as Promise<T>;
  };

  const storage = createLazyLocalStorage();

  const broadcastChannel: CoordinatorDependencies["broadcastChannel"] =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(DEFAULT_BROADCAST_CHANNEL)
      : {
          postMessage: () => {},
          close: () => {},
          onmessage: null,
        };

  return {
    tabId,
    leaseDurationMs: DEFAULT_LEASE_DURATION_MS,
    lockRequest,
    broadcastChannel,
    storage,
    now: () => Date.now(),
  };
}

// ── Storage helpers ─────────────────────────────────────────────────────────

function storageKey(orgId: string, actorId: string): string {
  return `${STORAGE_KEY_PREFIX}:${orgId}:${actorId}`;
}

function lockName(orgId: string, actorId: string): string {
  return `${LOCK_NAME_PREFIX}:${orgId}:${actorId}`;
}

/**
 * Normalizes any thrown value into a CoordinationUnavailableError. Public
 * methods use this to guarantee their declared Result return type: a rejected
 * lockRequest / destroyed coordinator / unexpected throw is always converted to
 * `{ ok: false, error }` rather than rejecting the public Promise.
 */
function toCoordinationUnavailable(err: unknown): CoordinationUnavailableError {
  if (err instanceof CoordinationUnavailableError) return err;
  return new CoordinationUnavailableError(
    err instanceof Error
      ? `Coordination unavailable: ${err.message}`
      : "Coordination unavailable: cannot acquire shared lock",
  );
}

// ── Coordinator ─────────────────────────────────────────────────────────────

/**
 * The full set of dependency keys, in stable order. Used to detect when a
 * caller has injected a complete dependency set so the constructor can use it
 * verbatim instead of building (and then discarding) real default deps — which
 * would orphan a real BroadcastChannel and touch sessionStorage even in tests
 * that inject a full fake environment.
 */
const DEPENDENCY_KEYS = [
  "tabId",
  "leaseDurationMs",
  "lockRequest",
  "broadcastChannel",
  "storage",
  "now",
] as const satisfies readonly (keyof CoordinatorDependencies)[];

function isCompleteDependencies(
  deps: unknown,
): deps is CoordinatorDependencies {
  if (!deps || typeof deps !== "object") return false;
  const obj = deps as Record<string, unknown>;
  return DEPENDENCY_KEYS.every((k) => k in obj);
}

export class PendingGrantCoordinator {
  private readonly deps: CoordinatorDependencies;
  private readonly listeners = new Set<(event: AuthorityChangeEvent) => void>();
  private readonly storageHandler: (e: StorageEvent) => void;
  private destroyed = false;

  constructor(deps?: Partial<CoordinatorDependencies>) {
    // If the caller injected a COMPLETE dependency set (tests do this), use it
    // verbatim — do NOT call createDefaultDeps(), which would construct a real
    // BroadcastChannel and touch sessionStorage only to be immediately
    // overwritten (resource leak of the orphaned channel). Only the production
    // singleton path (no deps) and partial-deps callers build defaults.
    if (isCompleteDependencies(deps)) {
      this.deps = deps;
    } else {
      this.deps = { ...createDefaultDeps(), ...(deps ?? {}) };
    }
    this.deps.broadcastChannel.onmessage = (event: MessageEvent) => {
      const data = event.data as BroadcastMessage;
      this.notifyListeners(data);
    };
    this.storageHandler = (e: StorageEvent) => {
      if (e.key?.startsWith(STORAGE_KEY_PREFIX)) {
        const parts = e.key.slice(STORAGE_KEY_PREFIX.length + 1).split(":");
        if (parts.length === 2) {
          this.notifyListeners({
            type: e.newValue ? "authority_created" : "authority_cleared",
            organizationId: parts[0]!,
            actorId: parts[1]!,
          });
        }
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", this.storageHandler);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.deps.broadcastChannel.close();
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.storageHandler);
    }
    this.listeners.clear();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Atomically reserves a pending command for the given (orgId, actorId).
   * Fails if an unresolved command already exists (AlreadyPendingError) or
   * if the shared storage is unavailable (CoordinationUnavailableError).
   *
   * On success, the command is persisted to localStorage with a fresh
   * in-flight lease held by this tab. The caller MUST then send the HTTP
   * request — the command is already visible to other tabs.
   */
  async reserve(
    orgId: string,
    actorId: string,
    command: PendingGrantCommand,
  ): Promise<ReserveResult> {
    try {
      return await this.withLock(orgId, actorId, async () => {
        // Check if an authority already exists
        const existing = this.readAuthority(orgId, actorId);
        if (existing) {
          return {
            ok: false as const,
            error: new AlreadyPendingError(existing),
          };
        }

        const now = this.deps.now();
        const authority: PendingGrantAuthority = {
          schemaVersion: 1,
          organizationId: orgId,
          actorId,
          command,
          revision: 1,
          createdAt: now,
          inFlightLease: {
            tabId: this.deps.tabId,
            leaseId: createContextSafeUuid(),
            expiresAt: now + this.deps.leaseDurationMs,
          },
        };

        this.writeAuthority(orgId, actorId, authority);
        this.broadcast({
          type: "authority_created",
          organizationId: orgId,
          actorId,
        });
        return { ok: true as const, authority };
      });
    } catch (err) {
      return { ok: false as const, error: toCoordinationUnavailable(err) };
    }
  }

  /**
   * Takes over an expired lease, allowing a different tab to retry the same
   * frozen command. The command identity (operationId, payload) is preserved
   * — never mint a new operationId on takeover.
   *
   * Fails if the lease is still valid (LeaseConflictError) or storage is
   * unavailable.
   */
  async takeOver(
    orgId: string,
    actorId: string,
    command: PendingGrantCommand,
  ): Promise<TakeOverResult> {
    try {
      return await this.withLock(orgId, actorId, async () => {
        const existing = this.readAuthority(orgId, actorId);
        if (!existing) {
          return {
            ok: false as const,
            error: new CoordinationUnavailableError(
              "No pending time-grant command to take over",
            ),
          };
        }

        // Check lease validity
        if (
          existing.inFlightLease &&
          !isLeaseExpired(existing.inFlightLease, this.deps.now())
        ) {
          return {
            ok: false as const,
            error: new LeaseConflictError(existing),
          };
        }

        // Enforce frozen-command equality: a takeover must replay the EXACT
        // command persisted by the original tab. A caller cannot reuse an
        // expired lease to overwrite operationId / payload — that would let a
        // crashed tab's identity be silently mutated, defeating C1. If the
        // caller's command differs on any field, fail closed.
        if (!commandsEqual(existing.command, command)) {
          return {
            ok: false as const,
            error: new CoordinationUnavailableError(
              "takeOver command does not match the stored frozen command",
            ),
          };
        }

        // Preserve the exact command — always reuse the stored frozen command
        // (ignore the caller's copy) and bump the revision for the new lease.
        const now = this.deps.now();
        const updated: PendingGrantAuthority = {
          ...existing,
          command: existing.command,
          revision: existing.revision + 1,
          inFlightLease: {
            tabId: this.deps.tabId,
            leaseId: createContextSafeUuid(),
            expiresAt: now + this.deps.leaseDurationMs,
          },
        };

        this.writeAuthority(orgId, actorId, updated);
        this.broadcast({
          type: "lease_acquired",
          organizationId: orgId,
          actorId,
        });
        return { ok: true as const, authority: updated };
      });
    } catch (err) {
      return { ok: false as const, error: toCoordinationUnavailable(err) };
    }
  }

  /**
   * Confirms and clears the pending authority using compare-and-clear.
   * Only succeeds when the stored authority's operationId AND revision
   * match the expected values. This prevents stale tabs from deleting
   * a newer authority that replaced theirs.
   */
  async clearConfirmed(
    orgId: string,
    actorId: string,
    expected: { operationId: string; revision: number },
  ): Promise<ClearResult> {
    try {
      return await this.withLock(orgId, actorId, async () => {
        const existing = this.readAuthority(orgId, actorId);
        if (!existing) {
          // Already cleared — that's OK
          return { ok: true as const };
        }

        // Compare-and-clear
        if (
          existing.command.operationId !== expected.operationId ||
          existing.revision !== expected.revision
        ) {
          return {
            ok: false as const,
            error: new CompareAndClearMismatchError(),
          };
        }

        this.removeAuthority(orgId, actorId);
        this.broadcast({
          type: "authority_cleared",
          organizationId: orgId,
          actorId,
        });
        return { ok: true as const };
      });
    } catch (err) {
      return { ok: false as const, error: toCoordinationUnavailable(err) };
    }
  }

  /**
   * Reads the current pending authority (if any) for the given (orgId, actorId).
   */
  async getCurrent(orgId: string, actorId: string): Promise<GetCurrentResult> {
    try {
      return await this.withLock(orgId, actorId, async () => {
        const authority = this.readAuthority(orgId, actorId);
        return { ok: true as const, authority };
      });
    } catch (err) {
      return { ok: false as const, error: toCoordinationUnavailable(err) };
    }
  }

  /**
   * Subscribes to authority change events. Returns an unsubscribe function.
   */
  subscribe(callback: (event: AuthorityChangeEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private async withLock<T>(
    orgId: string,
    actorId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const name = lockName(orgId, actorId);
    try {
      return await this.deps.lockRequest(name, async () => {
        if (this.destroyed) {
          throw new CoordinationUnavailableError(
            "Coordinator has been destroyed",
          );
        }
        return await fn();
      });
    } catch (err) {
      // `withLock` is an internal helper and may throw (e.g. lockRequest
      // rejects when Web Locks is unavailable, per the fail-closed default
      // dependency). Every PUBLIC method wraps its withLock call in a
      // try/catch that converts this throw into a Result via
      // toCoordinationUnavailable, so the public API never rejects.
      throw toCoordinationUnavailable(err);
    }
  }

  private readAuthority(
    orgId: string,
    actorId: string,
  ): PendingGrantAuthority | null {
    const key = storageKey(orgId, actorId);
    const raw = this.deps.storage.getItem(key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new CoordinationUnavailableError(
        `Corrupted shared storage record (${key}): cannot parse JSON`,
      );
    }

    if (!isValidAuthority(parsed)) {
      throw new CoordinationUnavailableError(
        `Invalid shared storage record format (${key})`,
      );
    }

    return parsed;
  }

  private writeAuthority(
    orgId: string,
    actorId: string,
    authority: PendingGrantAuthority,
  ): void {
    const key = storageKey(orgId, actorId);
    try {
      this.deps.storage.setItem(key, JSON.stringify(authority));
    } catch (err) {
      throw new CoordinationUnavailableError(
        `Shared storage write failed (${key}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private removeAuthority(orgId: string, actorId: string): void {
    const key = storageKey(orgId, actorId);
    try {
      this.deps.storage.removeItem(key);
    } catch {
      throw new CoordinationUnavailableError(
        `Shared storage remove failed (${key})`,
      );
    }
  }

  private broadcast(event: AuthorityChangeEvent): void {
    try {
      this.deps.broadcastChannel.postMessage(event);
    } catch {
      // BroadcastChannel is best-effort; don't fail the operation
    }
    this.notifyListeners(event);
  }

  private notifyListeners(event: AuthorityChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Isolate listener failures
      }
    }
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

function isValidAuthority(value: unknown): value is PendingGrantAuthority {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return false;
  if (typeof obj.organizationId !== "string") return false;
  if (typeof obj.actorId !== "string") return false;
  if (!obj.command || typeof obj.command !== "object") return false;
  const cmd = obj.command as Record<string, unknown>;
  if (typeof cmd.attemptId !== "string") return false;
  if (typeof cmd.operationId !== "string") return false;
  if (typeof cmd.addedSeconds !== "number") return false;
  if (typeof cmd.reasonCode !== "string") return false;
  if (typeof cmd.reasonText !== "string") return false;
  if (typeof obj.revision !== "number") return false;
  if (typeof obj.createdAt !== "number") return false;
  // inFlightLease is optional
  if (obj.inFlightLease !== undefined && obj.inFlightLease !== null) {
    if (typeof obj.inFlightLease !== "object") return false;
    const lease = obj.inFlightLease as Record<string, unknown>;
    if (typeof lease.tabId !== "string") return false;
    if (typeof lease.leaseId !== "string") return false;
    if (typeof lease.expiresAt !== "number") return false;
  }
  return true;
}
