import { FastifyPluginAsync } from "fastify";
import {
  CreateCandidateFieldRequestSchema,
  UpdateCandidateFieldRequestSchema,
} from "@exam/contracts";
import { createDatabase } from "@exam/db/src/database.js";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import type { RequestContext } from "@exam/domain";

function ensureTargetOrg(ctx: RequestContext): RequestContext {
  if (!ctx.targetOrganizationId) {
    return { ...ctx, targetOrganizationId: ctx.organizationId };
  }
  return ctx;
}

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
      const { db } = createDatabase();
      const repo = createCandidateFieldRepo(db);
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
      const { db } = createDatabase();
      const repo = createCandidateFieldRepo(db);
      const field = repo.create(ctx, data);
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
      const { db } = createDatabase();
      const repo = createCandidateFieldRepo(db);
      const updated = repo.update(ctx, id, data as Record<string, unknown>);
      if (!updated) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate field not found" },
        });
      }
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
      const { db } = createDatabase();
      const repo = createCandidateFieldRepo(db);
      const deleted = repo.delete(ctx, id);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate field not found" },
        });
      }
      return reply.code(204).send();
    },
  );
};

export default candidateFieldRoutes;
