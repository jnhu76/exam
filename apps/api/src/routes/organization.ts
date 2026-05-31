import { FastifyPluginAsync } from "fastify";
import {
  CreateOrganizationRequestSchema,
  UpdateOrganizationRequestSchema,
} from "@exam/contracts";
import { createDatabase } from "@exam/db/src/database.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/organizations",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { db } = createDatabase();
      const orgRepo = createOrganizationRepo(db);
      const orgs = orgRepo.list(ctx);
      return orgs.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/organizations",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CreateOrganizationRequestSchema.parse(request.body);
      const { db } = createDatabase();
      const orgRepo = createOrganizationRepo(db);
      const org = orgRepo.create(ctx, data);
      return reply.code(201).send({
        ...org,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/organizations/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const data = UpdateOrganizationRequestSchema.parse(request.body);
      const { db } = createDatabase();
      const orgRepo = createOrganizationRepo(db);
      const updated = orgRepo.update(
        ctx,
        id,
        data as Partial<{ name: string; displayName: string; slug: string }>,
      );
      if (!updated) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Organization not found" },
        });
      }
      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  fastify.delete(
    "/organizations/:id",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const { id } = request.params as { id: string };
      const { db } = createDatabase();
      const orgRepo = createOrganizationRepo(db);
      const deleted = orgRepo.delete(ctx, id);
      if (!deleted) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Organization not found" },
        });
      }
      return reply.code(204).send();
    },
  );
};

export default organizationRoutes;
