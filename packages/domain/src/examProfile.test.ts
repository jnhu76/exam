import { describe, expect, it } from "vitest";
import {
  applyExamProfileDefaults,
  type ExamProfilePolicyDefaults,
} from "./examProfile.js";

const baseProfile: ExamProfilePolicyDefaults = {
  durationMinutes: 60,
  latestStartOffsetMinutes: 10,
  minSubmitAfterStartMinutes: 5,
  retakePolicy: "max_attempts",
  maxAttempts: 2,
  scoreStrategy: "highest",
  resultPublicationMode: "after_grading",
  interruptionTimePolicy: "bounded_grace",
  interruptionGracePerIncidentSeconds: 120,
  interruptionGracePerAttemptSeconds: 600,
};

describe("applyExamProfileDefaults — precedence (P7-M2 §18/§21)", () => {
  it("applies the profile value when the request omits the field", () => {
    const resolved = applyExamProfileDefaults(baseProfile, {});
    expect(resolved).toEqual(baseProfile);
  });

  it("explicit request values override profile values", () => {
    const resolved = applyExamProfileDefaults(baseProfile, {
      durationMinutes: 90,
      maxAttempts: 3,
    });
    expect(resolved.durationMinutes).toBe(90);
    expect(resolved.maxAttempts).toBe(3);
    // Untouched fields still come from the profile.
    expect(resolved.retakePolicy).toBe("max_attempts");
    expect(resolved.resultPublicationMode).toBe("after_grading");
    expect(resolved.latestStartOffsetMinutes).toBe(10);
  });

  it("explicit null overrides a nullable profile value (never ??-collapses)", () => {
    const resolved = applyExamProfileDefaults(baseProfile, {
      latestStartOffsetMinutes: null,
      interruptionGracePerIncidentSeconds: null,
    });
    expect(resolved.latestStartOffsetMinutes).toBeNull();
    expect(resolved.interruptionGracePerIncidentSeconds).toBeNull();
    expect(resolved.minSubmitAfterStartMinutes).toBe(5);
  });

  // Note: `exactOptionalPropertyTypes` makes an explicit `undefined` literal
  // inexpressible in Partial<ExamProfilePolicyDefaults> — which IS the
  // semantics: an absent key means "no override" (undefined). The null-vs-
  // omitted distinction is covered by the "explicit null" and "omits the
  // field" tests above; `applyExamProfileDefaults` itself uses `!==
  // undefined` so an explicit undefined (if it ever arrives at runtime) is
  // treated as no override, never as a value.

  it("resolves every profile-owned field", () => {
    const resolved = applyExamProfileDefaults(baseProfile, {});
    expect(Object.keys(resolved).sort()).toEqual(
      Object.keys(baseProfile).sort(),
    );
  });
});

describe("applyExamProfileDefaults — purity (P7-M2 §18)", () => {
  it("does not mutate the profile or the overrides inputs", () => {
    const profile = { ...baseProfile };
    const overrides: Partial<ExamProfilePolicyDefaults> = {
      durationMinutes: 90,
      latestStartOffsetMinutes: null,
    };
    const profileSnapshot = JSON.parse(JSON.stringify(profile));
    const overridesSnapshot = JSON.parse(JSON.stringify(overrides));

    applyExamProfileDefaults(profile, overrides);

    expect(JSON.parse(JSON.stringify(profile))).toEqual(profileSnapshot);
    expect(JSON.parse(JSON.stringify(overrides))).toEqual(overridesSnapshot);
  });

  it("is deterministic for identical inputs", () => {
    const a = applyExamProfileDefaults(baseProfile, { maxAttempts: 3 });
    const b = applyExamProfileDefaults(baseProfile, { maxAttempts: 3 });
    expect(a).toEqual(b);
  });
});
