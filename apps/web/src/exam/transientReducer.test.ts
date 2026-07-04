import { describe, expect, it } from "vitest";
import { transientReducer } from "./transientReducer";

/**
 * P3-FSM-0 — transient reducer.
 *
 * Only owns UI transient states (saving / submitting / error). It does NOT
 * duplicate AttemptStatus — the backend snapshot is the business truth source.
 * (L0 §7.3)
 */

describe("transientReducer", () => {
  it("idle + SAVE_REQUEST → saving", () => {
    expect(transientReducer("idle", { type: "SAVE_REQUEST" })).toBe("saving");
  });

  it("saving + SAVE_SUCCESS → idle", () => {
    expect(transientReducer("saving", { type: "SAVE_SUCCESS" })).toBe("idle");
  });

  it("saving + SAVE_FAILED → save_failed", () => {
    expect(transientReducer("saving", { type: "SAVE_FAILED" })).toBe(
      "save_failed",
    );
  });

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

  it("save_failed + SAVE_REQUEST → saving (retry allowed)", () => {
    expect(transientReducer("save_failed", { type: "SAVE_REQUEST" })).toBe(
      "saving",
    );
  });

  it("submit_failed + SUBMIT_REQUEST → submitting (retry after failure)", () => {
    expect(transientReducer("submit_failed", { type: "SUBMIT_REQUEST" })).toBe(
      "submitting",
    );
  });

  it("any state + RESET → idle", () => {
    expect(transientReducer("save_failed", { type: "RESET" })).toBe("idle");
    expect(transientReducer("submit_failed", { type: "RESET" })).toBe("idle");
    expect(transientReducer("submitting", { type: "RESET" })).toBe("idle");
    expect(transientReducer("load_failed", { type: "RESET" })).toBe("idle");
  });

  it("any state + LOAD_FAILED → load_failed", () => {
    expect(transientReducer("idle", { type: "LOAD_FAILED" })).toBe(
      "load_failed",
    );
    expect(transientReducer("saving", { type: "LOAD_FAILED" })).toBe(
      "load_failed",
    );
  });

  it("submitting + SAVE_REQUEST stays submitting (no save during submit)", () => {
    expect(transientReducer("submitting", { type: "SAVE_REQUEST" })).toBe(
      "submitting",
    );
  });

  it("ignores SAVE_SUCCESS when not saving (no spurious idle transition)", () => {
    expect(transientReducer("idle", { type: "SAVE_SUCCESS" })).toBe("idle");
    expect(transientReducer("submitting", { type: "SAVE_SUCCESS" })).toBe(
      "submitting",
    );
  });
});
