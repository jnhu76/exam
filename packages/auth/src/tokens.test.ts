import { describe, expect, it } from "vitest";
import { generateToken, hashToken, verifyToken } from "./tokens.js";

describe("identity lifecycle tokens (#297)", () => {
  it("generates base64url tokens with ~256 bits of entropy", () => {
    const token = generateToken();
    // 32 bytes -> 43 base64url chars, no padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates unique tokens across many draws", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(tokens.size).toBe(1000);
  });

  it("hashes to a 64-char hex digest that is stable and distinct from the raw token", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it("verifyToken accepts the right token and rejects wrong input in constant shape", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(generateToken(), hash)).toBe(false);
    expect(verifyToken("", hash)).toBe(false);
    expect(verifyToken(token, "not-a-hash")).toBe(false);
  });
});
