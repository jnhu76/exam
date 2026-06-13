import { describe, it, expect, vi } from "vitest";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from "../src/password.js";

describe("password hashing", () => {
  it("should hash a password and verify it matches", async () => {
    const password = "password123";
    const hash = await hashPassword(password);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);

    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBeTruthy();
  });

  it("should not verify incorrect password", async () => {
    const password = "password123";
    const hash = await hashPassword(password);

    const isMatch = await verifyPassword("wrongpassword", hash);
    expect(isMatch).toBeFalsy();
  });
});

describe("verifyPasswordOrDummy (timing-attack mitigation)", () => {
  it("invokes argon2.verify exactly once when hash is null", async () => {
    const argon2 = await import("argon2");
    const verifySpy = vi.fn(argon2.verify);
    vi.doMock("argon2", async () => {
      const actual = await vi.importActual<typeof argon2>("argon2");
      return { ...actual, verify: verifySpy };
    });

    vi.resetModules();
    const mod = await import("../src/password.js");
    verifySpy.mockClear();

    const result = await mod.verifyPasswordOrDummy("any-password", null);

    expect(result).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    vi.doUnmock("argon2");
    vi.resetModules();
  });

  it("invokes argon2.verify exactly once when hash is undefined", async () => {
    const argon2 = await import("argon2");
    const verifySpy = vi.fn(argon2.verify);
    vi.doMock("argon2", async () => {
      const actual = await vi.importActual<typeof argon2>("argon2");
      return { ...actual, verify: verifySpy };
    });

    vi.resetModules();
    const mod = await import("../src/password.js");
    verifySpy.mockClear();

    const result = await mod.verifyPasswordOrDummy("any-password", undefined);

    expect(result).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    vi.doUnmock("argon2");
    vi.resetModules();
  });

  it("returns true when password matches the real hash", async () => {
    const password = "password123";
    const hash = await hashPassword(password);

    const result = await verifyPasswordOrDummy(password, hash);
    expect(result).toBe(true);
  });

  it("returns false when password does not match the real hash", async () => {
    const password = "password123";
    const hash = await hashPassword(password);

    const result = await verifyPasswordOrDummy("wrong", hash);
    expect(result).toBe(false);
  });

  it("returns false when stored hash is an empty string", async () => {
    const result = await verifyPasswordOrDummy("any", "");
    expect(result).toBe(false);
  });
});
