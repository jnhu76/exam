import { describe, expect, it } from "vitest";
import {
  summarizeProfile,
  type ProfileSummaryLabels,
} from "./examProfileSummary";
import type { ExamProfilePolicyDefaults } from "@exam/domain";

/** English labels for deterministic snapshot-free assertions. */
const en: ProfileSummaryLabels = {
  durationMinutes: (m) => `${m} min`,
  noLimit: "no limit",
  latestStart: (m) => `late ${m}m`,
  minSubmit: (m) => `min-submit ${m}m`,
  retake: {
    unlimited: "unlimited",
    maxAttempts: (n) => `max ${n}`,
    passThenStop: "pass-then-stop",
  },
  scoreStrategy: { highest: "highest", latest: "latest", first: "first" },
  resultPublication: {
    immediate: "immediate",
    afterGrading: "after-grading",
    manual: "manual",
  },
  interruption: {
    strict: "strict",
    boundedGrace: "grace",
    operatorIncident: "operator",
  },
  separator: " | ",
};

const baseStrict: ExamProfilePolicyDefaults = {
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

describe("summarizeProfile", () => {
  it("renders the minimal strict profile without optional segments", () => {
    expect(summarizeProfile(baseStrict, en)).toBe(
      "60 min | unlimited | highest | immediate | strict",
    );
  });

  it("renders max_attempts with the attempt count", () => {
    expect(
      summarizeProfile(
        { ...baseStrict, retakePolicy: "max_attempts", maxAttempts: 2 },
        en,
      ),
    ).toBe("60 min | max 2 | highest | immediate | strict");
  });

  it("renders pass_then_stop without an attempt count", () => {
    expect(
      summarizeProfile({ ...baseStrict, retakePolicy: "pass_then_stop" }, en),
    ).toBe("60 min | pass-then-stop | highest | immediate | strict");
  });

  it("includes late-start and min-submit when present", () => {
    expect(
      summarizeProfile(
        {
          ...baseStrict,
          latestStartOffsetMinutes: 15,
          minSubmitAfterStartMinutes: 10,
        },
        en,
      ),
    ).toBe(
      "60 min | late 15m | min-submit 10m | unlimited | highest | immediate | strict",
    );
  });

  it("renders the standard-online profile with all segments", () => {
    expect(
      summarizeProfile(
        {
          durationMinutes: 60,
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
        en,
      ),
    ).toBe(
      "60 min | late 15m | min-submit 10m | max 2 | highest | after-grading | grace",
    );
  });

  it("renders operator_incident interruption", () => {
    expect(
      summarizeProfile(
        { ...baseStrict, interruptionTimePolicy: "operator_incident" },
        en,
      ),
    ).toBe("60 min | unlimited | highest | immediate | operator");
  });
});
