import { describe, expect, it } from "vitest";
import {
  publishExam,
  openExam,
  closeExam,
  archiveExam,
  type ExamRepository,
} from "./examCommands.js";
import type { Exam } from "@exam/domain";
import { InvalidStateTransitionError, ValidationError } from "@exam/domain";

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Test Exam",
    description: "",
    courseId: "course-1",
    status: "draft",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date(),
    closeAt: new Date(Date.now() + 86400000),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: ["q1", "q2"],
    questionSnapshot: [],
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(initial: Exam): ExamRepository {
  let current = { ...initial };
  return {
    findById(id: string) {
      return id === current.id ? current : null;
    },
    update(_id: string, data: Partial<Exam>) {
      current = { ...current, ...data };
      return current;
    },
  };
}

describe("examCommands", () => {
  describe("publishExam", () => {
    it("transitions draft → published", () => {
      const repo = makeRepo(makeExam());
      const result = publishExam(repo, "exam-1");
      expect(result.status).toBe("published");
    });

    it("captures questionSnapshot on publish", () => {
      const repo = makeRepo(makeExam());
      const result = publishExam(repo, "exam-1");
      expect(result.questionSnapshot).toBeDefined();
      expect(result.questionSnapshot.length).toBe(2);
    });

    it("throws for non-existent exam", () => {
      const repo = makeRepo(makeExam());
      expect(() => publishExam(repo, "nonexistent")).toThrow(ValidationError);
    });

    it("throws for invalid transition (published → published)", () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      expect(() => publishExam(repo, "exam-1")).toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws when no questions", () => {
      const repo = makeRepo(makeExam({ questionIds: [] }));
      expect(() => publishExam(repo, "exam-1")).toThrow(ValidationError);
    });

    it("throws when passingScore is 0", () => {
      const repo = makeRepo(makeExam({ passingScore: 0 }));
      expect(() => publishExam(repo, "exam-1")).toThrow(ValidationError);
    });
  });

  describe("openExam", () => {
    it("transitions published → open", () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      const result = openExam(repo, "exam-1");
      expect(result.status).toBe("open");
    });

    it("throws for draft → open", () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      expect(() => openExam(repo, "exam-1")).toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("closeExam", () => {
    it("transitions open → closed", () => {
      const repo = makeRepo(makeExam({ status: "open" }));
      const result = closeExam(repo, "exam-1");
      expect(result.status).toBe("closed");
    });

    it("throws for published → closed", () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      expect(() => closeExam(repo, "exam-1")).toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("archiveExam", () => {
    it("transitions closed → archived", () => {
      const repo = makeRepo(makeExam({ status: "closed" }));
      const result = archiveExam(repo, "exam-1");
      expect(result.status).toBe("archived");
    });

    it("transitions published → archived", () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      const result = archiveExam(repo, "exam-1");
      expect(result.status).toBe("archived");
    });

    it("throws for draft → archived", () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      expect(() => archiveExam(repo, "exam-1")).toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for open → archived", () => {
      const repo = makeRepo(makeExam({ status: "open" }));
      expect(() => archiveExam(repo, "exam-1")).toThrow(
        InvalidStateTransitionError,
      );
    });
  });
});
