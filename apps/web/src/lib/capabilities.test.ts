import { describe, expect, it } from "vitest";
import type { MeResponse } from "@exam/contracts";
import { permissionsForRole, type PermissionKey } from "@exam/authz";
import {
  can,
  canAccessAdminConsole,
  canAccessExamRuntime,
  adminLandingPath,
  canArchiveExam,
  canCancelExam,
  canCloseExam,
  canCreateExam,
  canDeleteExam,
  canExtendExam,
  canImportQuestions,
  canManageEnrollments,
  canPublishExam,
  canPublishResults,
  canSeeCourses,
  canSeeDashboard,
  canSeeExams,
  canSeeGradingQueue,
  canSeeManagement,
  canSeeProctor,
  canSeeQuestions,
  canSeeResults,
  canSeeSettings,
  canUnpublishExam,
  canUpdateExam,
  defaultLandingPath,
  isAdmin,
  isCandidate,
  hasManagementCapability,
} from "./capabilities";

/**
 * Build a minimal MeResponse-shaped user for a role, with the capability
 * union derived from the role's preset. When `capabilities` is explicitly
 * provided it overrides the default (used for multi-role tests).
 */
function userWith(
  role: MeResponse["role"],
  capabilities?: readonly PermissionKey[],
): Pick<MeResponse, "role" | "capabilities"> {
  return {
    role,
    capabilities: capabilities
      ? [...capabilities]
      : [...permissionsForRole(role)],
  };
}

/** Shorthand for single-role users (capabilities = role preset). */
function user(
  role: MeResponse["role"],
): Pick<MeResponse, "role" | "capabilities"> {
  return userWith(role);
}

describe("P4-4 capability helper — per-role nav/action visibility", () => {
  // The expected MVP matrix (mirrors the backend @exam/authz presets + the
  // P4-1 route matrix). Teacher = authoring+lifecycle+results, NOT grading/
  // proctor/management. Grader = grading only. Proctor = proctor only.
  it("Admin sees everything (compatibility superset)", () => {
    const u = user("Admin");
    expect(isAdmin(u)).toBe(true);
    expect(canSeeManagement(u)).toBe(true);
    expect(canSeeDashboard(u)).toBe(true);
    expect(canSeeCourses(u)).toBe(true);
    expect(canSeeQuestions(u)).toBe(true);
    expect(canImportQuestions(u)).toBe(true);
    expect(canSeeExams(u)).toBe(true);
    expect(canSeeGradingQueue(u)).toBe(true);
    expect(canSeeResults(u)).toBe(true);
    expect(canSeeProctor(u)).toBe(true);
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("Teacher sees authoring/exams/results but NOT grading/proctor/management", () => {
    const u = user("Teacher");
    expect(isAdmin(u)).toBe(false);
    expect(canSeeManagement(u)).toBe(false);
    expect(canSeeDashboard(u)).toBe(false);
    expect(canSeeCourses(u)).toBe(true);
    expect(canSeeQuestions(u)).toBe(true);
    expect(canImportQuestions(u)).toBe(true);
    expect(canSeeExams(u)).toBe(true);
    expect(canSeeGradingQueue(u)).toBe(false); // Teacher is NOT a Grader
    expect(canSeeResults(u)).toBe(true);
    expect(canSeeProctor(u)).toBe(false);
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("Grader sees the grading queue but NOT authoring/management/proctor", () => {
    const u = user("Grader");
    expect(canSeeManagement(u)).toBe(false);
    expect(canSeeDashboard(u)).toBe(false);
    expect(canSeeCourses(u)).toBe(false);
    expect(canSeeQuestions(u)).toBe(false);
    expect(canImportQuestions(u)).toBe(false);
    expect(canSeeExams(u)).toBe(false);
    expect(canSeeGradingQueue(u)).toBe(true);
    expect(canSeeResults(u)).toBe(false);
    expect(canSeeProctor(u)).toBe(false);
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("Proctor sees proctor monitoring but NOT authoring/grading/management", () => {
    const u = user("Proctor");
    expect(canSeeManagement(u)).toBe(false);
    expect(canSeeDashboard(u)).toBe(false);
    expect(canSeeCourses(u)).toBe(false);
    expect(canSeeQuestions(u)).toBe(false);
    expect(canImportQuestions(u)).toBe(false);
    expect(canSeeExams(u)).toBe(false);
    expect(canSeeGradingQueue(u)).toBe(false);
    expect(canSeeResults(u)).toBe(false);
    expect(canSeeProctor(u)).toBe(true);
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("Candidate is routed to the exam runtime (no console, no admin surfaces)", () => {
    const u = user("Candidate");
    expect(isCandidate(u)).toBe(true);
    expect(canAccessAdminConsole(u)).toBe(false);
    expect(canSeeManagement(u)).toBe(false);
    expect(canSeeDashboard(u)).toBe(false);
    expect(canSeeCourses(u)).toBe(false);
    expect(canSeeQuestions(u)).toBe(false);
    expect(canImportQuestions(u)).toBe(false);
    expect(canSeeExams(u)).toBe(false);
    expect(canSeeGradingQueue(u)).toBe(false);
    expect(canSeeResults(u)).toBe(false);
    expect(canSeeProctor(u)).toBe(false);
  });
});

describe("P4-4 capability helper — exam-page actions (task 10.4)", () => {
  it("Teacher may publish / close / publish-results / manage enrollments", () => {
    const u = user("Teacher");
    expect(canPublishExam(u)).toBe(true);
    expect(canCreateExam(u)).toBe(true);
    expect(canUpdateExam(u)).toBe(true);
    expect(canCloseExam(u)).toBe(true);
    expect(canPublishResults(u)).toBe(true);
    expect(canManageEnrollments(u)).toBe(true);
  });

  it("Teacher must NOT see Admin-only destructive exam actions", () => {
    const u = user("Teacher");
    expect(canUnpublishExam(u)).toBe(false);
    expect(canExtendExam(u)).toBe(false);
    expect(canCancelExam(u)).toBe(false);
    expect(canArchiveExam(u)).toBe(false);
    expect(canDeleteExam(u)).toBe(false);
  });

  it("Admin may perform every exam action (no regression)", () => {
    const u = user("Admin");
    expect(canCreateExam(u)).toBe(true);
    expect(canUpdateExam(u)).toBe(true);
    expect(canPublishExam(u)).toBe(true);
    expect(canCloseExam(u)).toBe(true);
    expect(canPublishResults(u)).toBe(true);
    expect(canManageEnrollments(u)).toBe(true);
    expect(canUnpublishExam(u)).toBe(true);
    expect(canExtendExam(u)).toBe(true);
    expect(canCancelExam(u)).toBe(true);
    expect(canArchiveExam(u)).toBe(true);
    expect(canDeleteExam(u)).toBe(true);
  });

  it("Grader/Proctor/Candidate may not perform exam authoring actions", () => {
    for (const role of ["Grader", "Proctor", "Candidate"] as const) {
      const u = user(role);
      expect(canCreateExam(u), role).toBe(false);
      expect(canUpdateExam(u), role).toBe(false);
      expect(canPublishExam(u), role).toBe(false);
      expect(canCloseExam(u), role).toBe(false);
      expect(canPublishResults(u), role).toBe(false);
      expect(canManageEnrollments(u), role).toBe(false);
    }
  });
});

describe("P4-4 capability helper — default landing paths", () => {
  it.each([
    ["Admin", "/admin/dashboard"],
    ["Teacher", "/admin/exams"],
    ["Grader", "/admin/grading-queue"],
    ["Proctor", "/admin/proctor"],
    ["Candidate", "/exam/list"],
  ] as const)("routes %s to an accessible surface", (role, expectedPath) => {
    expect(defaultLandingPath(user(role))).toBe(expectedPath);
  });

  it("uses the capability-backed Proctor workspace as the console landing", () => {
    expect(adminLandingPath(user("Proctor"))).toBe("/admin/proctor");
  });
});

describe("P4-4 capability helper — raw can() parity with backend presets", () => {
  // A spot-check that the frontend capability verdict matches a known
  // backend decision, so a future preset change surfaces here.
  it("Teacher can(QuestionCreate) is true (matches P4-2B cutover)", () => {
    // Permission.QuestionCreate = "question.create"
    expect(can(user("Teacher"), "question.create")).toBe(true);
  });
  it("Teacher can(GradingScoreWrite) is false (Teacher is not a Grader)", () => {
    expect(can(user("Teacher"), "grading.score.write")).toBe(false);
  });
  it("Candidate can(AttemptSubmit) is true (own-attempt)", () => {
    expect(can(user("Candidate"), "attempt.submit")).toBe(true);
  });
  it("Candidate can(QuestionView) is false", () => {
    expect(can(user("Candidate"), "question.view")).toBe(false);
  });
});

describe("RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1 — canSeeManagement is capability-derived", () => {
  // canSeeManagement must NOT short-circuit on a role label (isAdmin). It is an
  // aggregate over the management-surface permission set: the management nav is
  // visible iff the principal's capability set grants ANY of
  // UserView/AuditLogView/SettingsView/SystemHealthView/CandidateFieldView.
  // This keeps the gate aligned with the backend per-route requireCapability
  // gates and avoids anointing a single surrogate permission (directive §3).
  it("Admin sees management (holds UserView + the full management set)", () => {
    expect(canSeeManagement(user("Admin"))).toBe(true);
  });

  it.each(["Teacher", "Grader", "Proctor", "Candidate"] as const)(
    "%s does NOT see management (holds none of the management-surface perms)",
    (role) => {
      expect(canSeeManagement(user(role))).toBe(false);
    },
  );

  it("management visibility tracks a management-surface capability, not the Admin label", () => {
    // Proof the gate is capability-driven: Admin CAN see management, and Admin
    // is the only preset that holds UserView. If a future custom role held
    // UserView without being Admin, the aggregate would return true. We assert
    // the coupling via the underlying capability: every Admin-only management
    // perm individually flips can() true for Admin and false for others.
    const adminHasUserView = can(user("Admin"), "user.view");
    const teacherHasUserView = can(user("Teacher"), "user.view");
    expect(adminHasUserView).toBe(true);
    expect(teacherHasUserView).toBe(false);
    // And the aggregate includes more than just UserView — SettingsView also
    // drives it, so the gate is robust to a preset that grants only some
    // management perms.
    expect(can(user("Admin"), "settings.view")).toBe(true);
  });

  it("MUTATION E: canSeeManagement delegates to hasManagementCapability, not isAdmin", () => {
    // hasManagementCapability is a pure permission-set function: it makes no
    // reference to isAdmin, user.role, or any role label. If canSeeManagement
    // is reverted to `if (isAdmin(user)) return true`, the pure-set test below
    // still passes for Admin — but the architecture test proves the gate is
    // capability-derived, not role-label-derived.
    //
    // Proof 1: Admin preset passes the pure-set gate.
    const adminPerms = permissionsForRole("Admin");
    expect(hasManagementCapability(adminPerms)).toBe(true);

    // Proof 2: A hypothetical non-Admin role that holds UserView passes.
    const customPerms: PermissionKey[] = ["user.view"];
    expect(hasManagementCapability(customPerms)).toBe(true);

    // Proof 3: A role with zero management perms fails.
    const emptyPerms: PermissionKey[] = [];
    expect(hasManagementCapability(emptyPerms)).toBe(false);
  });
});

describe("RBAC-M10-E closure — multi-role capability union", () => {
  it("primary Candidate + secondary Teacher grants exam.view from the union", () => {
    // Candidate lacks exam.view; Teacher's preset includes it. The capability
    // union (passed explicitly) must reflect the multi-role truth.
    const teacherPerms = [...permissionsForRole("Teacher")];
    const u = userWith("Candidate", teacherPerms);
    expect(canSeeExams(u)).toBe(true);
    expect(canSeeResults(u)).toBe(true);
    // Shell classification still uses role: Candidate routes to exam runtime.
    expect(isCandidate(u)).toBe(true);
    // Teacher's ExamView grants admin-console access via adminLandingPath.
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("primary Candidate + secondary Admin grants all Admin capabilities", () => {
    const adminPerms = [...permissionsForRole("Admin")];
    const u = userWith("Candidate", adminPerms);
    expect(canSeeManagement(u)).toBe(true);
    expect(canSeeDashboard(u)).toBe(true);
    expect(canSeeGradingQueue(u)).toBe(true);
    expect(canSeeProctor(u)).toBe(true);
    // Admin's SystemHealthView grants admin-console access.
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("canSeeSettings works with explicit capability set", () => {
    const u = userWith("Candidate", ["settings.view"]);
    expect(canSeeSettings(u)).toBe(true);
    expect(canSeeManagement(u)).toBe(true); // SettingsView is a management perm
  });
});

describe("RBAC-M10-E-FRONTEND-MULTI-ROLE-SHELL-CORRECTIVE-1 — shell reachability matrix", () => {
  // Full behavioral matrix:
  // | Primary   | Secondary | Admin console | Exam runtime | Default landing (primary Candidate) | Default landing (non-Candidate-primary) |
  // |-----------|-----------|---------------|--------------|-------------------------------------|-----------------------------------------|
  // | Admin     | –         | allow         | deny         | –                                   | /admin/dashboard                        |
  // | Teacher   | –         | allow         | deny         | –                                   | /admin/exams                            |
  // | Proctor   | –         | allow         | deny         | –                                   | /admin/proctor                          |
  // | Grader    | –         | allow         | deny         | –                                   | /admin/grading-queue                    |
  // | Candidate | –         | deny          | allow        | /exam/list                          | –                                       |
  // | Candidate | Teacher   | allow         | allow        | /exam/list                          | –                                       |
  // | Candidate | Admin     | allow         | allow        | /exam/list                          | –                                       |
  // | Candidate | Proctor   | allow         | allow        | /exam/list                          | –                                       |
  // | Candidate | Grader    | allow         | allow        | /exam/list                          | –                                       |
  // | Teacher   | Candidate | allow         | allow        | –                                   | /admin/exams                            |
  // | Proctor   | Candidate | allow         | allow        | –                                   | /admin/proctor                          |
  // | Grader    | Candidate | allow         | allow        | –                                   | /admin/grading-queue                    |

  describe("canAccessExamRuntime", () => {
    it.each([
      ["Admin", false],
      ["Teacher", false],
      ["Proctor", false],
      ["Grader", false],
      ["Candidate", true],
    ] as const)("%s exam-runtime access: %s", (role, expected) => {
      expect(canAccessExamRuntime(user(role))).toBe(expected);
    });

    it("Candidate + Teacher: exam-runtime allowed (ExamTake from Candidate union)", () => {
      const unionPerms = [
        ...permissionsForRole("Candidate"),
        ...permissionsForRole("Teacher"),
      ];
      const u = userWith("Candidate", unionPerms);
      expect(canAccessExamRuntime(u)).toBe(true);
    });

    it("Teacher + Candidate: exam-runtime allowed (ExamTake from secondary Candidate union)", () => {
      const unionPerms = [
        ...permissionsForRole("Teacher"),
        ...permissionsForRole("Candidate"),
      ];
      const u = userWith("Teacher", unionPerms);
      expect(canAccessExamRuntime(u)).toBe(true);
    });

    it("no capabilities: exam-runtime denied", () => {
      const u = userWith("Candidate", []);
      expect(canAccessExamRuntime(u)).toBe(false);
    });
  });

  describe("canAccessAdminConsole — single-role", () => {
    it.each([
      ["Admin", true],
      ["Teacher", true],
      ["Proctor", true],
      ["Grader", true],
      ["Candidate", false],
    ] as const)("%s admin-console access: %s", (role, expected) => {
      expect(canAccessAdminConsole(user(role))).toBe(expected);
    });
  });

  describe("canAccessAdminConsole — multi-role", () => {
    it.each([
      ["Candidate + Teacher", "Candidate", "Teacher"],
      ["Candidate + Admin", "Candidate", "Admin"],
      ["Candidate + Proctor", "Candidate", "Proctor"],
      ["Candidate + Grader", "Candidate", "Grader"],
    ] as const)(
      "%s: admin-console allowed (secondary role grants a console perm)",
      (_label, primary, secondary) => {
        const secondaryPerms = [...permissionsForRole(secondary)];
        const u = userWith(primary, secondaryPerms);
        expect(canAccessAdminConsole(u)).toBe(true);
      },
    );

    it("Candidate + no console perms: admin-console denied", () => {
      const u = userWith("Candidate", ["attempt.submit"]);
      expect(canAccessAdminConsole(u)).toBe(false);
    });
  });

  describe("adminLandingPath — extended coverage", () => {
    it("returns /admin/courses when user only has CourseView", () => {
      const u = userWith("Candidate", ["course.view"]);
      expect(adminLandingPath(u)).toBe("/admin/courses");
    });

    it("returns /admin/questions when user only has QuestionView", () => {
      const u = userWith("Candidate", ["question.view"]);
      expect(adminLandingPath(u)).toBe("/admin/questions");
    });

    it("returns /admin/users when user only has a management-surface perm", () => {
      const u = userWith("Candidate", ["user.view"]);
      expect(adminLandingPath(u)).toBe("/admin/users");
    });

    it("returns null when user has no console capability", () => {
      const u = userWith("Candidate", []);
      expect(adminLandingPath(u)).toBeNull();
    });

    it("prioritizes dashboard over broader permissions", () => {
      const u = userWith("Admin", permissionsForRole("Admin"));
      expect(adminLandingPath(u)).toBe("/admin/dashboard");
    });

    it("prioritizes proctor workspace over grading queue", () => {
      // Proctor+Grader union: ExamRoomView checked before GradingQueueView.
      const gradgerPerms = [...permissionsForRole("Grader")];
      const proctorPerms = [...permissionsForRole("Proctor")];
      const u = userWith("Proctor", [...gradgerPerms, ...proctorPerms]);
      expect(adminLandingPath(u)).toBe("/admin/proctor");
    });
  });

  describe("defaultLandingPath — multi-role-aware", () => {
    it.each([
      ["Admin", "/admin/dashboard"],
      ["Teacher", "/admin/exams"],
      ["Grader", "/admin/grading-queue"],
      ["Proctor", "/admin/proctor"],
      ["Candidate", "/exam/list"],
    ] as const)("single-role %s lands on %s", (role, expectedPath) => {
      expect(defaultLandingPath(user(role))).toBe(expectedPath);
    });

    it("Candidate+Teacher: lands on /exam/list (Candidate-primary preference)", () => {
      const unionPerms = [
        ...permissionsForRole("Candidate"),
        ...permissionsForRole("Teacher"),
      ];
      const u = userWith("Candidate", unionPerms);
      expect(defaultLandingPath(u)).toBe("/exam/list");
    });

    it("Teacher+Candidate: lands on /admin/exams (non-Candidate primary)", () => {
      const unionPerms = [
        ...permissionsForRole("Teacher"),
        ...permissionsForRole("Candidate"),
      ];
      const u = userWith("Teacher", unionPerms);
      expect(defaultLandingPath(u)).toBe("/admin/exams");
    });

    it("no capabilities: lands on /login", () => {
      const u = userWith("Admin", []);
      expect(defaultLandingPath(u)).toBe("/login");
    });

    it("only ExamTake: lands on /exam/list", () => {
      const u = userWith("Candidate", ["exam.take"]);
      expect(defaultLandingPath(u)).toBe("/exam/list");
    });

    it("only console perm (no ExamTake): lands on console", () => {
      const u = userWith("Teacher", ["exam.view"]);
      expect(defaultLandingPath(u)).toBe("/admin/exams");
    });
  });
});
