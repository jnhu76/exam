import { describe, expect, it } from "vitest";
import { ROLE_PRESETS, permissionsForRole } from "./presets.js";
import { Permission, Role } from "./catalog.js";

/**
 * P7-E2A (ADR-017 D2/D3) — Maintainer preset boundary.
 *
 * The Application Maintainer preset holds ONLY operational observation
 * capabilities and ZERO business permissions. This is a hard constraint:
 * any business permission added to the preset is an invariant regression.
 */
const MAINTAINER = ROLE_PRESETS[Role.Maintainer];

describe("RBAC Maintainer preset — operational-only boundary (P7-E2A)", () => {
  it("is an assignable, login-capable built-in role", () => {
    expect(MAINTAINER.isSystem).toBe(true);
    expect(MAINTAINER.assignable).toBe(true);
    expect(MAINTAINER.loginAllowed).toBe(true);
  });

  it("holds exactly the operational observation capabilities", () => {
    const perms = permissionsForRole(Role.Maintainer);
    // Exact set pin: a regression adding ANY capability to the preset
    // (business or Admin-only system.*) must fail this test — arrayContaining
    // would let an extra Admin-only capability slip through.
    expect(perms).toEqual([
      Permission.SystemHealthView,
      Permission.SystemDiagnosticsView,
      Permission.SystemBackupView,
      Permission.SystemRestoreReadinessView,
      Permission.SystemOpsPolicyView,
    ]);
    // Every permission is from the system domain (operational observation).
    for (const p of perms) {
      expect(p.startsWith("system."), `${p} is not operational`).toBe(true);
    }
  });

  it("holds ZERO business permissions (hard constraint)", () => {
    const perms = new Set(permissionsForRole(Role.Maintainer));
    // Every catalog permission outside the system domain is business
    // authority (user/candidate/course/question/exam/grading/score/incident/
    // proctor-assignment/organization/settings). Maintainer must hold none.
    const businessPermissions = Object.values(Permission).filter(
      (p) => !p.startsWith("system."),
    );
    for (const p of businessPermissions) {
      expect(perms.has(p), `Maintainer must not hold ${p}`).toBe(false);
    }
  });

  it("does NOT receive the email-test side-effect capability (ADR-017 D7)", () => {
    const perms = permissionsForRole(Role.Maintainer);
    expect(perms).not.toContain(Permission.SystemEmailTest);
  });

  it("holds no sensitive permissions", () => {
    expect(MAINTAINER.sensitivePermissions).toEqual([]);
  });

  it("does not hold any permanently-forbidden execution capability (D4)", () => {
    const perms = new Set(permissionsForRole(Role.Maintainer));
    // Permanently-forbidden keys (ADR-017 D4) are NOT catalog permissions —
    // they are architecturally excluded by surface absence. Assert the
    // Maintainer preset grants no capability in the raw host/secret/restore
    // namespace and that no catalog permission exists for them.
    const forbiddenNamespaces = [
      "restore.",
      "pitr.",
      "pgdata.",
      "database.destructive",
      "secret.",
      "host.",
      "db.endpoint",
      "redis.credentials",
    ];
    for (const p of perms) {
      for (const ns of forbiddenNamespaces) {
        expect(p.startsWith(ns), `${p} is forbidden (${ns})`).toBe(false);
      }
    }
    // Assert the catalog itself contains no such permission keys (the
    // forbidden surface must not exist, not merely be ungranted).
    const catalogKeys = Object.values(Permission) as readonly string[];
    for (const key of catalogKeys) {
      for (const ns of forbiddenNamespaces) {
        expect(
          key.startsWith(ns),
          `catalog contains forbidden key ${key}`,
        ).toBe(false);
      }
    }
  });

  it("Admin keeps the email-test capability (no compatibility regression)", () => {
    const adminPerms = permissionsForRole(Role.Admin);
    expect(adminPerms).toContain(Permission.SystemEmailTest);
  });

  it("Maintainer is not a system-actor role (non-login exclusion holds)", () => {
    expect(MAINTAINER.defaultScope).toBe("system");
    expect(permissionsForRole(Role.System)).not.toContain(
      Permission.SystemHealthView,
    );
  });
});
