import { describe, it, expect } from "vitest";
import { getPermissionsForRole } from "./rbac.js";
import { Permission, Role } from "@exam/domain";

describe("RBAC Phase 1 role model", () => {
  it("exports only Admin and Candidate as Role values", () => {
    expect(Object.values(Role).sort()).toEqual(["Admin", "Candidate"]);
  });

  it("Admin has admin management permissions", () => {
    const perms = new Set(getPermissionsForRole("Admin"));
    expect(perms.has(Permission.MANAGE_USERS)).toBe(true);
    expect(perms.has(Permission.CREATE_EXAM)).toBe(true);
    expect(perms.has(Permission.EXPORT_SCORES)).toBe(true);
  });

  it("Candidate has only take-exam and own-score permissions", () => {
    const perms = new Set(getPermissionsForRole("Candidate"));
    expect(perms.has(Permission.TAKE_EXAM)).toBe(true);
    expect(perms.has(Permission.VIEW_OWN_SCORE)).toBe(true);
    expect(perms.size).toBe(2);
  });

  it("does not grant SuperAdmin wildcard permissions (role removed)", () => {
    expect(getPermissionsForRole("SuperAdmin" as never)).toEqual([]);
  });

  it("does not grant Teacher permissions (role removed)", () => {
    expect(getPermissionsForRole("Teacher" as never)).toEqual([]);
  });

  it("does not grant Proctor permissions (role removed)", () => {
    expect(getPermissionsForRole("Proctor" as never)).toEqual([]);
  });
});
