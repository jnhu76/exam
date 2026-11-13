import { describe, expect, it } from "vitest";
import { localInputToInstant } from "@/lib/dateTime";
import {
  buildCreateExamPayload,
  clearOverride,
  goToStep,
  initialWizardState,
  resolveWizardSchedule,
  setInterruptionPolicyOverride,
  setOverride,
  WIZARD_CODE_DEFAULTS,
  type WizardScheduleInstants,
  type WizardState,
} from "./wizardState";

const SCHEDULE = { openAt: "2026-09-01T09:00", closeAt: "2026-09-01T11:00" };

// Instants for SCHEDULE under the stated scheduling time zone — produced by
// the same seam the page uses, so the wire contract and the seam stay tied.
const SCHEDULE_TZ = "Asia/Shanghai";

function scheduleInstants(
  openAt: string,
  closeAt: string,
): WizardScheduleInstants {
  const open = localInputToInstant(openAt, SCHEDULE_TZ);
  const close = localInputToInstant(closeAt, SCHEDULE_TZ);
  return {
    openAt: open.kind === "unique" ? open.instant : "",
    closeAt: close.kind === "unique" ? close.instant : null,
  };
}

function stateWith(partial: Partial<WizardState>): WizardState {
  return { ...initialWizardState(), ...SCHEDULE, ...partial };
}

function payloadFor(
  partial: Partial<WizardState>,
  resolved = WIZARD_CODE_DEFAULTS,
) {
  const state = stateWith(partial);
  return buildCreateExamPayload(
    state,
    resolved,
    scheduleInstants(state.openAt, state.closeAt),
  );
}

describe("buildCreateExamPayload — durationMinutes wire semantics (explicit > profile > default)", () => {
  it("profile path, no duration override → OMITS durationMinutes (profile value wins)", () => {
    const payload = payloadFor({ profileId: "p1" });
    expect(payload.profileId).toBe("p1");
    expect(payload).not.toHaveProperty("durationMinutes");
  });

  it("profile path, explicit duration override → sends the override", () => {
    const payload = payloadFor({
      profileId: "p1",
      overrides: { durationMinutes: 120 },
    });
    expect(payload.durationMinutes).toBe(120);
  });

  it("no profile, no duration override → sends the code default (60)", () => {
    const payload = payloadFor({ profileId: null });
    expect(payload.durationMinutes).toBe(WIZARD_CODE_DEFAULTS.durationMinutes);
  });

  it("no profile, explicit duration override → sends the override, not the default", () => {
    const payload = payloadFor({
      profileId: null,
      overrides: { durationMinutes: 45 },
    });
    expect(payload.durationMinutes).toBe(45);
  });
});

describe("buildCreateExamPayload — schedule instants are the single wire authority", () => {
  it("sends the caller-resolved instants verbatim (no wall-clock re-parse)", () => {
    // F-20 regression: the payload must carry the instant the page resolved
    // through the scheduling seam — never a browser-zone re-parse of the wall
    // string. The state wall clock here deliberately differs from the
    // instants under a non-host time zone.
    const payload = buildCreateExamPayload(
      stateWith({
        openAt: "2026-11-20T09:00",
        closeAt: "2026-11-20T11:00",
      }),
      WIZARD_CODE_DEFAULTS,
      {
        openAt: "2026-11-20T01:00:00.000Z",
        closeAt: "2026-11-20T03:00:00.000Z",
      },
    );
    expect(payload.openAt).toBe("2026-11-20T01:00:00.000Z");
    expect(payload.closeAt).toBe("2026-11-20T03:00:00.000Z");
  });

  it("untimed mode sends an explicit semantic null closeAt", () => {
    const payload = buildCreateExamPayload(
      stateWith({
        overrides: { timingMode: "untimed" },
        closeAt: "",
      }),
      { ...WIZARD_CODE_DEFAULTS, timingMode: "untimed" },
      { openAt: "2026-09-01T01:00:00.000Z", closeAt: null },
    );
    expect(payload.closeAt).toBeNull();
    expect(payload.openAt).toBe("2026-09-01T01:00:00.000Z");
  });

  it("missing resolved instants THROWS (fail-closed), even with wall strings present", () => {
    const state = stateWith({});
    expect(() =>
      buildCreateExamPayload(state, WIZARD_CODE_DEFAULTS, {
        openAt: "",
        closeAt: null,
      }),
    ).toThrow(/instant/);
  });
});

describe("buildCreateExamPayload — schedule fail-closed", () => {
  it("missing openAt/closeAt THROWS instead of inventing times", () => {
    expect(() =>
      buildCreateExamPayload(initialWizardState(), WIZARD_CODE_DEFAULTS, {
        openAt: "",
        closeAt: null,
      }),
    ).toThrow(/openAt\/closeAt/);
  });

  it("partial schedule also throws", () => {
    const s = initialWizardState();
    expect(() =>
      buildCreateExamPayload(
        { ...s, openAt: "2026-09-01T09:00" },
        WIZARD_CODE_DEFAULTS,
        { openAt: "", closeAt: null },
      ),
    ).toThrow(/openAt\/closeAt/);
  });
});

describe("resolveWizardSchedule — wall clocks resolved through the scheduling seam", () => {
  it("resolves unique wall clocks to instants in the given zone", () => {
    const schedule = resolveWizardSchedule(
      { openAt: "2026-11-20T09:00", closeAt: "2026-11-20T11:00" },
      "Asia/Shanghai",
    );
    expect(schedule.open).toEqual({
      status: "ok",
      instant: "2026-11-20T01:00:00.000Z",
    });
    expect(schedule.close).toEqual({
      status: "ok",
      instant: "2026-11-20T03:00:00.000Z",
    });
  });

  it("an empty closeAt stays empty", () => {
    const schedule = resolveWizardSchedule(
      { openAt: "2026-11-20T09:00", closeAt: "" },
      "Asia/Shanghai",
    );
    expect(schedule.open.status).toBe("ok");
    expect(schedule.close.status).toBe("empty");
  });

  it("maps DST gaps, overlaps and invalid dates to field statuses", () => {
    const schedule = resolveWizardSchedule(
      { openAt: "2026-03-08T02:30", closeAt: "2026-11-01T01:30" },
      "America/Los_Angeles",
    );
    expect(schedule.open.status).toBe("dst-gap");
    expect(schedule.close.status).toBe("ambiguous");

    const invalid = resolveWizardSchedule(
      { openAt: "2026-02-30T09:00", closeAt: "2026-11-20T11:00" },
      "Asia/Shanghai",
    );
    expect(invalid.open.status).toBe("invalid");
    expect(invalid.close.status).toBe("ok");
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

describe("clearOverride — revert to inheritance", () => {
  it("removes the selected override entirely", () => {
    const s = setOverride(initialWizardState(), "durationMinutes", 45);
    expect(clearOverride(s, "durationMinutes").overrides).toEqual({});
  });

  it("restores inheritance for the cleared field while keeping other overrides", () => {
    const s = setOverride(
      setOverride(initialWizardState(), "durationMinutes", 45),
      "retakePolicy",
      "max_attempts",
    );
    const next = clearOverride(s, "durationMinutes");
    expect(next.overrides).toEqual({ retakePolicy: "max_attempts" });
    // The cleared field resolves back to the code default on the no-profile path.
    const payload = payloadFor({ profileId: null, overrides: next.overrides });
    expect(payload.durationMinutes).toBe(WIZARD_CODE_DEFAULTS.durationMinutes);
  });
});

describe("goToStep — clamping", () => {
  it("clamps below 1 to step 1", () => {
    expect(goToStep(initialWizardState(), 0).step).toBe(1);
    expect(goToStep(initialWizardState(), -3).step).toBe(1);
  });

  it("clamps above 5 to step 5", () => {
    expect(goToStep(initialWizardState(), 9).step).toBe(5);
  });

  it("preserves valid indices", () => {
    expect(goToStep(initialWizardState(), 3).step).toBe(3);
    expect(goToStep(initialWizardState(), 1).step).toBe(1);
    expect(goToStep(initialWizardState(), 5).step).toBe(5);
  });
});
