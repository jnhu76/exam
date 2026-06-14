import { FastifyPluginAsync } from "fastify";
import {
  CreateCandidateFieldRequestSchema,
  UpdateCandidateFieldRequestSchema,
} from "@exam/contracts";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

const candidateFieldRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/candidate-fields",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
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
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const data = CreateCandidateFieldRequestSchema.parse(request.body);
      const repo = createCandidateFieldRepo(fastify.db);
      if (data.unique && (await repo.list(ctx)).some((field) => field.unique)) {
        return reply
          .code(409)
          .send(
            buildErrorResponse(request.id, "CANDIDATE_IDENTITY_FIELD_CONFLICT"),
          );
      }
      const field = await repo.create(ctx, data);
      recordAudit(
        fastify,
        request,
        ctx,
        "candidate_field.create",
        "candidate_field",
        field.id,
      );
      return reply.code(201).send({
        ...field,
        createdAt: field.createdAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/candidate-fields/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
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
      const updated = await repo.update(ctx, id, {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.fieldType !== undefined ? { fieldType: data.fieldType } : {}),
        ...(data.required !== undefined ? { required: data.required } : {}),
        ...(data.unique !== undefined ? { unique: data.unique } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "candidate_field.update",
        "candidate_field",
        id,
      );
      return { ...updated, createdAt: updated.createdAt.toISOString() };
    },
  );

  fastify.delete(
    "/candidate-fields/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
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
      const deleted = await repo.delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "candidate_field.delete",
        "candidate_field",
        id,
      );
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/candidate-fields/template",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
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
