import { describe, expect, it } from "vitest";
import type {
  AttemptGradingEntry,
  ExamAttempt,
  GradingEntryMode,
  GradingEntryStatus,
  QuestionSnapshot,
} from "@exam/domain";
import { materializeGradingWorkset } from "./gradingWorkset.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";

const NOW = new Date("2026-06-01T12:00:00Z");

function objectiveSnapshot(
  id: string,
  score: number,
  standardAnswer: unknown = "a",
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
    attachments: [],
    options: [],
    standardAnswer,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

function textResponseSnapshot(
  id: string,
  score: number,
  opts: { standardAnswer?: unknown } = {},
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: `Subjective ${id}`,
    attachments: [],
    options: [],
    standardAnswer: opts.standardAnswer ?? null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 1,
    rubric: null,
  };
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enrollment-1",
    candidateId: "candidate-1",
    attemptNo: 1,
    status: "submitted",
    questionSnapshot: [objectiveSnapshot("q-obj", 40, "a")],
    answers: [],
    gradingStatus: "pending_manual",
    submittedAnswers: {
      schemaVersion: 1,
      answers: [{ questionId: "q-obj", value: "a" }],
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface StoredEntry {
  id: string;
  organizationId: string;
  attemptId: string;
  questionId: string;
  gradingMode: GradingEntryMode;
  status: GradingEntryStatus;
  maxScore: number;
  earnedScore: number | null;
  candidateAnswer: unknown;
  standardAnswer: unknown;
  correct: boolean | null;
  comment: string;
  gradedBy: string | null;
  gradedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeWorksetRepo(existing: StoredEntry[] = []) {
  const store = new Map<string, StoredEntry>();
  for (const e of existing) {
    store.set(`${e.attemptId}:${e.questionId}`, e);
  }
  const created: StoredEntry[] = [];
  let counter = 0;
  const repo: GradingWorksetRepository = {
    async findByAttempt(attemptId: string) {
      return Array.from(store.values())
        .filter((e) => e.attemptId === attemptId)
        .map((e) => ({ ...e }));
    },
    async bulkCreate(inputs) {
      for (const input of inputs) {
        const key = `${input.attemptId}:${input.questionId}`;
        if (store.has(key)) {
          throw new Error(
            `duplicate grading entry for ${key} — materialization must not create duplicates`,
          );
        }
        const entry: StoredEntry = {
          id: `entry-${++counter}`,
          organizationId: "org-1",
          comment: "",
          gradedBy: null,
          gradedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          ...input,
        };
        store.set(key, entry);
        created.push(entry);
      }
    },
  };
  return { repo, created, store };
}

describe("materializeGradingWorkset", () => {
  it("creates exactly one entry per frozen question", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveSnapshot("q-obj-1", 30, "a"),
        objectiveSnapshot("q-obj-2", 20, "b"),
        textResponseSnapshot("q-text", 50),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj-1", value: "a" },
          { questionId: "q-obj-2", value: "x" },
          { questionId: "q-text", value: "student answer" },
        ],
      },
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    expect(created).toHaveLength(3);
    expect(created.map((e) => e.questionId).sort()).toEqual([
      "q-obj-1",
      "q-obj-2",
      "q-text",
    ]);
  });

  it("objective questions get completed_auto with correct earned score", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "a" },
          { questionId: "q-text", value: "ans" },
        ],
      },
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    const obj = created.find((e) => e.questionId === "q-obj")!;
    expect(obj.gradingMode).toBe("auto");
    expect(obj.status).toBe("completed_auto");
    expect(obj.earnedScore).toBe(40);
    expect(obj.correct).toBe(true);
    expect(obj.candidateAnswer).toBe("a");
    expect(obj.standardAnswer).toBe("a");
  });

  it("objective wrong answer gets earnedScore=0, correct=false", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "b" },
          { questionId: "q-text", value: "ans" },
        ],
      },
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    const obj = created.find((e) => e.questionId === "q-obj")!;
    expect(obj.earnedScore).toBe(0);
    expect(obj.correct).toBe(false);
  });

  it("text_response questions get pending_manual with frozen answer", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "a" },
          { questionId: "q-text", value: "student answer" },
        ],
      },
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    const manual = created.find((e) => e.questionId === "q-text")!;
    expect(manual.gradingMode).toBe("manual");
    expect(manual.status).toBe("pending_manual");
    expect(manual.earnedScore).toBeNull();
    expect(manual.correct).toBeNull();
    expect(manual.candidateAnswer).toBe("student answer");
    expect(manual.maxScore).toBe(60);
  });

  it("non-null-SA text_response still gets pending_manual", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        textResponseSnapshot("q-text", 100, {
          standardAnswer: "参考答案",
        }),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-text", value: "student answer" }],
      },
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    const manual = created.find((e) => e.questionId === "q-text")!;
    expect(manual.gradingMode).toBe("manual");
    expect(manual.status).toBe("pending_manual");
    expect(manual.standardAnswer).toBe("参考答案");
  });

  it("missing submitted answer for objective produces zero-score completed_auto", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [objectiveSnapshot("q-obj", 40, "a")],
      submittedAnswers: { schemaVersion: 1, answers: [] },
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    const obj = created.find((e) => e.questionId === "q-obj")!;
    expect(obj.status).toBe("completed_auto");
    expect(obj.earnedScore).toBe(0);
    expect(obj.correct).toBe(false);
    expect(obj.candidateAnswer).toBeNull();
  });

  it("retry (entries already exist) does not duplicate work", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "a" },
          { questionId: "q-text", value: "ans" },
        ],
      },
    });
    const existing: StoredEntry[] = [
      {
        id: "existing-1",
        organizationId: "org-1",
        attemptId: "attempt-1",
        questionId: "q-obj",
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
        comment: "",
        gradedBy: null,
        gradedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "existing-2",
        organizationId: "org-1",
        attemptId: "attempt-1",
        questionId: "q-text",
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 60,
        earnedScore: null,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: null,
        comment: "",
        gradedBy: null,
        gradedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const { repo, created } = makeWorksetRepo(existing);

    await materializeGradingWorkset(attempt, repo);

    expect(created).toHaveLength(0);
  });

  it("uses submittedAnswers exclusively, never draft answers", async () => {
    const attempt = makeAttempt({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "a" },
          { questionId: "q-text", value: "frozen answer" },
        ],
      },
      answers: [
        { questionId: "q-obj", answer: "b", version: 1, savedAt: NOW },
        {
          questionId: "q-text",
          answer: "draft answer",
          version: 1,
          savedAt: NOW,
        },
      ],
    });
    const { repo, created } = makeWorksetRepo();

    await materializeGradingWorkset(attempt, repo);

    const obj = created.find((e) => e.questionId === "q-obj")!;
    expect(obj.candidateAnswer).toBe("a");
    expect(obj.earnedScore).toBe(40);
    const manual = created.find((e) => e.questionId === "q-text")!;
    expect(manual.candidateAnswer).toBe("frozen answer");
  });
});
