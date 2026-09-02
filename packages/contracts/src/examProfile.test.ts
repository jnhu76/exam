import { describe, expect, it } from "vitest";
import {
  CreateExamProfileRequestSchema,
  UpdateExamProfileRequestSchema,
  ExamProfileSchema,
} from "./examProfile.js";
import { CreateExamRequestSchema } from "./exam.js";

describe("CreateExamRequestSchema — P7-M2 profileId + durationMinutes (design §19/§20)", () => {
  const base = {
    title: "T",
    courseId: "00000000-0000-0000-0000-000000000001",
    openAt: "2026-01-01T00:00:00.000Z",
    closeAt: "2026-01-02T00:00:00.000Z",
    passingScore: 60,
    totalScore: 100,
  };

  it("requires durationMinutes when no profileId is supplied (unchanged no-profile contract)", () => {
    const result = CreateExamRequestSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "durationMinutes",
      );
      expect(issue?.code).toBe("invalid_type");
      expect(issue?.message).toBe("Required");
    }
  });

  it("accepts a missing durationMinutes when a profileId is supplied", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...base,
      profileId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMinutes).toBeUndefined();
      expect(result.data.profileId).toBe(
        "00000000-0000-0000-0000-000000000002",
      );
    }
  });

  it("accepts explicit durationMinutes with or without a profileId", () => {
    expect(
      CreateExamRequestSchema.safeParse({ ...base, durationMinutes: 30 })
        .success,
    ).toBe(true);
    expect(
      CreateExamRequestSchema.safeParse({
        ...base,
        durationMinutes: 30,
        profileId: "00000000-0000-0000-0000-000000000002",
      }).success,
    ).toBe(true);
  });
});

describe("CreateExamProfileRequestSchema (design §16)", () => {
  const valid = {
    name: "Standard",
    timingMode: "timed_window",
    durationMinutes: 60,
    retakePolicy: "max_attempts",
    maxAttempts: 2,
    scoreStrategy: "highest",
    resultPublicationMode: "after_grading",
    interruptionTimePolicy: "strict",
  };

  it("accepts a valid profile", () => {
    const result = CreateExamProfileRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Standard");
      expect(result.data.description).toBe("");
      expect(result.data.latestStartOffsetMinutes).toBeUndefined();
    }
  });

  it("rejects an empty name and overlong names", () => {
    expect(
      CreateExamProfileRequestSchema.safeParse({ ...valid, name: "  " })
        .success,
    ).toBe(false);
    expect(
      CreateExamProfileRequestSchema.safeParse({
        ...valid,
        name: "x".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("rejects non-Phase-1 retake policies (daily_limit/weekly_limit are not profile-safe)", () => {
    expect(
      CreateExamProfileRequestSchema.safeParse({
        ...valid,
        retakePolicy: "daily_limit",
      }).success,
    ).toBe(false);
    expect(
      CreateExamProfileRequestSchema.safeParse({
        ...valid,
        retakePolicy: "weekly_limit",
      }).success,
    ).toBe(false);
  });

  it("rejects zero/negative duration and maxAttempts", () => {
    expect(
      CreateExamProfileRequestSchema.safeParse({ ...valid, durationMinutes: 0 })
        .success,
    ).toBe(false);
    expect(
      CreateExamProfileRequestSchema.safeParse({ ...valid, maxAttempts: 0 })
        .success,
    ).toBe(false);
  });

  it("accepts explicit null nullable fields (strict profile with null caps)", () => {
    const result = CreateExamProfileRequestSchema.safeParse({
      ...valid,
      latestStartOffsetMinutes: null,
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latestStartOffsetMinutes).toBeNull();
      expect(result.data.interruptionGracePerIncidentSeconds).toBeNull();
    }
  });

  it("rejects negative latest-start / min-submit offsets", () => {
    expect(
      CreateExamProfileRequestSchema.safeParse({
        ...valid,
        latestStartOffsetMinutes: -1,
      }).success,
    ).toBe(false);
    expect(
      CreateExamProfileRequestSchema.safeParse({
        ...valid,
        minSubmitAfterStartMinutes: -5,
      }).success,
    ).toBe(false);
  });
});

describe("UpdateExamProfileRequestSchema (design §22 explicit null)", () => {
  it("allows a partial patch", () => {
    const result = UpdateExamProfileRequestSchema.safeParse({
      durationMinutes: 90,
    });
    expect(result.success).toBe(true);
  });

  it("allows explicit null to clear a nullable field", () => {
    const result = UpdateExamProfileRequestSchema.safeParse({
      latestStartOffsetMinutes: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latestStartOffsetMinutes).toBeNull();
    }
  });

  it("allows an empty patch (no-op detection in the route)", () => {
    const result = UpdateExamProfileRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toHaveLength(0);
    }
  });
});

describe("ExamProfileSchema Phase A mode shapes (#291)", () => {
  const validCreate = {
    name: "Standard",
    timingMode: "timed_window",
    durationMinutes: 60,
    retakePolicy: "max_attempts",
    maxAttempts: 2,
    scoreStrategy: "highest",
    resultPublicationMode: "after_grading",
    interruptionTimePolicy: "strict",
  };

  it("accepts a deadline profile with null duration (#291 Phase A)", () => {
    const result = CreateExamProfileRequestSchema.safeParse({
      ...validCreate,
      timingMode: "deadline",
      durationMinutes: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an untimed profile with null duration (#291 Phase A)", () => {
    const result = CreateExamProfileRequestSchema.safeParse({
      ...validCreate,
      timingMode: "untimed",
      durationMinutes: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a profile carrying timed_sync (latent mode)", () => {
    const result = CreateExamProfileRequestSchema.safeParse({
      ...validCreate,
      timingMode: "timed_sync",
    });
    expect(result.success).toBe(false);
  });

  it("defaults an omitted timingMode to timed_window (legacy profiles)", () => {
    const { timingMode: _omitted, ...withoutMode } = validCreate;
    const result = CreateExamProfileRequestSchema.safeParse(withoutMode);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timingMode).toBe("timed_window");
    }
  });
});

describe("ExamProfileSchema response shape", () => {
  it("accepts the persisted profile response", () => {
    const result = ExamProfileSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000010",
      organizationId: "00000000-0000-0000-0000-000000000011",
      name: "Standard",
      description: "",
      timingMode: "timed_window",
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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});
