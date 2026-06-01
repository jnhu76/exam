import { FastifyPluginAsync } from "fastify";
import {
  CreateCandidateRequestSchema,
  CandidateImportRequestSchema,
  UpdateCandidateRequestSchema,
} from "@exam/contracts";
import { PaginationParamsSchema } from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import type { RequestContext } from "@exam/domain";
import { ValidationError } from "@exam/domain";
import { ensureTargetOrg } from "./helpers.js";
import { recordAudit } from "./audit.js";

function validateCandidateFields(
  configuredFields: ReturnType<
    ReturnType<typeof createCandidateFieldRepo>["list"]
  >,
  fields: Record<string, unknown>,
): void {
  if (configuredFields.length === 0) {
    return;
  }
  if (configuredFields.filter((field) => field.unique).length !== 1) {
    throw new ValidationError(
      "Exactly one candidate identity field is required",
    );
  }
  for (const field of configuredFields) {
    const value = fields[field.name];
    if (
      field.required &&
      (value === undefined || value === null || value === "")
    ) {
      throw new ValidationError(`${field.label} is required`);
    }
    if (
      value !== undefined &&
      value !== null &&
      field.fieldType === "number" &&
      typeof value !== "number"
    ) {
      throw new ValidationError(`${field.label} must be a number`);
    }
    if (
      value !== undefined &&
      value !== null &&
      field.fieldType !== "number" &&
      typeof value !== "string"
    ) {
      throw new ValidationError(`${field.label} must be text`);
    }
  }
}

function findByIdentity(
  candidates: ReturnType<ReturnType<typeof createCandidateRepo>["list"]>,
  configuredFields: ReturnType<
    ReturnType<typeof createCandidateFieldRepo>["list"]
  >,
  fields: Record<string, unknown>,
) {
  const uniqueField = configuredFields.find((field) => field.unique);
  if (!uniqueField) return null;
  return (
    candidates.find(
      (candidate) =>
        candidate.fields[uniqueField.name] === fields[uniqueField.name],
    ) ?? null
  );
}

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
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createCandidateRepo(fastify.db);
      const userRepo = createUserRepo(fastify.db);
      const { items, total } = repo.listPaginated(ctx, page, pageSize);

      return {
        items: items.map((c) => {
          const user = userRepo.findById(ctx, c.userId);
          return {
            ...c,
            name: user?.name ?? "",
            username: user?.username ?? "",
            isActive: user?.isActive ?? false,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
          };
        }),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
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
      const configuredFields = createCandidateFieldRepo(fastify.db).list(ctx);
      validateCandidateFields(configuredFields, data.fields);
      if (
        findByIdentity(candidateRepo.list(ctx), configuredFields, data.fields)
      ) {
        throw new ValidationError("Candidate identity already exists");
      }

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
      recordAudit(
        fastify,
        request,
        ctx,
        "candidate.create",
        "candidate",
        candidate.id,
      );

      return reply.code(201).send({
        ...candidate,
        createdAt: candidate.createdAt.toISOString(),
        updatedAt: candidate.updatedAt.toISOString(),
      });
    },
  );

  fastify.patch(
    "/candidates/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
    },
    async (request, reply) => {
      const ctx = ensureTargetOrg(request.ctx!);
      const { id } = request.params as { id: string };
      const data = UpdateCandidateRequestSchema.parse(request.body);
      const candidateRepo = createCandidateRepo(fastify.db);
      const candidate = candidateRepo.findById(ctx, id);
      if (!candidate) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate not found" },
        });
      }
      if (data.fields) {
        const configuredFields = createCandidateFieldRepo(fastify.db).list(ctx);
        validateCandidateFields(configuredFields, data.fields);
        const duplicate = findByIdentity(
          candidateRepo.list(ctx),
          configuredFields,
          data.fields,
        );
        if (duplicate && duplicate.id !== id) {
          throw new ValidationError("Candidate identity already exists");
        }
        candidateRepo.update(ctx, id, { fields: data.fields });
      }
      if (data.name !== undefined || data.isActive !== undefined) {
        createUserRepo(fastify.db).update(ctx, candidate.userId, {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        });
      }
      const updated = candidateRepo.findById(ctx, id)!;
      recordAudit(fastify, request, ctx, "candidate.update", "candidate", id);
      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/candidates/import",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60 * 1000,
        },
      },
    },
    async (request: any) => {
      const ctx = ensureTargetOrg(request["ctx"] as RequestContext);
      const data = CandidateImportRequestSchema.parse(request.body);
      const userRepo = createUserRepo(fastify.db);
      const candidateRepo = createCandidateRepo(fastify.db);
      const configuredFields = createCandidateFieldRepo(fastify.db).list(ctx);

      let created = 0;
      let updated = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < data.rows.length; i++) {
        try {
          const row = data.rows[i]!;
          const username = row.username as string | undefined;
          const password = row.password as string | undefined;
          const name = row.name as string | undefined;
          const fields = (row.fields as Record<string, unknown>) ?? {};

          if (!username || !name) {
            errors.push({ row: i, message: "Missing required fields" });
            continue;
          }
          validateCandidateFields(configuredFields, fields);
          const existing = findByIdentity(
            candidateRepo.list(ctx),
            configuredFields,
            fields,
          );
          if (existing) {
            candidateRepo.update(ctx, existing.id, { fields });
            userRepo.update(ctx, existing.userId, { name });
            updated++;
            continue;
          }
          if (!password) {
            errors.push({
              row: i,
              message: "Password is required for new candidates",
            });
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

          candidateRepo.create(ctx, { userId: user.id, fields });
          created++;
        } catch (err) {
          errors.push({
            row: i,
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      recordAudit(
        fastify,
        request,
        ctx,
        "candidate.import",
        "organization",
        ctx.targetOrganizationId!,
        { total: data.rows.length, created, updated, errors: errors.length },
      );
      return { total: data.rows.length, created, updated, errors };
    },
  );
};

export default candidateRoutes;
