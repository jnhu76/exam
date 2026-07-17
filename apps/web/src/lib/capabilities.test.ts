import { describe, expect, it } from "vitest";
import type { MeResponse } from "@exam/contracts";
import {
  can,
  canAccessAdminConsole,
  canArchiveExam,
  canCancelExam,
  canCloseExam,
  canDeleteExam,
  canExtendExam,
  canManageEnrollments,
  canPublishExam,
  canPublishResults,
  canSeeExams,
  canSeeGradingQueue,
  canSeeManagement,
  canSeeProctor,
  canSeeQuestionBank,
  canSeeResults,
  canUnpublishExam,
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
    expect(canSeeQuestionBank(u)).toBe(true);
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
    expect(canSeeQuestionBank(u)).toBe(true);
    expect(canSeeExams(u)).toBe(true);
    expect(canSeeGradingQueue(u)).toBe(false); // Teacher is NOT a Grader
    expect(canSeeResults(u)).toBe(true);
    expect(canSeeProctor(u)).toBe(false);
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("Grader sees the grading queue but NOT authoring/management/proctor", () => {
    const u = user("Grader");
    expect(canSeeManagement(u)).toBe(false);
    expect(canSeeQuestionBank(u)).toBe(false);
    expect(canSeeExams(u)).toBe(false);
    expect(canSeeGradingQueue(u)).toBe(true);
    expect(canSeeResults(u)).toBe(false);
    expect(canSeeProctor(u)).toBe(false);
    expect(canAccessAdminConsole(u)).toBe(true);
  });

  it("Proctor sees proctor monitoring but NOT authoring/grading/management", () => {
    const u = user("Proctor");
    expect(canSeeManagement(u)).toBe(false);
    expect(canSeeQuestionBank(u)).toBe(false);
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
    expect(canSeeQuestionBank(u)).toBe(false);
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
      expect(canPublishExam(u), role).toBe(false);
      expect(canCloseExam(u), role).toBe(false);
      expect(canPublishResults(u), role).toBe(false);
      expect(canManageEnrollments(u), role).toBe(false);
    }
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
