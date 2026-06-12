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
  configuredFields: Awaited<
    ReturnType<ReturnType<typeof createCandidateFieldRepo>["list"]>
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
  candidates: Awaited<
    ReturnType<ReturnType<typeof createCandidateRepo>["list"]>
  >,
  configuredFields: Awaited<
    ReturnType<ReturnType<typeof createCandidateFieldRepo>["list"]>
  >,
  fields: Record<string, unknown>,
) {
  const uniqueField = configuredFields.find((field) => field.unique);
  if (!uniqueField) return null;
  const value = fields[uniqueField.name];
  if (value === undefined || value === null || value === "") return null;
  return (
    candidates.find(
      (candidate) => candidate.fields[uniqueField.name] === value,
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
      const { items, total } = await repo.listPaginated(ctx, page, pageSize);

      const itemsWithUsers = await Promise.all(
        items.map(async (c) => {
          const user = await userRepo.findById(ctx, c.userId);
          return {
            ...c,
            name: user?.name ?? "",
            username: user?.username ?? "",
            isActive: user?.isActive ?? false,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
          };
        }),
      );
      return {
        items: itemsWithUsers,
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
      const configuredFields = await createCandidateFieldRepo(fastify.db).list(
        ctx,
      );
      validateCandidateFields(configuredFields, data.fields);
      if (
        findByIdentity(
          await candidateRepo.list(ctx),
          configuredFields,
          data.fields,
        )
      ) {
        throw new ValidationError("Candidate identity already exists");
      }

      const passwordHash = await hashPassword(data.password);
      let user;
      try {
        user = await userRepo.create(ctx, {
          username: data.username,
          passwordHash,
          name: data.name,
          role: "Candidate" as const,
          isActive: true,
        });
      } catch (err: any) {
        if (
          err?.code === "23505" ||
          err?.message?.includes("unique") ||
          err?.message?.includes("duplicate")
        ) {
          return reply.code(409).send({
            error: {
              code: "DUPLICATE",
              message: "Username already exists",
            },
          });
        }
        throw err;
      }

      const candidate = await candidateRepo.create(ctx, {
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
      const candidate = await candidateRepo.findById(ctx, id);
      if (!candidate) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate not found" },
        });
      }
      if (data.fields) {
        const configuredFields = await createCandidateFieldRepo(
          fastify.db,
        ).list(ctx);
        validateCandidateFields(configuredFields, data.fields);
        const duplicate = findByIdentity(
          await candidateRepo.list(ctx),
          configuredFields,
          data.fields,
        );
        if (duplicate && duplicate.id !== id) {
          throw new ValidationError("Candidate identity already exists");
        }
        await candidateRepo.update(ctx, id, { fields: data.fields });
      }
      if (data.name !== undefined || data.isActive !== undefined) {
        await createUserRepo(fastify.db).update(ctx, candidate.userId, {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        });
      }
      const updated = await candidateRepo.findById(ctx, id);
      if (!updated) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Candidate not found" },
        });
      }
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
      const configuredFields = await createCandidateFieldRepo(fastify.db).list(
        ctx,
      );

      const allCandidates = await candidateRepo.list(ctx);
      // TODO: optimize for large orgs — userRepo.list(ctx) loads all users into memory.
      // Consider a role-scoped query or batch lookup when orgs exceed ~10k users.
      const existingUsernames = new Set<string>();
      const userIdMap = new Map<string, string>();
      for (const user of await userRepo.list(ctx)) {
        existingUsernames.add(user.username);
        userIdMap.set(user.username, user.id);
      }

      let created = 0;
      let updated = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < data.rows.length; i++) {
        try {
          const row = data.rows[i]!;
          const username = row.username;
          const password = row.password;
          const name = row.name;
          const fields = row.fields ?? {};

          if (!username || !name) {
            errors.push({ row: i + 1, message: "缺少用户名或姓名" });
            continue;
          }
          validateCandidateFields(configuredFields, fields);
          let existing = findByIdentity(
            allCandidates,
            configuredFields,
            fields,
          );
          if (!existing && existingUsernames.has(username)) {
            const userId = userIdMap.get(username)!;
            existing = await candidateRepo.findByUserId(ctx, userId);
          }
          if (existing) {
            await candidateRepo.update(ctx, existing.id, { fields });
            await userRepo.update(ctx, existing.userId, { name });
            existingUsernames.add(username);
            userIdMap.set(username, existing.userId);
            updated++;
            continue;
          }
          if (!password) {
            errors.push({
              row: i + 1,
              message: "新增考生需要初始密码",
            });
            continue;
          }

          const passwordHash = await hashPassword(password);
          const user = await userRepo.create(ctx, {
            username,
            passwordHash,
            name,
            role: "Candidate" as const,
            isActive: true,
          });
          existingUsernames.add(username);
          userIdMap.set(username, user.id);

          const candidate = await candidateRepo.create(ctx, {
            userId: user.id,
            fields,
          });
          allCandidates.push(candidate);
          created++;
        } catch (err) {
          errors.push({
            row: i + 1,
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
