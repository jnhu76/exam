import type { FastifyPluginAsync } from "fastify";
import {
  ImportLogListQuerySchema,
  ImportLogListResponseSchema,
} from "@exam/contracts";
import { ensureTargetOrg } from "./helpers.js";
import { createImportJobLogRepo } from "@exam/db/src/repository/importJobLogRepo.js";

const cookieAuth = [{ cookieAuth: [] }] as const;

const importLogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/admin/import-logs",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        querystring: ImportLogListQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: ImportLogListResponseSchema },
      },
    },
    async (request) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { page, pageSize, type } = ImportLogListQuerySchema.parse(
        request.query,
      );
      const repo = createImportJobLogRepo(fastify.db);
      const { items, total } = await repo.list(ctx, page, pageSize, type);
      return {
        items: items.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          total: row.total,
          createdCount: row.createdCount,
          updatedCount: row.updatedCount,
          errors: row.errors,
          metadata: row.metadata,
          errorsDetail: row.errorsDetail,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );
};

export default importLogRoutes;
