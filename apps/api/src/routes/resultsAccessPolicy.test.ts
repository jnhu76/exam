import { describe, expect, it } from "vitest";
import type { ExamStatus } from "@exam/domain";
import {
  isExamEnded,
  resolveAdminResultsAccess,
} from "./resultsAccessPolicy.js";

/** Minimal exam projection: both policy functions read only status/closeAt. */
function exam(status: ExamStatus, closeAt: Date | null) {
  return { status, closeAt };
}

describe("isExamEnded", () => {
  it("closed and archived exams are ended regardless of closeAt", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const future = new Date("2999-01-01T00:00:00Z");
    expect(isExamEnded(exam("closed", null), past)).toBe(true);
    expect(isExamEnded(exam("archived", null), past)).toBe(true);
    expect(isExamEnded(exam("closed", future), past)).toBe(true);
    expect(isExamEnded(exam("archived", future), past)).toBe(true);
  });

  it("an untimed exam (closeAt null) never ends by the clock", () => {
    const now = new Date("2025-06-01T00:00:00Z");
    expect(isExamEnded(exam("published", null), now)).toBe(false);
    expect(isExamEnded(exam("open", null), now)).toBe(false);
  });

  it("a scheduled exam is not ended strictly before closeAt", () => {
    const closeAt = new Date("2025-06-01T12:00:00Z");
    expect(
      isExamEnded(exam("published", closeAt), new Date(closeAt.getTime() - 1)),
    ).toBe(false);
  });

  it("boundary: now === closeAt counts as ended (>= semantics)", () => {
    const closeAt = new Date("2025-06-01T12:00:00Z");
    expect(
      isExamEnded(exam("published", closeAt), new Date(closeAt.getTime())),
    ).toBe(true);
    expect(
      isExamEnded(exam("open", closeAt), new Date(closeAt.getTime())),
    ).toBe(true);
  });
});

describe("resolveAdminResultsAccess", () => {
  const now = new Date("2025-06-01T12:00:00Z");
  const ended = new Date("2025-06-01T11:00:00Z");
  const future = new Date("2025-06-01T13:00:00Z");

  it("canceled wins over every other condition", () => {
    expect(
      resolveAdminResultsAccess(exam("canceled", ended), now, 3, 5),
    ).toEqual({ allowed: false, verdict: "EXAM_CANCELED" });
    expect(
      resolveAdminResultsAccess(exam("canceled", future), now, 0, 0),
    ).toEqual({ allowed: false, verdict: "EXAM_CANCELED" });
  });

  it("unresolved attempts win over the ended check (mid-exam access is blocked either way)", () => {
    expect(resolveAdminResultsAccess(exam("open", ended), now, 2, 0)).toEqual({
      allowed: false,
      verdict: "UNRESOLVED_ATTEMPTS_EXIST",
      unresolvedCount: 2,
    });
    expect(resolveAdminResultsAccess(exam("open", future), now, 1, 0)).toEqual({
      allowed: false,
      verdict: "UNRESOLVED_ATTEMPTS_EXIST",
      unresolvedCount: 1,
    });
  });

  it("not-ended with no unresolved attempts is EXAM_NOT_FINISHED", () => {
    expect(
      resolveAdminResultsAccess(exam("published", future), now, 0, 4),
    ).toEqual({ allowed: false, verdict: "EXAM_NOT_FINISHED" });
    // untimed exams never end by the clock
    expect(
      resolveAdminResultsAccess(exam("published", null), now, 0, 4),
    ).toEqual({ allowed: false, verdict: "EXAM_NOT_FINISHED" });
  });

  it("ended with zero graded attempts is NO_GRADED_ATTEMPTS", () => {
    expect(
      resolveAdminResultsAccess(exam("published", ended), now, 0, 0),
    ).toEqual({ allowed: false, verdict: "NO_GRADED_ATTEMPTS" });
  });

  it("ended with graded attempts is allowed", () => {
    expect(
      resolveAdminResultsAccess(exam("published", ended), now, 0, 1),
    ).toEqual({ allowed: true, verdict: "allowed" });
    expect(resolveAdminResultsAccess(exam("closed", null), now, 0, 7)).toEqual({
      allowed: true,
      verdict: "allowed",
    });
  });
});
