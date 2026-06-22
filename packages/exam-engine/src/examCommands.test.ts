import { describe, expect, it } from "vitest";
import {
  publishExam,
  openExam,
  closeExam,
  archiveExam,
  cancelExam,
  unpublishExam,
  extendExam,
  buildQuestionSnapshot,
  checkAndUpdateExamStatus,
  publishResults,
  type ExamRepository,
} from "./examCommands.js";
import type { Exam, Question } from "@exam/domain";
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
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    organizationId: "org-1",
    courseId: "course-1",
    type: "single_choice",
    content: `Question ${id}`,
    options: [
      { id: "a", content: "A" },
      { id: "b", content: "B" },
    ],
    standardAnswer: "a",
    attachments: [],
    score: 50,
    difficulty: 1,
    tags: [],
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const testQuestions = [makeQuestion("q1"), makeQuestion("q2")];

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
  describe("buildQuestionSnapshot", () => {
    it("creates snapshot from questions", () => {
      const snapshot = buildQuestionSnapshot(["q1", "q2"], testQuestions);
      expect(snapshot.length).toBe(2);
      expect(snapshot[0]?.originalQuestionId).toBe("q1");
      expect(snapshot[0]?.content).toBe("Question q1");
      expect(snapshot[0]?.options).toEqual([
        { id: "a", content: "A" },
        { id: "b", content: "B" },
      ]);
    });

    it("throws for missing question", () => {
      expect(() =>
        buildQuestionSnapshot(["q1", "missing"], testQuestions),
      ).toThrow(ValidationError);
    });
  });

  describe("publishExam", () => {
    it("transitions draft → published", async () => {
      const repo = makeRepo(makeExam());
      const result = await publishExam(repo, "exam-1", testQuestions);
      expect(result.status).toBe("published");
    });

    it("captures questionSnapshot with real data", async () => {
      const repo = makeRepo(makeExam());
      const result = await publishExam(repo, "exam-1", testQuestions);
      expect(result.questionSnapshot.length).toBe(2);
      expect(result.questionSnapshot[0]?.content).toBe("Question q1");
      expect(result.questionSnapshot[0]?.standardAnswer).toBe("a");
    });

    it("throws for non-existent exam", async () => {
      const repo = makeRepo(makeExam());
      await expect(
        publishExam(repo, "nonexistent", testQuestions),
      ).rejects.toThrow(ValidationError);
    });

    it("throws for invalid transition (published → published)", async () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      await expect(publishExam(repo, "exam-1", testQuestions)).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws when no questions", async () => {
      const repo = makeRepo(makeExam({ questionIds: [] }));
      await expect(publishExam(repo, "exam-1", testQuestions)).rejects.toThrow(
        ValidationError,
      );
    });

    it("throws when passingScore is 0", async () => {
      const repo = makeRepo(makeExam({ passingScore: 0 }));
      await expect(publishExam(repo, "exam-1", testQuestions)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("openExam", () => {
    it("transitions published → open", async () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      const result = await openExam(repo, "exam-1");
      expect(result.status).toBe("open");
    });

    it("throws for draft → open", async () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      await expect(openExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("closeExam", () => {
    it("transitions open → closed", async () => {
      const repo = makeRepo(makeExam({ status: "open" }));
      const result = await closeExam(repo, "exam-1");
      expect(result.status).toBe("closed");
    });

    it("throws for published → closed", async () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      await expect(closeExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    // ADR-005 Slice 1 / review decision #2: close is idempotent for `closed`.
    // `closed -> closed` is a no-op returning the current exam, NOT a
    // transition error. The route layer suppresses the duplicate audit.
    it("is idempotent: closed → closed returns the exam unchanged", async () => {
      const repo = makeRepo(makeExam({ status: "closed" }));
      const result = await closeExam(repo, "exam-1");
      expect(result.status).toBe("closed");
    });

    it("throws for draft → closed", async () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      await expect(closeExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for archived → closed", async () => {
      const repo = makeRepo(makeExam({ status: "archived" }));
      await expect(closeExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("archiveExam", () => {
    it("transitions closed → archived", async () => {
      const repo = makeRepo(makeExam({ status: "closed" }));
      const result = await archiveExam(repo, "exam-1");
      expect(result.status).toBe("archived");
    });

    it("transitions published → archived", async () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      const result = await archiveExam(repo, "exam-1");
      expect(result.status).toBe("archived");
    });

    it("throws for draft → archived", async () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      await expect(archiveExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for open → archived", async () => {
      const repo = makeRepo(makeExam({ status: "open" }));
      await expect(archiveExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("unpublishExam", () => {
    it("transitions published -> draft", async () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      const result = await unpublishExam(repo, "exam-1");
      expect(result.status).toBe("draft");
    });

    it("throws for draft -> draft (noop rejected)", async () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      await expect(unpublishExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for open -> draft", async () => {
      const repo = makeRepo(makeExam({ status: "open" }));
      await expect(unpublishExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for closed/archived -> draft", async () => {
      const repo = makeRepo(makeExam({ status: "closed" }));
      await expect(unpublishExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("cancelExam", () => {
    it("transitions published -> canceled", async () => {
      const repo = makeRepo(makeExam({ status: "published" }));
      const result = await cancelExam(repo, "exam-1");
      expect(result.status).toBe("canceled");
    });

    it("transitions open -> canceled", async () => {
      const repo = makeRepo(makeExam({ status: "open" }));
      const result = await cancelExam(repo, "exam-1");
      expect(result.status).toBe("canceled");
    });

    it("throws for draft -> canceled", async () => {
      const repo = makeRepo(makeExam({ status: "draft" }));
      await expect(cancelExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for closed -> canceled", async () => {
      const repo = makeRepo(makeExam({ status: "closed" }));
      await expect(cancelExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for canceled -> canceled (already canceled)", async () => {
      const repo = makeRepo(makeExam({ status: "canceled" }));
      await expect(cancelExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("throws for archived -> canceled", async () => {
      const repo = makeRepo(makeExam({ status: "archived" }));
      await expect(cancelExam(repo, "exam-1")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe("archiveExam canceled", () => {
    it("transitions canceled -> archived", async () => {
      const repo = makeRepo(makeExam({ status: "canceled" }));
      const result = await archiveExam(repo, "exam-1");
      expect(result.status).toBe("archived");
    });
  });

  describe("extendExam", () => {
    const futureClose = new Date(Date.now() + 3600_000);
    const baseExam = (status: string) =>
      makeExam({ status: status as never, closeAt: futureClose });

    it("extends an open exam's closeAt by extendMinutes", async () => {
      const repo = makeRepo(baseExam("open"));
      const result = await extendExam(repo, "exam-1", 15);
      expect(result.status).toBe("open");
      expect(new Date(result.closeAt).getTime()).toBeGreaterThan(
        futureClose.getTime(),
      );
    });

    it("throws for non-open states", async () => {
      for (const status of [
        "draft",
        "published",
        "closed",
        "canceled",
        "archived",
      ]) {
        const repo = makeRepo(baseExam(status));
        await expect(extendExam(repo, "exam-1", 15)).rejects.toThrow(
          InvalidStateTransitionError,
        );
      }
    });

    it("throws for non-positive extendMinutes", async () => {
      const repo = makeRepo(baseExam("open"));
      await expect(extendExam(repo, "exam-1", 0)).rejects.toThrow(
        ValidationError,
      );
      await expect(extendExam(repo, "exam-1", -5)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("checkAndUpdateExamStatus", () => {
    it("transitions published → open when now >= openAt", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "published", openAt, closeAt }));
      const now = new Date("2025-01-01T10:00:00Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("open");
      expect(result?.transition).toBe("open");
    });

    it("transitions open → closed when now >= closeAt", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "open", openAt, closeAt }));
      const now = new Date("2025-01-01T12:00:00Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("closed");
      expect(result?.transition).toBe("closed");
    });

    it("does not transition published when now < openAt", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "published", openAt, closeAt }));
      const now = new Date("2025-01-01T09:59:59Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("published");
      expect(result?.transition).toBeUndefined();
    });

    it("does not transition open when now < closeAt", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "open", openAt, closeAt }));
      const now = new Date("2025-01-01T11:59:59Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("open");
      expect(result?.transition).toBeUndefined();
    });

    it("does not transition draft exam", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "draft", openAt, closeAt }));
      const now = new Date("2025-01-01T11:00:00Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("draft");
      expect(result?.transition).toBeUndefined();
    });

    it("does not transition closed exam", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "closed", openAt, closeAt }));
      const now = new Date("2025-01-01T13:00:00Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("closed");
      expect(result?.transition).toBeUndefined();
    });

    it("does not transition archived exam", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "archived", openAt, closeAt }));
      const now = new Date("2025-01-01T11:00:00Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("archived");
      expect(result?.transition).toBeUndefined();
    });

    it("returns null when not found", async () => {
      const repo = makeRepo(makeExam());
      const result = await checkAndUpdateExamStatus(
        repo,
        "nonexistent",
        new Date(),
      );
      expect(result).toBeNull();
    });

    it("idempotent: second call after transition returns same status with no transition", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "published", openAt, closeAt }));
      const now = new Date("2025-01-01T10:00:00Z");
      const first = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(first?.exam.status).toBe("open");
      expect(first?.transition).toBe("open");
      const second = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(second?.exam.status).toBe("open");
      expect(second?.transition).toBeUndefined();
    });

    it("transitions published → open → closed in one call when past closeAt", async () => {
      const openAt = new Date("2025-01-01T10:00:00Z");
      const closeAt = new Date("2025-01-01T12:00:00Z");
      const repo = makeRepo(makeExam({ status: "published", openAt, closeAt }));
      const now = new Date("2025-01-01T13:00:00Z");
      const result = await checkAndUpdateExamStatus(repo, "exam-1", now);
      expect(result?.exam.status).toBe("closed");
      expect(result?.transition).toBe("closed");
    });
  });

  // P2D-J5a: publishResults unit coverage. Mirrors the route integration
  // tests but isolates the pure engine logic from the DB/HTTP layer.
  describe("publishResults", () => {
    const publishTime = new Date("2025-06-01T10:00:00Z");

    it("sets resultsPublishedAt on a published exam and reports alreadyPublished=false", async () => {
      const repo = makeRepo(
        makeExam({ status: "published", resultsPublishedAt: null }),
      );
      const result = await publishResults(repo, "exam-1", publishTime);
      expect(result.exam.resultsPublishedAt).toBe(publishTime);
      expect(result.alreadyPublished).toBe(false);
    });

    it("accepts open and closed states", async () => {
      for (const status of ["open", "closed"] as const) {
        const repo = makeRepo(makeExam({ status, resultsPublishedAt: null }));
        const result = await publishResults(repo, "exam-1", publishTime);
        expect(result.exam.resultsPublishedAt).toBe(publishTime);
        expect(result.alreadyPublished).toBe(false);
      }
    });

    it("is idempotent: a repeat call returns alreadyPublished=true and leaves the timestamp unchanged", async () => {
      const firstAt = new Date("2025-06-01T10:00:00Z");
      const repo = makeRepo(
        makeExam({ status: "published", resultsPublishedAt: firstAt }),
      );
      const result = await publishResults(
        repo,
        "exam-1",
        new Date("2025-07-01T10:00:00Z"),
      );
      expect(result.exam.resultsPublishedAt).toBe(firstAt);
      expect(result.alreadyPublished).toBe(true);
    });

    it("rejects draft, canceled, and archived states with InvalidStateTransitionError", async () => {
      for (const status of ["draft", "canceled", "archived"] as const) {
        const repo = makeRepo(makeExam({ status }));
        await expect(
          publishResults(repo, "exam-1", publishTime),
        ).rejects.toThrow(InvalidStateTransitionError);
      }
    });

    it("throws ValidationError when the exam does not exist", async () => {
      const repo = makeRepo(makeExam());
      await expect(
        publishResults(repo, "missing", publishTime),
      ).rejects.toThrow(ValidationError);
    });
  });
});
