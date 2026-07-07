import { describe, expect, it } from "vitest";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { deriveTakeExamView } from "./deriveTakeExamView";
import { transientReducer } from "./transientReducer";

/**
 * P3-FSM-0 integration: prove the two modules compose into the
 * refresh-restore contract (L0 §7.4).
 *
 * On page refresh the frontend re-derives its view purely from the
 * CandidateTakeSnapshot returned by GET /candidate/attempts/:id/take.
 * The transient reducer must NOT carry over a stale submitting phase —
 * a fresh load resets it to idle so a refreshed submitted attempt shows
 * locked, non-editable inputs without a stuck "submitting" indicator.
 */

describe("P3-FSM-0 refresh-restore integration", () => {
  it("refreshed submitted snapshot → locked view + idle transient (no stuck submitting)", () => {
    const snapshot: CandidateTakeSnapshot = {
      attemptId: "00000000-0000-0000-0000-000000000001",
      examId: "00000000-0000-0000-0000-000000000002",
      attemptStatus: "submitted",
      gradingStatus: "pending_manual",
      isEditable: false,
      canStart: false,
      canResume: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      resultVisibility: "hidden",
      answerVisibility: "hidden",
      submittedAt: "2026-07-04T10:30:00.000Z",
      serverNow: "2026-07-04T10:31:00.000Z",
      effectiveDeadline: "2026-07-04T11:00:00.000Z",
      serverRevision: "2026-07-04T10:30:00.000Z",
      questions: [
        {
          id: "q1",
          type: "text_response",
          prompt: "free text",
          options: [],
          inputMode: "multi_line",
          maxScore: 20,
          answerValue: "candidate answer",
          answerSource: "submitted",
        },
      ],
    };

    const view = deriveTakeExamView(snapshot);
    // Even if transient state was "submitting" right before refresh, the
    // fresh load must reset it to idle so the UI is not stuck.
    const afterRefresh = transientReducer("submitting", { type: "RESET" });

    expect(view.isLocked).toBe(true);
    expect(view.lockReason).toBe("submitted");
    expect(view.questions[0]!.disabled).toBe(true);
    expect(afterRefresh).toBe("idle");
  });

  it("submitted snapshot's canSave=false makes SAVE_REQUEST a no-op at the UI level", () => {
    const snapshot: CandidateTakeSnapshot = {
      attemptId: "00000000-0000-0000-0000-000000000001",
      examId: "00000000-0000-0000-0000-000000000002",
      attemptStatus: "submitted",
      gradingStatus: "fully_graded",
      isEditable: false,
      canStart: false,
      canResume: false,
      canSave: false,
      canSubmit: false,
      lockReason: "submitted",
      resultVisibility: "visible",
      answerVisibility: "visible",
      submittedAt: "2026-07-04T10:30:00.000Z",
      serverNow: "2026-07-04T10:31:00.000Z",
      effectiveDeadline: null,
      serverRevision: "2026-07-04T10:30:00.000Z",
      questions: [],
    };

    const view = deriveTakeExamView(snapshot);
    // Page contract: when canSave is false, the page must not fire SAVE_REQUEST.
    // The reducer would otherwise still transition to "saving" — so the guard
    // lives in the page, not the reducer. Here we assert the view exposes the
    // flag the page guards on.
    expect(view.canSave).toBe(false);
  });
});
