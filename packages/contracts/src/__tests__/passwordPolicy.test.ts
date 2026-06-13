import { describe, it, expect } from "vitest";
import {
  DEFAULT_PASSWORD_POLICY,
  passwordField,
  passwordLoginField,
} from "../passwordPolicy.js";

describe("DEFAULT_PASSWORD_POLICY", () => {
  it("has minLength 8", () => {
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(8);
  });

  it("has maxLength 100", () => {
    expect(DEFAULT_PASSWORD_POLICY.maxLength).toBe(100);
  });
});

describe("passwordField", () => {
  it("accepts password exactly at minLength", () => {
    const result = passwordField().safeParse("12345678");
    expect(result.success).toBe(true);
  });

  it("rejects password one character below minLength", () => {
    const result = passwordField().safeParse("1234567");
    expect(result.success).toBe(false);
  });

  it("rejects password above maxLength", () => {
    const result = passwordField().safeParse("a".repeat(101));
    expect(result.success).toBe(false);
  });

  it("accepts password exactly at maxLength", () => {
    const result = passwordField().safeParse("a".repeat(100));
    expect(result.success).toBe(true);
  });

  it("respects an overridden policy", () => {
    const result = passwordField({ minLength: 12, maxLength: 100 }).safeParse(
      "12345678",
    );
    expect(result.success).toBe(false);
  });
});

describe("passwordLoginField", () => {
  it("accepts a password shorter than the minLength to preserve auth-failure semantics", () => {
    const result = passwordLoginField().safeParse("short");
    expect(result.success).toBe(true);
  });

  it("accepts an empty string so the auth path can return a uniform 401", () => {
    const result = passwordLoginField().safeParse("");
    expect(result.success).toBe(true);
  });

  it("rejects a password above maxLength to bound DoS surface", () => {
    const result = passwordLoginField().safeParse("a".repeat(101));
    expect(result.success).toBe(false);
  });

  it("ignores policy.minLength to keep login schema policy-free", () => {
    const result = passwordLoginField({
      minLength: 12,
      maxLength: 100,
    }).safeParse("a");
    expect(result.success).toBe(true);
  });
});
