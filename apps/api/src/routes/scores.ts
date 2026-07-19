import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AttemptResultResponseSchema,
  AttemptScoreParamsSchema,
  ScoreListQuerySchema,
  ScoreListResponseSchema,
  ErrorResponseSchema,
  type HiddenReason,
} from "@exam/contracts";
import type {
  Exam,
  ExamAttempt,
  QuestionScoreResult,
  RequestContext,
} from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { Permission } from "@exam/authz";
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
      order: question.order,
    };
  });
}

/**
 * Determines whether the score list for an exam can be opened.
 * The exam must be finished (closed/archived or past closeAt) and have
 * at least one graded attempt.
 */
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

/**
 * P2D-J5a result visibility decision for a single attempt.
 *
 * Two-stage gate:
 *   1. resultReady — is the result itself computable? Requires status=graded
 *      AND all score fields present AND grading is no longer pending manual
 *      scoring. after_grading mode additionally requires gradingStatus to be
 *      exactly 'fully_graded' (auto_graded is not enough — that mode means
 *      "wait for all grading including manual to finish").
 *   2. publication gate — applies when the request reached this route via the
 *      ScoreOwnView capability path (candidate own-score access). Requests
 *      that reached via ScoreAllView (administrative / academic result access)
 *      bypass this stage and see the full result whenever resultReady is true.
 *
 * RBAC-M10-E (P1-4): the gate is driven by `scoreView` — the capability path
 * the score preHandler arbitrates (ScoreAllView -> "all", ScoreOwnView+owner
 * -> "own"). It is NOT `roles.includes("Candidate")`: a multi-role actor
 * reaching via ScoreAllView must NOT be demoted to candidate publication
 * policy just because they happen to hold a Candidate assignment.
 *
 * Returns `{ visible: true }` when the full result can be shown, otherwise
 * `{ visible: false, hiddenReason }` where hiddenReason is one of:
 *   - 'not_started'  — attempt is in a pre-submit lifecycle state.
 *   - 'not_graded'   — result not yet computable (grading pending or incomplete).
 *   - 'pending_publish' — manual mode and admin has not called publish-results.
 */
function computeResultVisibility(
  exam: Exam,
  attempt: ExamAttempt,
  view: "own" | "all",
): { visible: true } | { visible: false; hiddenReason: HiddenReason } {
  // Stage 1: is the result computable?
  const isPreSubmit = attempt.status !== "graded";
  const scoreFieldsPresent =
    attempt.score != null &&
    attempt.passed != null &&
    attempt.gradedAt != null &&
    attempt.gradingResult != null;

  if (isPreSubmit) {
    // 'not_started' covers any non-graded lifecycle state (in_progress,
    // submitted, grading, voided, disrupted, etc.) — the result is not yet
    // computable. The label is historical, not literal.
    return { visible: false, hiddenReason: "not_started" };
  }
  if (!scoreFieldsPresent) {
    return { visible: false, hiddenReason: "not_graded" };
  }

  // gradingStatus semantics: 'pending_manual' always means not-ready.
  // 'auto_graded' counts as ready UNLESS the exam mode is after_grading
  // (which demands 'fully_graded'). 'fully_graded' is always ready.
  const gradingStatus = attempt.gradingStatus ?? "auto_graded";
  if (gradingStatus === "pending_manual") {
    return { visible: false, hiddenReason: "not_graded" };
  }
  if (
    exam.resultPublicationMode === "after_grading" &&
    gradingStatus !== "fully_graded"
  ) {
    // after_grading demands fully_graded; auto_graded is insufficient.
    return { visible: false, hiddenReason: "not_graded" };
  }

  // Stage 2: publication gate — applies only on the own-view capability path
  // (ScoreOwnView + owner). The all-view path (ScoreAllView) bypasses it.
  if (view === "all") {
    return { visible: true };
  }
  switch (exam.resultPublicationMode) {
    case "immediate":
      return { visible: true };
    case "after_grading":
      return { visible: true };
    case "manual":
      return exam.resultsPublishedAt != null
        ? { visible: true }
        : { visible: false, hiddenReason: "pending_publish" };
  }
}

/**
 * Resolves the score preHandler's authoritative own/all capability-path
 * decision (RBAC-M10-E, P1-4). `request.scoreView` is set ONLY by
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
        fastify.requireCapability(Permission.ScoreAllView),
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
      // ADR-005 Slice 4 (cancel-minimal): canceled exams never expose normal
      // scores/export. Runs first so it takes precedence over all other gates.
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
      // ADR-005 Slice 1 §Close & export policy: scores are not exposed while
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
        return reply
          .code(409)
          .send(
            buildErrorResponse(
              request.id,
              "RESOURCE_CONFLICT",
              { reason: "EXAM_NOT_FINISHED" },
              access.message ?? undefined,
            ),
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
   * GET /scores/attempts/:attemptId — Returns the detailed result for a
   * single graded attempt. Visibility is governed by P2D-J5a:
   *
   *   1. resultReady — the result is computable (status=graded, score/passed/
   *      gradedAt/gradingResult all present, AND gradingStatus is not
   *      pending_manual — i.e. grading is done). If not ready, the response
   *      is status-only with hiddenReason='not_graded' (or 'not_started' for
   *      pre-submit states).
   *   2. publication gate — for candidates, the exam's resultPublicationMode:
   *        immediate     → visible as soon as resultReady
   *        after_grading → visible as soon as resultReady (gradingStatus must
   *                        be fully_graded, NOT auto_graded)
   *        manual        → visible only after admin publish-results
   *                        (resultsPublishedAt != null); pending_publish
   *                        hiddenReason otherwise.
   *
   * Admins (non-Candidate roles) bypass the publication gate and see the full
   * result whenever resultReady is true.
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
          200: AttemptResultResponseSchema,
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

      const view = await requireScoreView(request, reply);
      if (view === null) return;
      const visibility = computeResultVisibility(exam, attempt, view);

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

      // standardAnswer stripping follows the capability path (RBAC-M10-E):
      // own-view (ScoreOwnView) = candidate own-score access -> strip; all-view
      // (ScoreAllView) = administrative/academic result access -> keep. This is
      // NOT roles.includes("Candidate"): a multi-role actor reaching via
      // ScoreAllView keeps the full result.
      const stripStandardAnswer = view === "own";
      const safeQuestionResults = stripStandardAnswer
        ? questionResults.map(({ standardAnswer: _, ...rest }) => rest)
        : questionResults;

      return AttemptResultResponseSchema.parse({
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
};

export default scoreRoutes;
