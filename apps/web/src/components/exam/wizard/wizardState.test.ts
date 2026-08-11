import { describe, expect, it } from "vitest";
import {
  buildCreateExamPayload,
  initialWizardState,
  setInterruptionPolicyOverride,
  setOverride,
  WIZARD_CODE_DEFAULTS,
  type WizardState,
} from "./wizardState";

const SCHEDULE = { openAt: "2026-09-01T09:00", closeAt: "2026-09-01T11:00" };

function stateWith(partial: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...SCHEDULE, ...partial };
}

describe("buildCreateExamPayload — durationMinutes wire semantics (explicit > profile > default)", () => {
  it("profile path, no duration override → OMITS durationMinutes (profile value wins)", () => {
    const payload = buildCreateExamPayload(stateWith({ profileId: "p1" }));
    expect(payload.profileId).toBe("p1");
    expect(payload).not.toHaveProperty("durationMinutes");
  });

  it("profile path, explicit duration override → sends the override", () => {
    const payload = buildCreateExamPayload(
      stateWith({
        profileId: "p1",
        overrides: { durationMinutes: 120 },
      }),
    );
    expect(payload.durationMinutes).toBe(120);
  });

  it("no profile, no duration override → sends the code default (60)", () => {
    const payload = buildCreateExamPayload(stateWith({ profileId: null }));
    expect(payload.durationMinutes).toBe(WIZARD_CODE_DEFAULTS.durationMinutes);
  });

  it("no profile, explicit duration override → sends the override, not the default", () => {
    const payload = buildCreateExamPayload(
      stateWith({ profileId: null, overrides: { durationMinutes: 45 } }),
    );
    expect(payload.durationMinutes).toBe(45);
  });
});

describe("buildCreateExamPayload — schedule fail-closed", () => {
  it("missing openAt/closeAt THROWS instead of inventing times", () => {
    expect(() => buildCreateExamPayload(initialWizardState())).toThrow(
      /openAt\/closeAt/,
    );
  });

  it("partial schedule also throws", () => {
    const s = initialWizardState();
    expect(() =>
      buildCreateExamPayload({ ...s, openAt: "2026-09-01T09:00" }),
    ).toThrow(/openAt\/closeAt/);
  });
});

describe("setInterruptionPolicyOverride — atomic caps clearing", () => {
  it("leaving bounded_grace writes policy + explicit null for both caps", () => {
    const s = setOverride(
      initialWizardState(),
      "interruptionTimePolicy",
      "bounded_grace",
    );
    const next = setInterruptionPolicyOverride(s, "strict");
    expect(next.overrides).toEqual({
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    });
  });

  it("operator_incident clears caps too", () => {
    const s = setOverride(
      initialWizardState(),
      "interruptionTimePolicy",
      "bounded_grace",
    );
    const next = setInterruptionPolicyOverride(s, "operator_incident");
    expect(next.overrides.interruptionTimePolicy).toBe("operator_incident");
    expect(next.overrides.interruptionGracePerIncidentSeconds).toBeNull();
    expect(next.overrides.interruptionGracePerAttemptSeconds).toBeNull();
  });

  it("entering bounded_grace only sets the policy (caps keep inherited/override values)", () => {
    const s = setOverride(
      initialWizardState(),
      "interruptionTimePolicy",
      "strict",
    );
    const next = setInterruptionPolicyOverride(s, "bounded_grace");
    expect(next.overrides).toEqual({ interruptionTimePolicy: "bounded_grace" });
  });
});
