import { describe, expect, it } from "vitest";
import {
  publishExam,
  unpublishExam,
  type ExamRepository,
} from "./examCommands.js";
import type { Exam, Question } from "@exam/domain";
import {
  MINIMAL_PRODUCT_CONFIGURATION,
  STANDARD_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
  ValidationError,
  plainTextProjection,
  resolveDeploymentProductConfiguration,
  type ProductCapabilityId,
  type ResolvedProductConfiguration,
} from "@exam/domain";

/**
 * W2c.1 counterexamples (ADR-022 Phase 2 #678 / #669 umbrella sibling):
 * publish is the freeze gate for NEW product commitments, so it must judge
 * the CURRENT question material — the rows re-read inside the publish
 * transaction — against the deployment's resolved product ceiling BEFORE any
 * snapshot is materialized (product-capability-composition.md §6/§7 layer 4,
 * §14 Phase 2 gate; EXSEM-004 re-acceptance).
 *
 * Target contract under test (implementation step lands the guard):
 *
 *   publishExam(repo, examId, questions, deployment: ResolvedProductConfiguration)
 *
 * The 4th parameter is REQUIRED by design: an optional parameter could not
 * distinguish "guard missing" from "guard present but unwired", which is
 * exactly the bypass this gate exists to close. Until the guard lands, every
 * RED case below fails because publish SUCCEEDS where the ceiling forbids a
 * new commitment.
 *
 * Derivation authority is W2a's `deriveQuestionRequiredCapabilities` (final
 * frozen material only; `grading.manual` is a resolver dependency, not a
 * material property — questionCapabilityDerivation.ts ownership note). These
 * tests judge the derivation through publishExam's behavior, not by
 * re-implementing it.
 *
 * Channels covered here converge on one engine seam, so no per-channel guard
 * may exist: a historical draft (E1-E4), unpublish-then-republish (E5,
 * EXSEM-004: the retained snapshot is non-authoritative residue), and the
 * behavior-equivalent Standard baseline (E6).
 */

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
    syncStartedAt: null,
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
    contentDocument: null,
    answerMode: null,
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
    rubric: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const RICH_DOC = {
  docVersion: 1 as const,
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [
        { type: "text" as const, text: "Solve ", marks: ["bold" as const] },
        { type: "inlineMath" as const, latex: "x^2-1=0" },
      ],
    },
  ],
};

function makeRichDoc() {
  return RICH_DOC;
}

/**
 * Exam repository fake that also records every mutation, so the
 * fail-closed invariant (a ceiling rejection writes NOTHING — no half
 * snapshot, no status change) is observable at the repository boundary.
 */
function makeRepo(initial: Exam): ExamRepository & {
  readonly updateCalls: number;
} {
  let current = { ...initial };
  let updateCalls = 0;
  return {
    findById(id: string) {
      return id === current.id ? current : null;
    },
    findByIdForUpdate(id: string) {
      return id === current.id ? current : null;
    },
    findByIdForShare(id: string) {
      return id === current.id ? current : null;
    },
    update(_id: string, data: Partial<Exam>) {
      updateCalls += 1;
      current = { ...current, ...data };
      return current;
    },
    get updateCalls() {
      return updateCalls;
    },
  };
}

/** Single-question draft whose totalScore matches the question (publish preconditions). */
function publishRepo(question: Question) {
  return makeRepo(
    makeExam({
      questionIds: [question.id],
      totalScore: question.score,
      passingScore: 0,
    }),
  );
}

/** The full Standard ceiling, resolved through the canonical Phase 2 resolver. */
function resolvedStandard(): ResolvedProductConfiguration {
  return resolveDeploymentProductConfiguration(STANDARD_PRODUCT_CONFIGURATION);
}

/** The shipped Minimal preset, resolved through the same resolver authority. */
function resolvedMinimal(): ResolvedProductConfiguration {
  return resolveDeploymentProductConfiguration(MINIMAL_PRODUCT_CONFIGURATION);
}

/** Standard minus exactly the listed capabilities (controlled bounded ceiling). */
function boundedWithout(
  disabled: readonly ProductCapabilityId[],
): ResolvedProductConfiguration {
  return resolveDeploymentProductConfiguration({
    preset: "standard",
    revision: 1,
    presentation: "standard",
    enabled: SUPPORTED_PRODUCT_CAPABILITIES.filter(
      (capability) => !disabled.includes(capability),
    ),
  });
}

async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** RED helper: narrows the captured rejection or fails naming what happened. */
function expectValidationError(rejection: unknown): ValidationError {
  if (!(rejection instanceof ValidationError)) {
    throw new Error(
      `expected ValidationError (capability ceiling rejection), got: ${String(rejection)} — publish went through without consulting the deployment ceiling`,
    );
  }
  return rejection;
}

describe("publishExam capability ceiling (W2c.1 #678)", () => {
  it("RED: rejects a historical rich-prompt draft when content.prompt.rich is disabled, writing nothing", async () => {
    const doc = makeRichDoc();
    const question = makeQuestion("q1", {
      contentDocument: doc,
      content: plainTextProjection(doc),
    });
    const repo = publishRepo(question);

    const rejection = await captureRejection(() =>
      publishExam(
        repo,
        "exam-1",
        [question],
        boundedWithout(["content.prompt.rich"]),
      ),
    );
    const error = expectValidationError(rejection);
    expect(error.message).toContain("content.prompt.rich");

    // Fail-closed structure: the ceiling is judged before the freeze, so a
    // rejected publish leaves the exam row untouched — draft, no snapshot.
    expect(repo.updateCalls).toBe(0);
    const after = repo.findById("exam-1") as Exam;
    expect(after.status).toBe("draft");
    expect(after.questionSnapshot).toEqual([]);
  });

  it("RED: rejects a historical rich-option draft when content.option.rich is disabled, writing nothing", async () => {
    const doc = makeRichDoc();
    const question = makeQuestion("q1", {
      options: [
        { id: "a", content: "0" },
        { id: "b", content: plainTextProjection(doc), contentDocument: doc },
      ],
    });
    const repo = publishRepo(question);

    const rejection = await captureRejection(() =>
      publishExam(
        repo,
        "exam-1",
        [question],
        boundedWithout(["content.option.rich"]),
      ),
    );
    const error = expectValidationError(rejection);
    expect(error.message).toContain("content.option.rich");

    expect(repo.updateCalls).toBe(0);
    const after = repo.findById("exam-1") as Exam;
    expect(after.status).toBe("draft");
    expect(after.questionSnapshot).toEqual([]);
  });

  it("RED: rejects a historical rich-answer draft when answer.text.rich is disabled, writing nothing", async () => {
    const question = makeQuestion("q1", {
      type: "text_response",
      contentDocument: null,
      answerMode: "rich",
      options: [],
      standardAnswer: null,
      rubric: "按步骤给分",
    });
    const repo = publishRepo(question);

    const rejection = await captureRejection(() =>
      publishExam(
        repo,
        "exam-1",
        [question],
        boundedWithout(["answer.text.rich"]),
      ),
    );
    const error = expectValidationError(rejection);
    expect(error.message).toContain("answer.text.rich");

    expect(repo.updateCalls).toBe(0);
    const after = repo.findById("exam-1") as Exam;
    expect(after.status).toBe("draft");
    expect(after.questionSnapshot).toEqual([]);
  });

  it("RED: rejects a plain subjective draft when question.text_response is disabled (type ceiling), writing nothing", async () => {
    const question = makeQuestion("q1", {
      type: "text_response",
      options: [],
      standardAnswer: null,
      rubric: "按要点给分",
    });
    const repo = publishRepo(question);

    const rejection = await captureRejection(() =>
      publishExam(
        repo,
        "exam-1",
        [question],
        boundedWithout(["question.text_response"]),
      ),
    );
    const error = expectValidationError(rejection);
    expect(error.message).toContain("question.text_response");

    expect(repo.updateCalls).toBe(0);
    const after = repo.findById("exam-1") as Exam;
    expect(after.status).toBe("draft");
    expect(after.questionSnapshot).toEqual([]);
  });

  it("RED: rejects a republish under a lowered ceiling — EXSEM-004 residue never bypasses re-acceptance", async () => {
    const doc = makeRichDoc();
    const question = makeQuestion("q1", {
      contentDocument: doc,
      content: plainTextProjection(doc),
    });
    const repo = publishRepo(question);

    // First publish is legal under full Standard and freezes the snapshot.
    const published = await publishExam(
      repo,
      "exam-1",
      [question],
      resolvedStandard(),
    );
    expect(published.status).toBe("published");
    const residue = published.questionSnapshot;

    // Legal withdrawal restores draft author authority; the retained
    // snapshot is non-authoritative residue (EXSEM-004).
    const draft = await unpublishExam(repo, "exam-1");
    expect(draft.status).toBe("draft");

    // Republish must re-judge CURRENT material against the CURRENT ceiling:
    // the deployment no longer admits content.prompt.rich, so the republish
    // creates an unsupported new commitment and must fail closed.
    const callsBeforeRepublish = repo.updateCalls;
    const rejection = await captureRejection(() =>
      publishExam(
        repo,
        "exam-1",
        [question],
        boundedWithout(["content.prompt.rich"]),
      ),
    );
    const error = expectValidationError(rejection);
    expect(error.message).toContain("content.prompt.rich");

    expect(repo.updateCalls).toBe(callsBeforeRepublish);
    const after = repo.findById("exam-1") as Exam;
    expect(after.status).toBe("draft");
    // Residue is untouched by the rejected republish (still the old freeze).
    expect(after.questionSnapshot).toEqual(residue);
  });

  it("RED: rejects a queue-required draft under the Minimal preset, writing nothing", async () => {
    // #678 review: the publish gate must judge the exam's OWN admission
    // policy, not only question material — a draft whose questions are all
    // inside Minimal's three types but whose controlFlags freeze a queue
    // admission path is a NEW admission.queue commitment the Minimal
    // ceiling does not admit.
    const question = makeQuestion("q1", { type: "true_false" });
    const repo = makeRepo(
      makeExam({
        questionIds: [question.id],
        totalScore: question.score,
        passingScore: 0,
        controlFlags: {
          ...makeExam().controlFlags,
          requireQueue: true,
        },
      }),
    );

    const rejection = await captureRejection(() =>
      publishExam(repo, "exam-1", [question], resolvedMinimal()),
    );
    const error = expectValidationError(rejection);
    expect(error.message).toContain("admission.queue");

    expect(repo.updateCalls).toBe(0);
    const after = repo.findById("exam-1") as Exam;
    expect(after.status).toBe("draft");
    expect(after.questionSnapshot).toEqual([]);
  });

  it("publishes the same queue-required draft under the full Standard ceiling (behavior equivalence)", async () => {
    const question = makeQuestion("q1", { type: "true_false" });
    const repo = makeRepo(
      makeExam({
        questionIds: [question.id],
        totalScore: question.score,
        passingScore: 0,
        controlFlags: {
          ...makeExam().controlFlags,
          requireQueue: true,
        },
      }),
    );

    const published = await publishExam(
      repo,
      "exam-1",
      [question],
      resolvedStandard(),
    );
    expect(published.status).toBe("published");
    expect(published.questionSnapshot).toHaveLength(1);
  });

  it("publishes the same rich material under the full Standard ceiling (behavior equivalence)", async () => {
    const doc = makeRichDoc();
    const question = makeQuestion("q1", {
      contentDocument: doc,
      content: plainTextProjection(doc),
    });
    const repo = publishRepo(question);

    const published = await publishExam(
      repo,
      "exam-1",
      [question],
      resolvedStandard(),
    );
    expect(published.status).toBe("published");
    expect(published.questionSnapshot).toHaveLength(1);
    expect(published.questionSnapshot[0]?.contentDocument).toEqual(doc);
    expect(published.questionSnapshot[0]?.content).toBe(
      plainTextProjection(doc),
    );
  });
});
