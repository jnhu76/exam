/**
 * Transient UI state for the TakeExam page (L0 §7.3).
 *
 * This is deliberately NOT a copy of AttemptStatus. It only tracks
 * short-lived submit/load UI phases. The backend CandidateTakeSnapshot
 * remains the business truth source.
 *
 * INVARIANT (#971 R6): the per-question answer-save lifecycle (saving /
 * saved / failed) has NO global slot here — it is DERIVED from the save
 * queue's per-question statuses (useSubmitFlush.getSaveQueueSummary) so one
 * question's success can never mask another question's pending or failed
 * revision. The former global SAVE_* events were removed with that dual
 * truth source.
 */
export type TransientState =
  | "idle"
  | "submitting"
  | "submit_failed"
  | "load_failed";

/**
 * Events that drive transient UI state transitions (L0 §7.3).
 */
export type TransientEvent =
  | { type: "SUBMIT_REQUEST" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_FAILED" }
  | { type: "LOAD_FAILED" }
  | { type: "RESET" };

/**
 * Reduces a transient state + event into the next transient state.
 *
 * Anti-repeat guard (L0 §7.3): `submitting` ignores `SUBMIT_REQUEST` so a
 * double-click cannot fire a second submit.
 *
 * Any state accepts RESET → idle and LOAD_FAILED → load_failed.
 */
export function transientReducer(
  state: TransientState,
  event: TransientEvent,
): TransientState {
  switch (event.type) {
    case "RESET":
      return "idle";
    case "LOAD_FAILED":
      return "load_failed";
    case "SUBMIT_REQUEST":
      // Double-submit guard: ignore while already submitting.
      if (state === "submitting") return state;
      return "submitting";
    case "SUBMIT_SUCCESS":
      return state === "submitting" ? "idle" : state;
    case "SUBMIT_FAILED":
      return state === "submitting" ? "submit_failed" : state;
    default: {
      // Exhaustiveness guard — if a new event is added without a case, the
      // compiler flags it here.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
