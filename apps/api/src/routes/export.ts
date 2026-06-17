import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema } from "@exam/contracts";
import type { RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { ensureTargetOrg } from "./helpers.js";
import { generateCSV } from "@exam/import-export";
import { buildErrorResponse } from "../lib/errorResponse.js";

/**
 * Zod schema for route parameters that expect a UUID `id`.
 */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Fastify plugin that registers data export routes.
 * Currently exposes `GET /exams/:id/export/scores` for CSV export of
 * graded exam attempt scores.
 */
export const exportRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /exams/:id/export/scores
   *
   * Exports graded attempt scores for the specified exam as a CSV file.
   * Admin-only. The CSV includes candidate name, custom fields, score,
   * pass status, attempt number, and submission time.
   */
  fastify.get(
    "/exams/:id/export/scores",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: z.string(),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: examId } = request.params as { id: string };
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);

      const examRepo = createExamRepo(fastify.db);
      const exam = await examRepo.findById(ctx, examId);
      if (!exam) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }

      const attemptRepo = createAttemptRepo(fastify.db);
      const results = await attemptRepo.listGradedByExam(ctx, examId);

      const candidateFieldRepo = createCandidateFieldRepo(fastify.db);
      const fields = (await candidateFieldRepo.list(ctx)).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const fieldPairs = fields.map((f) => ({
        key: f.name,
        label: f.label || f.name,
      }));

      const headers = [
        "考生姓名",
        ...fieldPairs.map((fp) => fp.label),
        "成绩",
        "及格状态",
        "尝试次数",
        "提交时间",
      ];

      const rows = results.map((r) => ({
        考生姓名: r.candidateUser.name,
        ...fieldPairs.reduce(
          (acc, fp) => {
            acc[fp.label] = r.candidateProfile.fields[fp.key] ?? "";
            return acc;
          },
          {} as Record<string, unknown>,
        ),
        成绩: r.attempt.score,
        及格状态: r.attempt.passed ? "及格" : "不及格",
        尝试次数: r.attempt.attemptNo,
        提交时间: r.attempt.submittedAt?.toISOString() ?? "",
      }));

      const csv = generateCSV(headers, rows);

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="scores-${examId}-${Date.now()}.csv"`,
      );

      const auditRepo = createAuditLogRepo(fastify.db);
      await auditRepo.create(ctx, {
        actorId: ctx.actorId,
        action: "export_scores",
        targetType: "exam",
        targetId: examId,
        metadata: { format: "csv", rowCount: results.length },
        ipAddress: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply.send(csv);
    },
  );
};
