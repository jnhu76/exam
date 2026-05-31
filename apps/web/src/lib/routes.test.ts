import { describe, expect, it } from "vitest";
import { routes } from "@/lib/routes";

describe("routes", () => {
  it("has login route", () => {
    expect(routes.login).toBe("/login");
  });

  it("has admin routes", () => {
    expect(routes.admin.dashboard).toBe("/admin/dashboard");
    expect(routes.admin.organizations).toBe("/admin/organizations");
    expect(routes.admin.users).toBe("/admin/users");
    expect(routes.admin.candidates).toBe("/admin/candidates");
    expect(routes.admin.settings).toBe("/admin/settings");
    expect(routes.admin.candidateFields).toBe("/admin/candidate-fields");
    expect(routes.admin.courses).toBe("/admin/courses");
    expect(routes.admin.questions).toBe("/admin/questions");
    expect(routes.admin.questionsNew).toBe("/admin/questions/new");
    expect(routes.admin.questionEdit).toBeInstanceOf(Function);
    expect(routes.admin.questionEdit("123")).toBe("/admin/questions/123/edit");
    expect(routes.admin.questionsImport).toBe("/admin/questions/import");
    expect(routes.admin.exams).toBe("/admin/exams");
    expect(routes.admin.examsNew).toBe("/admin/exams/new");
    expect(routes.admin.examDetail).toBeInstanceOf(Function);
    expect(routes.admin.examDetail("42")).toBe("/admin/exams/42");
    expect(routes.admin.examScores).toBeInstanceOf(Function);
    expect(routes.admin.examScores("42")).toBe("/admin/exams/42/scores");
    expect(routes.admin.attemptDetail).toBeInstanceOf(Function);
    expect(routes.admin.attemptDetail("99")).toBe("/admin/attempts/99");
    expect(routes.admin.system).toBe("/admin/system");
  });

  it("has exam routes", () => {
    expect(routes.exam.list).toBe("/exam/list");
    expect(routes.exam.start).toBeInstanceOf(Function);
    expect(routes.exam.start("42")).toBe("/exam/42/start");
    expect(routes.exam.take).toBeInstanceOf(Function);
    expect(routes.exam.take("42")).toBe("/exam/42/take");
    expect(routes.exam.result).toBeInstanceOf(Function);
    expect(routes.exam.result("42")).toBe("/exam/42/result");
  });
});
