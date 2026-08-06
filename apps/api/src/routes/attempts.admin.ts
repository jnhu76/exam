import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  FlagMisconductRequestSchema,
  FlagMisconductResponseSchema,
  ForceSubmitWithOperationRequestSchema,
  AttemptCommandReceiptResponseSchema,
  TimeGrantRequestSchema,
  TimeGrantResponseSchema,
  AttemptTimelineResponseSchema,
  AttemptIdParamsSchema,
  AttemptExportResponseSchema,
  type AttemptExportData,
  type AttemptExportQuestionResult,
  ErrorResponseSchema,
} from "@exam/contracts";
import type { RequestContext } from "@exam/domain";
import { generateCSV } from "@exam/import-export";
import { NotFoundError } from "@exam/domain";
import { flagMisconduct } from "@exam/exam-engine";
import { Permission } from "@exam/authz";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createAttemptRepoAdapter } from "../adapters/repoAdapters.js";
import {
  ensureTargetOrg,
  formatZodError,
  getRequestContext,
} from "./helpers.js";
import { cookieAuth } from "./attempts.shared.js";
import {
  recordAtomicHttpAudit,
  recordSensitiveReadAudit,
} from "../audit/auditWriter.js";
import { grantWithOperationRaceRecovery } from "../orchestrators/operatorGrantExecution.js";
import { forceSubmitWithOperationRaceRecovery } from "../orchestrators/forceSubmitExecution.js";

/**
 * Registers all admin-facing attempt routes: misconduct flag, force-submit,
 * and time-grants. Handlers are unchanged from the pre-split module.
 */
export async function registerAdminAttemptRoutes(fastify: FastifyInstance) {
  /**
   * POST /admin/attempts/:attemptId/misconduct — Admin records a
   * misconduct flag on an attempt (informational; does not change status).
   * Allowed on any attempt status (§16). Idempotent (re-flag overwrites).
   * Audit: attempt.misconductFlagged. Response: { ok: true }.
   */
  fastify.post(
    "/admin/attempts/:attemptId/misconduct",
    {
      preHandler: [
        fastify.authenticate,
        // J4-I1B (ADR-015 §8): flipped from flat to scoped. The grant is
        // REMOVED from the Proctor preset (proctorAccess = admin_only), so
        // only Admin reaches the handler; the attempt resolver still validates
        // target existence, tenant, and parent chain.
        fastify.requireScopedCapability(
          Permission.AttemptMisconductMark,
          "attempt",
          "attemptId",
        ),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: FlagMisconductRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: FlagMisconductResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = FlagMisconductRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      const { severity, notes } = body.data;

      // The attempt mutation and privileged-action evidence share one
      // transaction so neither can commit without the other.
      await executeInTransaction(fastify.db, async (tx) => {
        await flagMisconduct(
          createAttemptRepoAdapter(createAttemptRepo(tx), ctx),
          attemptId,
          ctx.actorId,
          severity,
          notes,
          fastify.now(),
        );
        await recordAtomicHttpAudit(tx, request, ctx, {
          action: "attempt.misconductFlagged",
          targetType: "attempt",
          targetId: attemptId,
          metadata: { severity, notes },
        });
      });

      return reply.send({ ok: true } as const);
    },
  );

  /**
   * POST /admin/attempts/:attemptId/force-submit — Admin force-submits an
   * in_progress or disrupted attempt, then grades it inside the SAME
   * transaction (no submitted-but-not-graded crash window). A `submitted` row
   * left by a crashed earlier operation is recovered to `graded` here.
   *
   * J5-I1C Slice 2: the request carries an operationId (client-generated
   * command identity, J5-R0 §8.2) and a REQUIRED canonical reason (J5-R0
   * §8.1). The execution is a durable, operationId-keyed command arbitrated
   * by the shared `attempt_command_receipts` table: the first execution
   * atomically commits receipt + mutation + audit; a replay of the same
   * operationId + canonical payload returns the STORED immutable
   * result_payload (no re-submit, no re-grade, no new audit); any drift
   * (different payload / command / attempt) is a 409 IDEMPOTENCY_CONFLICT; a
   * NEW operationId against an already-terminal attempt leaves a durable
   * `no_change` receipt. The response is the operation receipt — NOT a
   * rebuilt Attempt projection (the old LoadAttemptResponse path is retired).
   * Audit event: attempt.forceSubmit (metadata carries operationId + reason).
   */
  fastify.post(
    "/admin/attempts/:attemptId/force-submit",
    {
      preHandler: [
        fastify.authenticate,
        // J4-I1B (ADR-015 §8): flipped from flat to scoped. The grant is
        // REMOVED from the Proctor preset (proctorAccess = admin_only); the
        // attempt resolver still validates target existence, tenant, and
        // parent chain.
        fastify.requireScopedCapability(
          Permission.AttemptForceSubmit,
          "attempt",
          "attemptId",
        ),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: ForceSubmitWithOperationRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: AttemptCommandReceiptResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = ForceSubmitWithOperationRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      const { operationId, reason } = body.data;
      // ADR-006: capture ONE operation `now` and thread it through the
      // orchestrator so receipt + submit + grading + audit agree within this
      // request.
      const now = fastify.now();

      // The orchestrator owns the transaction: pre-read replay/conflict, EA
      // lock, receipt-first insert, submit+grade, fact verification, audit,
      // and the exact-23505 fresh-transaction recovery. The route never
      // re-reads the attempt after the orchestrator returns.
      const result = await forceSubmitWithOperationRaceRecovery(
        fastify.db,
        ctx,
        { attemptId, operationId, reason, actorId: ctx.actorId, now },
        { audit: { request } },
      );

      return reply.send(AttemptCommandReceiptResponseSchema.parse(result));
    },
  );

  /**
   * POST /admin/attempts/:attemptId/time-grants — Admin grants operator time to
   * an in_progress/disrupted attempt (REC-I4-I3B2). The adjustment ledger insert,
   * the attempt deadline update, and the compliance audit all commit inside ONE
   * transaction. The client supplies command identity (operationId), magnitude,
   * and reason; server-decided fields (actorId, source, policy, deadlines,
   * incidentId) are derived server-side and can not be set by the caller.
   * Idempotent: the same operationId + same payload returns the committed result
   * without a duplicate ledger row. Returns the operation fact (outcome +
   * adjustment + attempt), not just the attempt.
   */
  fastify.post(
    "/admin/attempts/:attemptId/time-grants",
    {
      preHandler: [
        fastify.authenticate,
        // ADR-013 / ADR-010 §3.9: the grant runs in the target-Attempt scope.
        // `requireScopedCapability` is a strict superset of the flat
        // capability gate — it first checks the Admin preset, then resolves
        // the target Attempt's organization + parent chain and fail-closes
        // (404 missing / 403 cross-org / 503 resolver error). This matches
        // the route registry entry (scope: Attempt, resolver: "attempt").
        fastify.requireScopedCapability(
          Permission.AttemptTimeGrant,
          "attempt",
          "attemptId",
        ),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        body: TimeGrantRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: TimeGrantResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const body = TimeGrantRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.code(400).send(formatZodError(request.id, body.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;
      // Contract already trims reasonCode/reasonText, so the committed ledger
      // and the audit projection below share identical canonical values.
      const {
        operationId,
        addedSeconds,
        reasonCode,
        reasonText,
        interruptionId,
        incidentId,
      } = body.data;
      // One authoritative command timestamp threaded through the ledger insert,
      // the deadline update, and the audit so the three agree in this request.
      // It is reused unchanged across the 23505 recovery rerun (below) so the
      // original and recovered commands are byte-identical.
      const now = fastify.now();

      const result = await grantWithOperationRaceRecovery(
        fastify.db,
        ctx,
        {
          attemptId,
          operationId,
          addedSeconds,
          reasonCode,
          reasonText,
          interruptionId: interruptionId ?? null,
          incidentId: incidentId ?? null,
          actorId: ctx.actorId,
          now,
        },
        { audit: { request } },
      );

      return reply.send(
        TimeGrantResponseSchema.parse({
          outcome: result.outcome,
          adjustment: result.adjustment
            ? {
                id: result.adjustment.id,
                operationId: result.adjustment.operationId,
                attemptId: result.adjustment.attemptId,
                source: result.adjustment.source,
                beforeDeadline: result.adjustment.beforeDeadline.toISOString(),
                afterDeadline: result.adjustment.afterDeadline.toISOString(),
                addedSeconds: result.adjustment.addedSeconds,
                reasonCode: result.adjustment.reasonCode,
                reasonText: result.adjustment.reasonText,
                interruptionId: result.adjustment.interruptionId,
                incidentId: result.adjustment.incidentId,
                createdAt: result.adjustment.createdAt.toISOString(),
              }
            : null,
          attempt: {
            id: result.attempt.id,
            status: result.attempt.status,
            deadlineAt: result.attempt.deadlineAt?.toISOString() ?? null,
          },
        }),
      );
    },
  );

  /**
   * GET /admin/attempts/:attemptId/timeline — returns the chronological audit
   * trail for one attempt (start, save, disrupt, restore, submit, grade, and
   * admin actions like force-submit/extend/misconduct), oldest-first. Read-only
   * query over audit_logs filtered by target. 404 if the attempt does not exist
   * in the caller's organization; Proctor actors additionally need an active
   * assignment to the attempt's Exam (J4-I1B, proctorAccess = assignment_scoped).
   */
  fastify.get(
    "/admin/attempts/:attemptId/timeline",
    {
      preHandler: [
        fastify.authenticate,
        // J4-I1B (ADR-015 §8): flipped from flat to scoped + Proctor
        // assignment enforcement.
        fastify.requireScopedCapability(
          Permission.AttemptTimelineView,
          "attempt",
          "attemptId",
          { proctorAccess: "assignment_scoped" },
        ),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: AttemptTimelineResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;

      const attemptRepo = createAttemptRepo(fastify.db);
      const attempt = await attemptRepo.findById(ctx, attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found");
      }

      const auditLogRepo = createAuditLogRepo(fastify.db);
      const rows = await auditLogRepo.listByTarget(ctx, "attempt", attemptId);

      return reply.send({
        events: rows.map((row) => ({
          id: row.auditLog.id,
          organizationId: row.auditLog.organizationId,
          actorId: row.auditLog.actorId,
          actorName: row.actorName,
          action: row.auditLog.action,
          targetType: row.auditLog.targetType,
          targetId: row.auditLog.targetId,
          metadata: row.auditLog.metadata,
          ipAddress: row.auditLog.ipAddress,
          userAgent: row.auditLog.userAgent,
          createdAt: row.auditLog.createdAt.toISOString(),
        })),
      });
    },
  );

  /**
   * GET /admin/attempts/:attemptId/export — Export attempt details (answers +
   * question results) as JSON. Admin-only. Audit event: attempt.exported.
   * For CSV, see GET /admin/attempts/:attemptId/export/csv (split so each
   * response has a single, self-consistent OpenAPI content type).
   */
  fastify.get(
    "/admin/attempts/:attemptId/export",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptExport),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: AttemptExportResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;

      const exportData = await buildAttemptExport(fastify, ctx, attemptId);

      await recordExportAudit(fastify, ctx, request, attemptId, "json");

      return reply.send(AttemptExportResponseSchema.parse(exportData));
    },
  );

  /**
   * GET /admin/attempts/:attemptId/export/csv — Export attempt details as a
   * UTF-8 (BOM) CSV file. Admin-only. `x-content-types` declares the real
   * `text/csv` media type so the generated OpenAPI documents it correctly
   * instead of mislabeling it as application/json (the provider default).
   * Audit event: attempt.exported.
   */
  fastify.get(
    "/admin/attempts/:attemptId/export/csv",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AttemptExport),
      ],
      schema: {
        params: AttemptIdParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.string(),
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
        "x-content-types": { "200": "text/csv" },
      },
    },
    async (request, reply) => {
      const parsed = AttemptIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { attemptId } = parsed.data;

      const exportData = await buildAttemptExport(fastify, ctx, attemptId);

      await recordExportAudit(fastify, ctx, request, attemptId, "csv");

      const csvHeaders = [
        "题号",
        "题型",
        "题目内容",
        "考生答案",
        "标准答案",
        "得分",
        "满分",
        "是否正确",
      ];
      const csvRows = exportData.questionResults.map((q) => ({
        题号: q.order,
        题型: q.type,
        题目内容: q.content,
        考生答案: formatAnswerValue(q.candidateAnswer),
        标准答案: formatAnswerValue(q.standardAnswer),
        得分: q.score ?? "—",
        满分: q.maxScore,
        是否正确: q.correct == null ? "—" : q.correct ? "是" : "否",
      }));
      const csv = "\uFEFF" + generateCSV(csvHeaders, csvRows);
      reply.header(
        "Content-Disposition",
        `attachment; filename="attempt-${attemptId}.csv"`,
      );
      return reply.type("text/csv; charset=utf-8").send(csv);
    },
  );
}

/**
 * Builds the attempt export payload (answers + per-question results) shared by
 * the JSON and CSV export routes. Throws NotFoundError if the attempt does not
 * exist in the caller's organization.
 */
async function buildAttemptExport(
  fastify: FastifyInstance,
  ctx: RequestContext,
  attemptId: string,
): Promise<AttemptExportData> {
  const attemptRepo = createAttemptRepo(fastify.db);
  const attempt = await attemptRepo.findById(ctx, attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  const answerMap = new Map<string, unknown>();
  for (const a of attempt.answers) {
    answerMap.set(a.questionId, a.answer);
  }

  const questionResults: AttemptExportQuestionResult[] =
    attempt.questionSnapshot.map((q) => {
      const gResult = attempt.gradingResult?.find(
        (g) => g.questionId === q.originalQuestionId,
      );
      return {
        order: q.order,
        type: q.type,
        content: q.content,
        candidateAnswer: answerMap.get(q.originalQuestionId) ?? null,
        standardAnswer: q.standardAnswer,
        score: gResult?.score ?? null,
        maxScore: gResult?.maxScore ?? q.score,
        correct: gResult?.correct ?? null,
      };
    });

  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    ...(attempt.score == null ? {} : { score: attempt.score }),
    ...(attempt.passed == null ? {} : { passed: attempt.passed }),
    startedAt: attempt.startedAt?.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString(),
    deadlineAt: attempt.deadlineAt?.toISOString(),
    createdAt: attempt.createdAt.toISOString(),
    questionResults,
  };
}

/** Records the synchronous sensitive-read attempt export evidence. */
async function recordExportAudit(
  fastify: FastifyInstance,
  ctx: RequestContext,
  request: FastifyRequest,
  attemptId: string,
  format: "json" | "csv",
): Promise<void> {
  await recordSensitiveReadAudit(fastify.db, request, ctx, {
    action: "attempt.exported",
    targetType: "attempt",
    targetId: attemptId,
    metadata: { format },
  });
}

/** Formats an answer value as a display string for CSV export. */
function formatAnswerValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join("; ");
  return JSON.stringify(value);
}
