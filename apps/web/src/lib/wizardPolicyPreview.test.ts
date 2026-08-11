import { describe, expect, it } from "vitest";
import {
  buildExplicitOverridesPayload,
  buildWizardPolicyPreview,
  isOverridden,
  type WizardProfileLike,
} from "./wizardPolicyPreview";
import type { ExamProfilePolicyDefaults } from "@exam/domain";

const codeDefaults: ExamProfilePolicyDefaults = {
  durationMinutes: 60,
  latestStartOffsetMinutes: null,
  minSubmitAfterStartMinutes: null,
  retakePolicy: "unlimited",
  maxAttempts: 1,
  scoreStrategy: "highest",
  resultPublicationMode: "immediate",
  interruptionTimePolicy: "strict",
  interruptionGracePerIncidentSeconds: null,
  interruptionGracePerAttemptSeconds: null,
};

const profile: WizardProfileLike = {
  id: "p1",
  name: "标准在线考试",
  defaults: {
    durationMinutes: 90,
    latestStartOffsetMinutes: 15,
    minSubmitAfterStartMinutes: 10,
    retakePolicy: "max_attempts",
    maxAttempts: 2,
    scoreStrategy: "highest",
    resultPublicationMode: "after_grading",
    interruptionTimePolicy: "bounded_grace",
    interruptionGracePerIncidentSeconds: 300,
    interruptionGracePerAttemptSeconds: 600,
  },
};

describe("buildWizardPolicyPreview — no-profile path", () => {
  it("falls back to code defaults with no overrides (all source override=false meaning not-overridden, but profile=null)", () => {
    const { resolved, sources, profileName } = buildWizardPolicyPreview({
      profile: null,
      overrides: {},
      codeDefaults,
    });
    expect(resolved).toEqual(codeDefaults);
    expect(profileName).toBeNull();
    // No profile + no overrides → every field is "override" (code default).
    expect(sources.durationMinutes).toBe("override");
  });

  it("applies an explicit override over code default", () => {
    const { resolved, sources } = buildWizardPolicyPreview({
      profile: null,
      overrides: { durationMinutes: 45 },
      codeDefaults,
    });
    expect(resolved.durationMinutes).toBe(45);
    expect(sources.durationMinutes).toBe("override");
  });
});

describe("buildWizardPolicyPreview — profile path", () => {
  it("resolves to profile defaults when no overrides are set (all source=profile)", () => {
    const { resolved, sources, profileName } = buildWizardPolicyPreview({
      profile,
      overrides: {},
      codeDefaults,
    });
    expect(resolved).toEqual(profile.defaults);
    expect(profileName).toBe("标准在线考试");
    expect(sources.durationMinutes).toBe("profile");
    expect(sources.retakePolicy).toBe("profile");
  });

  it("explicit value override wins over profile (source=override)", () => {
    const { resolved, sources } = buildWizardPolicyPreview({
      profile,
      overrides: { durationMinutes: 120 },
      codeDefaults,
    });
    expect(resolved.durationMinutes).toBe(120);
    expect(sources.durationMinutes).toBe("override");
    // Untouched fields still resolve from profile.
    expect(resolved.retakePolicy).toBe("max_attempts");
    expect(sources.retakePolicy).toBe("profile");
  });

  it("PRESERVES explicit null (does NOT erase it to profile value) — the M1/M2 invariant", () => {
    // The whole point of single-state authority: explicit null must survive.
    const { resolved, sources } = buildWizardPolicyPreview({
      profile,
      overrides: { latestStartOffsetMinutes: null },
      codeDefaults,
    });
    expect(resolved.latestStartOffsetMinutes).toBeNull();
    expect(sources.latestStartOffsetMinutes).toBe("override");
  });

  it("absent key inherits profile (NOT treated as null)", () => {
    const { resolved } = buildWizardPolicyPreview({
      profile,
      overrides: {},
      codeDefaults,
    });
    // Profile has 15; absence in overrides must NOT clear it.
    expect(resolved.latestStartOffsetMinutes).toBe(15);
  });
});

describe("buildExplicitOverridesPayload", () => {
  it("returns only explicitly-set keys, preserving null", () => {
    const payload = buildExplicitOverridesPayload({
      durationMinutes: 120,
      latestStartOffsetMinutes: null,
    });
    expect(payload).toEqual({
      durationMinutes: 120,
      latestStartOffsetMinutes: null,
    });
    expect(Object.prototype.hasOwnProperty.call(payload, "retakePolicy")).toBe(
      false,
    );
  });

  it("returns empty object when nothing is overridden", () => {
    expect(buildExplicitOverridesPayload({})).toEqual({});
  });

  it("preserves all 10 fields when all are overridden", () => {
    const all: Partial<ExamProfilePolicyDefaults> = {
      durationMinutes: 30,
      latestStartOffsetMinutes: 5,
      minSubmitAfterStartMinutes: 5,
      retakePolicy: "pass_then_stop",
      maxAttempts: 3,
      scoreStrategy: "latest",
      resultPublicationMode: "manual",
      interruptionTimePolicy: "operator_incident",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    };
    expect(buildExplicitOverridesPayload(all)).toEqual(all);
  });
});

describe("isOverridden", () => {
  it("true for present keys including null", () => {
    expect(isOverridden({ durationMinutes: 1 }, "durationMinutes")).toBe(true);
    expect(
      isOverridden(
        { latestStartOffsetMinutes: null },
        "latestStartOffsetMinutes",
      ),
    ).toBe(true);
  });

  it("false for absent keys", () => {
    expect(isOverridden({ durationMinutes: 1 }, "retakePolicy")).toBe(false);
    expect(isOverridden({}, "durationMinutes")).toBe(false);
  });
});
