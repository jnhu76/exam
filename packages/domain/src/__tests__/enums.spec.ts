import { describe, it, expect } from "vitest";
import {
  QuestionType,
  ExamStatus,
  AttemptStatus,
  EnrollmentStatus,
  Role,
  TimingMode,
  RetakePolicy,
  ScoreStrategy,
} from "../enums";

// Consolidated domain enum family. Historical phase codes (P3-L0-1) preserved
// in the assertion detail where useful.

describe("QuestionType contains the supported closed question-type set", () => {
  it("题型集合为 5 个封闭值（single/multiple/true_false/fill_blank/text_response）", () => {
    const values = Object.values(QuestionType);
    expect(values).toEqual([
      "single_choice",
      "multiple_choice",
      "fill_blank",
      "true_false",
      "text_response",
    ]);
  });
});

describe("domain enums expose stable string values", () => {
  it("ExamStatus 覆盖考试生命周期全部状态", () => {
    expect(ExamStatus.Draft).toBe("draft");
    expect(ExamStatus.Published).toBe("published");
    expect(ExamStatus.Open).toBe("open");
    expect(ExamStatus.Closed).toBe("closed");
    expect(ExamStatus.Archived).toBe("archived");
  });

  it("AttemptStatus 定义当前可达状态（in_progress/disrupted/submitted/grading/graded）", () => {
    expect(AttemptStatus.InProgress).toBe("in_progress");
    expect(AttemptStatus.Disrupted).toBe("disrupted");
    expect(AttemptStatus.Submitted).toBe("submitted");
    expect(AttemptStatus.Grading).toBe("grading");
    expect(AttemptStatus.Graded).toBe("graded");
  });

  it("AttemptStatus 保留 not_started / queued / voided 为当前状态机不可达的预留值", () => {
    expect(AttemptStatus.NotStarted).toBe("not_started");
    expect(AttemptStatus.Queued).toBe("queued");
    expect(AttemptStatus.Voided).toBe("voided");
  });

  it("EnrollmentStatus 覆盖分配/开始/完成/阻断四种资格状态", () => {
    expect(EnrollmentStatus.Assigned).toBe("assigned");
    expect(EnrollmentStatus.Started).toBe("started");
    expect(EnrollmentStatus.Completed).toBe("completed");
    expect(EnrollmentStatus.Blocked).toBe("blocked");
  });

  it("角色与考试模式枚举定义稳定值", () => {
    expect(Role.Admin).toBeDefined();
    expect(Role.Candidate).toBeDefined();
    expect(TimingMode.TimedWindow).toBe("timed_window");
    expect(RetakePolicy.MaxAttempts).toBe("max_attempts");
    expect(ScoreStrategy.Highest).toBe("highest");
  });
});
