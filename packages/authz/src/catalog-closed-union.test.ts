import { describe, it, expect } from "vitest";
import { Permission, Scope, Role, AuditAction } from "./catalog.js";

describe("RBAC-M1 catalog — closed-union integrity", () => {
  it("every Permission value is a dotted lowercase string (>= 2 segments), unique", () => {
    const values = Object.values(Permission);
    // uniqueness
    expect(new Set(values).size).toBe(values.length);
    // shape: dotted, lowercase, >= 2 segments. ADR §4 deliberately mixes
    // 2-segment (`user.view`) and 3-segment (`attempt.force_submit`) keys,
    // so we only assert the dotted-lowercase convention, not a fixed depth.
    for (const v of values) {
      expect(v).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
      expect(v.split(".").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("every Scope value is unique and lowercase", () => {
    const values = Object.values(Scope);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v).toMatch(/^[a-z_]+$/);
  });

  it("every Role value is unique", () => {
    const values = Object.values(Role);
    expect(new Set(values).size).toBe(values.length);
  });

  it("no permission value collides with a scope or role value", () => {
    const perms = new Set(Object.values(Permission));
    for (const s of Object.values(Scope))
      expect(perms.has(s as never)).toBe(false);
    for (const r of Object.values(Role))
      expect(perms.has(r as never)).toBe(false);
  });

  it("AuditAction values are unique", () => {
    const values = Object.values(AuditAction);
    expect(new Set(values).size).toBe(values.length);
  });
});
