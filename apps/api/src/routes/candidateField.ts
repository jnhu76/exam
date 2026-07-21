import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCandidateFieldRequestSchema,
  UpdateCandidateFieldRequestSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordBestEffortAudit } from "../audit/auditWriter.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { Permission } from "@exam/authz";

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for a single candidate field item in list/detail responses. */
const candidateFieldItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(["text", "number", "select"]),
  required: z.boolean(),
  unique: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});

/** Zod schema for the candidate field list response (array of field items). */
const candidateFieldListResponseSchema = z.array(candidateFieldItemSchema);

/** Zod schema for the import template response containing header column names. */
const templateResponseSchema = z.object({ headers: z.array(z.string()) });

/**
 * Fastify plugin that registers candidate field management routes.
 *
 * Provides CRUD operations and an import template endpoint for
 * candidate identity/custom fields. All routes require Admin role.
 */
const candidateFieldRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/candidate-fields",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CandidateFieldView),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: candidateFieldListResponseSchema },
      },
    },
    /**
     * GET /candidate-fields — list all candidate fields for the organization.
     *
     * Returns candidate fields ordered by their stored sort order.
     */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const repo = createCandidateFieldRepo(fastify.db);
      const fields = await repo.list(ctx);
      return fields.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/candidate-fields",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CandidateFieldCreate),
      ],
      schema: {
        body: CreateCandidateFieldRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 201: candidateFieldItemSchema, 409: ErrorResponseSchema },
      },
    },
    /**
     * POST /candidate-fields — create a new candidate field.
     *
     * Returns 409 if a unique (identity) field already exists and
     * the new field is also marked unique.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const data = CreateCandidateFieldRequestSchema.parse(request.body);
      const repo = createCandidateFieldRepo(fastify.db);
      if (data.unique && (await repo.list(ctx)).some((field) => field.unique)) {
        return reply
          .code(409)
          .send(
            buildErrorResponse(request.id, "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
          );
      }
      const field = await createCandidateFieldRepo(fastify.db).create(
        ctx,
        data,
      );
      recordBestEffortAudit(fastify, request, ctx, {
        action: "candidate_field.create",
        targetType: "candidate_field",
        targetId: field.id,
      });
      return reply.code(201).send({
        ...field,
        createdAt: field.createdAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/candidate-fields/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CandidateFieldUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateCandidateFieldRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: candidateFieldItemSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * PATCH /candidate-fields/:id — update an existing candidate field.
     *
     * Returns 404 if the field does not exist, or 409 if setting
     * unique would conflict with another existing identity field.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = UpdateCandidateFieldRequestSchema.parse(request.body);
      const repo = createCandidateFieldRepo(fastify.db);
      if (
        data.unique &&
        (await repo.list(ctx)).some((field) => field.unique && field.id !== id)
      ) {
        return reply
          .code(409)
          .send(
            buildErrorResponse(request.id, "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
          );
      }
      const updated = await createCandidateFieldRepo(fastify.db).update(
        ctx,
        id,
        {
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.fieldType !== undefined
            ? { fieldType: data.fieldType }
            : {}),
          ...(data.required !== undefined ? { required: data.required } : {}),
          ...(data.unique !== undefined ? { unique: data.unique } : {}),
          ...(data.sortOrder !== undefined
            ? { sortOrder: data.sortOrder }
            : {}),
        },
      );
      if (updated) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "candidate_field.update",
          targetType: "candidate_field",
          targetId: id,
          metadata: { changedFields: Object.keys(data) },
        });
      }
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return { ...updated, createdAt: updated.createdAt.toISOString() };
    },
  );

  fastify.delete(
    "/candidate-fields/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CandidateFieldDelete),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /**
     * DELETE /candidate-fields/:id — delete a candidate field.
     *
     * Returns 409 if the field is a unique identity field and
     * candidates already exist, since removing it would leave
     * candidates without an identity. Returns 404 if not found.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const repo = createCandidateFieldRepo(fastify.db);
      const field = await repo.findById(ctx, id);
      if (
        field?.unique &&
        (await createCandidateRepo(fastify.db).count(ctx)) > 0
      ) {
        return reply
          .code(409)
          .send(buildErrorResponse(request.id, "CANDIDATE_FIELD_IN_USE"));
      }
      const deleted = await createCandidateFieldRepo(fastify.db).delete(
        ctx,
        id,
      );
      if (deleted) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "candidate_field.delete",
          targetType: "candidate_field",
          targetId: id,
        });
      }
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/candidate-fields/template",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CandidateFieldView),
      ],
      schema: {
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: templateResponseSchema },
      },
    },
    /**
     * GET /candidate-fields/template — return import template headers.
     *
     * Returns the column headers for a candidate import file:
     * username, password, name, followed by configured custom field names.
     */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const fields = (
        await createCandidateFieldRepo(fastify.db).list(ctx)
      ).sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        headers: [
          "username",
          "password",
          "name",
          ...fields.map((field) => field.name),
        ],
      };
    },
  );
};

export default candidateFieldRoutes;
