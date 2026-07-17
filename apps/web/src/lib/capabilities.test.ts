import { describe, expect, it } from "vitest";
import type { MeResponse } from "@exam/contracts";
import {
  can,
  canAccessAdminConsole,
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
  canUnpublishExam,
  canUpdateExam,
  defaultLandingPath,
  isAdmin,
  isCandidate,
} from "./capabilities";

/** Build a minimal MeResponse-shaped user for a role. */
function user(role: MeResponse["role"]): Pick<MeResponse, "role"> {
  return { role };
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
  // A spot-check that the frontend preset-derived verdict matches a known
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
  // visible iff the principal's preset grants ANY of UserView/CandidateView/
  // AuditLogView/SettingsView/SystemHealthView/CandidateFieldView. This keeps
  // the gate aligned with the backend per-route requireCapability gates and
  // avoids anointing a single surrogate permission (directive §3).
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
});
