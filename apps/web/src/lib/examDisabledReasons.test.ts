import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import {
  deleteDisabledReasonKey,
  scoreViewDisabledReasonKey,
} from "./examDisabledReasons";

/**
 * C1 DisabledReasonCode consumption (message contract D0.8, C3): first-party
 * presentation derives from the machine code alone; the legacy
 * natural-language wire sibling is compatibility-only.
 */
describe("examDisabledReasons", () => {
  it("maps every score-view machine code to its Web i18n key", () => {
    expect(scoreViewDisabledReasonKey("EXAM_CANCELED")).toBe(
      "admin.exams.disabledReasons.canceled",
    );
    expect(scoreViewDisabledReasonKey("EXAM_NOT_FINISHED")).toBe(
      "admin.exams.disabledReasons.notFinished",
    );
    expect(scoreViewDisabledReasonKey("NO_GRADED_ATTEMPTS")).toBe(
      "admin.exams.disabledReasons.noGradedAttempts",
    );
  });

  it("maps the delete machine code to its Web i18n key", () => {
    expect(deleteDisabledReasonKey("EXAM_NOT_DRAFT")).toBe(
      "admin.exams.disabledReasons.notDraft",
    );
  });

  it("T6: presentation is derived from the machine code, never the legacy text", () => {
    // The mapper's only input is the machine code; mutating the legacy
    // natural-language wire value cannot change first-party output. Resolving
    // through the real catalog proves the key is live i18n, not a stale
    // literal.
    for (const code of [
      "EXAM_CANCELED",
      "EXAM_NOT_FINISHED",
      "NO_GRADED_ATTEMPTS",
    ] as const) {
      const key = scoreViewDisabledReasonKey(code);
      expect(key).not.toBeNull();
      const copy = i18n.t(key!);
      expect(copy).not.toBe(key);
      expect(copy.length).toBeGreaterThan(0);
    }
    expect(i18n.t(deleteDisabledReasonKey("EXAM_NOT_DRAFT")!)).toBe(
      "仅草稿状态的考试可删除",
    );
  });

  it("returns null for unknown future codes so callers fall back to legacy text", () => {
    expect(scoreViewDisabledReasonKey("FUTURE_BLOCK_REASON" as never)).toBe(
      null,
    );
    expect(deleteDisabledReasonKey("FUTURE_BLOCK_REASON" as never)).toBe(null);
  });
});
