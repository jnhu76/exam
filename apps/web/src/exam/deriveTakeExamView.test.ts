import { describe, expect, it } from "vitest";
import type { CandidateTakeSnapshot } from "@exam/contracts";
import { deriveTakeExamView } from "./deriveTakeExamView";

/**
 * P3-FSM-0 — deriveTakeExamView pure function.
 *
 * The backend CandidateTakeSnapshot is the business truth source; this
 * function derives page display state from it without copying business
 * state (L0 §7.2).
 */

/** Builds a valid CandidateTakeSnapshot with overrides for test scenarios. */
function buildSnapshot(
  overrides: Partial<CandidateTakeSnapshot> = {},
): CandidateTakeSnapshot {
  return {
    attemptId: "00000000-0000-0000-0000-000000000001",
    examId: "00000000-0000-0000-0000-000000000002",
    attemptStatus: "in_progress",
    gradingStatus: "auto_graded",
    isEditable: true,
    canStart: false,
    canResume: false,
    canSave: true,
    canSubmit: true,
    resultVisibility: "hidden",
    answerVisibility: "hidden",
    submittedAt: null,
    serverNow: "2026-07-04T10:00:00.000Z",
    effectiveDeadline: "2026-07-04T11:00:00.000Z",
    serverRevision: "2026-07-04T10:00:00.000Z",
    questions: [
      {
        id: "q1",
        type: "single_choice",
        prompt: "pick one",
        promptDocument: null,
        answerMode: "plain",
        options: [{ id: "opt-a", content: "A", contentDocument: null }],
        inputMode: "choice",
        maxScore: 10,
        answerValue: null,
        answerSource: "none",
      },
    ],
    ...overrides,
  };
}

describe("deriveTakeExamView", () => {
  it("in_progress editable snapshot → unlocked, questions enabled, canSave/canSubmit passed through", () => {
    const view = deriveTakeExamView(buildSnapshot());

    expect(view.attemptStatus).toBe("in_progress");
    expect(view.isLocked).toBe(false);
    expect(view.canSave).toBe(true);
    expect(view.canSubmit).toBe(true);
    expect(view.lockReason).toBeUndefined();
    const q = view.questions[0]!;
    expect(q.disabled).toBe(false);
  });

  it("submitted snapshot → locked with lockReason='submitted', questions disabled", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        attemptStatus: "submitted",
        isEditable: false,
        canSave: false,
        canSubmit: false,
        lockReason: "submitted",
        submittedAt: "2026-07-04T10:30:00.000Z",
        questions: [
          {
            id: "q1",
            type: "single_choice",
            prompt: "pick one",
            promptDocument: null,
            answerMode: "plain",
            options: [{ id: "opt-a", content: "A", contentDocument: null }],
            inputMode: "choice",
            maxScore: 10,
            answerValue: "opt-a",
            answerSource: "submitted",
          },
        ],
      }),
    );

    expect(view.isLocked).toBe(true);
    expect(view.lockReason).toBe("submitted");
    const q = view.questions[0]!;
    expect(q.disabled).toBe(true);
    expect(q.answerSource).toBe("submitted");
    expect(view.submittedAt).toBe("2026-07-04T10:30:00.000Z");
  });

  it("disrupted snapshot → locked with lockReason='disrupted', canResume passed through", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        attemptStatus: "disrupted",
        isEditable: false,
        canResume: true,
        canSave: false,
        canSubmit: false,
        lockReason: "disrupted",
      }),
    );

    expect(view.isLocked).toBe(true);
    expect(view.lockReason).toBe("disrupted");
    expect(view.canResume).toBe(true);
  });

  it("graded + resultVisibility visible → showResult=true; answerVisibility visible → showAnswers=true", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        attemptStatus: "graded",
        gradingStatus: "fully_graded",
        isEditable: false,
        canSave: false,
        canSubmit: false,
        lockReason: "submitted",
        resultVisibility: "visible",
        answerVisibility: "visible",
      }),
    );

    expect(view.showResult).toBe(true);
    expect(view.showAnswers).toBe(true);
  });

  it("graded + resultVisibility hidden → showResult=false (no score leak)", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        attemptStatus: "graded",
        gradingStatus: "fully_graded",
        isEditable: false,
        resultVisibility: "hidden",
        answerVisibility: "hidden",
      }),
    );

    expect(view.showResult).toBe(false);
    expect(view.showAnswers).toBe(false);
  });

  it("deadline-locked in_progress → locked with lockReason='deadline'", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        attemptStatus: "in_progress",
        isEditable: false,
        canSave: false,
        canSubmit: false,
        lockReason: "deadline",
      }),
    );

    expect(view.isLocked).toBe(true);
    expect(view.lockReason).toBe("deadline");
  });

  it("passes through server time fields verbatim (server is the timer truth source)", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        serverNow: "2026-07-04T09:59:59.000Z",
        effectiveDeadline: "2026-07-04T11:30:00.000Z",
      }),
    );

    expect(view.serverNow).toBe("2026-07-04T09:59:59.000Z");
    expect(view.effectiveDeadline).toBe("2026-07-04T11:30:00.000Z");
  });

  it("preserves per-question answerSource routing (draft while in_progress)", () => {
    const view = deriveTakeExamView(
      buildSnapshot({
        attemptStatus: "in_progress",
        questions: [
          {
            id: "q1",
            type: "fill_blank",
            prompt: "blank",
            promptDocument: null,
            answerMode: "plain",
            options: [],
            inputMode: "single_line",
            maxScore: 5,
            answerValue: "green",
            answerSource: "draft",
          },
          {
            id: "q2",
            type: "fill_blank",
            prompt: "blank2",
            promptDocument: null,
            answerMode: "plain",
            options: [],
            inputMode: "single_line",
            maxScore: 5,
            answerValue: null,
            answerSource: "none",
          },
        ],
      }),
    );

    const q0 = view.questions[0]!;
    expect(q0.answerSource).toBe("draft");
    expect(q0.answerValue).toBe("green");
    const q1 = view.questions[1]!;
    expect(q1.answerSource).toBe("none");
  });
});
