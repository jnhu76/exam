import type { FastifyPluginAsync } from "fastify";
import {
  AttemptResultResponseSchema,
  AttemptScoreParamsSchema,
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
import { formatZodError } from "./helpers.js";

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
