/**
 * REC-I4-C1 — Cross-tab pending grant authority types.
 *
 * Defines the durable authority record that lives in localStorage and is
 * coordinated across tabs via navigator.locks + BroadcastChannel.
 *
 * The authority is keyed by (organizationId, actorId): at most one unresolved
 * operator time-grant command can exist per operator at any time. This
 * prevents two tabs from minting different operationIds for the same grant
 * workflow.
 */

// ── Command ─────────────────────────────────────────────────────────────────

/** A frozen operator time-grant command — the exact bytes to (re)send. */
export interface PendingGrantCommand {
  attemptId: string;
  operationId: string;
  addedSeconds: number;
  reasonCode: string;
  reasonText: string;
}

// ── Lease ───────────────────────────────────────────────────────────────────

/**
 * A short-term in-flight lease that prevents two tabs from simultaneously
 * sending the same command. A lease expires after `leaseDurationMs`; the
 * holder may be crashed/closed, so expiry allows another tab to take over.
 */
export interface InFlightLease {
  tabId: string;
  leaseId: string;
  expiresAt: number;
}

// ── Authority ───────────────────────────────────────────────────────────────

/**
 * The durable shared authority record. At most one per (organizationId, actorId)
 * tuple exists at any time. Stored in localStorage and accessed atomically
 * via navigator.locks.
 */
export interface PendingGrantAuthority {
  schemaVersion: 1;
  organizationId: string;
  actorId: string;
  command: PendingGrantCommand;
  revision: number;
  createdAt: number;
  inFlightLease?: InFlightLease;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class CoordinationUnavailableError extends Error {
  readonly name = "CoordinationUnavailableError";
  readonly code = "COORDINATION_UNAVAILABLE";
  constructor(reason: string) {
    super(reason);
  }
}

export class AlreadyPendingError extends Error {
  readonly name = "AlreadyPendingError";
  readonly code = "ALREADY_PENDING";
  constructor(readonly existing: PendingGrantAuthority) {
    super("An unresolved time-grant command already exists");
  }
}

export class LeaseConflictError extends Error {
  readonly name = "LeaseConflictError";
  readonly code = "LEASE_CONFLICT";
  constructor(readonly existing: PendingGrantAuthority) {
    super("Another tab is currently processing this time-grant command");
  }
}

export class CompareAndClearMismatchError extends Error {
  readonly name = "CompareAndClearMismatchError";
  readonly code = "COMPARE_AND_CLEAR_MISMATCH";
  constructor() {
    super("Send claim does not match the stored authority");
  }
}

// ── Send claim ──────────────────────────────────────────────────────────────

/**
 * Proof that a tab holds the send lease for the current authority revision.
 * A claim is ONLY issued atomically inside the coordinator lock — either by
 * `reserve` (the first send) or by `claimForSend` (every retry). It MUST be
 * presented back verbatim to `clearConfirmed` / `releaseIndeterminate` so a
 * stale request whose response arrives late (after the lease was released or
 * re-claimed) cannot corrupt a newer claim.
 *
 * All three fields are part of the identity: comparing only operationId +
 * revision is insufficient — two different leases can share a revision bump.
 */
export interface PendingGrantSendClaim {
  operationId: string;
  revision: number;
  leaseId: string;
}

// ── Result types ────────────────────────────────────────────────────────────

export type ReserveResult =
  | { ok: true; authority: PendingGrantAuthority; claim: PendingGrantSendClaim }
  | { ok: false; error: CoordinationUnavailableError | AlreadyPendingError };

export type ClaimForSendResult =
  | {
      ok: true;
      authority: PendingGrantAuthority;
      claim: PendingGrantSendClaim;
    }
  | {
      ok: false;
      error: CoordinationUnavailableError | LeaseConflictError;
    };

export type ReleaseResult =
  | { ok: true; authority: PendingGrantAuthority }
  | {
      ok: false;
      error: CoordinationUnavailableError | CompareAndClearMismatchError;
    };

export type ClearResult =
  | { ok: true }
  | {
      ok: false;
      error: CoordinationUnavailableError | CompareAndClearMismatchError;
    };

export type GetCurrentResult =
  | { ok: true; authority: PendingGrantAuthority | null }
  | { ok: false; error: CoordinationUnavailableError };

// ── Events ──────────────────────────────────────────────────────────────────

export type AuthorityChangeEventType =
  | "authority_created"
  | "authority_cleared"
  | "lease_acquired"
  | "lease_released";

export interface AuthorityChangeEvent {
  type: AuthorityChangeEventType;
  organizationId: string;
  actorId: string;
}

// ── Broadcast message ───────────────────────────────────────────────────────

export interface BroadcastMessage {
  type: AuthorityChangeEventType;
  organizationId: string;
  actorId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isLeaseExpired(lease: InFlightLease, now: number): boolean {
  return now >= lease.expiresAt;
}

/**
 * Structural equality over the frozen command fields. Used by `claimForSend`
 * (and the page's stale-release reconciliation) to guarantee a retry /
 * reconciliation preserves the EXACT frozen command — a caller cannot reuse an
 * expired lease to overwrite operationId / payload.
 */
export function commandsEqual(
  a: PendingGrantCommand,
  b: PendingGrantCommand,
): boolean {
  return (
    a.operationId === b.operationId &&
    a.attemptId === b.attemptId &&
    a.addedSeconds === b.addedSeconds &&
    a.reasonCode === b.reasonCode &&
    a.reasonText === b.reasonText
  );
}

export function commandDigest(command: PendingGrantCommand): string {
  // Simple content identifier for compare-and-clear.
  return `${command.operationId}:${command.attemptId}:${command.addedSeconds}`;
}
