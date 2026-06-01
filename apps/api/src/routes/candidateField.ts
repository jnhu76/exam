import { FastifyPluginAsync } from "fastify";
import {
  CreateCandidateFieldRequestSchema,
  UpdateCandidateFieldRequestSchema,
} from "@exam/contracts";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";

const candidateFieldRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/candidate-fields",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const repo = createCandidateFieldRepo(fastify.db);
      const fields = repo.list(ctx);
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
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CreateCandidateFieldRequestSchema.parse(request.body);
      const repo = createCandidateFieldRepo(fastify.db);
      if (data.unique && repo.list(ctx).some((field) => field.unique)) {
        return reply.code(409).send({
          error: {
            code: "CONFLICT",
            message: "Only one candidate identity field can be unique",
          },
        });
      }
      const field = repo.create(ctx, data);
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const data = UpdateCandidateFieldRequestSchema.parse(request.body);
      const repo = createCandidateFieldRepo(fastify.db);
      if (
        data.unique &&
        repo.list(ctx).some((field) => field.unique && field.id !== id)
      ) {
        return reply.code(409).send({
          error: {
            code: "CONFLICT",
            message: "Only one candidate identity field can be unique",
          },
        });
      }
      const updated = repo.update(ctx, id, data as Record<string, unknown>);
      if (!updated) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate field not found" },
        });
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const repo = createCandidateFieldRepo(fastify.db);
      const field = repo.findById(ctx, id);
      if (field?.unique && createCandidateRepo(fastify.db).count(ctx) > 0) {
        return reply.code(409).send({
          error: {
            code: "CONFLICT",
            message: "Cannot delete the active candidate identity field",
          },
        });
      }
      const deleted = repo.delete(ctx, id);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate field not found" },
        });
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
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const fields = createCandidateFieldRepo(fastify.db)
        .list(ctx)
        .sort((a, b) => a.sortOrder - b.sortOrder);
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
