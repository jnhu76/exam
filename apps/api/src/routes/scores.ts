import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AttemptResultResponseSchema,
  CandidateAttemptResultResponseSchema,
  AttemptScoreParamsSchema,
  ScoreListQuerySchema,
  ScoreListResponseSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import type {
  Exam,
  ExamAttempt,
  QuestionScoreResult,
  RequestContext,
} from "@exam/domain";
import { NotFoundError, PermissionDeniedError } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { Permission } from "@exam/authz";
import { resolveCandidateResultVisibility } from "@exam/exam-engine";
import {
  formatZodError,
  ensureTargetOrg,
  getRequestContext,
} from "./helpers.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/** Zod schema for route params containing a UUID `id` field. */
const idParamsSchema = z.object({ id: z.string().uuid() });
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Extracts a single scalar value from a query parameter that may be an
 * array (e.g. `?page=1&page=2` → `"1"`).
 */
function normalizeScalarQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Normalizes score-list query parameters by extracting scalar values
 * for known keys (page, pageSize, passFilter, search, sortBy, sortOrder).
 */
function normalizeScoreListQuery(query: unknown) {
  if (typeof query !== "object" || query === null) {
    return {};
  }

  const raw = query as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of [
    "page",
    "pageSize",
    "passFilter",
    "search",
    "sortBy",
    "sortOrder",
  ] as const) {
    const val = normalizeScalarQueryValue(raw[key]);
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Fetches the attempt for the score result route.
 *
 * The authorization boundary (may this principal access this attempt?) is
 * enforced upstream by `requireScoreCapability` (capability + ownership, no
 * role-name branch — RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1). This function is
 * a defense-in-depth fetch: it loads the attempt org-scoped and relies on the
 * already-proven access. The previous role-string branch (`ctx.role !==
 * "Candidate"`) was removed because the score capability gate now makes that
 * distinction authoritatively (ADR §3.4: resolver is primary; handler is
 * belt-and-suspenders, not a substitute).
 */
async function findVisibleAttempt(
  fastify: Parameters<FastifyPluginAsync>[0],
  ctx: RequestContext,
  attemptId: string,
) {
  const attemptRepo = createAttemptRepo(fastify.db);
  return (await attemptRepo.findById(ctx, attemptId)) as ExamAttempt | null;
}

/**
 * Enriches grading results with question metadata (type, content, order)
 * from the attempt's question snapshot.
 */
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
      contentDocument: question.contentDocument ?? null,
      // #301: frozen answer input mode — the candidate-view
      // render authority for candidateAnswer (never JOIN live rows).
      answerMode: question.answerMode ?? null,
      order: question.order,
      // Computed BEFORE the own-view standardAnswer stripping: the candidate
      // DTO drops standardAnswer for every question, so the UI needs an
      // independent "graded manually" signal to keep the manual marker while
      // stripped objective answers render as hidden instead of mislabeled.
      // text_response is always manual (its standardAnswer is a reference,
      // not an auto-grading key); legacy fill_blank without a standardAnswer
      // is manual too.
      manualGraded:
        question.type === "text_response" ||
        (question.type === "fill_blank" && result.standardAnswer == null),
    };
  });
}

/**
 * Determines whether the score list for an exam can be opened.
 * The exam must be finished (closed/archived or past closeAt) and have
 * at least one graded attempt.
 *
 * INVARIANT (message contract D0.6): the blocking condition is signaled to
 * the client via `details.reason` (EXAM_NOT_FINISHED), never via prose.
 */
function canOpenScoreList(exam: Exam, gradedCount: number, now: Date) {
  const examEnded =
    exam.status === "closed" ||
    exam.status === "archived" ||
    (exam.closeAt !== null && now >= exam.closeAt);

  if (!examEnded) {
    return { allowed: false };
  }

  if (gradedCount === 0) {
    return { allowed: false };
  }

  return { allowed: true };
}

/**
 * Resolves the score preHandler's authoritative own/all capability-path
 * decision (union-of-assignments authority). `request.scoreView` is set ONLY by
 * `requireScoreCapability` after it arbitrates ScoreAllView vs
 * ScoreOwnView+ownership. A missing signal is a wiring bug (the route's
 * preHandler chain did not include the score capability gate, or the gate
 * failed to set it) — NEVER silently default to "own" (that would mask the
 * bug and could demote a legitimate all-view principal). Instead fail closed
 * as 503 AUTHZ_UNAVAILABLE.
 *
 * Returns the view, or `null` after sending the 503 response (caller must
 * short-circuit on null).
 */
async function requireScoreView(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<"own" | "all" | null> {
  if (request.scoreView === "own" || request.scoreView === "all") {
    return request.scoreView;
  }
  request.log.error(
    { route: request.url },
    "score handler reached without a scoreView signal — preHandler wiring bug",
  );
  await reply
    .code(503)
    .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
  return null;
}

/**
 * Fastify plugin registering score-list and individual attempt result routes.
 */
const scoreRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /exams/:id/scores — Returns a paginated list of graded attempt
   * scores for an exam. Admin and Teacher. Includes stats (pass/fail counts)
   * and supports sorting and filtering.
   */
  fastify.get(
    "/exams/:id/scores",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(Permission.ScoreAllView, "exam", "id", {
          teacherAccess: "course_assignment_scoped",
        }),
      ],
      schema: {
        params: idParamsSchema,
        querystring: ScoreListQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: ScoreListResponseSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const examId = (request.params as any).id;
      const normalized = normalizeScoreListQuery(request.query);
      const parsedQuery = ScoreListQuerySchema.safeParse(normalized);
      if (!parsedQuery.success) {
        return reply
          .code(400)
          .send(formatZodError(request.id, parsedQuery.error));
      }
      const ctx = ensureTargetOrg(getRequestContext(request));
      // ADR-006: capture the operation now once from the time authority and
      // thread it through every time-sensitive decision in this request.
      const now = fastify.now();
      const { page, pageSize, passFilter, sortBy, sortOrder } =
        parsedQuery.data;

      const examRepo = createExamRepo(fastify.db);
      const exam = (await examRepo.findById(ctx, examId)) as Exam | null;
      if (!exam) {
        throw new NotFoundError("Exam not found");
      }

      const attemptRepo = createAttemptRepo(fastify.db);
      // ADR-005: canceled exams never expose normal scores/export. Runs first
      // so it takes precedence over all other gates.
      if (exam.status === "canceled") {
        return reply
          .code(409)
          .send(
            buildErrorResponse(
              request.id,
              "EXAM_CANCELED_RESULTS_UNAVAILABLE",
              { reason: "CANCELLATION_MARKER_NOT_IMPLEMENTED" },
            ),
          );
      }
      // ADR-005 close & export policy: scores are not exposed while
      // unresolved attempts remain, even if the exam window has ended — an
      // admin must not export partial results mid-exam. Checked BEFORE the
      // ended/graded-count guard so the UNRESOLVED signal takes precedence.
      const unresolvedCount = await attemptRepo.countUnresolvedByExam(
        ctx,
        examId,
      );
      if (unresolvedCount > 0) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
            reason: "UNRESOLVED_ATTEMPTS_EXIST",
            activeAttemptCount: unresolvedCount,
          }),
        );
      }
      const gradedCount = await attemptRepo.countGradedByExam(ctx, examId, {
        passFilter: "all",
      });
      const access = canOpenScoreList(exam, gradedCount, now);
      if (!access.allowed) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
            reason: "EXAM_NOT_FINISHED",
          }),
        );
      }
      const offset = (page - 1) * pageSize;
      const statsResult = await attemptRepo.getGradedStats(ctx, examId);
      const [results, total] = await Promise.all([
        attemptRepo.listGradedByExam(ctx, examId, {
          passFilter,
          sortBy,
          sortOrder,
          limit: pageSize,
          offset,
        }),
        attemptRepo.countGradedByExam(ctx, examId, { passFilter }),
      ]);

      const items = results.map(
        ({ attempt, candidateProfile, candidateUser }) => ({
          attemptId: attempt.id,
          candidateId: attempt.candidateId,
          candidateName: candidateUser.name,
          candidateFields: candidateProfile.fields,
          examId: attempt.examId,
          examTitle: exam.title,
          score: Number(attempt.score),
          passed: attempt.passed,
          attemptNo: Number(attempt.attemptNo),
          submittedAt: attempt.submittedAt?.toISOString(),
        }),
      );

      const responsePayload = {
        items,
        stats: statsResult,
        total,
        page,
        pageSize,
      };
      return ScoreListResponseSchema.parse(responsePayload);
    },
  );

  /**
   * GET /scores/attempts/:attemptId — the CANDIDATE result surface. Returns
   * the caller's own graded result, or a status-only hidden variant. The
   * whole route is definitionally candidate-safe:
   *
   *   1. Access — `requireScoreCapability` arbitrates capability + ownership
   *      (union-of-assignments authority): ScoreOwnView principals reach only their own attempts;
   *      ScoreAllView actors (admins) may pass the gate but still receive the
   *      candidate projection — the full representation lives on
   *      GET /admin/attempts/:attemptId/result.
   *   2. Visibility — the projection ALWAYS resolves through the candidate
   *      publication gate (EXSEM-018): resultReady first, then the
   *      exam's resultPublicationMode. All-view publication bypass never
   *      happens on this surface.
   *   3. Contract — every response is parsed through
   *      CandidateAttemptResultResponseSchema, which structurally cannot
   *      represent standardAnswer (EXSEM-017 / ADR-021: safe contract AND
   *      minimal projection; the mapper strip below is the projection layer,
   *      the parse is the contract boundary).
   *
   * Visibility semantics (hiddenReason, publication modes) are documented on
   * resolveCandidateResultVisibility.
   */
  fastify.get(
    "/scores/attempts/:attemptId",
    {
      preHandler: [fastify.authenticate, fastify.requireScoreCapability()],
      schema: {
        params: AttemptScoreParamsSchema,
        security: cookieAuth,
        "x-role": ["Candidate", "Admin"],
        response: {
          200: CandidateAttemptResultResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptScoreParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const ctx = getRequestContext(request);
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

      // Fail-closed proof the capability gate ran (ownership was enforced
      // upstream); the projection below is candidate-owned regardless of the
      // arbitrated view.
      if ((await requireScoreView(request, reply)) === null) return;
      const visibility = resolveCandidateResultVisibility(exam, attempt, "own");

      if (!visibility.visible) {
        return CandidateAttemptResultResponseSchema.parse({
          attemptId: attempt.id,
          status: attempt.status,
          showResultImmediately: false,
          hiddenReason: visibility.hiddenReason,
          examTitle: exam.title,
        });
      }

      // visibility.visible === true guarantees score/passed/gradedAt/
      // gradingResult are all present (the helper checks them before returning
      // visible). Assert non-null for TS; the runtime invariant holds.
      const gradedAt = attempt.gradedAt as Date;
      const gradingResult = attempt.gradingResult as QuestionScoreResult[];
      const questionResults = buildQuestionResults(attempt, gradingResult);

      // Minimal projection (union-of-assignments authority): this surface never carries the
      // frozen reference answer — for ANY caller. The CandidateAttemptResultResponseSchema
      // parse below is the structural boundary: even if this strip drifted,
      // the candidate contract could not emit standardAnswer.
      const safeQuestionResults = questionResults.map(
        ({ standardAnswer: _, ...rest }) => rest,
      );

      return CandidateAttemptResultResponseSchema.parse({
        attemptId: attempt.id,
        status: attempt.status,
        showResultImmediately: true,
        examTitle: exam.title,
        passingScore: exam.passingScore,
        totalScore: attempt.score,
        passed: attempt.passed,
        gradedAt: gradedAt.toISOString(),
        questionResults: safeQuestionResults,
      });
    },
  );

  /**
   * GET /admin/attempts/:attemptId/result — the AUTHORIZED all-view result
   * surface (admin/teacher ScoreAllView capability path; the surface
   * AttemptDetailPage consumes). Returns the full graded result INCLUDING the
   * frozen standardAnswer per question (EXSEM-017 keeps it representable on
   * authorized internal surfaces), or a status-only hidden variant when the
   * result is not computable yet. The candidate publication gate is bypassed
   * on this path (INV-A1): all-view actors see results as soon as they are
   * ready, independent of publication policy.
   *
   * Candidates (ScoreOwnView-only principals) are rejected: the full result
   * representation is not a candidate surface (EXSEM-017/018).
   */
  fastify.get(
    "/admin/attempts/:attemptId/result",
    {
      preHandler: [fastify.authenticate, fastify.requireScoreCapability()],
      schema: {
        params: AttemptScoreParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: AttemptResultResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = AttemptScoreParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send(formatZodError(request.id, parsed.error));
      }
      const view = await requireScoreView(request, reply);
      if (view === null) return;
      if (view !== "all") {
        throw new PermissionDeniedError(
          "Full attempt result requires the all-view score capability",
        );
      }
      const ctx = getRequestContext(request);
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

      // All-view bypasses the candidate publication gate (INV-A1).
      const visibility = resolveCandidateResultVisibility(exam, attempt, "all");
      if (!visibility.visible) {
        return AttemptResultResponseSchema.parse({
          attemptId: attempt.id,
          status: attempt.status,
          showResultImmediately: false,
          hiddenReason: visibility.hiddenReason,
          examTitle: exam.title,
        });
      }

      // visibility.visible === true guarantees score/passed/gradedAt/
      // gradingResult are all present (the helper checks them before returning
      // visible). Assert non-null for TS; the runtime invariant holds.
      const gradedAt = attempt.gradedAt as Date;
      const gradingResult = attempt.gradingResult as QuestionScoreResult[];
      const questionResults = buildQuestionResults(attempt, gradingResult);

      return AttemptResultResponseSchema.parse({
        attemptId: attempt.id,
        status: attempt.status,
        showResultImmediately: true,
        examTitle: exam.title,
        passingScore: exam.passingScore,
        totalScore: attempt.score,
        passed: attempt.passed,
        gradedAt: gradedAt.toISOString(),
        questionResults,
      });
    },
  );
};

export default scoreRoutes;
