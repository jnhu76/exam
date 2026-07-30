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
  type AuthorityChangeEvent,
  commandDigest,
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

  // ── 1. No record → successful reserve ────────────────────────────────────

  it("reserves a command when no authority exists", async () => {
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

  // ── 5. Take over expired lease ──────────────────────────────────────────

  it("takes over an expired lease", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command (lease valid for 30s)
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // Advance time past the lease expiry
    vi.advanceTimersByTime(31_000);

    // B can take over
    const takeOver = await coordB.takeOver(ORG_A, ACTOR_1, COMMAND);
    expect(takeOver.ok).toBe(true);
    if (!takeOver.ok) return;
    expect(takeOver.authority.command.operationId).toBe("op-1");
    expect(takeOver.authority.command.attemptId).toBe("att-1");
    // The command must be identical — no new operationId
    expect(takeOver.authority.command.operationId).toBe(COMMAND.operationId);
    // Lease is now held by B
    expect(takeOver.authority.inFlightLease).toBeDefined();
    expect(takeOver.authority.inFlightLease!.tabId).toBe(TAB_B);
    // Revision incremented
    expect(takeOver.authority.revision).toBe(2);
  });

  // ── 6. Non-expired lease cannot be taken over ───────────────────────────

  it("refuses takeover of a non-expired lease", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command (lease valid for 30s)
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // B tries to take over while lease is still valid
    const takeOver = await coordB.takeOver(ORG_A, ACTOR_1, COMMAND);
    expect(takeOver.ok).toBe(false);
    if (takeOver.ok) return;
    expect(takeOver.error).toBeInstanceOf(LeaseConflictError);
  });

  // ── 7. Compare-and-clear on confirmed outcome ───────────────────────────

  it("clears authority with matching compare-and-clear", async () => {
    const env = createTestEnv();
    const { coord } = env.createCoordinator(TAB_A);

    const reserve = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(true);
    if (!reserve.ok) return;

    // Clear with matching operationId + revision
    const clear = await coord.clearConfirmed(ORG_A, ACTOR_1, {
      operationId: "op-1",
      revision: 1,
    });
    expect(clear.ok).toBe(true);

    // Authority should now be gone
    const current = await coord.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).toBeNull();
  });

  // ── 8. Old revision cannot clear new record ─────────────────────────────

  it("refuses clear with stale revision (compare-and-clear mismatch)", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves a command (rev 1)
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // Advance time so lease expires
    vi.advanceTimersByTime(31_000);

    // B takes over (rev 2)
    const takeOver = await coordB.takeOver(ORG_A, ACTOR_1, COMMAND);
    expect(takeOver.ok).toBe(true);

    // Now A (stale) tries to clear with revision 1 — should fail
    const staleClear = await coordA.clearConfirmed(ORG_A, ACTOR_1, {
      operationId: "op-1",
      revision: 1,
    });
    expect(staleClear.ok).toBe(false);
    if (staleClear.ok) return;
    expect(staleClear.error).toBeInstanceOf(CompareAndClearMismatchError);

    // B can still clear with rev 2
    const freshClear = await coordB.clearConfirmed(ORG_A, ACTOR_1, {
      operationId: "op-1",
      revision: 2,
    });
    expect(freshClear.ok).toBe(true);
  });

  // ── 9. Corrupted record fails closed ────────────────────────────────────

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

  // ── 10. Storage write failure fails closed ──────────────────────────────

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

  // ── 11. Actor / organization isolation ──────────────────────────────────

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

  // ── 12. BroadcastChannel notifies other tabs ────────────────────────────

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

    await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    await coordA.clearConfirmed(ORG_A, ACTOR_1, {
      operationId: "op-1",
      revision: 1,
    });

    // The clear should produce a broadcast
    const clearEvents = received.filter((r) => r.type === "authority_cleared");
    expect(clearEvents.length).toBe(1);
    expect(clearEvents[0]).toEqual({
      type: "authority_cleared",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });
  });

  // ── 13. TakeOver broadcasts lease_acquired ──────────────────────────────

  it("broadcasts lease_acquired on takeover", async () => {
    const env = createTestEnv();
    const { coord: coordA, channel: channelA } = env.createCoordinator(TAB_A);
    const { coord: coordB, channel: channelB } = env.createCoordinator(TAB_B);

    const received: AuthorityChangeEvent[] = [];
    channelA.onmessage = (event: MessageEvent) => {
      received.push(event.data as AuthorityChangeEvent);
    };

    await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    vi.advanceTimersByTime(31_000);
    await coordB.takeOver(ORG_A, ACTOR_1, COMMAND);

    // A should receive the lease_acquired broadcast
    const leaseEvents = received.filter((r) => r.type === "lease_acquired");
    expect(leaseEvents.length).toBe(1);
    expect(leaseEvents[0]).toEqual({
      type: "lease_acquired",
      organizationId: ORG_A,
      actorId: ACTOR_1,
    });
  });

  // ── 14. Subscribe callback receives events ──────────────────────────────

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

    await coord.clearConfirmed(ORG_A, ACTOR_1, {
      operationId: "op-1",
      revision: 1,
    });
    expect(events.length).toBe(0);
  });

  // ── 15. Lease expiry is detected by getCurrent ──────────────────────────

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

  // ── 16. takeOver rejects a mutated frozen command (B4) ───────────────────

  it("takeOver rejects a mutated frozen command and leaves the authority intact", async () => {
    const env = createTestEnv();
    const { coord: coordA } = env.createCoordinator(TAB_A);
    const { coord: coordB } = env.createCoordinator(TAB_B);

    // A reserves the canonical command (op-1 / att-1 / 600s).
    const reserveA = await coordA.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserveA.ok).toBe(true);

    // Let the lease expire so B is eligible to take over.
    vi.advanceTimersByTime(31_000);

    // B attempts a takeover with the SAME operationId but a MUTATED payload
    // (addedSeconds 600 → 1200). This must fail closed: a takeover must replay
    // the exact frozen command, never overwrite it.
    const takeOver = await coordB.takeOver(
      ORG_A,
      ACTOR_1,
      COMMAND_SAME_OP_DIFF_PAYLOAD,
    );
    expect(takeOver.ok).toBe(false);
    if (takeOver.ok) return;
    expect(takeOver.error).toBeInstanceOf(CoordinationUnavailableError);

    // The stored authority must be unchanged: same command, same revision (1),
    // no new lease for B. A mutation must not silently persist.
    const current = await coordA.getCurrent(ORG_A, ACTOR_1);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.authority).not.toBeNull();
    expect(current.authority!.command.addedSeconds).toBe(600);
    expect(current.authority!.revision).toBe(1);
  });

  // ── 17. A failing lock never rejects the public API (B3) ─────────────────
  //
  // The fail-closed default dependency rejects lockRequest when Web Locks is
  // unavailable. This test proves the four public methods convert that
  // rejection into a { ok: false } Result rather than rejecting the returned
  // Promise — the page never needs a try/catch around coordinator calls.

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
        throwingLockRequest as unknown as CoordinatorDependencies["lockRequest"],
      broadcastChannel: new MockBroadcastChannel("test"),
      storage: new FakeStorage(),
      now: () => Date.now(),
    });

    // reserve — returns a Result, does not reject.
    const reserve = await coord.reserve(ORG_A, ACTOR_1, COMMAND);
    expect(reserve.ok).toBe(false);
    if (reserve.ok) return;
    expect(reserve.error).toBeInstanceOf(CoordinationUnavailableError);

    // takeOver — returns a Result, does not reject.
    const takeOver = await coord.takeOver(ORG_A, ACTOR_1, COMMAND);
    expect(takeOver.ok).toBe(false);
    if (takeOver.ok) return;
    expect(takeOver.error).toBeInstanceOf(CoordinationUnavailableError);

    // clearConfirmed — returns a Result, does not reject.
    const clear = await coord.clearConfirmed(ORG_A, ACTOR_1, {
      operationId: "op-1",
      revision: 1,
    });
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

  // ── 18. Lazy storage: constructor tolerates unavailable localStorage ───────
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

  // ── 19. Storage unavailability is surfaced as a Result (B5) ───────────────
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
