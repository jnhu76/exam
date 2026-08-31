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
    schemaVersion: 2,
    organizationId: ORG_ID,
    actorId: ACTOR_ID,
    command: {
      attemptId: "00000000-0000-4000-8000-000000000001",
      operationId: "00000000-0000-4000-8000-000000000002",
      reason: "管理员强制交卷",
      examId: "exam-1",
      candidateName: "张三",
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

  describe("loadPendingForceSubmit", () => {
    it("returns none when nothing is stored", () => {
      expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
        kind: "none",
      });
    });

    it("returns authority for a valid stored record", () => {
      const authority = validAuthority();
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
      expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
        kind: "authority",
        authority,
      });
    });

    it("clears and surfaces corrupt when the JSON is unparseable", () => {
      sessionStorage.setItem(STORAGE_KEY, "{not json");
      expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
        kind: "corrupt",
        cleared: true,
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("clears and surfaces corrupt for a different organizationId", () => {
      const authority = validAuthority({ organizationId: "other-org" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
      expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
        kind: "corrupt",
        cleared: true,
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("clears and surfaces corrupt for a different actorId", () => {
      const authority = validAuthority({ actorId: "other-actor" });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
      expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
        kind: "corrupt",
        cleared: true,
      });
    });

    it.each([
      ["schemaVersion", { schemaVersion: 1 }],
      // JSON.stringify serializes NaN to null, so this stored-value case
      // exercises the not-a-number path; the Number.isFinite guard itself is
      // reached save-side, before serialization.
      [
        "createdAt serialized from a non-finite value",
        { createdAt: Number.NaN },
      ],
      [
        "operationId not uuid",
        { command: { ...validAuthority().command, operationId: "not-a-uuid" } },
      ],
      [
        "attemptId empty",
        { command: { ...validAuthority().command, attemptId: "" } },
      ],
      [
        "reason blank",
        { command: { ...validAuthority().command, reason: "   " } },
      ],
      [
        "reason untrimmed",
        { command: { ...validAuthority().command, reason: " x" } },
      ],
      // `undefined` is dropped by JSON.stringify, so this exercises the
      // missing-field path, not just the empty-string path.
      [
        "examId missing",
        { command: { ...validAuthority().command, examId: undefined } },
      ],
      [
        "candidateName missing",
        { command: { ...validAuthority().command, candidateName: undefined } },
      ],
      [
        "candidateName empty",
        { command: { ...validAuthority().command, candidateName: "" } },
      ],
      [
        "candidateName too long",
        {
          command: {
            ...validAuthority().command,
            candidateName: "名".repeat(201),
          },
        },
      ],
    ] as Array<[string, Partial<PendingForceSubmitAuthority>]>)(
      "clears and surfaces corrupt when %s is invalid",
      (_label, overrides) => {
        const authority = validAuthority(overrides);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authority));
        expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
          kind: "corrupt",
          cleared: true,
        });
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      },
    );

    it("returns none when sessionStorage is inaccessible", () => {
      const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
      Object.defineProperty(window, "sessionStorage", {
        value: null,
        configurable: true,
      });
      try {
        expect(loadPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
          kind: "none",
        });
      } finally {
        Object.defineProperty(window, "sessionStorage", real);
      }
    });
  });

  describe("savePendingForceSubmit", () => {
    it("persists a valid authority and verifies the write", () => {
      // Capture the authority ONCE — the byte comparison must use the exact
      // record that was written (createdAt is Date.now()-based, so a second
      // validAuthority() call would drift by milliseconds).
      const authority = validAuthority();
      const result = savePendingForceSubmit(authority);
      expect(result).toEqual({ ok: true });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe(
        JSON.stringify(authority),
      );
    });

    it("returns invalid_authority for a semantically invalid record without writing", () => {
      // The save path runs the SAME full validator the loader uses BEFORE
      // writing: the byte read-back only proves the write stuck, it cannot
      // catch a record the loader would treat as corrupt and DELETE —
      // silently destroying the operation identity this save was meant to
      // protect. Per-rule validation coverage lives in the load matrix above;
      // this case owns "invalid → nothing written".
      const invalid = validAuthority({
        command: { ...validAuthority().command, candidateName: "" },
      });
      const result = savePendingForceSubmit(invalid);
      expect(result).toEqual({ ok: false, error: "invalid_authority" });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    // In-memory non-finite createdAt reaches the validator BEFORE
    // serialization — the load-side case above cannot cover this branch,
    // because JSON.stringify has already degraded NaN to null by the time the
    // loader parses it.
    it.each([Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects non-finite createdAt before writing (%s)",
      (createdAt) => {
        const authority = validAuthority({ createdAt });

        expect(savePendingForceSubmit(authority)).toEqual({
          ok: false,
          error: "invalid_authority",
        });

        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      },
    );

    it("returns readback_mismatch when the storage returns different bytes and removes them", () => {
      const authority = validAuthority();
      // Real setItem must run, then getItem read-back returns different bytes.
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockReturnValueOnce('{"different":true}');
      const result = savePendingForceSubmit(authority);
      expect(result).toEqual({ ok: false, error: "readback_mismatch" });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      getItemSpy.mockRestore();
    });

    it("returns write_failed when setItem throws (quota-style exception)", () => {
      const setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        });
      const result = savePendingForceSubmit(validAuthority());
      expect(result).toEqual({ ok: false, error: "write_failed" });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      setItemSpy.mockRestore();
    });

    it("returns write_failed when the read-back returns null (write did not stick)", () => {
      const setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {});
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockReturnValueOnce(null);
      const result = savePendingForceSubmit(validAuthority());
      expect(result).toEqual({ ok: false, error: "write_failed" });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      setItemSpy.mockRestore();
      getItemSpy.mockRestore();
    });

    it("returns write_failed when the read-back getItem throws", () => {
      const setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {});
      const getItemSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementationOnce(() => {
          throw new Error("storage blocked");
        });
      const result = savePendingForceSubmit(validAuthority());
      expect(result).toEqual({ ok: false, error: "write_failed" });
      getItemSpy.mockRestore();
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      setItemSpy.mockRestore();
    });

    it("returns storage_unavailable when sessionStorage is absent", () => {
      const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
      Object.defineProperty(window, "sessionStorage", {
        value: null,
        configurable: true,
      });
      try {
        expect(savePendingForceSubmit(validAuthority())).toEqual({
          ok: false,
          error: "storage_unavailable",
        });
      } finally {
        Object.defineProperty(window, "sessionStorage", real);
      }
    });
  });

  describe("clearPendingForceSubmit", () => {
    it("removes a stored record and returns ok", () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: true });
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("returns ok when nothing is stored", () => {
      expect(clearPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({ ok: true });
    });

    it("returns storage_unavailable when sessionStorage is absent", () => {
      const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
      Object.defineProperty(window, "sessionStorage", {
        value: null,
        configurable: true,
      });
      try {
        expect(clearPendingForceSubmit(ORG_ID, ACTOR_ID)).toEqual({
          ok: false,
          error: "storage_unavailable",
        });
      } finally {
        Object.defineProperty(window, "sessionStorage", real);
      }
    });

    it("returns remove_failed when removeItem throws", () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      const removeItemSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new DOMException("blocked", "SecurityError");
        });
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: false, error: "remove_failed" });
      removeItemSpy.mockRestore();
    });

    it("returns remove_failed when the record is still present after removal", () => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(validAuthority()));
      // Silent removal failure: removeItem reports success but leaves the
      // record in place — the caller must keep the recovery surface instead
      // of trusting a clear that did not happen.
      const removeItemSpy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {});
      const result = clearPendingForceSubmit(ORG_ID, ACTOR_ID);
      expect(result).toEqual({ ok: false, error: "remove_failed" });
      expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
      removeItemSpy.mockRestore();
    });
  });
});
