import { describe, it, expect } from "vitest";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  ChangePasswordRequestSchema,
} from "../auth.js";
import { CreateUserRequestSchema, RoleSchema } from "../user.js";
import { CreateCandidateRequestSchema } from "../candidate.js";
import {
  CreateCourseRequestSchema,
  UpdateCourseRequestSchema,
} from "../course.js";
import { CreateExamRequestSchema, ExamSchema } from "../exam.js";
import {
  CreateQuestionRequestSchema,
  QuestionImportRowSchema,
} from "../question.js";
import {
  ScoreListQuerySchema,
  SaveAnswerRequestSchema,
  SaveAnswerResponseSchema,
  CandidateExamDetailResponseSchema,
  SaveAnswerAcceptedSchema,
  SaveAnswerRejectedSchema,
  SaveAnswerRejectReasonEnum,
  GradingStatusEnum,
  ManualGradingEntrySchema,
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

  it("CreateExamRequestSchema rejects invalid timingMode", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      timingMode: "untimed",
    });
    expect(result.success).toBe(false);
  });

  it("CreateExamRequestSchema rejects negative passingScore", () => {
    const result = CreateExamRequestSchema.safeParse({
      ...validExam,
      passingScore: -1,
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

  it("SaveAnswerResponseSchema validates accepted", () => {
    const result = SaveAnswerResponseSchema.safeParse({
      accepted: true,
      serverVersion: 1,
      savedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("SaveAnswerResponseSchema validates rejected via union", () => {
    const result = SaveAnswerResponseSchema.safeParse({
      accepted: false,
      reason: "STALE_VERSION",
      message: "服务器上存在更新的答案版本",
      serverVersion: 2,
      savedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("CandidateExamDetailResponseSchema validates", () => {
    const result = CandidateExamDetailResponseSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Exam",
      durationMinutes: 60,
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
  it("has exactly 5 values", () => {
    const values = SaveAnswerRejectReasonEnum.options;
    expect(values).toEqual([
      "STALE_VERSION",
      "ATTEMPT_ALREADY_SUBMITTED",
      "ATTEMPT_CLOSED",
      "DEADLINE_EXCEEDED",
      "CONFLICTING_PAYLOAD",
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

describe("Phase 1 role model (Admin + Candidate only)", () => {
  it("RoleSchema accepts Admin", () => {
    expect(RoleSchema.safeParse("Admin").success).toBe(true);
  });

  it("RoleSchema accepts Candidate", () => {
    expect(RoleSchema.safeParse("Candidate").success).toBe(true);
  });

  it("RoleSchema rejects Teacher", () => {
    expect(RoleSchema.safeParse("Teacher").success).toBe(false);
  });

  it("RoleSchema rejects SuperAdmin", () => {
    expect(RoleSchema.safeParse("SuperAdmin").success).toBe(false);
  });

  it("RoleSchema rejects Proctor", () => {
    expect(RoleSchema.safeParse("Proctor").success).toBe(false);
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

  it("CreateUserRequestSchema rejects Teacher", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "Teacher",
    });
    expect(result.success).toBe(false);
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

  it("CreateUserRequestSchema rejects Candidate (candidates are managed via candidate routes)", () => {
    const result = CreateUserRequestSchema.safeParse({
      username: "newuser",
      password: "password123",
      name: "New User",
      role: "Candidate",
    });
    expect(result.success).toBe(false);
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

  const validEntry = {
    id: "00000000-0000-4000-8000-000000000001",
    attemptId: "00000000-0000-4000-8000-000000000002",
    questionId: "q-essay-1", // originalQuestionId — not a uuid
    score: 7,
    maxScore: 10,
    gradedBy: "00000000-0000-4000-8000-000000000003",
    gradedAt: "2026-06-21T00:00:00.000Z",
  };

  it("ManualGradingEntrySchema accepts a complete valid payload", () => {
    const result = ManualGradingEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });

  it("ManualGradingEntrySchema defaults comment to empty string when omitted", () => {
    const parsed = ManualGradingEntrySchema.parse(validEntry);
    expect(parsed.comment).toBe("");
  });

  it("ManualGradingEntrySchema rejects negative score", () => {
    const result = ManualGradingEntrySchema.safeParse({
      ...validEntry,
      score: -1,
    });
    expect(result.success).toBe(false);
  });

  it("ManualGradingEntrySchema rejects score greater than maxScore", () => {
    const result = ManualGradingEntrySchema.safeParse({
      ...validEntry,
      score: 11,
      maxScore: 10,
    });
    expect(result.success).toBe(false);
  });

  it("ManualGradingEntrySchema rejects comment longer than 2000 chars", () => {
    const result = ManualGradingEntrySchema.safeParse({
      ...validEntry,
      comment: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("ManualGradingEntrySchema accepts a non-uuid questionId (originalQuestionId)", () => {
    const result = ManualGradingEntrySchema.safeParse({
      ...validEntry,
      questionId: "any-snapshot-question-id",
    });
    expect(result.success).toBe(true);
  });
});
