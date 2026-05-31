import { FastifyPluginAsync } from "fastify";
import {
  CreateCandidateRequestSchema,
  CandidateImportRequestSchema,
} from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";

const candidateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/candidates",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const repo = createCandidateRepo(fastify.db);
      const candidates = repo.list(ctx);
      return candidates.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/candidates",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CreateCandidateRequestSchema.parse(request.body);
      const userRepo = createUserRepo(fastify.db);
      const candidateRepo = createCandidateRepo(fastify.db);

      const passwordHash = await hashPassword(data.password);
      const user = userRepo.create(ctx, {
        username: data.username,
        passwordHash,
        name: data.name,
        role: "Candidate" as const,
        isActive: true,
      });

      const candidate = candidateRepo.create(ctx, {
        userId: user.id,
        fields: data.fields,
      });

      return reply.code(201).send({
        ...candidate,
        createdAt: candidate.createdAt.toISOString(),
        updatedAt: candidate.updatedAt.toISOString(),
      });
    },
  );

  fastify.post(
    "/candidates/import",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CandidateImportRequestSchema.parse(request.body);
      const userRepo = createUserRepo(fastify.db);
      const candidateRepo = createCandidateRepo(fastify.db);

      let created = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < data.rows.length; i++) {
        try {
          const row = data.rows[i]!;
          const username = row.username as string | undefined;
          const password = row.password as string | undefined;
          const name = row.name as string | undefined;

          if (!username || !password || !name) {
            errors.push({ row: i, message: "Missing required fields" });
            continue;
          }

          const passwordHash = await hashPassword(password);
          const user = userRepo.create(ctx, {
            username,
            passwordHash,
            name,
            role: "Candidate" as const,
            isActive: true,
          });

          const fields = (row.fields as Record<string, unknown>) ?? {};
          candidateRepo.create(ctx, { userId: user.id, fields });
          created++;
        } catch (err) {
          errors.push({
            row: i,
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      return { total: data.rows.length, created, updated: 0, errors };
    },
  );
};

export default candidateRoutes;
