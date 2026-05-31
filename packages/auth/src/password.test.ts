import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

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
