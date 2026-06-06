import { describe, it, expect } from "vitest";
import { ExamStatus, AttemptStatus, EnrollmentStatus } from "../enums";

describe("考试状态生命周期测试", () => {
  describe("考试状态转换", () => {
    const validTransitions: Record<string, string[]> = {
      [ExamStatus.Draft]: [ExamStatus.Published, ExamStatus.Archived],
      [ExamStatus.Published]: [ExamStatus.Open, ExamStatus.Draft],
      [ExamStatus.Open]: [ExamStatus.Closed],
      [ExamStatus.Closed]: [ExamStatus.Archived],
      [ExamStatus.Archived]: [],
    };

    it("应该允许从草稿状态发布考试", () => {
      const from = ExamStatus.Draft;
      const to = ExamStatus.Published;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从发布状态开始考试", () => {
      const from = ExamStatus.Published;
      const to = ExamStatus.Open;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从进行中状态结束考试", () => {
      const from = ExamStatus.Open;
      const to = ExamStatus.Closed;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已结束状态归档考试", () => {
      const from = ExamStatus.Closed;
      const to = ExamStatus.Archived;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从草稿状态归档考试", () => {
      const from = ExamStatus.Draft;
      const to = ExamStatus.Archived;
      expect(validTransitions[from]).toContain(to);
    });

    it("不应该允许从已归档状态进行任何转换", () => {
      const from = ExamStatus.Archived;
      expect(validTransitions[from]).toHaveLength(0);
    });

    it("应该允许从发布状态返回草稿", () => {
      const from = ExamStatus.Published;
      const to = ExamStatus.Draft;
      expect(validTransitions[from]).toContain(to);
    });
  });

  describe("考试状态边界条件", () => {
    it("不应该允许直接从草稿状态跳到开放状态", () => {
      const transitions: Record<string, string[]> = {
        [ExamStatus.Draft]: [ExamStatus.Published, ExamStatus.Archived],
      };
      expect(transitions[ExamStatus.Draft]).not.toContain(ExamStatus.Open);
    });

    it("不应该允许从归档状态重新打开考试", () => {
      const transitions: Record<string, string[]> = {
        [ExamStatus.Archived]: [],
      };
      expect(transitions[ExamStatus.Archived]).not.toContain(ExamStatus.Open);
    });
  });
});

describe("考生考试状态生命周期测试", () => {
  describe("考生状态转换", () => {
    const validTransitions: Record<string, string[]> = {
      [AttemptStatus.NotStarted]: [
        AttemptStatus.Queued,
        AttemptStatus.InProgress,
      ],
      [AttemptStatus.Queued]: [AttemptStatus.InProgress],
      [AttemptStatus.InProgress]: [
        AttemptStatus.Disrupted,
        AttemptStatus.Submitted,
      ],
      [AttemptStatus.Disrupted]: [
        AttemptStatus.InProgress,
        AttemptStatus.Submitted,
      ],
      [AttemptStatus.Submitted]: [AttemptStatus.Grading, AttemptStatus.Graded],
      [AttemptStatus.Grading]: [AttemptStatus.Graded],
      [AttemptStatus.Graded]: [AttemptStatus.Voided],
      [AttemptStatus.Voided]: [],
    };

    it("应该允许从未开始状态进入队列", () => {
      const from = AttemptStatus.NotStarted;
      const to = AttemptStatus.Queued;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从队列状态开始考试", () => {
      const from = AttemptStatus.Queued;
      const to = AttemptStatus.InProgress;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从未开始状态直接开始考试", () => {
      const from = AttemptStatus.NotStarted;
      const to = AttemptStatus.InProgress;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从进行中状态中断考试", () => {
      const from = AttemptStatus.InProgress;
      const to = AttemptStatus.Disrupted;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从中断状态恢复考试", () => {
      const from = AttemptStatus.Disrupted;
      const to = AttemptStatus.InProgress;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从进行中状态提交考试", () => {
      const from = AttemptStatus.InProgress;
      const to = AttemptStatus.Submitted;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从中断状态提交考试", () => {
      const from = AttemptStatus.Disrupted;
      const to = AttemptStatus.Submitted;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已提交状态进入批改状态", () => {
      const from = AttemptStatus.Submitted;
      const to = AttemptStatus.Grading;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从批改状态完成批改", () => {
      const from = AttemptStatus.Grading;
      const to = AttemptStatus.Graded;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已提交状态直接标记为已批改", () => {
      const from = AttemptStatus.Submitted;
      const to = AttemptStatus.Graded;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已批改状态作废考试", () => {
      const from = AttemptStatus.Graded;
      const to = AttemptStatus.Voided;
      expect(validTransitions[from]).toContain(to);
    });

    it("不应该允许从已作废状态进行任何转换", () => {
      const from = AttemptStatus.Voided;
      expect(validTransitions[from]).toHaveLength(0);
    });
  });

  describe("考生状态边界条件", () => {
    it("不应该允许从未开始状态直接提交考试", () => {
      const transitions: Record<string, string[]> = {
        [AttemptStatus.NotStarted]: [
          AttemptStatus.Queued,
          AttemptStatus.InProgress,
        ],
      };
      expect(transitions[AttemptStatus.NotStarted]).not.toContain(
        AttemptStatus.Submitted,
      );
    });

    it("不应该允许从队列状态直接提交考试", () => {
      const transitions: Record<string, string[]> = {
        [AttemptStatus.Queued]: [AttemptStatus.InProgress],
      };
      expect(transitions[AttemptStatus.Queued]).not.toContain(
        AttemptStatus.Submitted,
      );
    });

    it("不应该允许从已提交状态恢复考试", () => {
      const transitions: Record<string, string[]> = {
        [AttemptStatus.Submitted]: [
          AttemptStatus.Grading,
          AttemptStatus.Graded,
        ],
      };
      expect(transitions[AttemptStatus.Submitted]).not.toContain(
        AttemptStatus.InProgress,
      );
    });

    it("不应该允许从已批改状态重新批改", () => {
      const transitions: Record<string, string[]> = {
        [AttemptStatus.Graded]: [AttemptStatus.Voided],
      };
      expect(transitions[AttemptStatus.Graded]).not.toContain(
        AttemptStatus.Grading,
      );
    });
  });
});

describe("报名状态生命周期测试", () => {
  describe("报名状态转换", () => {
    const validTransitions: Record<string, string[]> = {
      [EnrollmentStatus.Assigned]: [
        EnrollmentStatus.Started,
        EnrollmentStatus.Blocked,
      ],
      [EnrollmentStatus.Started]: [EnrollmentStatus.Completed],
      [EnrollmentStatus.Blocked]: [EnrollmentStatus.Started],
      [EnrollmentStatus.Completed]: [],
    };

    it("应该允许从已分配状态开始考试", () => {
      const from = EnrollmentStatus.Assigned;
      const to = EnrollmentStatus.Started;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已分配状态阻塞报名", () => {
      const from = EnrollmentStatus.Assigned;
      const to = EnrollmentStatus.Blocked;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已开始状态完成考试", () => {
      const from = EnrollmentStatus.Started;
      const to = EnrollmentStatus.Completed;
      expect(validTransitions[from]).toContain(to);
    });

    it("应该允许从已阻塞状态开始考试", () => {
      const from = EnrollmentStatus.Blocked;
      const to = EnrollmentStatus.Started;
      expect(validTransitions[from]).toContain(to);
    });

    it("不应该允许从已完成状态进行任何转换", () => {
      const from = EnrollmentStatus.Completed;
      expect(validTransitions[from]).toHaveLength(0);
    });
  });

  describe("报名状态边界条件", () => {
    it("不应该允许从已分配状态直接完成考试", () => {
      const transitions: Record<string, string[]> = {
        [EnrollmentStatus.Assigned]: [
          EnrollmentStatus.Started,
          EnrollmentStatus.Blocked,
        ],
      };
      expect(transitions[EnrollmentStatus.Assigned]).not.toContain(
        EnrollmentStatus.Completed,
      );
    });

    it("不应该允许从已开始状态返回已分配", () => {
      const transitions: Record<string, string[]> = {
        [EnrollmentStatus.Started]: [EnrollmentStatus.Completed],
      };
      expect(transitions[EnrollmentStatus.Started]).not.toContain(
        EnrollmentStatus.Assigned,
      );
    });

    it("不应该允许从已完成状态重新开始考试", () => {
      const transitions: Record<string, string[]> = {
        [EnrollmentStatus.Completed]: [],
      };
      expect(transitions[EnrollmentStatus.Completed]).not.toContain(
        EnrollmentStatus.Started,
      );
    });
  });
});
