import type { FastifyRequest } from "fastify";
import type { RequestContext, Exam } from "@exam/domain";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { reconcileExamForMutation } from "./reconciliation.js";
import {
  recordAtomicHttpAudit,
  type AuditTarget,
} from "../audit/auditWriter.js";
import { createExamRepoAdapter } from "../adapters/repoAdapters.js";
import type { ActiveAuditActionForDurability } from "../audit/auditPolicy.js";

/**
 * Result of the shared transition orchestration wrapping a route-specific
 * `run` callback. The helper handles:
 * 1. Transaction + row-level lock
 * 2. Mutation reconciliation (J2.8)
 * 3. Explicit privileged-transition audit recording
 *
 * `null` means the exam was not found (caller returns 404).
 */
export type TransitionResult<T> = {
  data: T;
} | null;

/**
 * Shared orchestration for admin exam transition routes (close, unpublish,
 * extend, cancel, archive). Handles the common lock → reconcile → command →
 * explicit audit pattern so each route only provides its guard + command
 * logic. Automatic reconciliation itself is canonical domain state and does
 * not produce a compliance audit.
 *
 * @param db      - Database instance (shared by the route)
 * @param ctx     - Request context with organizationId
 * @param examId  - Exam to transition
 * @param now     - Injected timestamp (never use bare wall-clock calls)
 * @param run     - Route-specific: guard check + engine command + return data.
 *                  Receives a pre-built repo adapter for the locked exam row,
 *                  the reconciled exam, and the raw tx for creating additional
 *                  repos (e.g. attemptRepo).
 * @returns       - Route-specific result, or null (404)
 */
export async function executeAdminExamTransition<T>(
  db: Database,
  ctx: RequestContext,
  examId: string,
  now: Date,
  run: (args: {
    tx: TransactionDatabase;
    repo: ReturnType<typeof createExamRepoAdapter>;
    exam: Exam;
  }) => Promise<T>,
  request: FastifyRequest,
  auditTargets: (
    data: T,
  ) => AuditTarget<ActiveAuditActionForDurability<"atomic">>[],
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

    for (const target of auditTargets(data)) {
      await recordAtomicHttpAudit(tx, request, ctx, target);
    }

    return { data };
  });
}
