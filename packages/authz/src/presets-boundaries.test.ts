import { describe, it, expect } from "vitest";
import { permissionsForRole, ROLE_PRESETS } from "./presets.js";
import { Permission, Role, type RoleKey } from "./catalog.js";

const has = (
  role: RoleKey,
  ...perms: (typeof Permission)[keyof typeof Permission][]
) => {
  const set = new Set(permissionsForRole(role));
  return perms.map((p) => set.has(p));
};

describe("RBAC-M2 boundary #1 — Admin is a compatibility superset", () => {
  it("Admin holds the 4 proctor trap perms (so flipping gates never denies Admin)", () => {
    // REC-I4-I3B2: the trap perm is now AttemptTimeGrant (Admin-only), not the
    // old AttemptTimeExtend. Admin must hold it so the new route stays accessible.
    const [f, g, m, room] = has(
      Role.Admin,
      Permission.AttemptForceSubmit,
      Permission.AttemptTimeGrant,
      Permission.AttemptMisconductMark,
      Permission.ExamRoomView,
    );
    expect([f, g, m, room]).toEqual([true, true, true, true]);
  });

  it("Admin holds grading detail/answer/score (preserve current Admin grading access)", () => {
    const [d, a, s] = has(
      Role.Admin,
      Permission.GradingDetailView,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
    );
    expect([d, a, s]).toEqual([true, true, true]);
  });

  it("Admin does NOT hold Candidate own-runtime perms", () => {
    const [start, save, submit, hb, own] = has(
      Role.Admin,
      Permission.AttemptStart,
      Permission.AttemptAnswerSave,
      Permission.AttemptSubmit,
      Permission.AttemptHeartbeatSend,
      Permission.ScoreOwnView,
    );
    expect([start, save, submit, hb, own]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("Admin does NOT hold System-only perms", () => {
    const [auto, hb, recon] = has(
      Role.Admin,
      Permission.SystemAutoSubmit,
      Permission.SystemHeartbeatScan,
      Permission.SystemLifecycleReconcile,
    );
    expect([auto, hb, recon]).toEqual([false, false, false]);
  });
});

describe("RBAC-M2 boundary #2/#3 — Teacher is not Grader or Proctor by default", () => {
  it("Teacher does NOT view candidate answers / grade / proctor by default", () => {
    const [ans, grade, force, grant, misconduct, room] = has(
      Role.Teacher,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
      Permission.AttemptForceSubmit,
      Permission.AttemptTimeGrant,
      Permission.AttemptMisconductMark,
      Permission.ExamRoomView,
    );
    expect([ans, grade, force, grant, misconduct, room]).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("Teacher CAN author courses/questions/exams by default", () => {
    const [cc, qc, ec] = has(
      Role.Teacher,
      Permission.CourseCreate,
      Permission.QuestionCreate,
      Permission.ExamCreate,
    );
    expect([cc, qc, ec]).toEqual([true, true, true]);
  });
});

describe("RBAC-M2 boundary #4/#5 — Proctor cannot view answers / grade / publish by default", () => {
  it("Proctor does NOT view answers / grade / publish results / view all scores", () => {
    const [ans, grade, pub, scores] = has(
      Role.Proctor,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
      Permission.ExamResultPublish,
      Permission.ScoreAllView,
    );
    expect([ans, grade, pub, scores]).toEqual([false, false, false, false]);
  });

  it("Proctor CAN operate runtime authority (force-submit / misconduct / room) but NOT grant time", () => {
    // REC-I4-I3B2: operator time grant is Admin-only. Proctor retains
    // force-submit / misconduct / room but must NOT hold AttemptTimeGrant
    // (the old AttemptTimeExtend route was cut; no grant path remains).
    const [force, grant, misconduct, room] = has(
      Role.Proctor,
      Permission.AttemptForceSubmit,
      Permission.AttemptTimeGrant,
      Permission.AttemptMisconductMark,
      Permission.ExamRoomView,
    );
    expect([force, grant, misconduct, room]).toEqual([true, false, true, true]);
  });
});

describe("RBAC-M2 boundary #6 — Grader can grade but cannot publish by default", () => {
  it("Grader CAN view detail/answer/write score", () => {
    const [d, a, s] = has(
      Role.Grader,
      Permission.GradingDetailView,
      Permission.GradingAnswerView,
      Permission.GradingScoreWrite,
    );
    expect([d, a, s]).toEqual([true, true, true]);
  });

  it("Grader does NOT finalize / view identity / publish by default", () => {
    const [fin, id, pub] = has(
      Role.Grader,
      Permission.GradingFinalize,
      Permission.GradingIdentityView,
      Permission.ExamResultPublish,
    );
    expect([fin, id, pub]).toEqual([false, false, false]);
  });
});

describe("RBAC-M2 boundary #8 — System actor is non-login, non-assignable, SYS-only", () => {
  it("System is not login-capable and not assignable", () => {
    expect(ROLE_PRESETS[Role.System].loginAllowed).toBe(false);
    expect(ROLE_PRESETS[Role.System].assignable).toBe(false);
  });

  it("System holds only the 3 system-only perms, nothing human-facing", () => {
    const sys = new Set(permissionsForRole(Role.System));
    expect(sys.size).toBe(3);
    expect(sys.has(Permission.SystemAutoSubmit)).toBe(true);
    expect(sys.has(Permission.SystemHeartbeatScan)).toBe(true);
    expect(sys.has(Permission.SystemLifecycleReconcile)).toBe(true);
    // no human capability leaks
    expect(sys.has(Permission.UserCreate)).toBe(false);
    expect(sys.has(Permission.AttemptForceSubmit)).toBe(false);
    expect(sys.has(Permission.ExamTake)).toBe(false);
  });

  it("no human role holds a System-only permission", () => {
    const humanRoles: RoleKey[] = [
      Role.Admin,
      Role.Teacher,
      Role.Proctor,
      Role.Grader,
      Role.Candidate,
    ];
    for (const r of humanRoles) {
      const set = new Set(permissionsForRole(r));
      expect(set.has(Permission.SystemAutoSubmit), `${r} has auto_submit`).toBe(
        false,
      );
      expect(
        set.has(Permission.SystemHeartbeatScan),
        `${r} has heartbeat_scan`,
      ).toBe(false);
      expect(
        set.has(Permission.SystemLifecycleReconcile),
        `${r} has lifecycle_reconcile`,
      ).toBe(false);
    }
  });
});

describe("RBAC-M2 integrity — every granted permission is a known catalog value", () => {
  const catalog = new Set<string>(Object.values(Permission));
  for (const role of Object.keys(ROLE_PRESETS) as RoleKey[]) {
    it(`${role} grants only known permissions, no duplicates`, () => {
      const perms = permissionsForRole(role);
      expect(new Set(perms).size).toBe(perms.length);
      for (const p of perms) expect(catalog.has(p)).toBe(true);
    });
  }
});
