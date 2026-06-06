import type { FastifyPluginAsync } from "fastify";
import { NotFoundError } from "@exam/domain";
import type { RequestContext } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { ensureTargetOrg } from "./helpers.js";
import { generateCSV } from "@exam/import-export";

export const exportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exams/:id/export/scores",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request, reply) => {
      const { id: examId } = request.params as { id: string };
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);

      const examRepo = createExamRepo(fastify.db);
      const exam = examRepo.findById(ctx, examId);
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }

      const attemptRepo = createAttemptRepo(fastify.db);
      const results = attemptRepo.listGradedByExam(ctx, examId);

      // Get candidate fields
      const candidateFieldRepo = createCandidateFieldRepo(fastify.db);
      const fields = candidateFieldRepo
        .list(ctx)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const fieldNames = fields.map((f) => f.name);

      // Build headers
      const headers = [
        "考生姓名",
        ...fieldNames,
        "成绩",
        "及格状态",
        "尝试次数",
        "提交时间",
      ];

      // Build rows
      const rows = results.map((r) => ({
        考生姓名: r.candidateUser.name,
        ...fieldNames.reduce(
          (acc, name) => {
            acc[name] = r.candidateProfile.fields[name] ?? "";
            return acc;
          },
          {} as Record<string, unknown>,
        ),
        成绩: r.attempt.score,
        及格状态: r.attempt.passed ? "及格" : "不及格",
        尝试次数: r.attempt.attemptNo,
        提交时间: r.attempt.submittedAt?.toISOString() ?? "",
      }));

      // Generate CSV
      const csv = generateCSV(headers, rows);

      // Set headers for download
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="scores-${examId}-${Date.now()}.csv"`,
      );

      // Write audit log
      const auditRepo = createAuditLogRepo(fastify.db);
      auditRepo.create(ctx, {
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
