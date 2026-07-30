import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PendingGrantCoordinator,
  type CoordinatorDependencies,
} from "./pendingGrantCoordinator";
import {
  AlreadyPendingError,
  CoordinationUnavailableError,
  LeaseConflictError,
  CompareAndClearMismatchError,
  type PendingGrantCommand,
  type PendingGrantSendClaim,
  type AuthorityChangeEvent,
} from "./pendingGrantAuthority";

// ── Helpers ─────────────────────────────────────────────────────────────────

const ORG_A = "org-a";
const ORG_B = "org-b";
const ACTOR_1 = "actor-1";
const ACTOR_2 = "actor-2";
const TAB_A = "tab-a";
const TAB_B = "tab-b";

const COMMAND: PendingGrantCommand = {
  attemptId: "att-1",
  operationId: "op-1",
  addedSeconds: 600,
  reasonCode: "technical_incident",
  reasonText: "网络中断",
};

const COMMAND_DIFF_ATTEMPT: PendingGrantCommand = {
  attemptId: "att-2",
  operationId: "op-2",
  addedSeconds: 300,
  reasonCode: "candidate_request",
  reasonText: "需要更多时间",
};

const COMMAND_SAME_OP_DIFF_PAYLOAD: PendingGrantCommand = {
  attemptId: "att-1",
  operationId: "op-1",
  addedSeconds: 1200,
  reasonCode: "technical_incident",
  reasonText: "不同原因",
};

// ── Mock lock manager ───────────────────────────────────────────────────────

/**
 * A simple in-process lock manager that simulates navigator.locks.request.
 * Multiple calls for the same name are queued and executed sequentially.
 */
class MockLockManager {
  private held = new Map<string, boolean>();
  private queue = new Map<string, Array<() => void>>();

  request = vi.fn(
    <T>(
      name: string,
      callback: (lock: { name: string } | null) => Promise<T>,
    ): Promise<T> => {
      return this._request(name, callback);
    },
  );

  private async _request<T>(
    name: string,
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T> {
    // Wait until the lock is free
    while (this.held.get(name)) {
      await new Promise<void>((resolve) => {
        if (!this.queue.has(name)) this.queue.set(name, []);
        this.queue.get(name)!.push(resolve);
      });
    }
    this.held.set(name, true);
    try {
      return await callback({ name });
    } finally {
      this.held.set(name, false);
      // Release the next waiter, if any
      const q = this.queue.get(name);
      if (q && q.length > 0) {
        q.shift()!();
      }
    }
  }
}

// ── Mock BroadcastChannel ───────────────────────────────────────────────────

class MockBroadcastChannel {
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private otherChannels: MockBroadcastChannel[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /** Registers a peer channel for message delivery simulation. */
  registerPeer(peer: MockBroadcastChannel): void {
    this.otherChannels.push(peer);
  }

  postMessage(data: unknown): void {
    // Deliver to all peers synchronously (simulates BroadcastChannel)
    for (const peer of this.otherChannels) {
      if (peer.onmessage) {
        peer.onmessage(new MessageEvent("message", { data }));
      }
    }
  }

  close(): void {
    this.onmessage = null;
  }
}

// ── Test helpers ────────────────────────────────────────────────────────────

/**
 * Creates a shared test environment with a common lock manager and storage,
 * plus per-tab BroadcastChannel pairs. Multiple coordinators created via
 * `createCoordinator` share the same lock manager and storage, so they
 * simulate cross-tab coordination.
 */
function createTestEnv() {
  const lockManager = new MockLockManager();
  const storage = new FakeStorage();
  const allChannels: MockBroadcastChannel[] = [];

  function createCoordinator(tabId: string): {
    coord: PendingGrantCoordinator;
    channel: MockBroadcastChannel;
  } {
    const channel = new MockBroadcastChannel("exam.pending-grant-coordinator");
    // Register this channel with all existing peers
    for (const existing of allChannels) {
      channel.registerPeer(existing);
      existing.registerPeer(channel);
    }
    allChannels.push(channel);

    const deps: CoordinatorDependencies = {
      tabId,
      leaseDurationMs: 30_000,
      lockRequest: lockManager.request as <T>(
        name: string,
        callback: (lock: { name: string } | null) => Promise<T>,
      ) => Promise<T>,
      broadcastChannel: channel,
      storage,
      now: () => Date.now(),
    };
    const coord = new PendingGrantCoordinator(deps);
    return { coord, channel };
  }

  return { lockManager, storage, createCoordinator, allChannels };
}

/** A simple in-memory Storage implementation for testing. */
class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/** A Storage implementation that always throws, simulating a disabled API. */
class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("Storage access denied");
  }
  clear(): void {
    throw new Error("Storage access denied");
  }
  getItem(): string | null {
    throw new Error("Storage access denied");
  }
  key(): string | null {
    throw new Error("Storage access denied");
  }
  removeItem(): void {
    throw new Error("Storage access denied");
  }
  setItem(): void {
    throw new Error("Storage access denied");
  }
}

describe("PendingGrantCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. No record → successful reserve returns a first-send claim ────────

  it("reserves a command and returns the first-send claim", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    const result = await coord.reserve(ORG_A, ACTOR_1, COMMAND);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authority.schemaVersion).toBe(1);
    expect(result.authority.organizationId).toBe(ORG_A);
    expect(result.authority.actorId).toBe(ACTOR_1);
    expect(result.authority.command.operationId).toBe(COMMAND.operationId);
    expect(result.authority.command.attemptId).toBe(COMMAND.attemptId);
    expect(result.authority.revision).toBe(1);
    expect(result.authority.createdAt).toBe(Date.now());
    expect(result.authority.inFlightLease).toBeDefined();
    expect(result.authority.inFlightLease!.tabId).toBe(TAB_A);
    expect(result.authority.inFlightLease!.expiresAt).toBe(Date.now() + 30_000);
    // First-send claim mirrors the freshly created authority.
    const claim = result.claim;
    expect(claim.operationId).toBe(COMMAND.operationId);
    expect(claim.revision).toBe(1);
    expect(claim.leaseId).toBe(result.authority.inFlightLease!.leaseId);
  });

  // ── 2. Two calls reserve simultaneously → only one succeeds ──────────────

  it("two simultaneous reserves: only the first succeeds", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // Reserve from A first
    const resultA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(resultA.ok).toBe(true);

    // B should fail because A already holds the authority
    const resultB = await coordB.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(resultB.ok).toBe(false);
    if (resultB.ok) return;
    expect(resultB.error).toBeInstanceOf(AlreadyPendingError);
    if (resultB.error instanceof AlreadyPendingError) {
      expect(resultB.error.existing.command.operationId).toBe("op-1");
    }
  });

  // ── 3. Second tab recovers the full command ─────────────────────────────

  it("second tab recovers the full pending command", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // B reads the current authority
    const current = await coordB.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).not.toBeNull();
    expect(current.authority!.command.operationId).toBe("op-1");
    expect(current.authority!.command.attemptId).toBe("att-1");
    expect(current.authority!.command.addedSeconds).toBe(600);
    expect(current.authority!.command.reasonCode).toBe("technical_incident");
    expect(current.authority!.command.reasonText).toBe("网络中断");
    expect(current.authority!.revision).toBe(1);
  });

  // ── 4. Different attempt is blocked ─────────────────────────────────────

  it("blocks reserve for a different attempt when one is already pending", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    // Reserve for att-1
    const resultA = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(resultA.ok).toBe(true);

    // Try to reserve for att-2 — should fail because the authority is
    // per-(orgId, actorId), not per-attempt.
    const resultB = await coord.reserve(ORG_A, ACTOR_1, COMMAND_DIFF_ATTEMPT);
    expect(resultB.ok).toBe(false);
    if (resultB.ok) return;
    expect(resultB.error).toBeInstanceOf(AlreadyPendingError);
  });

  // ── 5. claimForSend succeeds when no lease exists (first claim after release) ─

  it("claimForSend succeeds when there is no lease", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves (lease held by A), then releases it so the authority exists
    // without an active lease.
    const reserve = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;
    const released = await coordA.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      reserve.claim,
    );
    expect(released.ok).toBe(true);

    // B can now claim with no active lease.
    const claim = await coordB.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.claim.operationId).toBe(COMMAND.operationId);
    expect(claim.authority.inFlightLease!.tabId).toBe(TAB_B);
  });

  // ── 6. claimForSend succeeds on an EXPIRED lease ─────────────────────────

  it("claimForSend takes over an expired lease", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command (lease valid for 30s)
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // Advance time past the lease expiry
    vi.advanceTimersByTime(31_000);

    // B can claim
    const claim = await coordB.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.authority.command.operationId).toBe("op-1");
    expect(claim.authority.command.attemptId).toBe("att-1");
    // The command must be identical — no new operationId
    expect(claim.authority.command.operationId).toBe(COMMAND.operationId);
    // Lease is now held by B
    expect(claim.authority.inFlightLease).toBeDefined();
    expect(claim.authority.inFlightLease!.tabId).toBe(TAB_B);
    // Revision incremented
    expect(claim.authority.revision).toBe(2);
  });

  // ── 7. claimForSend refuses a NON-EXPIRED lease (different tab) ──────────

  it("refuses claimForSend while another tab's lease is valid", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command (lease valid for 30s)
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // B tries to claim while lease is still valid
    const claim = await coordB.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBeInstanceOf(LeaseConflictError);
  });

  // ── 8. claimForSend refuses a NON-EXPIRED lease held by the SAME tab ─────

  it("refuses claimForSend while the SAME tab's lease is still valid", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    // A reserves (lease valid for 30s). A retrying without release must not
    // mint a second concurrent claim for the same tab — a single in-flight
    // send claim per authority revision is the invariant.
    const reserve = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);

    const claim = await coord.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBeInstanceOf(LeaseConflictError);
  });

  // ── 9. Two coordinators claim concurrently → only one succeeds ───────────

  it("two concurrent claimForSend: only one succeeds (lock serializes)", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves then releases, leaving an authority with no active lease.
    const reserve = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;
    const released = await coordA.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      reserve.claim,
    );
    expect(released.ok).toBe(true);

    // Both A and B claim concurrently. The shared lock serializes them: the
    // first acquires the lease, the second must get LeaseConflictError.
    const [claimA, claimB] = await Promise.all([
      coordA.claimForSend(ORG_A, ACTOR_1, COMMAND),
      coordB.claimForSend(ORG_A, ACTOR_1, COMMAND),
    ]);
    const oks = [claimA.ok, claimB.ok].filter(Boolean).length;
    expect(oks).toBe(1);
    // Exactly one returned a claim and the other a LeaseConflictError.
    if (claimA.ok && !claimB.ok) {
      expect(claimB.error).toBeInstanceOf(LeaseConflictError);
    } else if (claimB.ok && !claimA.ok) {
      expect(claimA.error).toBeInstanceOf(LeaseConflictError);
    } else {
      throw new Error("expected exactly one successful concurrent claim");
    }
  });

  // ── 10. claimForSend rejects a mutated frozen command (fail closed) ──────

  it("claimForSend rejects a mutated frozen command and leaves the authority intact", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves the canonical command (op-1 / att-1 / 600s).
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // Let the lease expire so B is eligible to claim.
    vi.advanceTimersByTime(31_000);

    // B attempts a claim with the SAME operationId but a MUTATED payload
    // (addedSeconds 600 → 1200). This must fail closed: a retry must replay
    // the exact frozen command, never overwrite it.
    const claim = await coordB.claimForSend(
      ORG_A,
      ACTOR_1,
      COMMAND_SAME_OP_DIFF_PAYLOAD,
    );
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBeInstanceOf(CoordinationUnavailableError);

    // The stored authority must be unchanged: same command, same revision (1),
    // no new lease for B. A mutation must not silently persist.
    const current = await coordA.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).not.toBeNull();
    expect(current.authority!.command.addedSeconds).toBe(600);
    expect(current.authority!.revision).toBe(1);
  });

  // ── 11. releaseIndeterminate: keeps command, removes lease, revision+1 ───

  it("releaseIndeterminate keeps the command, removes the lease, and bumps revision", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    const reserve = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;
    const beforeRev = reserve.authority.revision;
    const beforeCmd = reserve.authority.command;

    const released = await coord.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      reserve.claim,
    );
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    // Command preserved verbatim.
    expect(released.authority.command).toEqual(beforeCmd);
    // Lease removed.
    expect(released.authority.inFlightLease).toBeUndefined();
    // Revision bumped so the released claim cannot later clear or re-release.
    expect(released.authority.revision).toBe(beforeRev + 1);

    // A fresh claimForSend now succeeds (no active lease).
    const claim = await coord.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claim.ok).toBe(true);
  });

  // ── 12. releaseIndeterminate rejects a STALE claim (mismatch) ────────────

  it("releaseIndeterminate rejects a stale claim", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);

    const reserve = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;
    const staleClaim: PendingGrantSendClaim = { ...reserve.claim };

    // A releases legitimately; revision bumps and leaseId is gone.
    const released = await coordA.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      reserve.claim,
    );
    expect(released.ok).toBe(true);

    // A stale retry of the original release must mismatch — it cannot operate
    // on the authority after revision bumped.
    const stale = await coordA.releaseIndeterminate(ORG_A, ACTOR_1, staleClaim);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error).toBeInstanceOf(CompareAndClearMismatchError);
  });

  // ── 13. clearConfirmed requires the FULL claim (operationId+revision+leaseId) ─

  it("clears authority with matching full claim", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    const reserve = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;

    // Clear with the full matching claim.
    const clear = await coord.clearConfirmed(ORG_A, ACTOR_1, reserve.claim);
    expect(clear.ok).toBe(true);

    // Authority should now be gone
    const current = await coord.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).toBeNull();
  });

  // ── 14. clearConfirmed refuses a stale claim ─────────────────────────────

  it("refuses clear with a stale claim (compare-and-clear mismatch)", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command (rev 1)
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);
    if (!reserveA.ok) return;
    const staleClaim = reserveA.claim;

    // Advance time so lease expires
    vi.advanceTimersByTime(31_000);

    // B claims (rev 2, new leaseId)
    const claimB = await coordB.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claimB.ok).toBe(true);
    if (!claimB.ok) return;

    // Now A (stale rev-1 claim) tries to clear — must fail.
    const staleClear = await coordA.clearConfirmed(ORG_A, ACTOR_1, staleClaim);
    expect(staleClear.ok).toBe(false);
    if (staleClear.ok) return;
    expect(staleClear.error).toBeInstanceOf(CompareAndClearMismatchError);

    // B can still clear with its fresh full claim.
    const freshClear = await coordB.clearConfirmed(
      ORG_A,
      ACTOR_1,
      claimB.claim,
    );
    expect(freshClear.ok).toBe(true);
  });

  // ── 15. New claim makes an OLD response's clear mismatch (stale late clear) ─

  it("a late stale response cannot clear an authority that was re-claimed", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves (rev 1) then releases legitimately (rev 2, no lease).
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);
    if (!reserveA.ok) return;
    const released = await coordA.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      reserveA.claim,
    );
    expect(released.ok).toBe(true);

    // B claims (rev 3, new leaseId). The authority now belongs to B's claim.
    const claimB = await coordB.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claimB.ok).toBe(true);
    if (!claimB.ok) return;

    // A's original (rev-1) confirmed response arrives LATE and tries to clear.
    // It must mismatch — otherwise it would delete B's in-flight claim.
    const lateClear = await coordA.clearConfirmed(
      ORG_A,
      ACTOR_1,
      reserveA.claim,
    );
    expect(lateClear.ok).toBe(false);
    if (lateClear.ok) return;
    expect(lateClear.error).toBeInstanceOf(CompareAndClearMismatchError);

    // B's authority is intact.
    const current = await coordB.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).not.toBeNull();
    expect(current.authority!.revision).toBe(3);
  });

  // ── 16. Corrupted record fails closed ────────────────────────────────────

  it("corrupted storage record fails closed", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    // Write garbage to the storage key
    const key = `exam.pendingGrantAuthority:${ORG_A}:${ACTOR_1}`;
    env.storage.setItem(key, "not-valid-json{{{");

    // Reserve should fail closed
    const result = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(CoordinationUnavailableError);

    // getCurrent should also fail closed
    const current = await coord.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(false);
    if (current.ok) return;
    expect(current.error).toBeInstanceOf(CoordinationUnavailableError);
  });

  // ── 17. Storage write failure fails closed ──────────────────────────────

  it("storage write failure fails closed", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    // Make setItem throw on the shared storage
    const setItemSpy = vi
      .spyOn(env.storage, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage quota exceeded");
      });

    const result = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(CoordinationUnavailableError);

    setItemSpy.mockRestore();
  });

  // ── 18. Actor / organization isolation ──────────────────────────────────

  it("isolates authorities by actorId", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    // Actor 1 reserves a command
    const result1 = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(result1.ok).toBe(true);

    // Actor 2 (same org) can reserve a different command
    const result2 = await coord.reserve(ORG_A, ACTOR_2, COMMAND_DIFF_ATTEMPT);
    expect(result2.ok).toBe(true);
  });

  it("isolates authorities by organizationId", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    // Org A, Actor 1 reserves
    const resultA = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(resultA.ok).toBe(true);

    // Org B, Actor 1 (same actor, different org) can reserve independently
    const resultB = await coord.reserve(ORG_B, ACTOR_1, COMMAND_DIFF_ATTEMPT);
    expect(resultB.ok).toBe(true);
  });

  // ── 19. BroadcastChannel notifies other tabs ────────────────────────────

  it("broadcasts authority_created on reserve", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    // Create a second coordinator to receive the broadcast
    const { channel: channelB } = env.createCoordinator(TAB_B);

    const received: AuthorityChangeEvent[] = [];
    channelB.onmessage = (event: MessageEvent) => {
      received.push(event.data as AuthorityChangeEvent);
    };

    await coordA.reserve(ORG_A, ACTOR_1, COMMAND);

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({
      type: "authority_created",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });
  });

  it("broadcasts authority_cleared on clearConfirmed", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { channel: channelB } = env.createCoordinator(TAB_B);

    const received: AuthorityChangeEvent[] = [];
    channelB.onmessage = (event: MessageEvent) => {
      received.push(event.data as AuthorityChangeEvent);
    };

    const reserve = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;
    await coordA.clearConfirmed(ORG_A, ACTOR_1, reserve.claim);

    // The clear should produce a broadcast
    const clearEvents = received.filter((r) => r.type === "authority_cleared");
    expect(clearEvents.length).toBe(1);
    expect(clearEvents[0]).toEqual({
      type: "authority_cleared",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });
  });

  // ── 20. claimForSend broadcasts lease_acquired; release broadcasts lease_released ─

  it("broadcasts lease_acquired on claimForSend and lease_released on releaseIndeterminate", async () => {
    const env = createTestEnv();
    const { coord: coordA, channel: channelA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    const received: AuthorityChangeEvent[] = [];
    channelA.onmessage = (event: MessageEvent) => {
      received.push(event.data as AuthorityChangeEvent);
    };

    await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    vi.advanceTimersByTime(31_000);
    const claimB = await coordB.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claimB.ok).toBe(true);
    if (!claimB.ok) return;

    // A should receive the lease_acquired broadcast (from B's claim).
    const leaseEvents = received.filter((r) => r.type === "lease_acquired");
    expect(leaseEvents.length).toBe(1);
    expect(leaseEvents[0]).toEqual({
      type: "lease_acquired",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });

    // B releases the lease.
    const released = await coordB.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      claimB.claim,
    );
    expect(released.ok).toBe(true);

    const releasedEvents = received.filter((r) => r.type === "lease_released");
    expect(releasedEvents.length).toBe(1);
    expect(releasedEvents[0]).toEqual({
      type: "lease_released",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });
  });

  // ── 21. Subscribe callback receives events ──────────────────────────────

  it("calls subscribe callback on authority changes", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    const events: unknown[] = [];
    const unsubscribe = coord.subscribe((event) => {
      events.push(event);
    });

    await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      type: "authority_created",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });

    // No more events after unsubscribe
    events.length = 0;
    unsubscribe();

    const reserve = await coord.reserve(ORG_B, ACTOR_2, COMMAND);
    expect(reserve.ok).toBe(true);
    expect(events.length).toBe(0);
  });

  // ── 22. Lease expiry is detected by getCurrent ──────────────────────────

  it("reports authority with expired lease via getCurrent", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    vi.advanceTimersByTime(31_000);

    const current = await coord.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).not.toBeNull();
    // The lease is still present but expired — the caller decides what to do
    expect(current.authority!.inFlightLease).toBeDefined();
    expect(current.authority!.inFlightLease!.expiresAt).toBeLessThan(
      Date.now(),
    );
  });

  // ── 23. A failing lock never rejects the public API ─────────────────────
  //
  // The fail-closed default dependency rejects lockRequest when Web Locks is
  // unavailable. This test proves every public method converts that rejection
  // into a { ok: false } Result rather than rejecting the returned Promise —
  // the page never needs a try/catch around coordinator calls.

  it("public methods return a Result (never reject) when lock acquisition fails", async () => {
    // Build a coordinator whose lockRequest always rejects, simulating a
    // missing/unusable Web Locks API (the production fail-closed default).
    const throwingLockRequest = vi.fn(
      (): Promise<never> =>
        Promise.reject(
          new CoordinationUnavailableError(
            "Web Locks API unavailable: cannot coordinate cross-tab grants safely",
          ),
        ),
    );
    const coord = new PendingGrantCoordinator({
      tabId: TAB_A,
      leaseDurationMs: 30_000,
      lockRequest:
        throwingLockRequest as CoordinatorDependencies["lockRequest"],
      broadcastChannel: new MockBroadcastChannel("test"),
      storage: new FakeStorage(),
      now: () => Date.now(),
    });

    const fakeClaim: PendingGrantSendClaim = {
      operationId: "op-1",
      revision: 1,
      leaseId: "lease-1",
    };

    // reserve — returns a Result, does not reject.
    const reserve = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(false);
    if (reserve.ok) return;
    expect(reserve.error).toBeInstanceOf(CoordinationUnavailableError);

    // claimForSend — returns a Result, does not reject.
    const claim = await coord.claimForSend(ORG_A, ACTOR_1, COMMAND);
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.error).toBeInstanceOf(CoordinationUnavailableError);

    // releaseIndeterminate — returns a Result, does not reject.
    const released = await coord.releaseIndeterminate(
      ORG_A,
      ACTOR_1,
      fakeClaim,
    );
    expect(released.ok).toBe(false);
    if (released.ok) return;
    expect(released.error).toBeInstanceOf(CoordinationUnavailableError);

    // clearConfirmed — returns a Result, does not reject.
    const clear = await coord.clearConfirmed(ORG_A, ACTOR_1, fakeClaim);
    expect(clear.ok).toBe(false);
    if (clear.ok) return;
    expect(clear.error).toBeInstanceOf(CoordinationUnavailableError);

    // getCurrent — returns a Result, does not reject.
    const current = await coord.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(false);
    if (current.ok) return;
    expect(current.error).toBeInstanceOf(CoordinationUnavailableError);

    coord.destroy();
  });

  // ── 24. Lazy storage: constructor tolerates unavailable localStorage ───────
  //
  // The production singleton calls `new PendingGrantCoordinator()` during page
  // load. Browser policies that block the localStorage getter (e.g. disabled
  // storage, SecurityError) must not crash construction; the failure is surfaced
  // later, when a public method actually needs storage, and converted to a
  // Result so the page can show coordinationUnavailable and refuse to send.

  it("constructor does not throw when localStorage getter is blocked", () => {
    const getterSpy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException(
          "Access is denied for this document",
          "SecurityError",
        );
      });

    let coord: PendingGrantCoordinator | undefined;
    expect(() => {
      coord = new PendingGrantCoordinator();
    }).not.toThrow();
    expect(coord).toBeInstanceOf(PendingGrantCoordinator);

    getterSpy.mockRestore();
    coord?.destroy();
  });

  // ── 25. Storage unavailability is surfaced as a Result ───────────────────
  //
  // With a working lock manager but a storage implementation that always throws,
  // getCurrent must fail closed as a CoordinationUnavailableError Result — never
  // reject the Promise and never silently degrade to a fresh uncoordinated draft.

  it("getCurrent returns ok: false when storage is unavailable", async () => {
    const lockManager = new MockLockManager();
    const coord = new PendingGrantCoordinator({
      tabId: TAB_A,
      leaseDurationMs: 30_000,
      lockRequest: lockManager.request as <T>(
        name: string,
        callback: (lock: { name: string } | null) => Promise<T>,
      ) => Promise<T>,
      broadcastChannel: new MockBroadcastChannel("test"),
      storage: new ThrowingStorage(),
      now: () => Date.now(),
    });

    const current = await coord.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(false);
    if (current.ok) return;
    expect(current.error).toBeInstanceOf(CoordinationUnavailableError);

    coord.destroy();
  });
});
