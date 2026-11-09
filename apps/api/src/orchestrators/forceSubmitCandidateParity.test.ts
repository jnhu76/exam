/**
 * Candidate ↔ engine parity for the Admin Recovery Center's attempt action
 * candidates (contract §6.4: `allowedActions` = caller capability ∩ Attempt
 * state ∩ resource scope, server-computed).
 *
 * `deriveAttemptStatusActionCandidates` (@exam/db recovery read model) is a
 * PREDICTION surface only: the final word on force-submit legality is
 * `planForceSubmitExecution` — the pure planner of the durable force-submit
 * execution, which throws `InvalidStateTransitionError` for the engine's
 * rejection set under the EA lock. When the two diverge, the recovery UI
 * renders a button whose click is guaranteed to 409. This test pins the
 * biconditional across the full AttemptStatus domain so the read-model
 * predicate cannot drift from the engine rejection set:
 *
 *   candidate contains force_submit ⟺ the engine planner accepts the status
 *
 * This file lives in apps/api because it is the only workspace whose declared
 * dependency graph already reaches BOTH sides (@exam/db read model + the
 * orchestrator planner); binding them adds no new cross-package edge
 * (code-quality §6.1 as-built: @exam/api → @exam/db, @exam/exam-engine).
 */

import { describe, expect, it } from "vitest";
import { AttemptStatus, InvalidStateTransitionError } from "@exam/domain";
import type { ExamAttempt } from "@exam/domain";
import { deriveAttemptStatusActionCandidates } from "@exam/db/repository/recoveryRepo";
import { planForceSubmitExecution } from "./forceSubmitExecution.js";

/** Minimal ExamAttempt carrying only the fields the planner reads. */
function attemptWithStatus(status: ExamAttempt["status"]): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enrollment-1",
    candidateId: "candidate-1",
    attemptNo: 1,
    status,
    questionSnapshot: [],
    answers: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** True iff the force-submit engine authority accepts this status. */
function engineAcceptsForceSubmit(status: ExamAttempt["status"]): boolean {
  try {
    planForceSubmitExecution(attemptWithStatus(status), new Date(0));
    return true;
  } catch (error) {
    if (error instanceof InvalidStateTransitionError) return false;
    throw error;
  }
}

describe("force_submit candidate ↔ engine parity", () => {
  const STATUSES = Object.values(AttemptStatus);

  it("iterates the full AttemptStatus domain", () => {
    // The parity loops below are only as exhaustive as this list. Pinning the
    // exact value set makes any future enum addition fail HERE first, forcing
    // a conscious parity decision for the new status on both the read model
    // and the engine planner.
    expect([...STATUSES].sort()).toEqual(
      [
        "not_started",
        "queued",
        "in_progress",
        "disrupted",
        "submitted",
        "graded",
        "voided",
      ].sort(),
    );
  });

  it("candidate contains force_submit ⟺ the engine planner accepts the status", () => {
    for (const status of STATUSES) {
      const hasCandidate =
        deriveAttemptStatusActionCandidates(status).includes("force_submit");
      const engineAccepts = engineAcceptsForceSubmit(status);
      expect(
        hasCandidate,
        `${status}: recovery candidate predicts force_submit=${hasCandidate} ` +
          `but the engine planner ${engineAccepts ? "accepts" : "rejects"} it`,
      ).toBe(engineAccepts);
    }
  });

  it("time_grant candidate only on in_progress | disrupted", () => {
    for (const status of STATUSES) {
      const candidates = deriveAttemptStatusActionCandidates(status);
      if (status === "in_progress" || status === "disrupted") {
        expect(candidates, status).toContain("time_grant");
      } else {
        expect(candidates, status).not.toContain("time_grant");
      }
    }
  });

  it("misconduct_mark is a candidate on every status (no status excluded)", () => {
    for (const status of STATUSES) {
      expect(deriveAttemptStatusActionCandidates(status), status).toContain(
        "misconduct_mark",
      );
    }
  });
});
