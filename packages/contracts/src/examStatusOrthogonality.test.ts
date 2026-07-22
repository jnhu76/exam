import { describe, expect, it } from "vitest";
import { ExamStatusEnum, ResultPublicationModeEnum } from "./exam.js";
import { ProctorExamStatusEnum } from "./proctorMonitoring.js";

/**
 * Orthogonality contract: ExamStatus vs ResultPublicationMode vs
 * ProctorExamStatus (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1, directive §4).
 *
 * A reviewer finding asserted "the Exam enters after_grading and then
 * disappears from the Proctor workspace." That is a category error:
 * `after_grading` is a `ResultPublicationMode` (a result-visibility policy),
 * NOT an `ExamStatus` (a lifecycle status). An exam cannot "enter
 * after_grading." This test makes the type boundary explicit and prevents
 * future regression that would conflate the two domains.
 *
 * Authority: `packages/domain/src/enums.ts` (ExamStatus, ResultPublicationMode)
 * and `packages/contracts/src/exam.ts` (Zod enums mirroring the domain). The
 * Proctor workspace discoverability filter (`listProctorDiscoverable`) operates
 * on `ExamStatus` only; `ResultPublicationMode` has no effect on it.
 */
describe("ExamStatus / ResultPublicationMode orthogonality", () => {
  it("ExamStatus is exactly the documented lifecycle set (no after_grading)", () => {
    expect(ExamStatusEnum.options).toEqual([
      "draft",
      "published",
      "open",
      "closed",
      "canceled",
      "archived",
    ]);
  });

  it("ResultPublicationMode is exactly the visibility-policy set (after_grading lives here)", () => {
    expect(ResultPublicationModeEnum.options).toEqual([
      "immediate",
      "after_grading",
      "manual",
    ]);
  });
});

/**
 * Proctor workspace discoverability operates on ExamStatus, never on
 * ResultPublicationMode. The backend `listProctorDiscoverable` filter
 * (`examRepo.ts: inArray(exams.status, ["published","open","closed"])`) and the
 * frontend `ProctorWorkspacePage.STATUS_FILTERS` both use exactly this set.
 * `after_grading` (a ResultPublicationMode) has no bearing on discoverability.
 */
describe("Proctor workspace discoverability is ExamStatus-only", () => {
  it("ProctorExamStatusEnum is exactly published/open/closed", () => {
    expect(ProctorExamStatusEnum.options).toEqual([
      "published",
      "open",
      "closed",
    ]);
  });
});
