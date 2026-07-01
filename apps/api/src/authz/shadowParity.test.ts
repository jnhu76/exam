import { describe, it, expect } from "vitest";
import { shadowRequireCapability, type ShadowLogger } from "./shadow.js";
import { Permission, Role } from "@exam/authz";

/**
 * Shadow parity matrix (RBAC runtime activation, PR #3 Step 4).
 *
 * ADR §10.3 requires shadow parity evidence before flipping gates. The legacy
 * `requireRole(["Admin"])` and the new `requireCapability(permission)` agree
 * exactly on Admin and Candidate. For Proctor/Grader the capability decision
 * is *intentionally broader* — that is the whole point of RBAC activation —
 * so this test pins the EXPECTED diff matrix: Proctor is allowed exactly its
 * preset perms (and denied everything else); Grader likewise; Candidate/Teacher
 * get nothing proctor/grading. There must be NO unexpected diff.
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

const proctorPerms = [
  Permission.ExamRoomView,
  Permission.AttemptStatusView,
  Permission.AttemptTimelineView,
  Permission.AttemptMisconductMark,
  Permission.AttemptTimeExtend,
  Permission.AttemptForceSubmit,
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
          ctx: { actorId: "a", role: Role.Admin, permissions: [] },
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
          ctx: { actorId: "c", role: Role.Candidate, permissions: [] },
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
          ctx: { actorId: "p", role: Role.Proctor, permissions: [] },
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
          ctx: { actorId: "g", role: Role.Grader, permissions: [] },
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
          ctx: { actorId: "t", role: Role.Teacher, permissions: [] },
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
          ctx: { actorId: "a", role: Role.Admin, permissions: [] },
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
