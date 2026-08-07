import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPendingMisconduct,
  savePendingMisconduct,
  clearPendingMisconduct,
  type PendingMisconductAuthority,
} from "./pendingMisconductAuthority";

const ORG_ID = "org-test";
const ACTOR_ID = "actor-test";
const STORAGE_KEY = `exam.pendingMisconduct:${ORG_ID}:${ACTOR_ID}`;

function validAuthority(
  overrides: Partial<PendingMisconductAuthority> = {},
): PendingMisconductAuthority {
  return {
    schemaVersion: 2,
    organizationId: ORG_ID,
    actorId: ACTOR_ID,
    command: {
      attemptId: "00000000-0000-4000-8000-000000000001",
      operationId: "00000000-0000-4000-8000-000000000002",
      severity: "serious",
      notes: "candidate looked at notes",
      examId: "exam-1",
      candidateName: "张三",
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("pendingMisconductAuthority", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadPendingMisconduct", () => {
    it("returns none when nothing is stored", () => {
      expect(loadPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({ kind: "none" });
    });

    it("returns authority for a valid stored record", () => {
      const authority = validAuthority();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
      const result = loadPendingMisconduct(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ kind: "authority", authority });
    });

    it("clears and surfaces corrupt when the JSON is unparseable", () => {
      sessionStorage.setItem(STORAGE_KEY, "{not json");
      const result = loadPendingMisconduct(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ kind: "corrupt", cleared: true });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("clears and surfaces corrupt for a different organizationId", () => {
      const authority = validAuthority({ organizationId: "other-org" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
      expect(loadPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({
        kind: "corrupt",
        cleared: true,
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("clears and surfaces corrupt for a different actorId", () => {
      const authority = validAuthority({ actorId: "other-actor" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
      expect(loadPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({
        kind: "corrupt",
        cleared: true,
      });
    });

    it.each([
      ["schemaVersion", { schemaVersion: 1 }],
      ["createdAt not finite", { createdAt: Number.NaN }],
      [
        "operationId not uuid",
        { command: { ...validAuthority().command, operationId: "not-a-uuid" } },
      ],
      [
        "severity invalid",
        { command: { ...validAuthority().command, severity: "critical" } },
      ],
      [
        "notes blank",
        { command: { ...validAuthority().command, notes: "   " } },
      ],
      [
        "notes untrimmed",
        { command: { ...validAuthority().command, notes: " x" } },
      ],
      [
        "notes too long",
        { command: { ...validAuthority().command, notes: "x".repeat(1001) } },
      ],
      [
        "attemptId empty",
        { command: { ...validAuthority().command, attemptId: "" } },
      ],
      [
        "examId empty",
        { command: { ...validAuthority().command, examId: "" } },
      ],
      [
        "candidateName empty",
        { command: { ...validAuthority().command, candidateName: "" } },
      ],
    ] as Array<[string, Partial<PendingMisconductAuthority>]>)(
      "clears and surfaces corrupt when %s is invalid",
      (_label, overrides) => {
        const authority = validAuthority(overrides);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
        expect(loadPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({
          kind: "corrupt",
          cleared: true,
        });
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      },
    );
  });

  describe("savePendingMisconduct", () => {
    it("persists a valid authority and verifies the write", () => {
      const result = savePendingMisconduct(validAuthority());
      expect(result).toEqual({ ok: true });
      const stored = sessionStorage.getItem(STORAGE_KEY);
      expect(stored).toBe(JSON.stringify(validAuthority()));
    });

    it("returns invalid_authority for a semantically invalid record without writing", () => {
      const invalid = validAuthority({
        command: { ...validAuthority().command, notes: "  " },
      });
      const result = savePendingMisconduct(invalid);
      expect(result).toEqual({ ok: false, error: "invalid_authority" });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns readback_mismatch when the storage returns different bytes and removes them", () => {
      const authority = validAuthority();
      // Real setItem must run, then getItem read-back returns different bytes.
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockReturnValueOnce('{"different":true}');
      const result = savePendingMisconduct(authority);
      expect(result).toEqual({ ok: false, error: "readback_mismatch" });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      getItemSpy.mockRestore();
    });

    it("returns storage_unavailable when sessionStorage is absent", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      // Force getStorage to return null by stubbing window.sessionStorage.
      const original = (globalThis as { sessionStorage?: Storage })
        .sessionStorage;
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: undefined,
      });
      try {
        expect(savePendingMisconduct(validAuthority())).toEqual({
          ok: false,
          error: "storage_unavailable",
        });
      } finally {
        Object.defineProperty(globalThis, "sessionStorage", {
          configurable: true,
          value: original,
        });
      }
    });
  });

  describe("clearPendingMisconduct", () => {
    it("removes a stored record and returns ok", () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      const result = clearPendingMisconduct(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: true });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns ok when nothing is stored", () => {
      expect(clearPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({ ok: true });
    });

    it("returns remove_failed when the record is still present after removal", () => {
      const removeItem = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          // no-op: leave the record in place
        });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      const result = clearPendingMisconduct(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: false, error: "remove_failed" });
      removeItem.mockRestore();
    });
  });

  describe("round-trip", () => {
    it("save then load returns the same authority (mutation-proof)", () => {
      const authority = validAuthority();
      expect(savePendingMisconduct(authority)).toEqual({ ok: true });
      expect(loadPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({
        kind: "authority",
        authority,
      });
    });

    it("a writer-validated record always passes the loader (no writer/reader divergence)", () => {
      // Every field the loader treats as mandatory is validated by the writer;
      // exercise the boundary edge cases a hand-picked comparison would miss.
      const cases: PendingMisconductAuthority[] = [
        validAuthority({ schemaVersion: 2 }),
        validAuthority({ createdAt: 0 }),
        validAuthority({
          command: {
            ...validAuthority().command,
            notes: "x".repeat(1000),
            severity: "warning",
          },
        }),
      ];
      for (const authority of cases) {
        sessionStorage.clear();
        expect(savePendingMisconduct(authority)).toEqual({ ok: true });
        expect(loadPendingMisconduct(ORG_ID, ACTOR_ID)).toEqual({
          kind: "authority",
          authority,
        });
      }
    });
  });
});
