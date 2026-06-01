import type { FastifyPluginAsync } from "fastify";
import {
  AttemptResultResponseSchema,
  AttemptScoreParamsSchema,
  ScoreListQuerySchema,
  ScoreListResponseSchema,
} from "@exam/contracts";
import type {
  Exam,
  ExamAttempt,
  QuestionScoreResult,
  RequestContext,
} from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { formatZodError, ensureTargetOrg } from "./helpers.js";

function findVisibleAttempt(
  fastify: Parameters<FastifyPluginAsync>[0],
  ctx: RequestContext,
  attemptId: string,
) {
  const attemptRepo = createAttemptRepo(fastify.db);
  if (ctx.role !== "Candidate") {
    return attemptRepo.findById(ctx, attemptId) as ExamAttempt | null;
  }
  const candidate = createCandidateRepo(fastify.db).findByUserId(
    ctx,
    ctx.actorId,
  );
  return candidate
    ? (attemptRepo.findByIdAndCandidate(
        ctx,
        attemptId,
        candidate.id,
      ) as ExamAttempt | null)
    : null;
}

function buildQuestionResults(
  attempt: ExamAttempt,
  results: QuestionScoreResult[],
) {
  const questionMap = new Map(
    attempt.questionSnapshot.map((question) => [
      question.originalQuestionId,
      question,
    ]),
  );
  return results.map((result) => {
    const question = questionMap.get(result.questionId);
    if (!question) {
      throw new NotFoundError("Question snapshot not found");
    }
    return {
      ...result,
      type: question.type,
      content: question.content,
      order: question.order,
    };
  });
}

const scoreRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exams/:id/scores",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request, reply) => {
      const examId = (request.params as any).id;
      const parsedQuery = ScoreListQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send(formatZodError(parsedQuery.error));
      }
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize, passFilter, sortBy, sortOrder } =
        parsedQuery.data;

      const examRepo = createExamRepo(fastify.db);
      const exam = examRepo.findById(ctx, examId) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }

      const attemptRepo = createAttemptRepo(fastify.db);
      const offset = (page - 1) * pageSize;
      const results = attemptRepo.listGradedByExam(ctx, examId, {
        passFilter,
        sortBy,
        sortOrder,
        limit: pageSize,
        offset,
      });
      const total = attemptRepo.countGradedByExam(ctx, examId, { passFilter });

      // 计算统计数据
      const allGraded = attemptRepo.listGradedByExam(ctx, examId);
      const scores = allGraded
        .map((r) => r.attempt.score)
        .filter((s): s is number => s != null);
      const passed = allGraded.filter((r) => r.attempt.passed).length;
      const averageScore = scores.length
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
      const maxScore = scores.length ? Math.max(...scores) : 0;
      const minScore = scores.length ? Math.min(...scores) : 0;
      const passRate = scores.length ? passed / scores.length : 0;

      const items = results.map(
        ({ attempt, candidateProfile, candidateUser }) => ({
          attemptId: attempt.id,
          candidateId: attempt.candidateId,
          candidateName: candidateUser.name,
          candidateFields: candidateProfile.fields,
          examId: attempt.examId,
          examTitle: exam.title,
          score: attempt.score,
          passed: attempt.passed,
          attemptNo: attempt.attemptNo,
          submittedAt: attempt.submittedAt?.toISOString(),
        }),
      );

      return ScoreListResponseSchema.parse({
        items,
        stats: {
          averageScore,
          maxScore,
          minScore,
          passRate,
          totalGraded: scores.length,
        },
        total,
        page,
        pageSize,
      });
    },
  );

  fastify.get(
    "/scores/attempts/:attemptId",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Candidate", "Admin", "SuperAdmin", "Teacher"]),
      ],
    },
    async (request, reply) => {
      const parsed = AttemptScoreParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(parsed.error));
      }
      const ctx = request["ctx"] as RequestContext;
      const attempt = findVisibleAttempt(fastify, ctx, parsed.data.attemptId);
      if (!attempt) {
        throw new NotFoundError("Attempt not found");
      }
      const exam = createExamRepo(fastify.db).findById(
        ctx,
        attempt.examId,
      ) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }

      const showResults =
        ctx.role !== "Candidate" || exam.controlFlags.showResultImmediately;
      if (
        !showResults ||
        attempt.status !== "graded" ||
        attempt.score == null ||
        attempt.passed == null ||
        !attempt.gradedAt ||
        !attempt.gradingResult
      ) {
        return AttemptResultResponseSchema.parse({
          attemptId: attempt.id,
          status: attempt.status,
          showResultImmediately: false,
          examTitle: exam.title,
        });
      }

      return AttemptResultResponseSchema.parse({
        attemptId: attempt.id,
        status: attempt.status,
        showResultImmediately: true,
        examTitle: exam.title,
        passingScore: exam.passingScore,
        totalScore: attempt.score,
        passed: attempt.passed,
        gradedAt: attempt.gradedAt.toISOString(),
        questionResults: buildQuestionResults(attempt, attempt.gradingResult),
      });
    },
  );
};

export default scoreRoutes;
