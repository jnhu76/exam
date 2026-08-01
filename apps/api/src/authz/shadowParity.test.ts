import { describe, it, expect } from "vitest";
import { shadowRequireCapability, type ShadowLogger } from "./shadow.js";
import {
  Permission,
  Role,
  permissionsForRole,
  type PermissionKey,
  type RoleKey,
} from "@exam/authz";

/**
 * Shadow parity matrix (RBAC-M10-E).
 *
 * Post-flip, shadow compares the legacy `users.role` projection (the
 * `legacyGate` side) against the authoritative assignment-derived capability
 * union (the `capabilities` side). For a single-role user, the capability set
 * equals that role's preset — so this matrix populates `ctx.capabilities`
 * from `permissionsForRole(role)` and confirms shadow reports the expected
 * parity / broadening for each role. Production follows the capability side;
 * shadow records any drift as a warning.
 */
function makeLogger(): ShadowLogger & { mismatches: number } {
  const logger: ShadowLogger & { mismatches: number } = {
    mismatches: 0,
    info: () => {},
    warn: () => {
      logger.mismatches += 1;
    },
  };
  return logger;
}

/** Builds a ShadowContext carrying the role's preset as its capabilities. */
function ctxFor(role: RoleKey, actorId: string) {
  return {
    actorId,
    role,
    capabilities: permissionsForRole(role) as readonly PermissionKey[],
  };
}

const proctorPerms = [
  Permission.ExamRoomView,
  Permission.AttemptStatusView,
  Permission.AttemptTimelineView,
  // J4-I1B (ADR-015 §13): AttemptMisconductMark + AttemptForceSubmit REMOVED
  // from the Proctor preset — they are no longer part of the expected
  // Proctor capability set.
];
const graderPerms = [
  Permission.GradingQueueView,
  Permission.GradingDetailView,
  Permission.GradingAnswerView,
  Permission.GradingScoreWrite,
];

const probePerms = [
  ...proctorPerms,
  ...graderPerms,
  // a couple of admin-only perms to confirm Proctor/Grader don't get them
  Permission.UserCreate,
  Permission.ExamPublish,
] as const;

describe("RBAC Step 4 shadow parity matrix (expected diffs only)", () => {
  it("Admin: legacy allow == capability allow for every probed permission", () => {
    const log = makeLogger();
    for (const perm of probePerms) {
      const r = shadowRequireCapability(
        {
          route: `PROBE ${perm}`,
          ctx: ctxFor(Role.Admin, "a"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "system", id: "x" },
        },
        log,
      );
      // Admin is a superset -> legacy allow AND capability allow (no diff).
      expect(r.legacyAllowed, `${perm}`).toBe(true);
      expect(r.capabilityAllowed, `${perm}`).toBe(true);
    }
  });

  it("Candidate: legacy deny == capability deny for every probed permission", () => {
    const log = makeLogger();
    for (const perm of probePerms) {
      const r = shadowRequireCapability(
        {
          route: `PROBE ${perm}`,
          ctx: ctxFor(Role.Candidate, "c"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "system", id: "x" },
        },
        log,
      );
      // Candidate has none of these perms -> legacy deny AND capability deny.
      expect(r.legacyAllowed, `${perm}`).toBe(false);
      expect(r.capabilityAllowed, `${perm}`).toBe(false);
    }
  });

  it("Proctor: EXPECTED broadening — allowed exactly its preset proctor perms, denied grading/admin", () => {
    const log = makeLogger();
    for (const perm of probePerms) {
      const r = shadowRequireCapability(
        {
          route: `PROBE ${perm}`,
          ctx: ctxFor(Role.Proctor, "p"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "system", id: "x" },
        },
        log,
      );
      const expected = (proctorPerms as readonly string[]).includes(perm);
      expect(r.capabilityAllowed, `Proctor/${perm}`).toBe(expected);
      // legacy always denies non-Admin; capability is the broadening.
      expect(r.legacyAllowed, `Proctor/${perm}`).toBe(false);
    }
  });

  it("Grader: EXPECTED broadening — allowed exactly its preset grading perms, denied proctor/admin", () => {
    const log = makeLogger();
    for (const perm of probePerms) {
      const r = shadowRequireCapability(
        {
          route: `PROBE ${perm}`,
          ctx: ctxFor(Role.Grader, "g"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "system", id: "x" },
        },
        log,
      );
      const expected = (graderPerms as readonly string[]).includes(perm);
      expect(r.capabilityAllowed, `Grader/${perm}`).toBe(expected);
      expect(r.legacyAllowed, `Grader/${perm}`).toBe(false);
    }
  });

  it("Teacher: capability decision matches its preset exactly (no proctor/grading; has ExamPublish)", () => {
    const log = makeLogger();
    // Teacher preset (M2) includes ExamPublish + ScoreAllView but NOT proctor/
    // grading perms. Assert capability == preset membership for the probe set.
    const teacherHas = new Set<string>([
      Permission.ExamPublish,
      Permission.ScoreAllView,
    ]);
    for (const perm of probePerms) {
      const r = shadowRequireCapability(
        {
          route: `PROBE ${perm}`,
          ctx: ctxFor(Role.Teacher, "t"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "system", id: "x" },
        },
        log,
      );
      const expected = teacherHas.has(perm);
      expect(r.capabilityAllowed, `Teacher/${perm}`).toBe(expected);
      // legacy always denies non-Admin; capability broadens to the preset.
      expect(r.legacyAllowed, `Teacher/${perm}`).toBe(false);
    }
  });

  it("the matrix logs ZERO unexpected mismatches (ADR sec.10.3 parity)", () => {
    // Every Admin decision should AGREE (no mismatch logged). Proctor/Grader/
    // Teacher broadening is expected, so their mismatches ARE logged — this
    // test asserts the Admin parity specifically (the no-regression guarantee).
    const log = makeLogger();
    for (const perm of probePerms) {
      shadowRequireCapability(
        {
          route: `ADMIN ${perm}`,
          ctx: ctxFor(Role.Admin, "a"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "system", id: "x" },
        },
        log,
      );
    }
    expect(
      log.mismatches,
      "Admin must have zero legacy-vs-capability mismatches",
    ).toBe(0);
  });
});

// ──────────────────────── M10-D Shadow Parity ────────────────────────

const m10dPerms = [
  Permission.CandidateFieldView,
  Permission.CandidateFieldCreate,
  Permission.CandidateFieldUpdate,
  Permission.CandidateFieldDelete,
  Permission.SettingsView,
  Permission.SettingsUpdate,
  Permission.SystemHealthView,
  Permission.SystemDiagnosticsView,
  Permission.AuditLogView,
  Permission.CandidateCreate,
  Permission.CandidateUpdate,
  Permission.CandidateImport,
];

const ALL_ROLES = [
  Role.Admin,
  Role.Teacher,
  Role.Proctor,
  Role.Grader,
  Role.Candidate,
  Role.System,
] as const;

describe("M10-D shadow parity matrix", () => {
  it("Admin: legacy allow == capability allow for all M10-D permissions", () => {
    const log = makeLogger();
    for (const perm of m10dPerms) {
      const r = shadowRequireCapability(
        {
          route: `M10D ${perm}`,
          ctx: ctxFor(Role.Admin, "admin"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "organization", id: "org-1" },
        },
        log,
      );
      expect(r.legacyAllowed, `Admin legacy ${perm}`).toBe(true);
      expect(r.capabilityAllowed, `Admin capability ${perm}`).toBe(true);
    }
  });

  it("Admin parity: zero mismatches logged", () => {
    const log = makeLogger();
    for (const perm of m10dPerms) {
      shadowRequireCapability(
        {
          route: `M10D-ADMIN ${perm}`,
          ctx: ctxFor(Role.Admin, "admin"),
          legacyGate: ["Admin"],
          permission: perm,
          resource: { type: "organization", id: "org-1" },
        },
        log,
      );
    }
    expect(log.mismatches).toBe(0);
  });

  it("no non-Admin role receives accidental access expansion", () => {
    const nonAdminRoles = ALL_ROLES.filter((r) => r !== Role.Admin);
    for (const role of nonAdminRoles) {
      for (const perm of m10dPerms) {
        const r = shadowRequireCapability(
          {
            route: `M10D ${role}/${perm}`,
            ctx: ctxFor(role, role.toLowerCase()),
            legacyGate: ["Admin"],
            permission: perm,
            resource: { type: "organization", id: "org-1" },
          },
          makeLogger(),
        );
        expect(r.legacyAllowed, `${role} legacy ${perm}`).toBe(false);
        expect(r.capabilityAllowed, `${role} capability ${perm}`).toBe(false);
      }
    }
  });
});
