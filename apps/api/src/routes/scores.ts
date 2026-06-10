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

function normalizeScalarQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function normalizeScoreListQuery(query: unknown) {
  if (typeof query !== "object" || query === null) {
    return {};
  }

  const raw = query as Record<string, unknown>;
  return {
    page: normalizeScalarQueryValue(raw.page),
    pageSize: normalizeScalarQueryValue(raw.pageSize),
    passFilter: normalizeScalarQueryValue(raw.passFilter),
    search: normalizeScalarQueryValue(raw.search),
    sortBy: normalizeScalarQueryValue(raw.sortBy),
    sortOrder: normalizeScalarQueryValue(raw.sortOrder),
  };
}

async function findVisibleAttempt(
  fastify: Parameters<FastifyPluginAsync>[0],
  ctx: RequestContext,
  attemptId: string,
) {
  const attemptRepo = createAttemptRepo(fastify.db);
  if (ctx.role !== "Candidate") {
    return (await attemptRepo.findById(ctx, attemptId)) as ExamAttempt | null;
  }
  const candidate = await createCandidateRepo(fastify.db).findByUserId(
    ctx,
    ctx.actorId,
  );
  return candidate
    ? ((await attemptRepo.findByIdAndCandidate(
        ctx,
        attemptId,
        candidate.id,
      )) as ExamAttempt | null)
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

function canOpenScoreList(exam: Exam, gradedCount: number, now: Date) {
  const examEnded =
    exam.status === "closed" ||
    exam.status === "archived" ||
    now >= exam.closeAt;

  if (!examEnded) {
    return {
      allowed: false,
      message: "Exam is not finished yet",
    };
  }

  if (gradedCount === 0) {
    return {
      allowed: false,
      message: "No graded attempts available yet",
    };
  }

  return { allowed: true, message: null };
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
      const parsedQuery = ScoreListQuerySchema.safeParse(
        normalizeScoreListQuery(request.query),
      );
      if (!parsedQuery.success) {
        return reply.code(400).send(formatZodError(parsedQuery.error));
      }
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { page, pageSize, passFilter, sortBy, sortOrder } =
        parsedQuery.data;

      const examRepo = createExamRepo(fastify.db);
      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }

      const attemptRepo = createAttemptRepo(fastify.db);
      const gradedCount = await attemptRepo.countGradedByExam(ctx, examId, {
        passFilter: "all",
      });
      const access = canOpenScoreList(exam, gradedCount, new Date());
      if (!access.allowed) {
        return reply.code(409).send({
          error: {
            code: "INVALID_STATE_TRANSITION",
            message: access.message,
          },
        });
      }
      const offset = (page - 1) * pageSize;
      const [results, total, stats] = await Promise.all([
        attemptRepo.listGradedByExam(ctx, examId, {
          passFilter,
          sortBy,
          sortOrder,
          limit: pageSize,
          offset,
        }),
        attemptRepo.countGradedByExam(ctx, examId, { passFilter }),
        attemptRepo.getGradedStats(ctx, examId),
      ]);

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
        stats,
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
      const attempt = await findVisibleAttempt(
        fastify,
        ctx,
        parsed.data.attemptId,
      );
      if (!attempt) {
        throw new NotFoundError("Attempt not found");
      }
      const exam = (await createExamRepo(fastify.db).findById(
        ctx,
        attempt.examId,
      )) as Exam | null;
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
