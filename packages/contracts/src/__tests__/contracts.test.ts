import { describe, it, expect } from "vitest";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  ChangePasswordRequestSchema,
} from "../auth.js";
import {
  CreateUserRequestSchema,
  RoleSchema,
  AssignableRoleSchema,
} from "../user.js";
import { CreateCandidateRequestSchema } from "../candidate.js";
import {
  CreateCourseRequestSchema,
  UpdateCourseRequestSchema,
} from "../course.js";
import {
  CreateExamRequestSchema,
  ExamSchema,
  UpdateExamRequestSchema,
} from "../exam.js";
import { normalizeInterruptionPolicyConfiguration } from "../interruption.js";
import {
  CreateQuestionRequestSchema,
  QuestionImportRowSchema,
  QuestionSchema,
  UpdateQuestionRequestSchema,
} from "../question.js";
import {
  QuestionSnapshotSchema,
  RestoreAttemptResponseSchema,
} from "../attempt.js";
import {
  ScoreListQuerySchema,
  AuditLogQuerySchema,
  AuditLogExportQuerySchema,
  AuditLogPageResponseSchema,
  AUDIT_SEARCH_DEFAULT_LIMIT,
  encodeAuditCursor,
  decodeAuditCursor,
  SaveAnswerRequestSchema,
  SaveAnswerResponseSchema,
  CandidateExamDetailResponseSchema,
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
  SaveAnswerRejectReasonEnum,
  GradingStatusEnum,
  GradingDetailsQuestionSchema,
  GradingDetailsResponseSchema,
  ErrorResponseSchema,
  getSaveAnswerMessage,
  isErrorCode,
  getErrorMessage,
  candidateFieldValidationMessages,
  errorMessages,
} from "../index.js";

describe("common contracts", () => {
  it("requires requestId on error responses", () => {
    const result = ErrorResponseSchema.safeParse({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "资源不存在",
      },
    });

    expect(result.success).toBe(false);
  });

  it("preserves structured validation details", () => {
    const result = ErrorResponseSchema.parse({
      error: {
        code: "VALIDATION_ERROR",
        message: "请求参数无效",
        details: {
          fields: [
            {
              field: "durationMinutes",
              code: "TOO_SMALL",
              message: "数值太小",
            },
          ],
        },
        requestId: "req-contract",
      },
    });

    expect(result.error.details).toEqual({
      fields: [
        {
          field: "durationMinutes",
          code: "TOO_SMALL",
          message: "数值太小",
        },
      ],
    });
  });
});

describe("message registry", () => {
  it("isErrorCode returns true for known codes", () => {
    expect(isErrorCode("AUTH_REQUIRED")).toBe(true);
    expect(isErrorCode("RESOURCE_NOT_FOUND")).toBe(true);
    expect(isErrorCode("VALIDATION_ERROR")).toBe(true);
  });

  it("isErrorCode returns false for unknown codes", () => {
    expect(isErrorCode("UNAUTHORIZED")).toBe(false);
    expect(isErrorCode("FOO_BAR")).toBe(false);
    expect(isErrorCode("")).toBe(false);
  });

  it("getErrorMessage returns the registry message for a valid code", () => {
    expect(getErrorMessage("AUTH_REQUIRED")).toBe(errorMessages.AUTH_REQUIRED);
    expect(getErrorMessage("RATE_LIMITED")).toBe("请求过于频繁，请稍后重试");
  });

  it("every ErrorCode key has a non-empty message", () => {
    for (const key of Object.keys(
      errorMessages,
    ) as (keyof typeof errorMessages)[]) {
      expect(typeof errorMessages[key]).toBe("string");
      expect(errorMessages[key].length).toBeGreaterThan(0);
    }
  });

  it("candidateFieldValidationMessages returns localized messages", () => {
    expect(candidateFieldValidationMessages.configurationInvalid).toBe(
      "身份字段配置无效",
    );
    expect(candidateFieldValidationMessages.required("姓名")).toBe(
      "姓名为必填项",
    );
    expect(candidateFieldValidationMessages.numberRequired("年龄")).toBe(
      "年龄必须为数字",
    );
    expect(candidateFieldValidationMessages.textRequired("地址")).toBe(
      "地址必须为文本",
    );
  });
});

describe("auth contracts", () => {
  it("LoginRequestSchema accepts valid login", () => {
    const result = LoginRequestSchema.safeParse({
      username: "admin",
      password: "admin123",
    });
    expect(result.success).toBe(true);
  });

  it("LoginRequestSchema rejects an attacker-controlled username over 50 characters", () => {
    const result = LoginRequestSchema.safeParse({
      username: "u".repeat(51),
      password: "admin123",
    });
    expect(result.success).toBe(false);
  });

  it("LoginRequestSchema does not model organizationSlug as a Phase 1 field", () => {
    const parsed = LoginRequestSchema.parse({
      username: "admin",
      password: "admin123",
    });
    expect(parsed).not.toHaveProperty("organizationSlug");
  });

  it("LoginRequestSchema strips organizationSlug if a client smuggles it in", () => {
    const parsed = LoginRequestSchema.parse({
      username: "admin",
      password: "admin123",
      organizationSlug: "default",
    } as unknown as { username: string; password: string });
    expect("organizationSlug" in (parsed as object)).toBe(false);
    expect(parsed).toEqual({ username: "admin", password: "admin123" });
  });

  it("RegisterRequestSchema rejects short password", () => {
    const result = RegisterRequestSchema.safeParse({
      organizationSlug: "default",
      bootstrapToken: "token",
      username: "admin",
      password: "123",
      name: "Admin",
    });
    expect(result.success).toBe(false);
  });

  it("ChangePasswordRequestSchema validates", () => {
    const result = ChangePasswordRequestSchema.safeParse({
      currentPassword: "old",
      newPassword: "newpass123",
    });
    expect(result.success).toBe(true);
  });
});

describe("course contracts", () => {
  it("CreateCourseRequestSchema accepts valid course", () => {
    const result = CreateCourseRequestSchema.safeParse({
      name: "Math 101",
      code: "MATH101",
      description: "Basic math",
    });
    expect(result.success).toBe(true);
  });

  it("CreateCourseRequestSchema defaults empty description", () => {
    const result = CreateCourseRequestSchema.parse({
      name: "Math 101",
      code: "MATH101",
    });
    expect(result.description).toBe("");
  });

  it("UpdateCourseRequestSchema accepts partial update", () => {
    const result = UpdateCourseRequestSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("CreateCourseRequestSchema rejects empty name", () => {
    const result = CreateCourseRequestSchema.safeParse({
      name: "",
      code: "MATH101",
    });
    expect(result.success).toBe(false);
  });
});

describe("exam contracts", () => {
  const validExam = {
    title: "Test Exam",
    courseId: "550e8400-e29b-41d4-a716-446655440000",
    durationMinutes: 60,
    openAt: new Date().toISOString(),
    closeAt: new Date(Date.now() + 86400000).toISOString(),
    passingScore: 60,
    totalScore: 100,
  };

  it("CreateExamRequestSchema accepts valid exam", () => {
    const result = CreateExamRequestSchema.safeParse(validExam);
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema defaults timed_window mode", () => {
    const result = CreateExamRequestSchema.parse(validExam);
    expect(result.timingMode).toBe("timed_window");
  });

  it("CreateExamRequestSchema defaults manual selection", () => {
    const result = CreateExamRequestSchema.parse(validExam);
    expect(result.questionSelectionMode).toBe("manual");
  });

  it("CreateExamRequestSchema rejects values outside the timing-mode enum", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      timingMode: "hybrid",
    });
    expect(result.success).toBe(false);
  });

  // ── Phase A2 (#291): deadline / untimed join the authoring surface. ──
  it("CreateExamRequestSchema accepts deadline mode with closeAt and no duration", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      timingMode: "deadline",
      durationMinutes: null,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts untimed mode without closeAt/duration", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      timingMode: "untimed",
      durationMinutes: null,
      closeAt: null,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts timed_sync at shape level (canonical validator rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      timingMode: "timed_sync",
    });
    expect(result.success).toBe(true);
  });

  it("timed_window still requires duration without a profile", () => {
    const result = CreateExamRequestSchema.safeParse({
      title: "T",
      courseId: validExam.courseId,
      openAt: validExam.openAt,
      closeAt: validExam.closeAt,
      timingMode: "timed_window",
      // durationMinutes omitted, no profileId
    });
    expect(result.success).toBe(false);
  });

  it("ExamSchema exposes nullable durationMinutes/closeAt", () => {
    const row = {
      id: "00000000-0000-0000-0000-000000000001",
      organizationId: "00000000-0000-0000-0000-000000000002",
      title: "T",
      description: "",
      courseId: "00000000-0000-0000-0000-000000000003",
      status: "open",
      timingMode: "untimed",
      durationMinutes: null,
      openAt: new Date().toISOString(),
      closeAt: null,
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      controlFlags: {},
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      resultPublicationMode: "immediate",
      resultsPublishedAt: null,
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(ExamSchema.safeParse(row).success).toBe(true);
  });

  it("CreateExamRequestSchema rejects negative passingScore", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      passingScore: -1,
    });
    expect(result.success).toBe(false);
  });

  // P7-M1 (design §10): Zod owns per-field shape only; the passingScore <=
  // totalScore cross-field rule moved to the canonical engine validator
  // (enforced by the API route, not this schema).
  it("CreateExamRequestSchema accepts passingScore > totalScore (shape-only; API rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      passingScore: 101,
      totalScore: 100,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts passingScore = totalScore", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      passingScore: 100,
      totalScore: 100,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts passingScore = 0", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      passingScore: 0,
      totalScore: 100,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema rejects totalScore = 0", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      passingScore: 0,
      totalScore: 0,
    });
    expect(result.success).toBe(false);
  });

  // P7-M1 (design §10): cross-field passingScore check moved to the canonical
  // engine validator (API-level), so the schema is shape-only.
  it("UpdateExamRequestSchema accepts both fields with passingScore > totalScore (shape-only; API rejects)", () => {
    const result = UpdateExamRequestSchema.safeParse({
      passingScore: 80,
      totalScore: 50,
    });
    expect(result.success).toBe(true);
  });

  it("UpdateExamRequestSchema accepts single field (final-state validation is API-level)", () => {
    const result = UpdateExamRequestSchema.safeParse({ passingScore: 80 });
    expect(result.success).toBe(true);
  });

  it("UpdateExamRequestSchema accepts both fields with passingScore = totalScore", () => {
    const result = UpdateExamRequestSchema.safeParse({
      passingScore: 50,
      totalScore: 50,
    });
    expect(result.success).toBe(true);
  });

  // ── ADR-013 interruption policy authoring (REC-I4-I3A) ──

  it("CreateExamRequestSchema accepts strict interruption policy with null caps", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "strict",
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts bounded_grace with valid caps", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 300,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts operator_incident", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "operator_incident",
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema omits interruption fields by default", () => {
    const result = CreateExamRequestSchema.parse(validExam);
    expect(result.interruptionTimePolicy).toBeUndefined();
  });

  it("UpdateExamRequestSchema accepts partial interruption policy update", () => {
    const result = UpdateExamRequestSchema.safeParse({
      interruptionTimePolicy: "bounded_grace",
    });
    expect(result.success).toBe(true);
  });

  it("normalizeInterruptionPolicyConfiguration defaults omitted input to strict/null caps", () => {
    const resolved = normalizeInterruptionPolicyConfiguration({});
    expect(resolved).toEqual({
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    });
  });

  it("normalizeInterruptionPolicyConfiguration rejects bounded_grace without caps", () => {
    expect(() =>
      normalizeInterruptionPolicyConfiguration({ policy: "bounded_grace" }),
    ).toThrow();
  });

  it("normalizeInterruptionPolicyConfiguration rejects bounded_grace perIncident > perAttempt", () => {
    expect(() =>
      normalizeInterruptionPolicyConfiguration({
        policy: "bounded_grace",
        perIncidentCapSeconds: 600,
        perAttemptAggregateCapSeconds: 300,
      }),
    ).toThrow();
  });

  it("normalizeInterruptionPolicyConfiguration rejects strict with caps", () => {
    expect(() =>
      normalizeInterruptionPolicyConfiguration({
        policy: "strict",
        perIncidentCapSeconds: 120,
        perAttemptAggregateCapSeconds: null,
      }),
    ).toThrow();
  });

  it("ExamSchema DTO exposes interruption policy fields", () => {
    const exam = ExamSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      organizationId: "550e8400-e29b-41d4-a716-446655440001",
      title: "T",
      description: "",
      courseId: "550e8400-e29b-41d4-a716-446655440002",
      status: "draft",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date().toISOString(),
      closeAt: new Date(Date.now() + 86400000).toISOString(),
      passingScore: 0,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      resultPublicationMode: "immediate",
      resultsPublishedAt: null,
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 120,
      interruptionGracePerAttemptSeconds: 300,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(exam.interruptionTimePolicy).toBe("bounded_grace");
    expect(exam.interruptionGracePerIncidentSeconds).toBe(120);
    expect(exam.interruptionGracePerAttemptSeconds).toBe(300);
  });

  // P7-M1 (design §10): ADR-013 caps cross-field rules are enforced by the
  // route's `normalizeInterruptionPolicyConfiguration` + the canonical engine
  // validator (also re-checked at publish). The request schemas are shape-only:
  // per-field positive/int/max bounds, no cross-field refinements.

  it("CreateExamRequestSchema accepts bounded_grace without caps (shape-only; normalizer rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "bounded_grace",
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts bounded_grace perIncident > perAttempt (shape-only; normalizer rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 600,
      interruptionGracePerAttemptSeconds: 300,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts strict with caps (shape-only; normalizer rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: 120,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts operator_incident with caps (shape-only; normalizer rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "operator_incident",
      interruptionGracePerAttemptSeconds: 300,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema accepts caps without policy (shape-only; normalizer rejects)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionGracePerIncidentSeconds: 120,
    });
    expect(result.success).toBe(true);
  });

  it("CreateExamRequestSchema rejects cap exceeding PostgreSQL integer max (per-field shape)", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      interruptionTimePolicy: "bounded_grace",
      interruptionGracePerIncidentSeconds: 2_147_483_648,
      interruptionGracePerAttemptSeconds: 2_147_483_648,
    });
    expect(result.success).toBe(false);
  });
});

// ── ADR-013 restore response contract (REC-I4-I3A) ──
describe("RestoreAttemptResponseSchema (REC-I4-I3A frozen contract)", () => {
  const baseAttempt = {
    id: "550e8400-e29b-41d4-a716-446655440010",
    organizationId: "550e8400-e29b-41d4-a716-446655440001",
    examId: "550e8400-e29b-41d4-a716-446655440002",
    enrollmentId: "550e8400-e29b-41d4-a716-446655440003",
    candidateId: "550e8400-e29b-41d4-a716-446655440004",
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    score: 0,
    passed: false,
    startedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("accepts a restored strict-policy zero-grant response", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "strict", addedSeconds: 0 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a restored bounded_grace response with positive grant", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "bounded_grace", addedSeconds: 120 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an already_in_progress response", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "already_in_progress",
      compensation: { policy: "strict", addedSeconds: 0 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative addedSeconds", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "strict", addedSeconds: -1 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown policy", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "lenient", addedSeconds: 0 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(false);
  });

  it("does not expose internal interruption evidence (interruptionId/adjustmentId)", () => {
    // The frozen contract deliberately omits episode id, detected-event
    // evidence, and adjustment-ledger details. Parsing a payload that carries
    // them must NOT surface those keys in the parsed output.
    const parsed = RestoreAttemptResponseSchema.parse({
      lifecycle: "restored",
      compensation: {
        policy: "strict",
        addedSeconds: 0,
        interruptionId: "should-not-leak",
        adjustmentId: "should-not-leak",
        eligibleSeconds: 999,
      },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
      // Attempt to leak internal detail — must be stripped by the schema.
      interruptionId: "should-not-leak",
      adjustmentId: "should-not-leak",
      eligibleSeconds: 999,
    });
    expect(parsed).not.toHaveProperty("interruptionId");
    expect(parsed).not.toHaveProperty("adjustmentId");
    expect(parsed).not.toHaveProperty("eligibleSeconds");
    expect(parsed.compensation).not.toHaveProperty("interruptionId");
    expect(parsed.compensation).not.toHaveProperty("adjustmentId");
    expect(parsed.compensation).not.toHaveProperty("eligibleSeconds");
  });

  it("accepts a terminal lifecycle outcome (already-terminal or deadline-win)", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "terminal",
      compensation: { policy: "strict", addedSeconds: 0 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(true);
  });

  it("rejects strict policy with positive addedSeconds (compensation invariant)", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "strict", addedSeconds: 300 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(false);
  });

  it("rejects operator_incident policy with positive addedSeconds", () => {
    const result = RestoreAttemptResponseSchema.safeParse({
      lifecycle: "restored",
      compensation: { policy: "operator_incident", addedSeconds: 120 },
      attempt: { ...baseAttempt, serverNow: new Date().toISOString() },
    });
    expect(result.success).toBe(false);
  });
});

describe("question contracts", () => {
  it("CreateQuestionRequestSchema accepts true_false", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "true_false",
      content: "Is 1+1=2?",
      standardAnswer: true,
      score: 10,
    });
    expect(result.success).toBe(true);
  });

  it("CreateQuestionRequestSchema accepts fill_blank with ____", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "fill_blank",
      content: "The answer is ____",
      standardAnswer: "42",
      score: 10,
    });
    expect(result.success).toBe(true);
  });

  it("CreateQuestionRequestSchema rejects fill_blank without ____", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "fill_blank",
      content: "No placeholder",
      standardAnswer: "42",
      score: 10,
    });
    expect(result.success).toBe(false);
  });

  it("CreateQuestionRequestSchema accepts single_choice with valid standardAnswer", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "single_choice",
      content: "Pick one",
      options: [
        { id: "A", content: "Option A" },
        { id: "B", content: "Option B" },
      ],
      standardAnswer: "A",
      score: 10,
    });
    expect(result.success).toBe(true);
  });

  it("CreateQuestionRequestSchema rejects single_choice with invalid standardAnswer", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "single_choice",
      content: "Pick one",
      options: [
        { id: "A", content: "Option A" },
        { id: "B", content: "Option B" },
      ],
      standardAnswer: "C",
      score: 10,
    });
    expect(result.success).toBe(false);
  });

  it("CreateQuestionRequestSchema rejects choice with < 2 options", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "single_choice",
      content: "Pick one",
      options: [{ id: "A", content: "Only one" }],
      standardAnswer: "A",
      score: 10,
    });
    expect(result.success).toBe(false);
  });

  it("CreateQuestionRequestSchema accepts multiple_choice", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "multiple_choice",
      content: "Pick many",
      options: [
        { id: "A", content: "Option A" },
        { id: "B", content: "Option B" },
        { id: "C", content: "Option C" },
      ],
      standardAnswer: ["A", "B"],
      score: 10,
    });
    expect(result.success).toBe(true);
  });

  it("CreateQuestionRequestSchema rejects duplicate option ids", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "single_choice",
      content: "Pick one",
      options: [
        { id: "A", content: "First A" },
        { id: "A", content: "Second A" },
      ],
      standardAnswer: "A",
      score: 10,
    });
    expect(result.success).toBe(false);
  });

  it("QuestionImportRowSchema parses basic row", () => {
    const result = QuestionImportRowSchema.safeParse({
      type: "true_false",
      content: "Is true?",
      standardAnswer: true,
      score: 5,
    });
    expect(result.success).toBe(true);
  });

  // ── P3-L0-1: text_response + rubric dual-layer ─────────────────

  it("CreateQuestionRequestSchema accepts text_response with rubric and null standardAnswer", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "text_response",
      content: "请阐述你的观点",
      options: [],
      standardAnswer: null,
      rubric: "按逻辑完整性、关键概念、论证质量给分",
      score: 20,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rubric).toBe("按逻辑完整性、关键概念、论证质量给分");
    }
  });

  it("CreateQuestionRequestSchema defaults rubric to null when omitted", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "single_choice",
      content: "Pick one",
      options: [
        { id: "A", content: "Option A" },
        { id: "B", content: "Option B" },
      ],
      standardAnswer: "A",
      score: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rubric).toBeNull();
    }
  });

  it("QuestionSchema parses a full row with rubric: null", () => {
    const result = QuestionSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      organizationId: "550e8400-e29b-41d4-a716-446655440001",
      courseId: "550e8400-e29b-41d4-a716-446655440002",
      type: "text_response",
      content: "请阐述你的观点",
      options: [],
      standardAnswer: null,
      attachments: [],
      score: 20,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("UpdateQuestionRequestSchema accepts rubric update", () => {
    const result = UpdateQuestionRequestSchema.safeParse({
      rubric: "updated rubric text",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rubric).toBe("updated rubric text");
    }
  });

  it("QuestionSnapshotSchema accepts text_response with rubric", () => {
    const result = QuestionSnapshotSchema.safeParse({
      originalQuestionId: "q1",
      type: "text_response",
      content: "请阐述",
      attachments: [],
      options: [],
      standardAnswer: null,
      score: 20,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: "按逻辑给分",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rubric).toBe("按逻辑给分");
    }
  });

  it("QuestionSnapshotSchema normalizes missing rubric to null (legacy JSONB compat)", () => {
    const result = QuestionSnapshotSchema.safeParse({
      originalQuestionId: "q1",
      type: "single_choice",
      content: "Pick one",
      attachments: [],
      options: [
        { id: "A", content: "A" },
        { id: "B", content: "B" },
      ],
      standardAnswer: "A",
      score: 10,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      // rubric intentionally omitted — simulates a pre-L0-1 JSONB row
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rubric).toBeNull();
    }
  });

  // ── canonical tag grammar (issue #182): trim / drop-empty / dedupe /
  //    forbid-comma, so every accepted stored tag round-trips through the
  //    comma-separated GET /questions?tags= wire format ──────────────────

  it("CreateQuestionRequestSchema normalizes tags: trims, drops empties, dedupes in order", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "true_false",
      content: "Is 1+1=2?",
      standardAnswer: true,
      score: 10,
      tags: [" 代数 ", "", "代数", "几何", "  "],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(["代数", "几何"]);
    }
  });

  it("CreateQuestionRequestSchema rejects comma-containing tags", () => {
    const result = CreateQuestionRequestSchema.safeParse({
      courseId: "550e8400-e29b-41d4-a716-446655440000",
      type: "true_false",
      content: "Is 1+1=2?",
      standardAnswer: true,
      score: 10,
      tags: ["代数,几何"],
    });
    expect(result.success).toBe(false);
  });

  it("UpdateQuestionRequestSchema normalizes and rejects tags like create", () => {
    const normalized = UpdateQuestionRequestSchema.safeParse({
      tags: [" 代数 ", "代数", ""],
    });
    expect(normalized.success).toBe(true);
    if (normalized.success) {
      expect(normalized.data.tags).toEqual(["代数"]);
    }

    const rejected = UpdateQuestionRequestSchema.safeParse({ tags: ["a,b"] });
    expect(rejected.success).toBe(false);
  });

  it("QuestionImportRowSchema keeps raw comma-separated tags (split happens at the route)", () => {
    const result = QuestionImportRowSchema.safeParse({
      type: "true_false",
      content: "Is true?",
      standardAnswer: true,
      score: 5,
      tags: "代数, 几何",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toBe("代数, 几何");
    }
  });
});

describe("score contracts", () => {
  it("ScoreListQuerySchema coerces and defaults", () => {
    const result = ScoreListQuerySchema.parse({
      page: "1",
      passFilter: "all",
    });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.sortBy).toBe("submittedAt");
    expect(result.sortOrder).toBe("desc");
  });

  it("ScoreListQuerySchema rejects page=0", () => {
    const result = ScoreListQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });
});

describe("attempt contracts", () => {
  it("SaveAnswerRequestSchema validates", () => {
    const result = SaveAnswerRequestSchema.safeParse({
      attemptId: "550e8400-e29b-41d4-a716-446655440000",
      questionId: "550e8400-e29b-41d4-a716-446655440001",
      answer: true,
      clientSeq: 1,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    });
    expect(result.success).toBe(true);
  });

  it("CandidateExamDetailResponseSchema validates", () => {
    const result = CandidateExamDetailResponseSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Exam",
      durationMinutes: 60,
      timingMode: "timed_window",
      passingScore: 60,
      totalScore: 100,
      questionCount: 10,
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      maxAttempts: 2,
      currentAttempts: 0,
      canStartNewAttempt: true,
      availabilityStatus: "available",
      primaryAction: "start",
    });
    expect(result.success).toBe(true);
  });
});

describe("CandidateExamDetailResponseSchema timing modes (A2 corrective)", () => {
  const baseDetail = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Exam",
    passingScore: 60,
    totalScore: 100,
    questionCount: 10,
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: false,
      batchSize: 10,
      batchInterval: 3,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    maxAttempts: 2,
    currentAttempts: 0,
    canStartNewAttempt: true,
    availabilityStatus: "available" as const,
    primaryAction: "start" as const,
  };

  it("parses timed_window with a positive duration and carries timingMode", () => {
    const result = CandidateExamDetailResponseSchema.safeParse({
      ...baseDetail,
      durationMinutes: 60,
      timingMode: "timed_window",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timingMode).toBe("timed_window");
      expect(result.data.durationMinutes).toBe(60);
    }
  });

  it("parses deadline with explicit null duration (no personal time limit)", () => {
    const result = CandidateExamDetailResponseSchema.safeParse({
      ...baseDetail,
      durationMinutes: null,
      timingMode: "deadline",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timingMode).toBe("deadline");
      expect(result.data.durationMinutes).toBeNull();
    }
  });

  it("parses untimed with explicit null duration (open-ended)", () => {
    const result = CandidateExamDetailResponseSchema.safeParse({
      ...baseDetail,
      durationMinutes: null,
      timingMode: "untimed",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timingMode).toBe("untimed");
      expect(result.data.durationMinutes).toBeNull();
    }
  });
});

describe("SaveAnswerAcceptedSchema (A01 strict)", () => {
  const validAccepted = {
    accepted: true as const,
    serverVersion: 1,
    savedAt: "2026-06-12T08:00:00.000Z",
  };

  it("parses minimal accepted", () => {
    const result = SaveAnswerAcceptedSchema.safeParse(validAccepted);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accepted).toBe(true);
      expect(result.data.serverVersion).toBe(1);
      expect(result.data.savedAt).toBe("2026-06-12T08:00:00.000Z");
    }
  });

  it("rejects conflict field (strict)", () => {
    const result = SaveAnswerAcceptedSchema.safeParse({
      ...validAccepted,
      conflict: { reason: "STALE_VERSION" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown key (strict)", () => {
    const result = SaveAnswerAcceptedSchema.safeParse({
      ...validAccepted,
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });
});

describe("SaveAnswerRejectedSchema (A01 strict)", () => {
  const validRejected = {
    accepted: false as const,
    reason: "STALE_VERSION" as const,
    message: "服务器上存在更新的答案版本",
    serverVersion: 5,
    savedAt: "2026-06-12T08:00:00.000Z",
  };

  it("parses STALE_VERSION with details", () => {
    const result = SaveAnswerRejectedSchema.safeParse({
      ...validRejected,
      details: { serverAnswer: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details?.serverAnswer).toBe(true);
    }
  });

  it("parses STALE_VERSION without details", () => {
    const result = SaveAnswerRejectedSchema.safeParse(validRejected);
    expect(result.success).toBe(true);
  });

  it("parses all 4 reasons", () => {
    const reasons = [
      "STALE_VERSION",
      "ATTEMPT_ALREADY_SUBMITTED",
      "ATTEMPT_CLOSED",
      "DEADLINE_EXCEEDED",
    ] as const;
    for (const reason of reasons) {
      const result = SaveAnswerRejectedSchema.safeParse({
        ...validRejected,
        reason,
      });
      expect(result.success, `reason=${reason}`).toBe(true);
    }
  });

  it("rejects unknown reason", () => {
    const result = SaveAnswerRejectedSchema.safeParse({
      ...validRejected,
      reason: "UNKNOWN",
    });
    expect(result.success).toBe(false);
  });

  it("rejects conflict field (strict)", () => {
    const result = SaveAnswerRejectedSchema.safeParse({
      ...validRejected,
      conflict: { reason: "STALE_VERSION" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown key (strict)", () => {
    const result = SaveAnswerRejectedSchema.safeParse({
      ...validRejected,
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });
});

describe("SaveAnswerResponseSchema (A01 discriminated union)", () => {
  it("accepts accepted branch", () => {
    const result = SaveAnswerResponseSchema.safeParse({
      accepted: true,
      serverVersion: 1,
      savedAt: "2026-06-12T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts rejected branch", () => {
    const result = SaveAnswerResponseSchema.safeParse({
      accepted: false,
      reason: "STALE_VERSION",
      message: "服务器上存在更新的答案版本",
      serverVersion: 5,
      savedAt: "2026-06-12T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("SaveAnswerRejectReasonEnum", () => {
  it("has exactly 7 values (INVALID_ANSWER added by #301)", () => {
    const values = SaveAnswerRejectReasonEnum.options;
    expect(values).toEqual([
      "STALE_VERSION",
      "FUTURE_VERSION",
      "ATTEMPT_ALREADY_SUBMITTED",
      "ATTEMPT_CLOSED",
      "DEADLINE_EXCEEDED",
      "CONFLICTING_PAYLOAD",
      "INVALID_ANSWER",
    ]);
  });
});

describe("SaveAnswer route-shape equivalence (A01 wire contract)", () => {
  const buildRejectedWireShape = (
    reason: import("../attempt.js").SaveAnswerRejectReason,
    options: { latestAnswer?: unknown } = {},
  ) => ({
    accepted: false as const,
    reason,
    message: getSaveAnswerMessage(reason),
    serverVersion: 0,
    savedAt: "2026-06-12T08:00:00.000Z",
    details:
      options.latestAnswer != null
        ? { serverAnswer: options.latestAnswer }
        : undefined,
  });

  it("STALE_VERSION wire shape parses with serverAnswer in details", () => {
    const wire = buildRejectedWireShape("STALE_VERSION", {
      latestAnswer: "previous-candidate-answer",
    });
    const result = SaveAnswerResponseSchema.safeParse(wire);
    expect(result.success).toBe(true);
  });

  it("ATTEMPT_ALREADY_SUBMITTED wire shape parses without details", () => {
    const wire = buildRejectedWireShape("ATTEMPT_ALREADY_SUBMITTED");
    const result = SaveAnswerResponseSchema.safeParse(wire);
    expect(result.success).toBe(true);
  });

  it("ATTEMPT_CLOSED wire shape parses without details", () => {
    const wire = buildRejectedWireShape("ATTEMPT_CLOSED");
    const result = SaveAnswerResponseSchema.safeParse(wire);
    expect(result.success).toBe(true);
  });

  it("DEADLINE_EXCEEDED wire shape parses without details", () => {
    const wire = buildRejectedWireShape("DEADLINE_EXCEEDED");
    const result = SaveAnswerResponseSchema.safeParse(wire);
    expect(result.success).toBe(true);
  });

  it("registry message is non-empty for every reason", () => {
    for (const reason of SaveAnswerRejectReasonEnum.options) {
      const message = getSaveAnswerMessage(reason);
      expect(message.length, `reason=${reason}`).toBeGreaterThan(0);
    }
  });
});

describe("password policy enforcement at boundary", () => {
  const sevenChars = "1234567";
  const eightChars = "12345678";

  it("RegisterRequestSchema rejects 7-char password", () => {
    const result = RegisterRequestSchema.safeParse({
      organizationSlug: "default",
      bootstrapToken: "token",
      username: "admin",
      password: sevenChars,
      name: "Admin",
    });
    expect(result.success).toBe(false);
  });

  it("RegisterRequestSchema accepts 8-char password", () => {
    const result = RegisterRequestSchema.safeParse({
      organizationSlug: "default",
      bootstrapToken: "token",
      username: "admin",
      password: eightChars,
      name: "Admin",
    });
    expect(result.success).toBe(true);
  });

  it("ChangePasswordRequestSchema rejects 7-char newPassword", () => {
    const result = ChangePasswordRequestSchema.safeParse({
      currentPassword: "old",
      newPassword: sevenChars,
    });
    expect(result.success).toBe(false);
  });

  it("ChangePasswordRequestSchema accepts 8-char newPassword", () => {
    const result = ChangePasswordRequestSchema.safeParse({
      currentPassword: "old",
      newPassword: eightChars,
    });
    expect(result.success).toBe(true);
  });

  it("CreateUserRequestSchema rejects 7-char password", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: sevenChars,
      name: "New User",
      role: "Admin",
    });
    expect(result.success).toBe(false);
  });

  it("CreateUserRequestSchema accepts 8-char password", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: eightChars,
      name: "New User",
      role: "Admin",
    });
    expect(result.success).toBe(true);
  });

  it("CreateCandidateRequestSchema rejects 7-char password", () => {
    const result = CreateCandidateRequestSchema.safeParse({
      username: "cand001",
      password: sevenChars,
      name: "Cand",
      fields: {},
    });
    expect(result.success).toBe(false);
  });

  it("CreateCandidateRequestSchema accepts 8-char password", () => {
    const result = CreateCandidateRequestSchema.safeParse({
      username: "cand001",
      password: eightChars,
      name: "Cand",
      fields: {},
    });
    expect(result.success).toBe(true);
  });

  it("LoginRequestSchema still accepts a short password to preserve auth-failure semantics", () => {
    const result = LoginRequestSchema.safeParse({
      username: "admin",
      password: "short",
    });
    expect(result.success).toBe(true);
  });

  it("LoginRequestSchema accepts an empty password so auth returns uniform 401, not 400", () => {
    const result = LoginRequestSchema.safeParse({
      username: "admin",
      password: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("Phase 3 assignable role model (RBAC-M8)", () => {
  it("RoleSchema accepts Admin", () => {
    expect(RoleSchema.safeParse("Admin").success).toBe(true);
  });

  it("RoleSchema accepts Candidate", () => {
    expect(RoleSchema.safeParse("Candidate").success).toBe(true);
  });

  it("RoleSchema accepts Teacher/Proctor/Grader (widened in RBAC-M8)", () => {
    expect(RoleSchema.safeParse("Teacher").success).toBe(true);
    expect(RoleSchema.safeParse("Proctor").success).toBe(true);
    expect(RoleSchema.safeParse("Grader").success).toBe(true);
  });

  it("RoleSchema rejects SuperAdmin (no ADR; not assignable)", () => {
    expect(RoleSchema.safeParse("SuperAdmin").success).toBe(false);
  });

  it("AssignableRoleSchema rejects System (synthetic, non-assignable)", () => {
    expect(AssignableRoleSchema.safeParse("System").success).toBe(false);
  });

  it("CreateUserRequestSchema accepts Admin", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "Admin",
    });
    expect(result.success).toBe(true);
  });

  it("CreateUserRequestSchema accepts Teacher (widened in RBAC-M8)", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "Teacher",
    });
    expect(result.success).toBe(true);
  });

  it("CreateUserRequestSchema rejects SuperAdmin", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "SuperAdmin",
    });
    expect(result.success).toBe(false);
  });

  it("CreateUserRequestSchema accepts Candidate (role is assignable; candidate-detail is managed via candidate routes)", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "Candidate",
    });
    expect(result.success).toBe(true);
  });
});

// P2D-J2: manual grading model contracts.
describe("manual grading contracts", () => {
  it("GradingStatusEnum accepts the three valid statuses", () => {
    for (const s of ["auto_graded", "pending_manual", "fully_graded"]) {
      expect(GradingStatusEnum.safeParse(s).success).toBe(true);
    }
  });

  it("GradingStatusEnum rejects unknown statuses", () => {
    expect(GradingStatusEnum.safeParse("manual").success).toBe(false);
    expect(GradingStatusEnum.safeParse("graded").success).toBe(false);
    expect(GradingStatusEnum.safeParse("").success).toBe(false);
  });
});

describe("audit contracts", () => {
  it("AuditLogQuerySchema coerces limit and defaults to the search default", () => {
    const result = AuditLogQuerySchema.parse({ limit: "2" });
    expect(result.limit).toBe(2);
    const byDefault = AuditLogQuerySchema.parse({});
    expect(byDefault.limit).toBe(AUDIT_SEARCH_DEFAULT_LIMIT);
  });

  it("AuditLogQuerySchema rejects a limit above the hard search bound", () => {
    expect(AuditLogQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("AuditLogQuerySchema accepts action + targetType + actorId + targetId filters", () => {
    const result = AuditLogQuerySchema.parse({
      action: "exam.publish",
      targetType: "exam",
      actorId: "11111111-1111-1111-1111-111111111111",
      targetId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result.action).toBe("exam.publish");
    expect(result.targetType).toBe("exam");
    expect(result.actorId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.targetId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("AuditLogQuerySchema accepts an opaque cursor string", () => {
    const result = AuditLogQuerySchema.parse({ cursor: "v1|x|y" });
    expect(result.cursor).toBe("v1|x|y");
  });

  it("AuditLogQuerySchema accepts optional from/to ISO datetime bounds", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-12-31T23:59:59.000Z";
    const result = AuditLogQuerySchema.parse({ from, to });
    expect(result.from).toBe(from);
    expect(result.to).toBe(to);
  });

  it("AuditLogQuerySchema treats all filters as optional", () => {
    const result = AuditLogQuerySchema.parse({});
    expect(result.action).toBeUndefined();
    expect(result.targetType).toBeUndefined();
    expect(result.actorId).toBeUndefined();
    expect(result.targetId).toBeUndefined();
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
    expect(result.cursor).toBeUndefined();
  });

  it("AuditLogQuerySchema rejects a non-datetime from value", () => {
    const result = AuditLogQuerySchema.safeParse({
      from: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("AuditLogExportQuerySchema has no client limit and takes an optional snapshotTo", () => {
    const parsed = AuditLogExportQuerySchema.parse({
      snapshotTo: "2026-08-30T00:00:00.000Z",
    });
    expect(parsed.snapshotTo).toBe("2026-08-30T00:00:00.000Z");
    // The export cap is server-owned (AUDIT_EXPORT_MAX_ROWS): a client
    // `limit` key is stripped, never honored.
    expect("limit" in AuditLogExportQuerySchema.parse({ limit: 5 })).toBe(
      false,
    );
    expect(
      AuditLogExportQuerySchema.safeParse({ snapshotTo: "2026-08-30" }).success,
    ).toBe(false);
  });

  it("AuditLogPageResponseSchema requires the snapshot bound", () => {
    const base = { items: [], nextCursor: null };
    expect(AuditLogPageResponseSchema.safeParse(base).success).toBe(false);
    expect(
      AuditLogPageResponseSchema.safeParse({
        ...base,
        snapshotTo: "2026-08-30T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("audit cursor round-trips the snapshot bound and the last row", () => {
    const snapshotTo = "2026-08-30T10:00:00.000Z";
    const createdAt = "2026-08-30T09:36:21.000Z";
    const id = "33333333-3333-4333-8333-333333333333";
    const cursor = encodeAuditCursor(snapshotTo, createdAt, id);
    expect(decodeAuditCursor(cursor)).toEqual({ snapshotTo, createdAt, id });
  });

  it("audit cursor accepts Dates and decodes to the same ISO instants", () => {
    const snapshotTo = new Date("2026-08-30T10:00:00.000Z");
    const createdAt = new Date("2026-08-30T09:36:21.000Z");
    const id = "44444444-4444-4444-8444-444444444444";
    const cursor = encodeAuditCursor(snapshotTo, createdAt, id);
    expect(decodeAuditCursor(cursor)).toEqual({
      snapshotTo: "2026-08-30T10:00:00.000Z",
      createdAt: "2026-08-30T09:36:21.000Z",
      id,
    });
  });

  it("audit cursor rejects malformed values and stale versions", () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const ts = "2026-08-30T00:00:00.000Z";
    expect(decodeAuditCursor("garbage")).toBeNull();
    // Pre-snapshot v1 cursors carry no window bound and must never parse.
    expect(decodeAuditCursor(`v1|${ts}|${id}`)).toBeNull();
    expect(decodeAuditCursor(`v2|${ts}|${id}`)).toBeNull();
    expect(decodeAuditCursor(`v2|not-a-date|${ts}|${id}`)).toBeNull();
    expect(decodeAuditCursor(`v2|${ts}|not-a-date|${id}`)).toBeNull();
    expect(decodeAuditCursor(`v2|${ts}|${ts}|not-an-id`)).toBeNull();
    expect(decodeAuditCursor(`v2|${ts}|${ts}|${id}|extra`)).toBeNull();
  });
});

// P3-M1: grading detail candidate-answer visibility contracts.
describe("grading detail contracts", () => {
  const validQuestion = {
    questionId: "q-essay-1",
    type: "fill_blank" as const,
    content: "请简述光合作用的过程",
    contentDocument: null,
    maxScore: 10,
    // P3-MOD-P1-1: frozen grading metadata projected from QuestionSnapshot.
    standardAnswer: "参考答案：光反应与暗反应",
    rubric: "按逻辑完整性给分",
    candidateAnswer: "光合作用是植物利用光能...",
    entry: null,
  };

  it("GradingDetailsQuestionSchema accepts a valid question with answer", () => {
    const result = GradingDetailsQuestionSchema.safeParse(validQuestion);
    expect(result.success).toBe(true);
  });

  it("GradingDetailsQuestionSchema accepts null candidateAnswer", () => {
    const result = GradingDetailsQuestionSchema.safeParse({
      ...validQuestion,
      candidateAnswer: null,
    });
    expect(result.success).toBe(true);
  });

  it("GradingDetailsQuestionSchema accepts any candidateAnswer type", () => {
    for (const answer of [
      "text",
      42,
      true,
      ["A", "B"],
      { key: "value" },
      null,
    ]) {
      const result = GradingDetailsQuestionSchema.safeParse({
        ...validQuestion,
        candidateAnswer: answer,
      });
      expect(result.success).toBe(true);
    }
  });

  it("GradingDetailsQuestionSchema accepts a scored entry", () => {
    const result = GradingDetailsQuestionSchema.safeParse({
      ...validQuestion,
      entry: {
        score: 8,
        comment: "回答基本完整",
        gradedBy: "00000000-0000-4000-8000-000000000001",
        gradedAt: "2026-01-15T12:00:00.000Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("GradingDetailsQuestionSchema rejects missing required fields", () => {
    const result = GradingDetailsQuestionSchema.safeParse({
      questionId: "q1",
    });
    expect(result.success).toBe(false);
  });

  it("GradingDetailsQuestionSchema accepts null standardAnswer and rubric (text_response without reference answer)", () => {
    const result = GradingDetailsQuestionSchema.safeParse({
      ...validQuestion,
      type: "text_response",
      standardAnswer: null,
      rubric: null,
    });
    expect(result.success).toBe(true);
  });

  it("GradingDetailsQuestionSchema rejects invalid gradedAt datetime", () => {
    const result = GradingDetailsQuestionSchema.safeParse({
      ...validQuestion,
      entry: {
        score: 8,
        comment: "回答基本完整",
        gradedBy: "00000000-0000-4000-8000-000000000001",
        gradedAt: "not-a-datetime",
      },
    });
    expect(result.success).toBe(false);
  });

  it("GradingDetailsResponseSchema accepts a valid response", () => {
    const result = GradingDetailsResponseSchema.safeParse({
      attemptId: "00000000-0000-4000-8000-000000000001",
      examId: "00000000-0000-4000-8000-000000000002",
      examTitle: "期末考试",
      candidateId: "00000000-0000-4000-8000-000000000003",
      candidateName: "张三",
      gradingStatus: "pending_manual",
      questions: [validQuestion],
    });
    expect(result.success).toBe(true);
  });

  it("GradingDetailsResponseSchema accepts empty questions array", () => {
    const result = GradingDetailsResponseSchema.safeParse({
      attemptId: "00000000-0000-4000-8000-000000000001",
      examId: "00000000-0000-4000-8000-000000000002",
      examTitle: "期末考试",
      candidateId: "00000000-0000-4000-8000-000000000003",
      candidateName: "张三",
      gradingStatus: "fully_graded",
      questions: [],
    });
    expect(result.success).toBe(true);
  });

  it("GradingDetailsResponseSchema rejects invalid gradingStatus", () => {
    const result = GradingDetailsResponseSchema.safeParse({
      attemptId: "00000000-0000-4000-8000-000000000001",
      examId: "00000000-0000-4000-8000-000000000002",
      examTitle: "期末考试",
      candidateId: "00000000-0000-4000-8000-000000000003",
      candidateName: "张三",
      gradingStatus: "unknown_status",
      questions: [],
    });
    expect(result.success).toBe(false);
  });

  it("GradingDetailsResponseSchema rejects invalid UUIDs", () => {
    const result = GradingDetailsResponseSchema.safeParse({
      attemptId: "invalid-uuid",
      examId: "00000000-0000-4000-8000-000000000002",
      examTitle: "期末考试",
      candidateId: "00000000-0000-4000-8000-000000000003",
      candidateName: "张三",
      gradingStatus: "pending_manual",
      questions: [],
    });
    expect(result.success).toBe(false);
  });
});
