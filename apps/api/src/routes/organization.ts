import { FastifyPluginAsync } from "fastify";
import {
  CreateOrganizationRequestSchema,
  UpdateOrganizationRequestSchema,
} from "@exam/contracts";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/organizations",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["SuperAdmin"])],
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const orgRepo = createOrganizationRepo(fastify.db);
      const orgs = await orgRepo.list(ctx);
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
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const data = CreateOrganizationRequestSchema.parse(request.body);
      const orgRepo = createOrganizationRepo(fastify.db);
      const org = await orgRepo.create(ctx, data);
      recordAudit(
        fastify,
        request,
        ctx,
        "organization.create",
        "organization",
        org.id,
      );
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
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const data = UpdateOrganizationRequestSchema.parse(request.body);
      const orgRepo = createOrganizationRepo(fastify.db);
      const updated = await orgRepo.update(
        ctx,
        id,
        data as Partial<{ name: string; displayName: string; slug: string }>,
      );
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "organization.update",
        "organization",
        id,
      );
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
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const orgRepo = createOrganizationRepo(fastify.db);
      const deleted = await orgRepo.delete(ctx, id);
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(
        fastify,
        request,
        ctx,
        "organization.delete",
        "organization",
        id,
      );
      return reply.code(204).send();
    },
  );
};

export default organizationRoutes;
