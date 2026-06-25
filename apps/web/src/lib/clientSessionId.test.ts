import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClientSessionId, CLIENT_SESSION_ID_KEY } from "./clientSessionId";

describe("getClientSessionId", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns a stable id across calls within the same tab session", () => {
    const first = getClientSessionId();
    const second = getClientSessionId();
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("persists the id in sessionStorage", () => {
    const id = getClientSessionId();
    expect(sessionStorage.getItem(CLIENT_SESSION_ID_KEY)).toBe(id);
  });

  it("reuses an existing sessionStorage value instead of regenerating", () => {
    sessionStorage.setItem(CLIENT_SESSION_ID_KEY, "pre-existing-id");
    expect(getClientSessionId()).toBe("pre-existing-id");
  });

  it("regenerates after the stored id is cleared", () => {
    const first = getClientSessionId();
    sessionStorage.clear();
    const second = getClientSessionId();
    expect(second).not.toBe(first);
  });
});

describe("getClientSessionId — environment safety", () => {
  it("never throws if sessionStorage access fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    // getItem throws, so it falls through to generation; setItem may also throw.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => getClientSessionId()).not.toThrow();
    vi.restoreAllMocks();
  });
});
