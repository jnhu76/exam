import type {
  AttemptGradingEntry,
  AttemptTimingPolicySnapshot,
  Exam,
  ExamAttempt,
  ExamEnrollment,
  InterruptionTimePolicy,
  RequestContext,
} from "@exam/domain";
import type { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import type { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import type { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import type { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import type { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import type { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import type { createAttemptTimeAdjustmentRepo } from "@exam/db/src/repository/attemptTimeAdjustmentRepo.js";
import type { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import type {
  ExamRepository,
  AttemptRepository,
  EnrollmentRepository,
  GradingWorksetRepository,
  IncidentGrantValidator,
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "@exam/exam-engine";

/**
 * Adapts the DB exam repo to the ExamRepository interface expected by
 * the exam-engine command functions, binding the request context.
 */
export function createExamRepoAdapter(
  repo: ReturnType<typeof createExamRepo>,
  ctx: RequestContext,
): ExamRepository {
  return {
    findById: async (examId) =>
      (await repo.findById(ctx, examId)) as Exam | null,
    findByIdForUpdate: async (examId) =>
      (await repo.findByIdForUpdate(ctx, examId)) as Exam | null,
    update: async (examId, data) =>
      (await repo.update(
        ctx,
        examId,
        data as Parameters<typeof repo.update>[2],
      )) as Exam | null,
  };
}

/**
 * Flattens the engine-side {@link ExamAttempt.interruptionTimingPolicySnapshot}
 * projection into the four raw snapshot columns the DB row expects on insert.
 *
 * I2 wires attempt creation to populate the snapshot; the engine command
 * works in terms of the nested domain projection, while the DB insert row
 * carries the explicit columns (`interruptionPolicySnapshotVersion`,
 * `interruptionTimePolicySnapshot`,
 * `interruptionGracePerIncidentSecondsSnapshot`,
 * `interruptionGracePerAttemptSecondsSnapshot`). This translation lives in the
 * adapter layer so the engine never imports Drizzle row shapes.
 */
function flattenInterruptionSnapshotForCreate(
  input: Parameters<AttemptRepository["create"]>[0],
): Record<string, unknown> {
  const { interruptionTimingPolicySnapshot, ...rest } = input;
  if (interruptionTimingPolicySnapshot == null) {
    return rest;
  }
  return {
    ...rest,
    interruptionPolicySnapshotVersion:
      interruptionTimingPolicySnapshot.schemaVersion,
    interruptionTimePolicySnapshot: interruptionTimingPolicySnapshot.policy,
    interruptionGracePerIncidentSecondsSnapshot:
      interruptionTimingPolicySnapshot.perIncidentCapSeconds,
    interruptionGracePerAttemptSecondsSnapshot:
      interruptionTimingPolicySnapshot.perAttemptAggregateCapSeconds,
  };
}

/**
 * Reconstructs the nested {@link ExamAttempt.interruptionTimingPolicySnapshot}
 * domain projection from the flat DB snapshot columns on read. The DB stores
 * four columns (`interruption_policy_snapshot_version`,
 * `interruption_time_policy_snapshot`,
 * `interruption_grace_per_incident_seconds_snapshot`,
 * `interruption_grace_per_attempt_seconds_snapshot`); the engine command layer
 * expects the single nested object.
 */
function hydrateAttemptFromDb(row: unknown): ExamAttempt {
  const r = row as Record<string, unknown>;
  const policy = r.interruptionTimePolicySnapshot as
    | InterruptionTimePolicy
    | undefined;
  const snapshot: AttemptTimingPolicySnapshot | undefined = policy
    ? {
        schemaVersion: 1,
        policy,
        perIncidentCapSeconds:
          (r.interruptionGracePerIncidentSecondsSnapshot as number | null) ??
          null,
        perAttemptAggregateCapSeconds:
          (r.interruptionGracePerAttemptSecondsSnapshot as number | null) ??
          null,
      }
    : undefined;
  return { ...r, interruptionTimingPolicySnapshot: snapshot } as ExamAttempt;
}

/**
 * Adapts the DB attempt repo to the AttemptRepository interface expected by
 * the exam-engine command functions, binding the request context.
 */
export function createAttemptRepoAdapter(
  repo: ReturnType<typeof createAttemptRepo>,
  ctx: RequestContext,
): AttemptRepository {
  return {
    findById: async (id) => {
      const row = await repo.findById(ctx, id);
      return row ? hydrateAttemptFromDb(row) : null;
    },
    findByIdForUpdate: async (id) => {
      const row = await repo.findByIdForUpdate(ctx, id);
      return row ? hydrateAttemptFromDb(row) : null;
    },
    findActiveByEnrollment: async (enrollmentId) => {
      const row = await repo.findActiveByEnrollment(ctx, enrollmentId);
      return row ? hydrateAttemptFromDb(row) : null;
    },
    findByEnrollmentAndAttemptNo: async (enrollmentId, attemptNo) => {
      const row = await repo.findByEnrollmentAndAttemptNo(
        ctx,
        enrollmentId,
        attemptNo,
      );
      return row ? hydrateAttemptFromDb(row) : null;
    },
    create: async (input) =>
      hydrateAttemptFromDb(
        await repo.create(
          ctx,
          flattenInterruptionSnapshotForCreate(input) as Parameters<
            typeof repo.create
          >[1],
        ),
      ),
    update: async (id, data) => {
      const row = await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      );
      return row ? hydrateAttemptFromDb(row) : null;
    },
    refreshLastActivityIfInProgress: async (id, now) => {
      const row = await repo.refreshLastActivityIfInProgress(ctx, id, now);
      return row ? hydrateAttemptFromDb(row) : null;
    },
  };
}

/** Adapts the DB enrollment repo to the EnrollmentRepository interface expected
 * by the exam-engine command functions, binding the request context. */
export function createEnrollmentRepoAdapter(
  repo: ReturnType<typeof createEnrollmentRepo>,
  ctx: RequestContext,
): EnrollmentRepository {
  return {
    findByExamAndCandidate: async (examId, candidateId) =>
      (await repo.findByExamAndCandidate(
        ctx,
        examId,
        candidateId,
      )) as ExamEnrollment | null,
    findByExamAndCandidateForUpdate: async (examId, candidateId) =>
      (await repo.findByExamAndCandidateForUpdate(
        ctx,
        examId,
        candidateId,
      )) as ExamEnrollment | null,
    create: async (input) =>
      (await repo.create(
        ctx,
        input as Parameters<typeof repo.create>[1],
      )) as ExamEnrollment,
    update: async (id, data) =>
      (await repo.update(
        ctx,
        id,
        data as Parameters<typeof repo.update>[2],
      )) as ExamEnrollment | null,
  };
}

/** All three adapted repo interfaces needed by exam-engine commands. */
export interface ExamEngineRepos {
  exams: ExamRepository;
  attempts: AttemptRepository;
  enrollments: EnrollmentRepository;
}

/** Adapts the DB attempt-interruption (episode parent) repo to the
 * engine-facing {@link InterruptionEpisodeRepository}, binding ctx. */
export function createInterruptionEpisodeRepoAdapter(
  repo: ReturnType<typeof createAttemptInterruptionRepo>,
  ctx: RequestContext,
): InterruptionEpisodeRepository {
  return {
    create: async (attemptId) =>
      (await repo.create(ctx, { attemptId })) as Awaited<
        ReturnType<InterruptionEpisodeRepository["create"]>
      >,
    findById: async (interruptionId) =>
      (await repo.findById(ctx, interruptionId)) as Awaited<
        ReturnType<InterruptionEpisodeRepository["findById"]>
      >,
    findByAttemptForUpdate: async (attemptId, interruptionId) =>
      (await repo.findByAttemptForUpdate(
        ctx,
        attemptId,
        interruptionId,
      )) as Awaited<
        ReturnType<InterruptionEpisodeRepository["findByAttemptForUpdate"]>
      >,
    findLatestByAttempt: async (attemptId) =>
      (await repo.findLatestByAttempt(ctx, attemptId)) as Awaited<
        ReturnType<InterruptionEpisodeRepository["findLatestByAttempt"]>
      >,
  };
}

/** Adapts the DB attempt-interruption-event repo to the engine-facing
 * {@link InterruptionEventRepository}, binding ctx. */
export function createInterruptionEventRepoAdapter(
  repo: ReturnType<typeof createAttemptInterruptionEventRepo>,
  ctx: RequestContext,
): InterruptionEventRepository {
  return {
    insert: async (input) =>
      (await repo.insert(
        ctx,
        input as Parameters<typeof repo.insert>[1],
      )) as Awaited<ReturnType<InterruptionEventRepository["insert"]>>,
    findDetected: async (interruptionId) =>
      (await repo.findDetected(ctx, interruptionId)) as Awaited<
        ReturnType<InterruptionEventRepository["findDetected"]>
      >,
    findOutcome: async (interruptionId) =>
      (await repo.findOutcome(ctx, interruptionId)) as Awaited<
        ReturnType<InterruptionEventRepository["findOutcome"]>
      >,
    findLatestOutcomeByAttempt: async (attemptId) =>
      (await repo.findLatestOutcomeByAttempt(ctx, attemptId)) as Awaited<
        ReturnType<InterruptionEventRepository["findLatestOutcomeByAttempt"]>
      >,
  };
}

/** Adapts the DB attempt-time-adjustment repo to the engine-facing
 * {@link TimeAdjustmentRepository}, binding ctx. */
export function createTimeAdjustmentRepoAdapter(
  repo: ReturnType<typeof createAttemptTimeAdjustmentRepo>,
  ctx: RequestContext,
): TimeAdjustmentRepository {
  return {
    insert: async (input) =>
      (await repo.insert(
        ctx,
        input as Parameters<typeof repo.insert>[1],
      )) as Awaited<ReturnType<TimeAdjustmentRepository["insert"]>>,
    findById: async (adjustmentId) =>
      (await repo.findById(ctx, adjustmentId)) as Awaited<
        ReturnType<TimeAdjustmentRepository["findById"]>
      >,
    findByOperationId: async (operationId) =>
      (await repo.findByOperationId(ctx, operationId)) as Awaited<
        ReturnType<TimeAdjustmentRepository["findByOperationId"]>
      >,
    findBoundedByInterruption: async (interruptionId) =>
      (await repo.findBoundedByInterruption(ctx, interruptionId)) as Awaited<
        ReturnType<TimeAdjustmentRepository["findBoundedByInterruption"]>
      >,
    sumBoundedGraceSeconds: async (attemptId) =>
      repo.sumBoundedGraceSeconds(ctx, attemptId),
  };
}

/** Adapts the DB attempt-grading-entry repo to the GradingWorksetRepository
 * interface expected by the exam-engine `materializeGradingWorkset` and
 * `gradeQuestion` functions, binding the request context (P3-L0-2E Slice 3).
 *
 * Slice 3 consolidates the manual-score write path onto this single adapter:
 * manual grading now updates existing `attempt_grading_entries` rows instead
 * of upserting into the legacy `manual_grading_entries` table. */
export function createGradingWorksetRepoAdapter(
  repo: ReturnType<typeof createAttemptGradingEntryRepo>,
  ctx: RequestContext,
): GradingWorksetRepository {
  return {
    findByAttempt: async (attemptId) =>
      repo.findByAttempt(ctx, attemptId) as Promise<AttemptGradingEntry[]>,
    findByAttemptAndQuestion: async (attemptId, questionId) =>
      repo.findByAttemptAndQuestion(
        ctx,
        attemptId,
        questionId,
      ) as Promise<AttemptGradingEntry | null>,
    bulkCreate: async (inputs) => {
      await repo.bulkCreate(
        ctx,
        inputs as Parameters<typeof repo.bulkCreate>[1],
      );
    },
    completeManualEntry: async (input) =>
      repo.completeManualEntry(
        ctx,
        input as Parameters<typeof repo.completeManualEntry>[1],
      ) as Promise<AttemptGradingEntry | null>,
    countPendingManualForAttempt: async (attemptId) =>
      repo.countPendingManualForAttempt(ctx, attemptId),
  };
}

/**
 * Adapts the DB incident repo to the {@link IncidentGrantValidator} port used
 * by `grantAttemptTime` for the combined grant+link path (ADR-014 §10). The
 * lookup is ctx-organization-scoped (`incidentRepo.findById` filters by org),
 * so a null result proves both "missing" and "cross-org". Binds the request
 * context so the engine never imports Drizzle row shapes.
 */
export function createIncidentGrantValidatorAdapter(
  repo: ReturnType<typeof createIncidentRepo>,
  ctx: RequestContext,
): IncidentGrantValidator {
  return {
    findForGrantValidation: async (incidentId) => {
      const incident = await repo.findById(ctx, incidentId);
      if (!incident) return null;
      return {
        examId: incident.examId,
        attemptId: incident.attemptId,
        candidateId: incident.candidateId,
      };
    },
  };
}

/** Creates all three adapted repo interfaces in one call, binding the request
 *  context. Use this instead of calling individual adapter factories when the
 *  caller needs multiple repos (e.g. startOrRestoreAttempt, grading, submit). */
export function createExamEngineRepos(
  repos: {
    examRepo: ReturnType<typeof createExamRepo>;
    attemptRepo: ReturnType<typeof createAttemptRepo>;
    enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
  },
  ctx: RequestContext,
): ExamEngineRepos {
  return {
    exams: createExamRepoAdapter(repos.examRepo, ctx),
    attempts: createAttemptRepoAdapter(repos.attemptRepo, ctx),
    enrollments: createEnrollmentRepoAdapter(repos.enrollmentRepo, ctx),
  };
}

/** All engine repos needed by the composed restore command (Exam, Attempt,
 * Enrollment, three interruption ledgers, grading workset). */
export interface RestoreEngineRepos extends ExamEngineRepos {
  episodes: InterruptionEpisodeRepository;
  events: InterruptionEventRepository;
  adjustments: TimeAdjustmentRepository;
}

/** Bundles all engine repos needed by {@link restoreInterruptedAttempt},
 * binding ctx. Each repo factory receives the active transaction's DB handle
 * so row locks persist through the caller's transaction. */
export function createRestoreEngineRepos(
  repos: {
    examRepo: ReturnType<typeof createExamRepo>;
    attemptRepo: ReturnType<typeof createAttemptRepo>;
    enrollmentRepo: ReturnType<typeof createEnrollmentRepo>;
    interruptionRepo: ReturnType<typeof createAttemptInterruptionRepo>;
    interruptionEventRepo: ReturnType<
      typeof createAttemptInterruptionEventRepo
    >;
    timeAdjustmentRepo: ReturnType<typeof createAttemptTimeAdjustmentRepo>;
  },
  ctx: RequestContext,
): RestoreEngineRepos {
  return {
    ...createExamEngineRepos(
      {
        examRepo: repos.examRepo,
        attemptRepo: repos.attemptRepo,
        enrollmentRepo: repos.enrollmentRepo,
      },
      ctx,
    ),
    episodes: createInterruptionEpisodeRepoAdapter(repos.interruptionRepo, ctx),
    events: createInterruptionEventRepoAdapter(
      repos.interruptionEventRepo,
      ctx,
    ),
    adjustments: createTimeAdjustmentRepoAdapter(repos.timeAdjustmentRepo, ctx),
  };
}
