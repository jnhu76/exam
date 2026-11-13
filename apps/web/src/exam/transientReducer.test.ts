import { describe, expect, it } from "vitest";
import { transientReducer } from "./transientReducer";

/**
 * P3-FSM-0 — transient reducer.
 *
 * Only owns UI transient submit/load states. It does NOT duplicate
 * AttemptStatus — the backend snapshot is the business truth source (L0
 * §7.3).
 *
 * R6 (#971): the per-question answer-save lifecycle is derived from the save
 * queue's per-question statuses (useSubmitFlush), NOT from a single global
 * save slot here — a global SAVE_SUCCESS/SAVE_FAILED slot let one question's
 * outcome mask another's pending/failed state. The SAVE_* events therefore
 * no longer exist in this vocabulary; the submit flow keeps its own states.
 */

describe("transientReducer", () => {
  it("idle + SUBMIT_REQUEST → submitting", () => {
    expect(transientReducer("idle", { type: "SUBMIT_REQUEST" })).toBe(
      "submitting",
    );
  });

  it("submitting + SUBMIT_SUCCESS → idle", () => {
    expect(transientReducer("submitting", { type: "SUBMIT_SUCCESS" })).toBe(
      "idle",
    );
  });

  it("submitting + SUBMIT_FAILED → submit_failed", () => {
    expect(transientReducer("submitting", { type: "SUBMIT_FAILED" })).toBe(
      "submit_failed",
    );
  });

  it("submitting + SUBMIT_REQUEST stays submitting (double-submit guard)", () => {
    expect(transientReducer("submitting", { type: "SUBMIT_REQUEST" })).toBe(
      "submitting",
    );
  });

  it("submit_failed + SUBMIT_REQUEST → submitting (retry after failure)", () => {
    expect(transientReducer("submit_failed", { type: "SUBMIT_REQUEST" })).toBe(
      "submitting",
    );
  });

  it("any state + RESET → idle", () => {
    expect(transientReducer("submit_failed", { type: "RESET" })).toBe("idle");
    expect(transientReducer("submitting", { type: "RESET" })).toBe("idle");
    expect(transientReducer("load_failed", { type: "RESET" })).toBe("idle");
  });

  it("any state + LOAD_FAILED → load_failed", () => {
    expect(transientReducer("idle", { type: "LOAD_FAILED" })).toBe(
      "load_failed",
    );
    expect(transientReducer("submitting", { type: "LOAD_FAILED" })).toBe(
      "load_failed",
    );
  });

  it("exposes only the submit/load vocabulary — per-question save state lives in the save queue", () => {
    // The save-phase states are gone from the reducer's vocabulary (R6):
    // dispatching a SAVE_* event must be a compile-time error, and the
    // reduced states must never include the old global save slots.
    const statesAfterSubmitCycle = new Set([
      transientReducer("idle", { type: "SUBMIT_REQUEST" }),
      transientReducer("submitting", { type: "SUBMIT_FAILED" }),
      transientReducer("submit_failed", { type: "RESET" }),
      transientReducer("idle", { type: "LOAD_FAILED" }),
    ]);
    expect(statesAfterSubmitCycle.has("saving" as never)).toBe(false);
    expect(statesAfterSubmitCycle.has("save_failed" as never)).toBe(false);
  });
});
