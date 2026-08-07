import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPendingForceSubmit,
  savePendingForceSubmit,
  clearPendingForceSubmit,
  type PendingForceSubmitAuthority,
} from "./pendingForceSubmitAuthority";

const ORG_ID = "org-test";
const ACTOR_ID = "actor-test";
const STORAGE_KEY = `exam.pendingForceSubmit:${ORG_ID}:${ACTOR_ID}`;

function validAuthority(
  overrides: Partial<PendingForceSubmitAuthority> = {},
): PendingForceSubmitAuthority {
  return {
    schemaVersion: 1,
    organizationId: ORG_ID,
    actorId: ACTOR_ID,
    command: {
      attemptId: "00000000-0000-4000-8000-000000000001",
      operationId: "00000000-0000-4000-8000-000000000002",
      reason: "管理员强制交卷",
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("pendingForceSubmitAuthority", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Save ──────────────────────────────────────────────────────────────

  describe("savePendingForceSubmit", () => {
    it("persists a valid authority and read-back matches", () => {
      const auth = validAuthority();
      const result = savePendingForceSubmit(auth);
      expect(result).toEqual({ ok: true });
      const stored = sessionStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.command.attemptId).toBe(auth.command.attemptId);
      expect(parsed.command.operationId).toBe(auth.command.operationId);
    });

    it("returns storage_unavailable when sessionStorage is inaccessible", () => {
      // getStorage() checks `window.sessionStorage` directly; make it return
      // null so getStorage() returns null → storage_unavailable.
      const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
      Object.defineProperty(window, "sessionStorage", {
        value: null,
        configurable: true,
      });
      try {
        const result = savePendingForceSubmit(validAuthority());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("storage_unavailable");
      } finally {
        Object.defineProperty(window, "sessionStorage", real);
      }
    });

    it("returns write_failed when setItem throws", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      });
      const result = savePendingForceSubmit(validAuthority());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("write_failed");
    });

    it("returns write_failed when read-back is absent", () => {
      const origGetItem = Storage.prototype.getItem;
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
        key: string,
      ) {
        if (key === STORAGE_KEY) return null;
        return origGetItem.call(this, key);
      });
      const result = savePendingForceSubmit(validAuthority());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("write_failed");
    });

    it("returns readback_mismatch when read-back bytes differ", () => {
      const origGetItem = Storage.prototype.getItem;
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
        this: Storage,
        key: string,
      ) {
        const value = origGetItem.call(this, key);
        if (key === STORAGE_KEY && value !== null) {
          return JSON.stringify(JSON.parse(value), null, 2);
        }
        return value;
      });
      const result = savePendingForceSubmit(validAuthority());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("readback_mismatch");
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("covers schemaVersion in byte-equal check", () => {
      const origSetItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        origSetItem.call(this, key, value);
        // Corrupt schemaVersion after write
        const corrupted = JSON.parse(value);
        corrupted.schemaVersion = 99;
        origSetItem.call(this, key, JSON.stringify(corrupted));
      });
      const result = savePendingForceSubmit(validAuthority());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("readback_mismatch");
    });

    it("covers createdAt in byte-equal check", () => {
      const origSetItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        origSetItem.call(this, key, value);
        const corrupted = JSON.parse(value);
        corrupted.createdAt = corrupted.createdAt + 99999;
        origSetItem.call(this, key, JSON.stringify(corrupted));
      });
      const result = savePendingForceSubmit(validAuthority());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("readback_mismatch");
    });
  });

  // ── Load ──────────────────────────────────────────────────────────────

  describe("loadPendingForceSubmit", () => {
    it("returns authority for a valid stored record", () => {
      const auth = validAuthority();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("authority");
      if (result.kind === "authority") {
        expect(result.authority.command.attemptId).toBe(auth.command.attemptId);
        expect(result.authority.command.operationId).toBe(
          auth.command.operationId,
        );
      }
    });

    it("returns none when nothing is stored", () => {
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("none");
    });

    it("returns corrupt + clears when JSON is invalid", () => {
      sessionStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns corrupt when organizationId does not match", () => {
      const auth = validAuthority({ organizationId: "wrong-org" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns corrupt when actorId does not match", () => {
      const auth = validAuthority({ actorId: "wrong-actor" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns corrupt when schemaVersion is not 1", () => {
      const auth = validAuthority() as unknown as Record<string, unknown>;
      auth.schemaVersion = 2;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns corrupt when attemptId is empty", () => {
      const auth = validAuthority();
      auth.command.attemptId = "";
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns corrupt when operationId is not a valid UUID", () => {
      const auth = validAuthority();
      auth.command.operationId = "not-a-uuid";
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns corrupt when reason is empty", () => {
      const auth = validAuthority();
      auth.command.reason = "";
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns corrupt when reason has leading whitespace", () => {
      const auth = validAuthority();
      auth.command.reason = " 管理员强制交卷";
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns corrupt when createdAt is NaN", () => {
      const auth = validAuthority();
      (auth as unknown as Record<string, unknown>).createdAt = NaN;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns corrupt when createdAt is Infinity", () => {
      const auth = validAuthority();
      (auth as unknown as Record<string, unknown>).createdAt = Infinity;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.kind).toBe("corrupt");
    });

    it("returns none when sessionStorage is inaccessible", () => {
      const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
      Object.defineProperty(window, "sessionStorage", {
        value: null,
        configurable: true,
      });
      try {
        const result = loadPendingForceSubmit(ORG_ID, ACTOR_ID);
        expect(result.kind).toBe("none");
      } finally {
        Object.defineProperty(window, "sessionStorage", real);
      }
    });
  });

  // ── Clear ─────────────────────────────────────────────────────────────

  describe("clearPendingForceSubmit", () => {
    it("removes the record and read-back confirms null", () => {
      const auth = validAuthority();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: true });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns storage_unavailable when sessionStorage is inaccessible", () => {
      const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
      Object.defineProperty(window, "sessionStorage", {
        value: null,
        configurable: true,
      });
      try {
        const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("storage_unavailable");
      } finally {
        Object.defineProperty(window, "sessionStorage", real);
      }
    });

    it("returns remove_failed when removeItem throws", () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
        this: Storage,
        key: string,
      ) {
        if (key === STORAGE_KEY) {
          throw new DOMException("blocked", "SecurityError");
        }
      });
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("remove_failed");
    });

    it("returns remove_failed when read-back still finds the record after removeItem", () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      // Mock removeItem to not actually remove (simulate silent failure)
      const origRemoveItem = Storage.prototype.removeItem;
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
        this: Storage,
        key: string,
      ) {
        if (key === STORAGE_KEY) return; // Don't actually remove
        origRemoveItem.call(this, key);
      });
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("remove_failed");
      expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it("returns ok when nothing to clear (idempotent)", () => {
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: true });
    });
  });
});
