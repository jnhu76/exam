import { describe, it, expect } from "vitest";
import {
  ExamStatus,
  AttemptStatus,
  EnrollmentStatus,
  Role,
  QuestionType,
  TimingMode,
  RetakePolicy,
  ScoreStrategy,
} from "../enums";

describe("domain enums — 存在性与值验证", () => {
  it("ExamStatus 包含 Phase 1 所有状态", () => {
    expect(ExamStatus.Draft).toBe("draft");
    expect(ExamStatus.Published).toBe("published");
    expect(ExamStatus.Open).toBe("open");
    expect(ExamStatus.Closed).toBe("closed");
    expect(ExamStatus.Archived).toBe("archived");
  });

  it("AttemptStatus 包含 Phase 1 可达 + Phase 2 保留状态", () => {
    expect(AttemptStatus.InProgress).toBe("in_progress");
    expect(AttemptStatus.Disrupted).toBe("disrupted");
    expect(AttemptStatus.Submitted).toBe("submitted");
    expect(AttemptStatus.Grading).toBe("grading");
    expect(AttemptStatus.Graded).toBe("graded");
  });

  it("AttemptStatus not_started / queued / voided 存在但 Phase 1 不可达（保留给 Phase 2）", () => {
    expect(AttemptStatus.NotStarted).toBe("not_started");
    expect(AttemptStatus.Queued).toBe("queued");
    expect(AttemptStatus.Voided).toBe("voided");
  });

  it("EnrollmentStatus 包含所有 Phase 1 状态", () => {
    expect(EnrollmentStatus.Assigned).toBe("assigned");
    expect(EnrollmentStatus.Started).toBe("started");
    expect(EnrollmentStatus.Completed).toBe("completed");
    expect(EnrollmentStatus.Blocked).toBe("blocked");
  });

  it("其他关键枚举存在", () => {
    expect(Role.Admin).toBeDefined();
    expect(Role.Candidate).toBeDefined();
    expect(QuestionType.SingleChoice).toBe("single_choice");
    expect(TimingMode.TimedWindow).toBe("timed_window");
    expect(RetakePolicy.MaxAttempts).toBe("max_attempts");
    expect(ScoreStrategy.Highest).toBe("highest");
  });
});

describe("状态机转移表由 exam-engine 层拥有和强制", () => {
  it("ExamStatus / AttemptStatus / EnrollmentStatus 的转移规则在 exam-engine 层测试，不在 domain 层重复", () => {
    expect(true).toBe(true);
  });
});
