import { describe, expect, it, vi } from "vitest";
import type {
  AttemptInterruption,
  AttemptInterruptionEvent,
  AttemptTimeAdjustment,
  Exam,
  ExamAttempt,
  ExamEnrollment,
} from "@exam/domain";
import { ValidationError } from "@exam/domain";
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
  restoreInterruptedAttempt,
  type RestoreInterruptionResult,
} from "./restoreInterruption.js";

const NOW = new Date("2026-01-01T01:00:00.000Z");
const DETECTED_AT = new Date("2026-01-01T00:50:00.000Z");
const DEADLINE = new Date("2026-01-01T02:00:00.000Z");
const EXAM_CLOSE = new Date("2026-01-01T03:00:00.000Z");

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
    interruptionTimePolicy: "strict",
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
    status: "disrupted",
    questionSnapshot: [],
    answers: [],
    startedAt: new Date("2025-12-31T01:00:00Z"),
    deadlineAt: DEADLINE,
    lastActivityAt: new Date("2026-01-01T00:40:00Z"),
    interruptionTimingPolicySnapshot: {
      schemaVersion: 1,
      policy: "strict",
      perIncidentCapSeconds: null,
      perAttemptAggregateCapSeconds: null,
    },
    currentInterruptionId: "ep-1",
    interruptedAt: DETECTED_AT,
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

function makeEpisode(
  overrides: Partial<AttemptInterruption> = {},
): AttemptInterruption {
  return {
    id: "ep-1",
    organizationId: "org-1",
    attemptId: "attempt-1",
    createdAt: DETECTED_AT,
    ...overrides,
  } as AttemptInterruption;
}

function makeDetectedEvent(
  overrides: Partial<AttemptInterruptionEvent> = {},
): AttemptInterruptionEvent {
  return {
    id: "ev-det-1",
    organizationId: "org-1",
    attemptId: "attempt-1",
    interruptionId: "ep-1",
    eventType: "detected",
    occurredAt: DETECTED_AT,
    observedLastActivityAt: new Date("2026-01-01T00:40:00Z"),
    detectionSource: "heartbeat_timeout",
    timeoutSeconds: 60,
    policy: "strict",
    eligibleSeconds: null,
    timeAdjustmentId: null,
    actorId: null,
    reasonCode: "heartbeat_timeout",
    createdAt: DETECTED_AT,
    ...overrides,
  } as AttemptInterruptionEvent;
}

function makeOutcomeEvent(
  eventType: "restored" | "terminalized",
  overrides: Partial<AttemptInterruptionEvent> = {},
): AttemptInterruptionEvent {
  return {
    id: `ev-out-${eventType}`,
    organizationId: "org-1",
    attemptId: "attempt-1",
    interruptionId: "ep-1",
    eventType,
    occurredAt: NOW,
    observedLastActivityAt: null,
    detectionSource: null,
    timeoutSeconds: null,
    policy: "strict",
    eligibleSeconds: null,
    timeAdjustmentId: null,
    actorId: null,
    reasonCode: "strict_zero_grant",
    createdAt: NOW,
    ...overrides,
  } as AttemptInterruptionEvent;
}

interface MockContext {
  examRepo: ExamRepository;
  attemptRepo: AttemptRepository;
  enrollmentRepo: EnrollmentRepository;
  episodeRepo: InterruptionEpisodeRepository;
  eventRepo: InterruptionEventRepository;
  adjustmentRepo: TimeAdjustmentRepository;
  gradingWorksetRepo: GradingWorksetRepository;
  insertedEvents: unknown[];
  insertedAdjustments: unknown[];
  attemptUpdates: Record<string, unknown>[];
}

function setupMocks(opts: {
  attempt?: ExamAttempt;
  exam?: Exam;
  enrollment?: ExamEnrollment;
  episode?: AttemptInterruption | null;
  detected?: AttemptInterruptionEvent | null;
  outcome?: AttemptInterruptionEvent | null;
  latestOutcome?: AttemptInterruptionEvent | null;
  existingAdjustment?: AttemptTimeAdjustment | null;
  adjustmentById?: AttemptTimeAdjustment | null;
  sumBoundedGrace?: number;
  policyEvaluation?: {
    eligibleSeconds: number;
    addedSeconds: number;
    afterDeadline?: Date;
    reasonCode: string;
  };
}): MockContext {
  const attempt = opts.attempt ?? makeAttempt();
  const exam = opts.exam ?? makeExam();
  const enrollment = opts.enrollment ?? makeEnrollment();
  const insertedEvents: unknown[] = [];
  const insertedAdjustments: unknown[] = [];
  const attemptUpdates: Record<string, unknown>[] = [];

  const examRepo = {
    findById: async () => exam,
    findByIdForUpdate: async () => exam,
    update: async () => exam,
  } as unknown as ExamRepository;

  const attemptRepo = {
    findById: async () => attempt,
    findByIdForUpdate: async () => attempt,
    findActiveByEnrollment: async () => attempt,
    update: async (_id: string, data: Record<string, unknown>) => {
      attemptUpdates.push(data);
      return { ...attempt, ...data };
    },
    create: async () => attempt,
    listInProgress: async () => [attempt],
  } as unknown as AttemptRepository;

  const enrollmentRepo = {
    findByExamAndCandidateForUpdate: async () => enrollment,
    findById: async () => enrollment,
    update: async () => enrollment,
  } as unknown as EnrollmentRepository;

  const episodeRepo: InterruptionEpisodeRepository = {
    create: async () => makeEpisode(),
    findById: async () => opts.episode ?? makeEpisode(),
    findByAttemptForUpdate: async () =>
      opts.episode !== undefined ? opts.episode : makeEpisode(),
    findLatestByAttempt: async () =>
      opts.episode !== undefined ? opts.episode : makeEpisode(),
  };

  const eventRepo: InterruptionEventRepository = {
    insert: async (input) => {
      insertedEvents.push(input);
      return { id: "ev-new", ...input } as never;
    },
    findDetected: async () =>
      opts.detected !== undefined ? opts.detected : makeDetectedEvent(),
    findOutcome: async () => opts.outcome ?? null,
    findLatestOutcomeByAttempt: async () => opts.latestOutcome ?? null,
  };

  const adjustmentRepo: TimeAdjustmentRepository = {
    insert: async (input) => {
      insertedAdjustments.push(input);
      return { id: "adj-new", ...input } as never;
    },
    findById: async () => opts.adjustmentById ?? null,
    findBoundedByInterruption: async () => opts.existingAdjustment ?? null,
    sumBoundedGraceSeconds: async () => opts.sumBoundedGrace ?? 0,
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
    insertedEvents,
    insertedAdjustments,
    attemptUpdates,
  };
}

async function mintCapability(ctx: MockContext) {
  return lockEnrollmentAndAttempt(
    ctx.enrollmentRepo,
    ctx.attemptRepo,
    "attempt-1",
  );
}

async function runRestore(
  ctx: MockContext,
): Promise<RestoreInterruptionResult> {
  const capability = await mintCapability(ctx);
  return restoreInterruptedAttempt(
    ctx.examRepo,
    ctx.attemptRepo,
    ctx.enrollmentRepo,
    ctx.episodeRepo,
    ctx.eventRepo,
    ctx.adjustmentRepo,
    ctx.gradingWorksetRepo,
    capability,
    NOW,
  );
}

describe("restoreInterruptedAttempt", () => {
  describe("strict restore", () => {
    it("deadline unchanged, restored outcome inserted, pointer cleared, no adjustment", async () => {
      const ctx = setupMocks({});
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("restored");
      expect(result.compensation.policy).toBe("strict");
      expect(result.compensation.eligibleSeconds).toBe(0);
      expect(result.compensation.addedSeconds).toBe(0);
      expect(result.compensation.adjustmentId).toBeNull();
      expect(result.compensation.interruptionId).toBe("ep-1");

      const restoredEvent = ctx.insertedEvents.find(
        (e: any) => e.eventType === "restored",
      ) as any;
      expect(restoredEvent).toBeDefined();
      expect(restoredEvent.interruptionId).toBe("ep-1");
      expect(restoredEvent.policy).toBe("strict");
      expect(restoredEvent.timeAdjustmentId).toBeNull();

      expect(ctx.insertedAdjustments).toHaveLength(0);

      const pointerClear = ctx.attemptUpdates.find(
        (u) => u.currentInterruptionId === null,
      );
      expect(pointerClear).toBeDefined();
    });
  });

  describe("operator_incident restore", () => {
    it("deadline unchanged, restored outcome, no adjustment", async () => {
      const attempt = makeAttempt({
        interruptionTimingPolicySnapshot: {
          schemaVersion: 1,
          policy: "operator_incident",
          perIncidentCapSeconds: null,
          perAttemptAggregateCapSeconds: null,
        },
      });
      const ctx = setupMocks({
        attempt,
        detected: makeDetectedEvent({ policy: "operator_incident" }),
      });
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("restored");
      expect(result.compensation.policy).toBe("operator_incident");
      expect(result.compensation.addedSeconds).toBe(0);
      expect(result.compensation.adjustmentId).toBeNull();
      expect(ctx.insertedAdjustments).toHaveLength(0);
    });
  });

  describe("bounded_grace positive grant", () => {
    it("exact four-cap grant, one adjustment, deadline extended, restored outcome references adjustment", async () => {
      const attempt = makeAttempt({
        interruptionTimingPolicySnapshot: {
          schemaVersion: 1,
          policy: "bounded_grace",
          perIncidentCapSeconds: 300,
          perAttemptAggregateCapSeconds: 600,
        },
      });
      const exam = makeExam({
        interruptionTimePolicy: "bounded_grace",
        interruptionGracePerIncidentSeconds: 300,
        interruptionGracePerAttemptSeconds: 600,
      });
      const ctx = setupMocks({
        attempt,
        exam,
        detected: makeDetectedEvent({ policy: "bounded_grace" }),
      });
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("restored");
      expect(result.compensation.policy).toBe("bounded_grace");
      expect(result.compensation.addedSeconds).toBeGreaterThan(0);
      expect(result.compensation.adjustmentId).toBe("adj-new");
      expect(ctx.insertedAdjustments).toHaveLength(1);

      const restoredEvent = ctx.insertedEvents.find(
        (e: any) => e.eventType === "restored",
      ) as any;
      expect(restoredEvent.timeAdjustmentId).toBe("adj-new");
    });
  });

  describe("bounded_grace zero grant", () => {
    it("no adjustment, restored outcome retains eligibleSeconds", async () => {
      const detectedAtNow = NOW;
      const attempt = makeAttempt({
        interruptedAt: detectedAtNow,
        interruptionTimingPolicySnapshot: {
          schemaVersion: 1,
          policy: "bounded_grace",
          perIncidentCapSeconds: 300,
          perAttemptAggregateCapSeconds: 600,
        },
      });
      const ctx = setupMocks({
        attempt,
        detected: makeDetectedEvent({
          policy: "bounded_grace",
          occurredAt: detectedAtNow,
        }),
      });
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("restored");
      expect(result.compensation.addedSeconds).toBe(0);
      expect(result.compensation.adjustmentId).toBeNull();
      expect(ctx.insertedAdjustments).toHaveLength(0);
    });
  });

  describe("fail closed — identity violations", () => {
    it("missing parent → throws", async () => {
      const ctx = setupMocks({ episode: null });
      await expect(runRestore(ctx)).rejects.toThrow(ValidationError);
    });

    it("missing detected → throws", async () => {
      const ctx = setupMocks({ detected: null });
      await expect(runRestore(ctx)).rejects.toThrow(ValidationError);
    });

    it("detected/interruptedAt mismatch → throws", async () => {
      const detected = makeDetectedEvent({
        occurredAt: new Date("2026-01-01T00:49:59.000Z"),
      });
      const ctx = setupMocks({ detected });
      await expect(runRestore(ctx)).rejects.toThrow(/interruptedAt/i);
    });

    it("existing active outcome → throws", async () => {
      const outcome = makeOutcomeEvent("restored");
      const ctx = setupMocks({ outcome });
      await expect(runRestore(ctx)).rejects.toThrow(/already has an outcome/i);
    });
  });

  describe("lost-response retry — already in_progress", () => {
    it("same interruptionId, same eligibleSeconds, same adjustmentId, no duplicate event/adjustment", async () => {
      const restoredOutcome = makeOutcomeEvent("restored", {
        eligibleSeconds: 120,
        timeAdjustmentId: "adj-existing",
      });
      const adjustment: AttemptTimeAdjustment = {
        id: "adj-existing",
        operationId: "op-1",
        organizationId: "org-1",
        attemptId: "attempt-1",
        interruptionId: "ep-1",
        incidentId: null,
        policy: "bounded_grace",
        source: "bounded_grace",
        beforeDeadline: DEADLINE,
        afterDeadline: new Date(DEADLINE.getTime() + 120_000),
        addedSeconds: 120,
        eligibleSeconds: 120,
        reasonCode: "bounded_grace_per_incident_cap",
        reasonText: null,
        actorId: null,
        createdAt: NOW,
      } as AttemptTimeAdjustment;
      const attempt = makeAttempt({ status: "in_progress" });
      const ctx = setupMocks({
        attempt,
        latestOutcome: restoredOutcome,
        adjustmentById: adjustment,
      });
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("already_in_progress");
      expect(result.compensation.interruptionId).toBe("ep-1");
      expect(result.compensation.eligibleSeconds).toBe(120);
      expect(result.compensation.addedSeconds).toBe(120);
      expect(result.compensation.adjustmentId).toBe("adj-existing");
      expect(ctx.insertedEvents).toHaveLength(0);
      expect(ctx.insertedAdjustments).toHaveLength(0);
    });
  });

  describe("terminal retry", () => {
    it("terminalized outcome reconstructs, referenced adjustment validates", async () => {
      const terminalOutcome = makeOutcomeEvent("terminalized", {
        policy: "bounded_grace",
        eligibleSeconds: 60,
        timeAdjustmentId: "adj-term",
      });
      const adjustment: AttemptTimeAdjustment = {
        id: "adj-term",
        operationId: "op-2",
        organizationId: "org-1",
        attemptId: "attempt-1",
        interruptionId: "ep-1",
        incidentId: null,
        policy: "bounded_grace",
        source: "bounded_grace",
        beforeDeadline: DEADLINE,
        afterDeadline: new Date(DEADLINE.getTime() + 60_000),
        addedSeconds: 60,
        eligibleSeconds: 60,
        reasonCode: "bounded_grace_per_incident_cap",
        reasonText: null,
        actorId: null,
        createdAt: NOW,
      } as AttemptTimeAdjustment;
      const attempt = makeAttempt({ status: "submitted" });
      const ctx = setupMocks({
        attempt,
        latestOutcome: terminalOutcome,
        adjustmentById: adjustment,
      });
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("terminal");
      expect(result.compensation.addedSeconds).toBe(60);
      expect(result.compensation.adjustmentId).toBe("adj-term");
    });

    it("missing adjustment fails closed", async () => {
      const terminalOutcome = makeOutcomeEvent("terminalized", {
        timeAdjustmentId: "adj-missing",
      });
      const attempt = makeAttempt({ status: "submitted" });
      const ctx = setupMocks({
        attempt,
        latestOutcome: terminalOutcome,
        adjustmentById: null,
      });
      await expect(runRestore(ctx)).rejects.toThrow(/identity validation/i);
    });
  });

  describe("terminal with latest restored outcome", () => {
    it("plain terminal, no reuse of old restored grant", async () => {
      const restoredOutcome = makeOutcomeEvent("restored");
      const attempt = makeAttempt({ status: "graded" });
      const ctx = setupMocks({
        attempt,
        latestOutcome: restoredOutcome,
      });
      const result = await runRestore(ctx);

      expect(result.lifecycle).toBe("terminal");
      expect(result.compensation.interruptionId).toBeNull();
      expect(result.compensation.addedSeconds).toBe(0);
      expect(result.compensation.adjustmentId).toBeNull();
    });
  });

  describe("voided", () => {
    it("terminal result", async () => {
      const attempt = makeAttempt({ status: "voided" });
      const ctx = setupMocks({ attempt });
      const result = await runRestore(ctx);
      expect(result.lifecycle).toBe("terminal");
    });
  });

  describe("rollback injection", () => {
    it("adjustment insert fails → no partial state", async () => {
      const attempt = makeAttempt({
        interruptionTimingPolicySnapshot: {
          schemaVersion: 1,
          policy: "bounded_grace",
          perIncidentCapSeconds: 300,
          perAttemptAggregateCapSeconds: 600,
        },
      });
      const ctx = setupMocks({
        attempt,
        detected: makeDetectedEvent({ policy: "bounded_grace" }),
      });
      ctx.adjustmentRepo.insert = async () => {
        throw new Error("DB write failure");
      };
      await expect(runRestore(ctx)).rejects.toThrow("DB write failure");
      expect(ctx.insertedEvents).toHaveLength(0);
    });

    it("restored event insert fails → no partial state", async () => {
      const ctx = setupMocks({});
      ctx.eventRepo.insert = async () => {
        throw new Error("Event write failure");
      };
      await expect(runRestore(ctx)).rejects.toThrow("Event write failure");
    });
  });
});
