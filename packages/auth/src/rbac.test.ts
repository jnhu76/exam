import { describe, it, expect } from "vitest";
import { getPermissionsForRole } from "./rbac.js";
import { Permission, Role } from "@exam/domain";

describe("RBAC Phase 1 role model", () => {
  it("exports Admin and Candidate as the human roles, plus System (synthetic)", () => {
    // System is a non-login, non-assignable synthetic actor (ADR §System Actor
    // Policy); it is never a `users.role` value. Admin/Candidate remain the
    // only human, login-capable roles.
    expect(Object.values(Role).sort()).toEqual([
      "Admin",
      "Candidate",
      "System",
    ]);
  });

  it("does not grant System any legacy flat permissions (system perms live in @exam/authz)", () => {
    // The legacy Phase-1 flat map intentionally knows nothing about System;
    // system-only perms (system.auto_submit etc.) are owned by @exam/authz.
    expect(getPermissionsForRole("System" as never)).toEqual([]);
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
