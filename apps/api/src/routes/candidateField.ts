import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCandidateFieldRequestSchema,
  UpdateCandidateFieldRequestSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { createCandidateFieldRepo } from "@exam/db/repository/candidateFieldRepo";
import { createCandidateRepo } from "@exam/db/repository/candidateRepo";
import { acquireOrganizationAdvisoryLock } from "@exam/db/lock";
import { executeInTransaction, hasPostgresErrorCode } from "@exam/db/types";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { recordBestEffortAudit } from "../audit/auditWriter.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { Permission } from "@exam/authz";

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * True when the error is a violation of the candidate identity partial
 * unique index (`candidate_fields_org_identity_uidx`) — the DB backstop of
 * the at-most-one identity field invariant. Any other 23505 on this table
 * (e.g. the per-org field-name unique index) keeps its existing behavior.
 */
function isIdentityFieldIndexViolation(err: unknown): boolean {
  if (!hasPostgresErrorCode(err, "23505")) return false;
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (
      typeof current === "object" &&
      current !== null &&
      (current as { constraint?: unknown }).constraint ===
        "candidate_fields_org_identity_uidx"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

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
      let field: Awaited<
        ReturnType<ReturnType<typeof createCandidateFieldRepo>["create"]>
      > | null = null;
      try {
        field = await executeInTransaction(
          fastify.db,
          async (tx) => {
            // Guard + write serialize on the candidate-identity lock shared
            // with candidate creation, so the precheck cannot race a
            // concurrent create past its check.
            await acquireOrganizationAdvisoryLock(
              tx,
              ctx.organizationId,
              "candidate-identity",
            );
            const repo = createCandidateFieldRepo(tx);
            if (
              data.unique &&
              (await repo.list(ctx)).some((field) => field.unique)
            ) {
              return null;
            }
            return await repo.create(ctx, data);
          },
          // "read committed" is load-bearing: the precheck must see rows
          // committed by the transaction whose lock we just waited on (the
          // REPEATABLE READ snapshot predates the lock wait).
          { isolationLevel: "read committed" },
        );
      } catch (err) {
        if (isIdentityFieldIndexViolation(err)) {
          return reply
            .code(409)
            .send(
              buildErrorResponse(
                request.id,
                "CANDIDATE_IDENTITY_FIELD_CONFLICT",
              ),
            );
        }
        throw err;
      }
      if (!field) {
        return reply
          .code(409)
          .send(
            buildErrorResponse(request.id, "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
          );
      }
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
     * Returns 404 if the field does not exist, 409 CANDIDATE_FIELD_IN_USE
     * if clearing unique would strip the org's only identity field while
     * candidates exist, or 409 CANDIDATE_IDENTITY_FIELD_CONFLICT if setting
     * unique would conflict with another existing identity field.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = UpdateCandidateFieldRequestSchema.parse(request.body);
      type FieldRow = NonNullable<
        Awaited<
          ReturnType<ReturnType<typeof createCandidateFieldRepo>["update"]>
        >
      >;
      type PatchOutcome =
        | { kind: "updated"; updated: FieldRow }
        | { kind: "not-found" }
        | { kind: "identity-conflict" }
        | { kind: "identity-in-use" };
      const outcome = await executeInTransaction<PatchOutcome>(
        fastify.db,
        async (tx) => {
          // Guard + write serialize on the candidate-identity lock shared
          // with candidate creation, so the guards cannot race a concurrent
          // candidate creation past their checks.
          await acquireOrganizationAdvisoryLock(
            tx,
            ctx.organizationId,
            "candidate-identity",
          );
          const repo = createCandidateFieldRepo(tx);
          const current = await repo.findById(ctx, id);
          if (!current) {
            return { kind: "not-found" };
          }
          if (
            data.unique === false &&
            current.unique &&
            (await createCandidateRepo(tx).count(ctx)) > 0
          ) {
            // INVARIANT (SPEC.md §2.3, #1066): candidates exist, so the
            // org's only identity field cannot be unmarked — same contract
            // as DELETE of that field.
            return { kind: "identity-in-use" };
          }
          if (
            data.unique &&
            (await repo.list(ctx)).some(
              (field) => field.unique && field.id !== id,
            )
          ) {
            return { kind: "identity-conflict" };
          }
          const updated = await repo.update(ctx, id, {
            ...(data.label !== undefined ? { label: data.label } : {}),
            ...(data.fieldType !== undefined
              ? { fieldType: data.fieldType }
              : {}),
            ...(data.required !== undefined ? { required: data.required } : {}),
            ...(data.unique !== undefined ? { unique: data.unique } : {}),
            ...(data.sortOrder !== undefined
              ? { sortOrder: data.sortOrder }
              : {}),
          });
          if (!updated) {
            return { kind: "not-found" };
          }
          return { kind: "updated", updated };
        },
        // "read committed" is load-bearing: the guards must see rows
        // committed by the transaction whose lock we just waited on (the
        // REPEATABLE READ snapshot predates the lock wait).
        { isolationLevel: "read committed" },
      );
      if (outcome.kind === "identity-in-use") {
        return reply
          .code(409)
          .send(buildErrorResponse(request.id, "CANDIDATE_FIELD_IN_USE"));
      }
      if (outcome.kind === "identity-conflict") {
        return reply
          .code(409)
          .send(
            buildErrorResponse(request.id, "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
          );
      }
      if (outcome.kind === "not-found") {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      const updated = outcome.updated;
      recordBestEffortAudit(fastify, request, ctx, {
        action: "candidate_field.update",
        targetType: "candidate_field",
        targetId: id,
        metadata: { changedFields: Object.keys(data) },
      });
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
      const outcome = await executeInTransaction(
        fastify.db,
        async (tx): Promise<{ inUse: boolean; deleted: boolean }> => {
          // Guard + write serialize on the candidate-identity lock shared
          // with candidate creation, so the count guard cannot race a
          // concurrent candidate creation past its check.
          await acquireOrganizationAdvisoryLock(
            tx,
            ctx.organizationId,
            "candidate-identity",
          );
          const field = await createCandidateFieldRepo(tx).findById(ctx, id);
          if (field?.unique && (await createCandidateRepo(tx).count(ctx)) > 0) {
            return { inUse: true, deleted: false };
          }
          return {
            inUse: false,
            deleted: await createCandidateFieldRepo(tx).delete(ctx, id),
          };
        },
        // "read committed" is load-bearing: the guard must see rows
        // committed by the transaction whose lock we just waited on (the
        // REPEATABLE READ snapshot predates the lock wait).
        { isolationLevel: "read committed" },
      );
      if (outcome.inUse) {
        return reply
          .code(409)
          .send(buildErrorResponse(request.id, "CANDIDATE_FIELD_IN_USE"));
      }
      if (outcome.deleted) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "candidate_field.delete",
          targetType: "candidate_field",
          targetId: id,
        });
      }
      if (!outcome.deleted) {
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
     * Headers are the fixed import columns followed by the configured custom
     * field names, in the fields' configured sort order.
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
