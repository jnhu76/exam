import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext, Exam } from "@exam/domain";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import { reconcileExamForMutation } from "./reconciliation.js";
import { recordAudit } from "./audit.js";
import { createExamRepoAdapter } from "../adapters/repoAdapters.js";

/**
 * Result of the shared transition orchestration wrapping a route-specific
 * `run` callback. The helper handles:
 * 1. Transaction + row-level lock
 * 2. Mutation reconciliation (J2.8)
 * 3. Reconciliation audit recording (J2.7 policy)
 *
 * `null` means the exam was not found (caller returns 404).
 */
export type TransitionResult<T> = {
  data: T;
  reconAuditActions: string[];
} | null;

/**
 * Shared orchestration for admin exam transition routes (close, unpublish,
 * extend, cancel, archive). Handles the common lock → reconcile → audit
 * pattern so each route only provides its guard + command logic.
 *
 * @param db      - Database instance (shared by the route)
 * @param ctx     - Request context with organizationId
 * @param examId  - Exam to transition
 * @param now     - Injected timestamp (never use bare wall-clock calls)
 * @param run     - Route-specific: guard check + engine command + return data.
 *                  Receives a pre-built repo adapter for the locked exam row,
 *                  the reconciled exam, and the raw tx for creating additional
 *                  repos (e.g. attemptRepo).
 * @returns       - Augmented result with `reconAuditActions`, or null (404)
 */
export async function executeAdminExamTransition<T>(
  db: Database,
  ctx: RequestContext,
  examId: string,
  now: Date,
  run: (args: {
    tx: Database;
    repo: ReturnType<typeof createExamRepoAdapter>;
    exam: Exam;
  }) => Promise<T>,
): Promise<TransitionResult<T>> {
  return executeInTransaction(db, async (tx) => {
    const repo = createExamRepo(tx);

    // 1. Lock the exam row so no concurrent admin op / scanner races it.
    const locked = (await repo.findByIdForUpdate(ctx, examId)) as Exam | null;
    if (!locked) return null;

    // 2. Reconcile status by now (published->open / open->closed lazily).
    const adapter = createExamRepoAdapter(repo, ctx);
    const reconciled = await reconcileExamForMutation(adapter, examId, now);
    const exam = reconciled?.exam ?? locked;

    // 3. Route-specific guard + command.
    const data = await run({ tx, repo: adapter, exam });

    return {
      data,
      reconAuditActions: reconciled?.changed ? reconciled.auditActions : [],
    };
  });
}

/**
 * Record reconciliation audit actions after the transaction commits.
 * Call this unconditionally on the result of `executeAdminExamTransition`.
 * If `reconAuditActions` is empty, this is a no-op.
 */
export function recordReconAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  ctx: RequestContext,
  examId: string,
  result: TransitionResult<unknown>,
): void {
  if (!result) return;
  for (const action of result.reconAuditActions) {
    recordAudit(fastify, request, ctx, action, "exam", examId);
  }
}
