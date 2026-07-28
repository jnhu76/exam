import { describe, expect, it } from "vitest";
import type {
  AttemptGradingEntry,
  ExamAttempt,
  GradingEntryMode,
  GradingEntryStatus,
  QuestionSnapshot,
} from "@exam/domain";
import {
  materializeGradingWorkset,
  validateGradingWorksetConsistency,
  type GradingWorksetRepository,
} from "./gradingWorkset.js";
import { submitAttempt, type AttemptRepository } from "./attemptCommands.js";

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
    async findByAttemptAndQuestion(attemptId, questionId) {
      const found = store.get(`${attemptId}:${questionId}`);
      return found ? { ...found } : null;
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
    async completeManualEntry(input) {
      const key = `${input.attemptId}:${input.questionId}`;
      const existing = store.get(key);
      if (!existing) return null;
      const updated: StoredEntry = {
        ...existing,
        status: "completed_manual",
        earnedScore: input.earnedScore,
        correct: input.earnedScore >= input.maxScore,
        comment: input.comment,
        gradedBy: input.gradedBy,
        gradedAt: input.gradedAt,
        updatedAt: input.now,
      };
      store.set(key, updated);
      return { ...updated };
    },
    async countPendingManualForAttempt(attemptId) {
      return Array.from(store.values()).filter(
        (e) =>
          e.attemptId === attemptId &&
          e.gradingMode === "manual" &&
          e.status === "pending_manual",
      ).length;
    },
  };
  return { repo, created, store };
}

function makeEntry(
  attemptId: string,
  questionId: string,
  overrides: Partial<StoredEntry> = {},
): StoredEntry {
  return {
    id: `entry-${questionId}`,
    organizationId: "org-1",
    attemptId,
    questionId,
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
    ...overrides,
  };
}

function makeAttemptRepo(attempt: ExamAttempt): AttemptRepository {
  let stored = attempt;
  return {
    findById: () => stored,
    findByIdForUpdate: () => stored,
    findActiveByEnrollment: () => null,
    findByEnrollmentAndAttemptNo: () => null,
    create: () => stored,
    update: (_id, data) => {
      stored = { ...stored, ...data };
      return stored;
    },
    refreshLastActivityIfInProgress: () => stored,
  };
}

// ── materializeGradingWorkset (pure function, no existence check) ──

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

// ── submitAttempt seam-ownership tests (P3-L0-2E Step 1) ──────────

describe("submitAttempt grading workset ownership", () => {
  it("A. mixed attempt: submitAttempt creates objective completed_auto + manual pending_manual", async () => {
    const attempt = makeAttempt({
      status: "in_progress",
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      answers: [
        { questionId: "q-obj", answer: "a", version: 1, savedAt: NOW },
        {
          questionId: "q-text",
          answer: "student answer",
          version: 1,
          savedAt: NOW,
        },
      ],
    });
    const attRepo = makeAttemptRepo(attempt);
    const { repo, created } = makeWorksetRepo();

    await submitAttempt(attRepo, repo, "attempt-1", NOW);

    expect(created).toHaveLength(2);
    const obj = created.find((e) => e.questionId === "q-obj")!;
    expect(obj.gradingMode).toBe("auto");
    expect(obj.status).toBe("completed_auto");
    expect(obj.earnedScore).toBe(40);
    const manual = created.find((e) => e.questionId === "q-text")!;
    expect(manual.gradingMode).toBe("manual");
    expect(manual.status).toBe("pending_manual");
    expect(manual.earnedScore).toBeNull();
  });

  it("B. pure text_response: submitAttempt creates pending_manual entries", async () => {
    const attempt = makeAttempt({
      status: "in_progress",
      questionSnapshot: [textResponseSnapshot("q-text", 100)],
      answers: [
        {
          questionId: "q-text",
          answer: "essay answer",
          version: 1,
          savedAt: NOW,
        },
      ],
    });
    const attRepo = makeAttemptRepo(attempt);
    const { repo, created } = makeWorksetRepo();

    await submitAttempt(attRepo, repo, "attempt-1", NOW);

    expect(created).toHaveLength(1);
    expect(created[0]!.gradingMode).toBe("manual");
    expect(created[0]!.status).toBe("pending_manual");
    expect(created[0]!.earnedScore).toBeNull();
  });

  it("C. pure objective: submitAttempt creates completed_auto entries", async () => {
    const attempt = makeAttempt({
      status: "in_progress",
      questionSnapshot: [
        objectiveSnapshot("q-obj-1", 30, "a"),
        objectiveSnapshot("q-obj-2", 20, "b"),
      ],
      answers: [
        { questionId: "q-obj-1", answer: "a", version: 1, savedAt: NOW },
        { questionId: "q-obj-2", answer: "x", version: 1, savedAt: NOW },
      ],
    });
    const attRepo = makeAttemptRepo(attempt);
    const { repo, created } = makeWorksetRepo();

    await submitAttempt(attRepo, repo, "attempt-1", NOW);

    expect(created).toHaveLength(2);
    const e1 = created.find((e) => e.questionId === "q-obj-1")!;
    expect(e1.status).toBe("completed_auto");
    expect(e1.earnedScore).toBe(30);
    const e2 = created.find((e) => e.questionId === "q-obj-2")!;
    expect(e2.status).toBe("completed_auto");
    expect(e2.earnedScore).toBe(0);
  });
});

// ── submitAttempt idempotent validation tests (P3-L0-2E Steps 5-11) ──

describe("submitAttempt idempotent workset validation", () => {
  it("exact matching workset: idempotent re-entry returns without error", async () => {
    const attempt = makeAttempt({
      status: "submitted",
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
      gradingStatus: "pending_manual",
    });
    const attRepo = makeAttemptRepo(attempt);
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
      makeEntry("attempt-1", "q-text", {
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 60,
        earnedScore: null,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: null,
      }),
    ];
    const { repo, created } = makeWorksetRepo(existing);

    const result = await submitAttempt(attRepo, repo, "attempt-1", NOW);

    expect(result.status).toBe("submitted");
    expect(created).toHaveLength(0);
  });

  it("partial workset: idempotent re-entry fails closed", async () => {
    const attempt = makeAttempt({
      status: "submitted",
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        objectiveSnapshot("q-obj-2", 20, "b"),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "a" },
          { questionId: "q-obj-2", value: "b" },
        ],
      },
      gradingStatus: "auto_graded",
    });
    const attRepo = makeAttemptRepo(attempt);
    // Only q-obj exists, q-obj-2 is missing
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
    ];
    const { repo } = makeWorksetRepo(existing);

    await expect(
      submitAttempt(attRepo, repo, "attempt-1", NOW),
    ).rejects.toThrow(/inconsistency/i);
  });

  it("extra entry: idempotent re-entry fails closed", async () => {
    const attempt = makeAttempt({
      status: "submitted",
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        objectiveSnapshot("q-obj-2", 20, "b"),
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [
          { questionId: "q-obj", value: "a" },
          { questionId: "q-obj-2", value: "b" },
        ],
      },
      gradingStatus: "auto_graded",
    });
    const attRepo = makeAttemptRepo(attempt);
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 40,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
      makeEntry("attempt-1", "q-obj-2", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 20,
        earnedScore: 20,
        candidateAnswer: "b",
        standardAnswer: "b",
        correct: true,
      }),
      makeEntry("attempt-1", "q-orphan", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 10,
        earnedScore: 10,
      }),
    ];
    const { repo } = makeWorksetRepo(existing);

    await expect(
      submitAttempt(attRepo, repo, "attempt-1", NOW),
    ).rejects.toThrow(/inconsistency/i);
  });

  it("mode mismatch: idempotent re-entry fails closed", async () => {
    const attempt = makeAttempt({
      status: "submitted",
      questionSnapshot: [textResponseSnapshot("q-text", 60)],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-text", value: "ans" }],
      },
      gradingStatus: "pending_manual",
    });
    const attRepo = makeAttemptRepo(attempt);
    // Entry has gradingMode=auto but question is text_response → expected manual
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-text", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 60,
        earnedScore: 0,
        candidateAnswer: "ans",
      }),
    ];
    const { repo } = makeWorksetRepo(existing);

    await expect(
      submitAttempt(attRepo, repo, "attempt-1", NOW),
    ).rejects.toThrow(/gradingMode.*!=.*expected/i);
  });

  it("max-score mismatch: idempotent re-entry fails closed", async () => {
    const attempt = makeAttempt({
      status: "submitted",
      questionSnapshot: [objectiveSnapshot("q-obj", 40, "a")],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-obj", value: "a" }],
      },
      gradingStatus: "auto_graded",
    });
    const attRepo = makeAttemptRepo(attempt);
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 30, // wrong — snapshot says 40
        earnedScore: 30,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: true,
      }),
    ];
    const { repo } = makeWorksetRepo(existing);

    await expect(
      submitAttempt(attRepo, repo, "attempt-1", NOW),
    ).rejects.toThrow(/maxScore.*!=.*expected/i);
  });

  it("objective score mismatch: idempotent re-entry fails closed", async () => {
    const attempt = makeAttempt({
      status: "submitted",
      questionSnapshot: [objectiveSnapshot("q-obj", 40, "a")],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-obj", value: "a" }],
      },
      gradingStatus: "auto_graded",
    });
    const attRepo = makeAttemptRepo(attempt);
    // Answer "a" is correct → canonical score = 40, but entry says 0
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 0,
        candidateAnswer: "a",
        standardAnswer: "a",
        correct: false,
      }),
    ];
    const { repo } = makeWorksetRepo(existing);

    await expect(
      submitAttempt(attRepo, repo, "attempt-1", NOW),
    ).rejects.toThrow(/earnedScore.*!=.*expected/i);
  });

  it("pending manual progress: idempotent re-entry passes validation", async () => {
    const attempt = makeAttempt({
      status: "submitted",
      questionSnapshot: [textResponseSnapshot("q-text", 60)],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-text", value: "ans" }],
      },
      gradingStatus: "pending_manual",
    });
    const attRepo = makeAttemptRepo(attempt);
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-text", {
        gradingMode: "manual",
        status: "pending_manual",
        maxScore: 60,
        earnedScore: null,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: null,
      }),
    ];
    const { repo, created } = makeWorksetRepo(existing);

    const result = await submitAttempt(attRepo, repo, "attempt-1", NOW);

    expect(result.status).toBe("submitted");
    expect(created).toHaveLength(0);
  });

  it("completed manual progress: idempotent re-entry passes validation", async () => {
    const attempt = makeAttempt({
      status: "graded",
      questionSnapshot: [textResponseSnapshot("q-text", 60)],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-text", value: "ans" }],
      },
      gradingStatus: "fully_graded",
    });
    const attRepo = makeAttemptRepo(attempt);
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-text", {
        gradingMode: "manual",
        status: "completed_manual",
        maxScore: 60,
        earnedScore: 30,
        candidateAnswer: "ans",
        standardAnswer: null,
        correct: null,
        comment: "good effort",
        gradedBy: "grader-1",
        gradedAt: NOW,
      }),
    ];
    const { repo, created } = makeWorksetRepo(existing);

    const result = await submitAttempt(attRepo, repo, "attempt-1", NOW);

    expect(result.status).toBe("graded");
    expect(created).toHaveLength(0);
  });

  it("fresh submit with pre-existing entries: fails closed", async () => {
    const attempt = makeAttempt({
      status: "in_progress",
      questionSnapshot: [objectiveSnapshot("q-obj", 40, "a")],
      answers: [{ questionId: "q-obj", answer: "a", version: 1, savedAt: NOW }],
    });
    const attRepo = makeAttemptRepo(attempt);
    const existing: StoredEntry[] = [
      makeEntry("attempt-1", "q-obj", {
        gradingMode: "auto",
        status: "completed_auto",
        maxScore: 40,
        earnedScore: 0,
      }),
    ];
    const { repo } = makeWorksetRepo(existing);

    await expect(
      submitAttempt(attRepo, repo, "attempt-1", NOW),
    ).rejects.toThrow(/before authoritative submission freeze/i);
  });
});
