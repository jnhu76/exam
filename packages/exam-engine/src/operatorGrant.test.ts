import { describe, expect, it, vi } from "vitest";
import type {
  AttemptInterruption,
  AttemptInterruptionEvent,
  AttemptTimeAdjustment,
  Exam,
  ExamAttempt,
  ExamEnrollment,
} from "@exam/domain";
import {
  AttemptDeadlineExceedsExamCloseError,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";
import { lockEnrollmentAndAttempt } from "./lockSeam.js";
import {
  grantAttemptTime,
  type GrantAttemptTimeInput,
  type GrantAttemptTimeResult,
} from "./operatorGrant.js";

const NOW = new Date("2026-01-01T01:00:00.000Z");
const DEADLINE = new Date("2026-01-01T02:00:00.000Z");
const EXAM_CLOSE = new Date("2026-01-01T03:00:00.000Z");
const ACTOR = "admin-1";
const OPERATION_ID = "11111111-1111-1111-1111-111111111111";

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Test",
    description: "",
    courseId: "course-1",
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date("2025-12-31T00:00:00Z"),
    closeAt: EXAM_CLOSE,
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [],
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
    maxAttempts: 10,
    interruptionTimePolicy: "operator_incident",
    interruptionGracePerIncidentSeconds: null,
    interruptionGracePerAttemptSeconds: null,
    createdAt: new Date("2025-12-31T00:00:00Z"),
    updatedAt: new Date("2025-12-31T00:00:00Z"),
    ...overrides,
  } as Exam;
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enr-1",
    candidateId: "cand-1",
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: new Date("2025-12-31T01:00:00Z"),
    deadlineAt: DEADLINE,
    lastActivityAt: NOW,
    interruptionTimingPolicySnapshot: {
      schemaVersion: 1,
      policy: "operator_incident",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    },
    createdAt: new Date("2025-12-31T00:00:00Z"),
    updatedAt: new Date("2025-12-31T00:00:00Z"),
    ...overrides,
  } as ExamAttempt;
}

function makeEnrollment(): ExamEnrollment {
  return {
    id: "enr-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "cand-1",
    status: "started",
    attemptCount: 1,
    createdAt: new Date("2025-12-31T00:00:00Z"),
    updatedAt: new Date("2025-12-31T00:00:00Z"),
  } as unknown as ExamEnrollment;
}

function baseInput(
  overrides: Partial<GrantAttemptTimeInput> = {},
): GrantAttemptTimeInput {
  return {
    attemptId: "attempt-1",
    operationId: OPERATION_ID,
    addedSeconds: 600,
    reasonCode: "operator_grant",
    reasonText: "network incident",
    interruptionId: null,
    incidentId: null,
    actorId: ACTOR,
    now: NOW,
    ...overrides,
  };
}

interface MockContext {
  examRepo: ExamRepository;
  attemptRepo: AttemptRepository;
  enrollmentRepo: EnrollmentRepository;
  episodeRepo: InterruptionEpisodeRepository;
  eventRepo: InterruptionEventRepository;
  adjustmentRepo: TimeAdjustmentRepository;
  gradingWorksetRepo: GradingWorksetRepository;
  insertedAdjustments: InsertedAdjustmentInput[];
  attemptUpdates: Record<string, unknown>[];
  insertedEvents: unknown[];
}

type InsertedAdjustmentInput = Parameters<
  TimeAdjustmentRepository["insert"]
>[0];

function setupMocks(opts: {
  attempt?: ExamAttempt;
  exam?: Exam;
  enrollment?: ExamEnrollment;
  existingOperationAdjustment?: AttemptTimeAdjustment | null;
  episode?: AttemptInterruption | null;
  detected?: AttemptInterruptionEvent | null;
}): MockContext {
  const attempt = opts.attempt ?? makeAttempt();
  const exam = opts.exam ?? makeExam();
  const enrollment = opts.enrollment ?? makeEnrollment();
  const insertedAdjustments: InsertedAdjustmentInput[] = [];
  const attemptUpdates: Record<string, unknown>[] = [];
  const insertedEvents: unknown[] = [];

  // The attempt is mutable: each update mutates the in-memory row so the
  // re-read after update reflects the new deadline.
  let currentAttempt: ExamAttempt = { ...attempt };

  const examRepo = {
    findById: async () => exam,
    findByIdForUpdate: async () => exam,
    update: async () => exam,
  } as unknown as ExamRepository;

  const attemptRepo = {
    findById: async () => currentAttempt,
    findByIdForUpdate: async () => currentAttempt,
    findActiveByEnrollment: async () => currentAttempt,
    update: async (_id: string, data: Partial<ExamAttempt>) => {
      attemptUpdates.push(data);
      currentAttempt = { ...currentAttempt, ...data };
      return currentAttempt;
    },
    create: async () => currentAttempt,
    refreshLastActivityIfInProgress: async () => currentAttempt,
    findByEnrollmentAndAttemptNo: async () => null,
    listInProgress: async () => [],
  } as unknown as AttemptRepository;

  const enrollmentRepo = {
    findByExamAndCandidate: async () => enrollment,
    findByExamAndCandidateForUpdate: async () => enrollment,
    create: async () => enrollment,
    update: async () => enrollment,
  } as unknown as EnrollmentRepository;

  const episodeRepo: InterruptionEpisodeRepository = {
    create: async () => ({
      id: "ep-1",
      organizationId: "org-1",
      attemptId: "attempt-1",
      createdAt: NOW,
    }),
    findById: async () => opts.episode ?? null,
    findByAttemptForUpdate: async (
      _attemptId: string,
      _interruptionId: string,
    ) => opts.episode ?? null,
    findLatestByAttempt: async () => opts.episode ?? null,
  };

  const eventRepo: InterruptionEventRepository = {
    insert: async (input) => {
      insertedEvents.push(input);
      return { id: "ev-new", ...input } as never;
    },
    findDetected: async () => opts.detected ?? null,
    findOutcome: async () => null,
    findLatestOutcomeByAttempt: async () => null,
  };

  const adjustmentRepo: TimeAdjustmentRepository = {
    insert: async (input: InsertedAdjustmentInput) => {
      insertedAdjustments.push(input);
      return {
        id: "adj-new",
        organizationId: "org-1",
        createdAt: NOW,
        ...input,
      } as never;
    },
    findById: async () => null,
    findByOperationId: async () => opts.existingOperationAdjustment ?? null,
    findBoundedByInterruption: async () => null,
    sumBoundedGraceSeconds: async () => 0,
  };

  const gradingWorksetRepo: GradingWorksetRepository = {
    findByAttempt: async () => [],
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };

  return {
    examRepo,
    attemptRepo,
    enrollmentRepo,
    episodeRepo,
    eventRepo,
    adjustmentRepo,
    gradingWorksetRepo,
    insertedAdjustments,
    attemptUpdates,
    insertedEvents,
  };
}

async function mintCapability(ctx: MockContext) {
  return lockEnrollmentAndAttempt(
    ctx.enrollmentRepo,
    ctx.attemptRepo,
    "attempt-1",
  );
}

async function runGrant(
  ctx: MockContext,
  input: GrantAttemptTimeInput,
): Promise<GrantAttemptTimeResult> {
  const capability = await mintCapability(ctx);
  return grantAttemptTime(
    ctx.examRepo,
    ctx.attemptRepo,
    ctx.enrollmentRepo,
    ctx.episodeRepo,
    ctx.eventRepo,
    ctx.adjustmentRepo,
    ctx.gradingWorksetRepo,
    capability,
    input,
  );
}

describe("grantAttemptTime", () => {
  describe("happy path", () => {
    it("in_progress attempt: inserts operator ledger row, updates deadline, returns granted", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
      });
      const result = await runGrant(ctx, baseInput());

      expect(result.outcome).toBe("granted");
      expect(result.addedSeconds).toBe(600);
      expect(result.adjustment).not.toBeNull();
      expect(result.adjustment!.id).toBe("adj-new");

      // Ledger row shape
      expect(ctx.insertedAdjustments).toHaveLength(1);
      const row = ctx.insertedAdjustments[0]!;
      expect(row.operationId).toBe(OPERATION_ID);
      expect(row.attemptId).toBe("attempt-1");
      expect(row.source).toBe("operator");
      expect(row.policy).toBe("operator_incident");
      expect(row.interruptionId).toBeNull();
      expect(row.incidentId).toBeNull();
      expect(row.eligibleSeconds).toBeNull();
      expect(row.actorId).toBe(ACTOR);
      expect(row.reasonCode).toBe("operator_grant");
      expect(row.reasonText).toBe("network incident");
      expect(row.addedSeconds).toBe(600);
      expect(row.beforeDeadline.getTime()).toBe(DEADLINE.getTime());
      expect(row.afterDeadline.getTime()).toBe(DEADLINE.getTime() + 600_000);

      // Deadline updated to afterDeadline
      expect(ctx.attemptUpdates).toHaveLength(1);
      expect((ctx.attemptUpdates[0]!.deadlineAt as Date).getTime()).toBe(
        DEADLINE.getTime() + 600_000,
      );

      // Returned attempt reflects the new deadline
      expect(result.attempt.deadlineAt!.getTime()).toBe(
        DEADLINE.getTime() + 600_000,
      );
    });

    it("disrupted attempt: updates deadline but does NOT auto-restore to in_progress", async () => {
      const ctx = setupMocks({ attempt: makeAttempt({ status: "disrupted" }) });
      const result = await runGrant(ctx, baseInput());

      expect(result.outcome).toBe("granted");
      expect(result.addedSeconds).toBe(600);

      // Deadline was updated
      const deadlineUpdate = ctx.attemptUpdates.find((u) => "deadlineAt" in u);
      expect(deadlineUpdate).toBeDefined();
      expect((deadlineUpdate!.deadlineAt as Date).getTime()).toBe(
        DEADLINE.getTime() + 600_000,
      );

      // No status mutation to in_progress, no lastActivityAt change
      const statusChange = ctx.attemptUpdates.find((u) => "status" in u);
      expect(statusChange).toBeUndefined();

      // Returned attempt remains disrupted
      expect(result.attempt.status).toBe("disrupted");
    });
  });

  describe("terminal attempts", () => {
    it.each(["submitted", "grading", "graded", "voided"] as const)(
      "%s attempt: reconcile returns terminal, no ledger, no deadline update, outcome terminal",
      async (status) => {
        const ctx = setupMocks({
          attempt: makeAttempt({ status }),
        });
        const result = await runGrant(ctx, baseInput());

        expect(result.outcome).toBe("terminal");
        expect(result.adjustment).toBeNull();
        expect(result.addedSeconds).toBe(0);
        expect(ctx.insertedAdjustments).toHaveLength(0);
        expect(
          ctx.attemptUpdates.filter((u) => "deadlineAt" in u),
        ).toHaveLength(0);
      },
    );
  });

  describe("expired attempts reconcile to terminal, no grant", () => {
    it("expired in_progress: reconcile terminalizes via mode none, outcome terminal", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({
          status: "in_progress",
          deadlineAt: new Date("2026-01-01T00:30:00Z"), // before NOW
        }),
      });
      const result = await runGrant(ctx, baseInput());

      expect(result.outcome).toBe("terminal");
      expect(result.addedSeconds).toBe(0);
      expect(result.adjustment).toBeNull();
      expect(ctx.insertedAdjustments).toHaveLength(0);
    });

    it("expired disrupted: reconcile terminalizes via mode active_interruption, appends terminalized event, no grant", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({
          status: "disrupted",
          deadlineAt: new Date("2026-01-01T00:30:00Z"), // before NOW
          currentInterruptionId: "ep-1",
          interruptedAt: new Date("2026-01-01T00:10:00Z"),
        }),
        episode: {
          id: "ep-1",
          organizationId: "org-1",
          attemptId: "attempt-1",
          createdAt: new Date("2026-01-01T00:10:00Z"),
        },
        // The terminalization path requires a detected event for the
        // active interruption (resolveActiveInterruptionOnTerminalization
        // validates episode identity against the detected event).
        detected: {
          id: "ev-det-ep-1",
          organizationId: "org-1",
          attemptId: "attempt-1",
          interruptionId: "ep-1",
          eventType: "detected",
          occurredAt: new Date("2026-01-01T00:10:00Z"),
          observedLastActivityAt: new Date("2026-01-01T00:08:00Z"),
          detectionSource: "heartbeat_timeout",
          timeoutSeconds: 120,
          policy: "operator_incident",
          eligibleSeconds: null,
          timeAdjustmentId: null,
          actorId: null,
          reasonCode: "heartbeat_timeout",
          createdAt: new Date("2026-01-01T00:10:00Z"),
        },
      });
      const result = await runGrant(ctx, baseInput());

      expect(result.outcome).toBe("terminal");
      expect(result.addedSeconds).toBe(0);
      expect(result.adjustment).toBeNull();
      expect(ctx.insertedAdjustments).toHaveLength(0);

      // A terminalized event was appended (disrupted + expired path).
      const terminalized = ctx.insertedEvents.find(
        (e: any) => e.eventType === "terminalized",
      ) as any;
      expect(terminalized).toBeDefined();
    });
  });

  describe("exam.closeAt enforcement", () => {
    it("afterDeadline > exam.closeAt: rejects with AttemptDeadlineExceedsExamCloseError, no ledger, no deadline change", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress", deadlineAt: EXAM_CLOSE }),
      });
      // addedSeconds pushes afterDeadline past exam.closeAt
      await expect(
        runGrant(ctx, baseInput({ addedSeconds: 60 })),
      ).rejects.toThrow(AttemptDeadlineExceedsExamCloseError);
      expect(ctx.insertedAdjustments).toHaveLength(0);
      expect(ctx.attemptUpdates.filter((u) => "deadlineAt" in u)).toHaveLength(
        0,
      );
    });
  });

  describe("idempotency", () => {
    it("same operationId + same payload: returns the committed adjustment, exactly one ledger row, no second grant", async () => {
      const existing: AttemptTimeAdjustment = {
        id: "adj-existing",
        operationId: OPERATION_ID,
        organizationId: "org-1",
        attemptId: "attempt-1",
        interruptionId: null,
        incidentId: null,
        policy: "operator_incident",
        source: "operator",
        beforeDeadline: DEADLINE,
        afterDeadline: new Date(DEADLINE.getTime() + 600_000),
        addedSeconds: 600,
        eligibleSeconds: null,
        reasonCode: "operator_grant",
        reasonText: "network incident",
        actorId: ACTOR,
        createdAt: NOW,
      };
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
        existingOperationAdjustment: existing,
      });
      const result = await runGrant(ctx, baseInput());

      expect(result.outcome).toBe("idempotent_replay");
      expect(result.adjustment!.id).toBe("adj-existing");
      expect(result.addedSeconds).toBe(600);
      // No new insert, no new deadline update
      expect(ctx.insertedAdjustments).toHaveLength(0);
      expect(ctx.attemptUpdates.filter((u) => "deadlineAt" in u)).toHaveLength(
        0,
      );
    });

    it.each([
      ["addedSeconds", { addedSeconds: 1200 }],
      ["reasonCode", { reasonCode: "different_reason" }],
      ["reasonText", { reasonText: "different reason text" }],
      ["actorId", { actorId: "admin-2" }],
    ] as const)(
      "same operationId + different %s: throws IdempotencyConflictError, no insert, no deadline change",
      async (_label, override) => {
        const existing: AttemptTimeAdjustment = {
          id: "adj-existing",
          operationId: OPERATION_ID,
          organizationId: "org-1",
          attemptId: "attempt-1",
          interruptionId: null,
          incidentId: null,
          policy: "operator_incident",
          source: "operator",
          beforeDeadline: DEADLINE,
          afterDeadline: new Date(DEADLINE.getTime() + 600_000),
          addedSeconds: 600,
          eligibleSeconds: null,
          reasonCode: "operator_grant",
          reasonText: "network incident",
          actorId: ACTOR,
          createdAt: NOW,
        };
        const ctx = setupMocks({
          attempt: makeAttempt({ status: "in_progress" }),
          existingOperationAdjustment: existing,
        });
        await expect(runGrant(ctx, baseInput(override))).rejects.toThrow(
          IdempotencyConflictError,
        );
        expect(ctx.insertedAdjustments).toHaveLength(0);
        expect(
          ctx.attemptUpdates.filter((u) => "deadlineAt" in u),
        ).toHaveLength(0);
      },
    );

    it("reason canonicalization: leading/trailing whitespace retry is the same payload (idempotent_replay)", async () => {
      const existing: AttemptTimeAdjustment = {
        id: "adj-existing",
        operationId: OPERATION_ID,
        organizationId: "org-1",
        attemptId: "attempt-1",
        interruptionId: null,
        incidentId: null,
        policy: "operator_incident",
        source: "operator",
        beforeDeadline: DEADLINE,
        afterDeadline: new Date(DEADLINE.getTime() + 600_000),
        addedSeconds: 600,
        eligibleSeconds: null,
        reasonCode: "operator_grant",
        // committed value already trimmed
        reasonText: "network incident",
        actorId: ACTOR,
        createdAt: NOW,
      };
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
        existingOperationAdjustment: existing,
      });
      // Retry with surrounding whitespace — must canonicalize to the same payload.
      const result = await runGrant(
        ctx,
        baseInput({
          reasonText: "  network incident  ",
          reasonCode: "  operator_grant  ",
        }),
      );
      expect(result.outcome).toBe("idempotent_replay");
      expect(result.adjustment!.id).toBe("adj-existing");
    });
  });

  describe("interruptionId ownership", () => {
    it("interruptionId whose episode does not belong to the attempt: fails closed, no insert, no deadline change", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
        episode: null, // findByAttemptForUpdate returns null
      });
      await expect(
        runGrant(
          ctx,
          baseInput({ interruptionId: "99999999-9999-9999-9999-999999999999" }),
        ),
      ).rejects.toThrow(ValidationError);
      expect(ctx.insertedAdjustments).toHaveLength(0);
      expect(ctx.attemptUpdates.filter((u) => "deadlineAt" in u)).toHaveLength(
        0,
      );
    });

    it("historical episode (pointer cleared, no bounded ledger) is still referenceable", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({
          status: "in_progress",
          currentInterruptionId: null, // pointer cleared after a prior restore
          interruptedAt: null,
        }),
        episode: {
          id: "ep-historical",
          organizationId: "org-1",
          attemptId: "attempt-1",
          createdAt: new Date("2025-12-31T05:00:00Z"),
        },
      });
      const result = await runGrant(
        ctx,
        baseInput({ interruptionId: "ep-historical" }),
      );
      expect(result.outcome).toBe("granted");
      expect(ctx.insertedAdjustments[0]!.interruptionId).toBe("ep-historical");
    });
  });

  describe("operator_incident policy guard", () => {
    it("missing interruptionTimingPolicySnapshot: fails closed", async () => {
      const base = makeAttempt({ status: "in_progress" });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { interruptionTimingPolicySnapshot: _, ...rest } = base;
      const ctx = setupMocks({ attempt: rest as ExamAttempt });
      await expect(runGrant(ctx, baseInput())).rejects.toThrow(ValidationError);
      expect(ctx.insertedAdjustments).toHaveLength(0);
    });

    it.each(["strict", "bounded_grace"] as const)(
      "attempt policy %s (not operator_incident): rejected with InvalidStateTransitionError",
      async (policy) => {
        const ctx = setupMocks({
          attempt: makeAttempt({
            status: "in_progress",
            interruptionTimingPolicySnapshot: {
              schemaVersion: 1,
              policy,
              perIncidentCapSeconds: policy === "bounded_grace" ? 300 : null,
              perAttemptAggregateCapSeconds:
                policy === "bounded_grace" ? 600 : null,
            },
          }),
        });
        await expect(runGrant(ctx, baseInput())).rejects.toThrow(
          InvalidStateTransitionError,
        );
        expect(ctx.insertedAdjustments).toHaveLength(0);
      },
    );
  });

  describe("atomicity sequencing (transaction rollback owned by B2/V1)", () => {
    it("ledger insert throws: attemptRepo.update never called, deadline unchanged", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
      });
      const updateSpy = vi.spyOn(ctx.attemptRepo, "update");
      // Make insert throw after spy capture.
      ctx.adjustmentRepo.insert = async () => {
        throw new Error("DB insert failure");
      };
      await expect(runGrant(ctx, baseInput())).rejects.toThrow(
        "DB insert failure",
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("deadline update throws: command propagates the error (does not swallow)", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
      });
      const insertSpy = vi.spyOn(ctx.adjustmentRepo, "insert");
      vi.spyOn(ctx.attemptRepo, "update").mockRejectedValue(
        new Error("DB update failure"),
      );
      await expect(runGrant(ctx, baseInput())).rejects.toThrow(
        "DB update failure",
      );
      // insert was reached (proves insert-before-update sequencing).
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("capability affinity", () => {
    it("assertCapabilityFor rejects before any read/write when repos differ", async () => {
      const ctx = setupMocks({
        attempt: makeAttempt({ status: "in_progress" }),
      });
      // Mint with the real repos, then pass DIFFERENT repo objects to grantAttemptTime.
      const capability = await lockEnrollmentAndAttempt(
        ctx.enrollmentRepo,
        ctx.attemptRepo,
        "attempt-1",
      );
      const otherAttemptRepo = {
        ...ctx.attemptRepo,
      } as unknown as AttemptRepository;
      await expect(
        grantAttemptTime(
          ctx.examRepo,
          otherAttemptRepo,
          ctx.enrollmentRepo,
          ctx.episodeRepo,
          ctx.eventRepo,
          ctx.adjustmentRepo,
          ctx.gradingWorksetRepo,
          capability,
          baseInput(),
        ),
      ).rejects.toThrow(/affinity/i);
      expect(ctx.insertedAdjustments).toHaveLength(0);
    });
  });

  describe("input validation", () => {
    it("operationId must be a valid UUID", async () => {
      const ctx = setupMocks({});
      await expect(
        runGrant(ctx, baseInput({ operationId: "not-a-uuid" })),
      ).rejects.toThrow(ValidationError);
    });

    it("addedSeconds must be a positive integer", async () => {
      const ctx = setupMocks({});
      await expect(
        runGrant(ctx, baseInput({ addedSeconds: 0 })),
      ).rejects.toThrow(ValidationError);
      await expect(
        runGrant(ctx, baseInput({ addedSeconds: 10.5 })),
      ).rejects.toThrow(ValidationError);
    });

    it("addedSeconds must not exceed PostgreSQL integer bound", async () => {
      const ctx = setupMocks({});
      await expect(
        runGrant(ctx, baseInput({ addedSeconds: 3_000_000_000 })),
      ).rejects.toThrow(ValidationError);
    });

    it("reasonCode must be non-empty and bounded", async () => {
      const ctx = setupMocks({});
      await expect(
        runGrant(ctx, baseInput({ reasonCode: "   " })),
      ).rejects.toThrow(ValidationError);
      await expect(
        runGrant(ctx, baseInput({ reasonCode: "x".repeat(101) })),
      ).rejects.toThrow(ValidationError);
    });

    it("reasonText must be non-empty and bounded", async () => {
      const ctx = setupMocks({});
      await expect(
        runGrant(ctx, baseInput({ reasonText: "   " })),
      ).rejects.toThrow(ValidationError);
    });

    it("incidentId must be null (reserved for REC-I6)", async () => {
      const ctx = setupMocks({});
      await expect(
        runGrant(
          ctx,
          baseInput({
            incidentId: "22222222-2222-2222-2222-222222222222",
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("not found", () => {
    it("attempt missing under lock: NotFoundError", async () => {
      const ctx = setupMocks({});
      ctx.attemptRepo.findByIdForUpdate = async () => null;
      ctx.attemptRepo.findById = async () => null;
      await expect(runGrant(ctx, baseInput())).rejects.toThrow(NotFoundError);
    });
  });
});
