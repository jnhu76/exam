import { FastifyPluginAsync } from "fastify";
import { z, ZodError } from "zod";
import {
  CreateExamProfileRequestSchema,
  UpdateExamProfileRequestSchema,
  ExamProfileSchema,
  ErrorResponseSchema,
  normalizeInterruptionPolicyConfiguration,
} from "@exam/contracts";
import { createExamProfileRepo } from "@exam/db/src/repository/examProfileRepo.js";
import type { ExamProfile } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { Permission } from "@exam/authz";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordBestEffortAudit } from "../audit/auditWriter.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** OpenAPI security scheme: HTTP-only cookie authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Exam profile list response (ordered array — small authoring data, no pagination). */
const examProfileListResponseSchema = z.array(ExamProfileSchema);

/**
 * Convert an ExamProfile domain entity to the API response shape with ISO
 * date strings (mirrors the exam route's `toExamResponse`).
 */
function toExamProfileResponse(profile: ExamProfile) {
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    name: profile.name,
    description: profile.description,
    durationMinutes: profile.durationMinutes,
    latestStartOffsetMinutes: profile.latestStartOffsetMinutes,
    minSubmitAfterStartMinutes: profile.minSubmitAfterStartMinutes,
    retakePolicy: profile.retakePolicy,
    maxAttempts: profile.maxAttempts,
    scoreStrategy: profile.scoreStrategy,
    resultPublicationMode: profile.resultPublicationMode,
    interruptionTimePolicy: profile.interruptionTimePolicy,
    interruptionGracePerIncidentSeconds:
      profile.interruptionGracePerIncidentSeconds ?? null,
    interruptionGracePerAttemptSeconds:
      profile.interruptionGracePerAttemptSeconds ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/**
 * Normalize the interruption-policy normalizer's ZodError into the route's
 * VALIDATION_ERROR contract (details.fields), mapping internal names
 * (policy/perIncidentCapSeconds/perAttemptAggregateCapSeconds) back to API
 * field names. Shared by create and update.
 */
function mapInterruptionValidationError(err: unknown): never {
  const issues =
    err instanceof ZodError
      ? err.issues
      : [
          {
            code: "custom" as const,
            path: [] as (string | number)[],
            message: "Invalid interruption policy configuration",
          },
        ];
  const apiFieldByNormalizerKey: Record<string, string> = {
    policy: "interruptionTimePolicy",
    perIncidentCapSeconds: "interruptionGracePerIncidentSeconds",
    perAttemptAggregateCapSeconds: "interruptionGracePerAttemptSeconds",
  };
  throw new ValidationError("Invalid interruption policy configuration", {
    fields: issues.map((issue) => ({
      field:
        apiFieldByNormalizerKey[String(issue.path[0] ?? "")] ??
        "interruptionTimePolicy",
      code: "INVALID_INTERRUPTION_POLICY",
      message: issue.message,
    })),
  });
}

/**
 * Fastify plugin that registers exam policy profile CRUD routes.
 *
 * Profiles are organization-owned authoring templates (P7-M2). RBAC reuses
 * the closest Exam-authoring capabilities — no new permission family:
 *   read profiles   → Permission.ExamView
 *   create profile  → Permission.ExamCreate
 *   update/delete   → Permission.ExamUpdate
 * All access is org-scoped via the repository; a foreign-org profile id
 * resolves to 404 (no cross-org existence leak).
 */
const examProfileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/exam-profiles",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamView),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: examProfileListResponseSchema,
        },
      },
    },
    /** List exam policy profiles for the organization. */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createExamProfileRepo(fastify.db);
      const profiles = await repo.list(ctx);
      return profiles.map(toExamProfileResponse);
    },
  );

  fastify.post(
    "/exam-profiles",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamCreate),
      ],
      schema: {
        body: CreateExamProfileRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          201: ExamProfileSchema,
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * Create an exam policy profile. The ADR-013 interruption cross-field
     * caps rule is enforced via `normalizeInterruptionPolicyConfiguration`
     * (the shared leaf rule in `@exam/domain`). Duplicate (org, name) is
     * rejected as a stable 409 RESOURCE_CONFLICT.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const parsed = CreateExamProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;

      let interruptionPolicy: ReturnType<
        typeof normalizeInterruptionPolicyConfiguration
      >;
      try {
        interruptionPolicy = normalizeInterruptionPolicyConfiguration({
          policy: data.interruptionTimePolicy,
          perIncidentCapSeconds: data.interruptionGracePerIncidentSeconds,
          perAttemptAggregateCapSeconds:
            data.interruptionGracePerAttemptSeconds,
        });
      } catch (err) {
        return mapInterruptionValidationError(err);
      }

      const repo = createExamProfileRepo(fastify.db);
      try {
        const profile = (await repo.create(ctx, {
          name: data.name,
          description: data.description,
          durationMinutes: data.durationMinutes,
          latestStartOffsetMinutes: data.latestStartOffsetMinutes ?? null,
          minSubmitAfterStartMinutes: data.minSubmitAfterStartMinutes ?? null,
          retakePolicy: data.retakePolicy,
          maxAttempts: data.maxAttempts,
          scoreStrategy: data.scoreStrategy,
          resultPublicationMode: data.resultPublicationMode,
          interruptionTimePolicy: interruptionPolicy.policy,
          interruptionGracePerIncidentSeconds:
            interruptionPolicy.perIncidentCapSeconds,
          interruptionGracePerAttemptSeconds:
            interruptionPolicy.perAttemptAggregateCapSeconds,
        })) as ExamProfile;

        recordBestEffortAudit(fastify, request, ctx, {
          action: "exam_profile.create",
          targetType: "exam_profile",
          targetId: profile.id,
        });

        return reply.code(201).send(toExamProfileResponse(profile));
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          (err as Record<string, unknown>).code === "23505"
        ) {
          return reply
            .code(409)
            .send(buildErrorResponse(request.id, "RESOURCE_CONFLICT"));
        }
        throw err;
      }
    },
  );

  fastify.get(
    "/exam-profiles/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamView),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: ExamProfileSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /** Get an exam policy profile by id. Returns 404 if not found (org-scoped). */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const profile = (await createExamProfileRepo(fastify.db).findById(
        ctx,
        id,
      )) as ExamProfile | null;
      if (!profile) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return toExamProfileResponse(profile);
    },
  );

  fastify.patch(
    "/exam-profiles/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateExamProfileRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: ExamProfileSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * Update an exam policy profile. All fields optional; `null` explicitly
     * clears a nullable field. When any interruption field is present, the
     * partial input is merged with the profile's current resolved policy
     * before ADR-013 normalization (mirrors the exam-update path).
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const parsed = UpdateExamProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;

      const repo = createExamProfileRepo(fastify.db);
      const existing = (await repo.findById(ctx, id)) as ExamProfile | null;
      if (!existing) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      if (Object.keys(data).length === 0) {
        return toExamProfileResponse(existing);
      }

      const updateData: Record<string, unknown> = { ...data };
      const hasInterruptionInput =
        data.interruptionTimePolicy !== undefined ||
        data.interruptionGracePerIncidentSeconds !== undefined ||
        data.interruptionGracePerAttemptSeconds !== undefined;
      if (hasInterruptionInput) {
        let resolved;
        try {
          resolved = normalizeInterruptionPolicyConfiguration({
            policy:
              data.interruptionTimePolicy ?? existing.interruptionTimePolicy,
            perIncidentCapSeconds:
              data.interruptionGracePerIncidentSeconds === undefined
                ? (existing.interruptionGracePerIncidentSeconds ?? null)
                : data.interruptionGracePerIncidentSeconds,
            perAttemptAggregateCapSeconds:
              data.interruptionGracePerAttemptSeconds === undefined
                ? (existing.interruptionGracePerAttemptSeconds ?? null)
                : data.interruptionGracePerAttemptSeconds,
          });
        } catch (err) {
          return mapInterruptionValidationError(err);
        }
        updateData.interruptionTimePolicy = resolved.policy;
        updateData.interruptionGracePerIncidentSeconds =
          resolved.perIncidentCapSeconds;
        updateData.interruptionGracePerAttemptSeconds =
          resolved.perAttemptAggregateCapSeconds;
      }

      try {
        const updated = (await repo.update(
          ctx,
          id,
          updateData,
        )) as ExamProfile | null;
        if (!updated) {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
        recordBestEffortAudit(fastify, request, ctx, {
          action: "exam_profile.update",
          targetType: "exam_profile",
          targetId: id,
          metadata: { changedFields: Object.keys(data) },
        });
        return toExamProfileResponse(updated);
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          (err as Record<string, unknown>).code === "23505"
        ) {
          return reply
            .code(409)
            .send(buildErrorResponse(request.id, "RESOURCE_CONFLICT"));
        }
        throw err;
      }
    },
  );

  fastify.delete(
    "/exam-profiles/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ExamUpdate),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * Delete an exam policy profile (hard delete). Exams materialize profile
     * values at creation (copy-on-apply), so no Exam depends on the row —
     * deletion cannot break an existing or published Exam.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const deleted = await createExamProfileRepo(fastify.db).delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordBestEffortAudit(fastify, request, ctx, {
        action: "exam_profile.delete",
        targetType: "exam_profile",
        targetId: id,
      });
      return reply.code(204).send();
    },
  );
};

export default examProfileRoutes;
