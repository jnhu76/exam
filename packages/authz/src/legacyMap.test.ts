import { describe, it, expect } from "vitest";
import { Permission as Legacy } from "@exam/domain";
import {
  LEGACY_PERMISSION_MAP,
  LEGACY_ROLE_MAP,
  legacyPermissionToKey,
  legacyRoleToKey,
} from "./legacyMap.js";
import { Permission, Role } from "./catalog.js";

describe("RBAC-M1 legacy map — every legacy SCREAMING_SNAKE perm is mapped", () => {
  const legacyKeys = Object.values(Legacy) as string[];

  it("covers every legacy Permission key (ADR acceptance)", () => {
    for (const k of legacyKeys) {
      expect(LEGACY_PERMISSION_MAP).toHaveProperty(k);
    }
  });

  it("maps each legacy key to a value PermissionKey (1:1, no unmapped)", () => {
    const mapped = legacyKeys.map((k) => legacyPermissionToKey(k as never));
    // every mapped target is a real catalog value
    const catalogValues = new Set<string>(Object.values(Permission));
    for (const m of mapped) expect(catalogValues.has(m)).toBe(true);
    // 1:1 — no two legacy keys collapse onto the same new key unless intentional.
    // (MANAGE_ORGANIZATION is dead; it intentionally maps onto organization.update
    // alongside a future superset — record it explicitly.)
    const dupes = mapped.filter((m, i) => mapped.indexOf(m) !== i);
    expect(dupes).toEqual([]);
  });

  it("maps the dead MANAGE_ORGANIZATION to organization.update (ADR §4.1 note)", () => {
    expect(legacyPermissionToKey(Legacy.MANAGE_ORGANIZATION)).toBe(
      Permission.OrganizationUpdate,
    );
  });

  it("maps the proctor-perm trap keys to the new dotted proctor perms", () => {
    expect(legacyPermissionToKey(Legacy.VIEW_EXAM_ROOM)).toBe(
      Permission.ExamRoomView,
    );
    expect(legacyPermissionToKey(Legacy.MARK_MISCONDUCT)).toBe(
      Permission.AttemptMisconductMark,
    );
    expect(legacyPermissionToKey(Legacy.FORCE_SUBMIT)).toBe(
      Permission.AttemptForceSubmit,
    );
  });

  it("maps Phase 1 Candidate perms to own-scope perms", () => {
    expect(legacyPermissionToKey(Legacy.TAKE_EXAM)).toBe(Permission.ExamTake);
    expect(legacyPermissionToKey(Legacy.VIEW_OWN_SCORE)).toBe(
      Permission.ScoreOwnView,
    );
  });
});

describe("RBAC-M1 legacy map — legacy Role", () => {
  it("maps Admin and Candidate (the only legacy roles) to themselves", () => {
    expect(legacyRoleToKey("Admin" as never)).toBe(Role.Admin);
    expect(legacyRoleToKey("Candidate" as never)).toBe(Role.Candidate);
    expect(LEGACY_ROLE_MAP.Admin).toBe(Role.Admin);
    expect(LEGACY_ROLE_MAP.Candidate).toBe(Role.Candidate);
  });
});
