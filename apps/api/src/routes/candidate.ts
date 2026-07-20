import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCandidateRequestSchema,
  CandidateImportRequestSchema,
  CandidateImportResultSchema,
  UpdateCandidateRequestSchema,
  candidateFieldValidationMessages,
  ErrorResponseSchema,
} from "@exam/contracts";
import { PaginationParamsSchema } from "@exam/contracts";
import { hashPassword } from "@exam/auth/src/password.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { createCandidateFieldRepo } from "@exam/db/src/repository/candidateFieldRepo.js";
import { createImportJobLogRepo } from "@exam/db/src/repository/importJobLogRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { Permission } from "@exam/authz";
import {
  CandidateIdentityConflictError,
  UserAlreadyExistsError,
  ValidationError,
} from "@exam/domain";
import {
  ensureTargetOrg,
  getRequestContext,
  resolveImportStatus,
} from "./helpers.js";
import { recordAudit } from "./audit.js";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
} from "../lib/errorResponse.js";

/**
 * Validate candidate field values against configured candidate fields.
 *
 * Ensures exactly one unique (identity) field is configured, that all
 * required fields are present, and that field types match expectations.
 * Throws {@link ValidationError} on validation failure.
 */
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
      {
        fields: [
          {
            field: "fields",
            code: "IDENTITY_FIELD_CONFIGURATION",
            message: candidateFieldValidationMessages.configurationInvalid,
          },
        ],
      },
    );
  }
  for (const field of configuredFields) {
    const value = fields[field.name];
    if (
      field.required &&
      (value === undefined || value === null || value === "")
    ) {
      throw new ValidationError(`${field.label} is required`, {
        fields: [
          {
            field: `fields.${field.name}`,
            code: "REQUIRED",
            message: candidateFieldValidationMessages.required(field.label),
          },
        ],
      });
    }
    if (
      value !== undefined &&
      value !== null &&
      field.fieldType === "number" &&
      typeof value !== "number"
    ) {
      throw new ValidationError(`${field.label} must be a number`, {
        fields: [
          {
            field: `fields.${field.name}`,
            code: "INVALID_TYPE",
            message: candidateFieldValidationMessages.numberRequired(
              field.label,
            ),
          },
        ],
      });
    }
    if (
      value !== undefined &&
      value !== null &&
      field.fieldType !== "number" &&
      typeof value !== "string"
    ) {
      throw new ValidationError(`${field.label} must be text`, {
        fields: [
          {
            field: `fields.${field.name}`,
            code: "INVALID_TYPE",
            message: candidateFieldValidationMessages.textRequired(field.label),
          },
        ],
      });
    }
  }
}

/**
 * Find an existing candidate whose unique (identity) field matches the given value.
 *
 * Returns the first matching candidate or null if no match is found.
 */
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

/** OpenAPI security scheme requiring cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for a single candidate item in list/detail responses. */
const candidateItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  fields: z.record(z.unknown()),
  name: z.string(),
  username: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

/** Zod schema for a paginated candidate list response. */
const candidateListResponseSchema = z.object({
  items: z.array(candidateItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
});

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Fastify plugin that registers candidate management routes.
 *
 * Provides list, create, update, and import endpoints for candidates.
 * Candidate writes require Admin; the read list follows CandidateView.
 */
const candidateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/candidates",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CandidateView),
      ],
      schema: {
        querystring: PaginationParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 200: candidateListResponseSchema },
      },
    },
    /**
     * GET /candidates — list candidates with pagination.
     *
     * Returns paginated candidate records enriched with user-level
     * name, username, and isActive status. Requires CandidateView.
     */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
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
        fastify.requireCapability(Permission.CandidateCreate),
      ],
      schema: {
        body: CreateCandidateRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 201: candidateItemSchema, 409: ErrorResponseSchema },
      },
    },
    /**
     * POST /candidates — create a single candidate.
     *
     * Validates custom candidate fields, checks identity uniqueness,
     * creates a User record and associated CandidateProfile in a
     * transaction. Returns 409 on username or identity conflict.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const data = CreateCandidateRequestSchema.parse(request.body);
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
        throw new CandidateIdentityConflictError();
      }

      const passwordHash = await hashPassword(data.password);
      let candidate;
      try {
        candidate = await executeInTransaction(fastify.db, async (tx) => {
          const txUserRepo = createUserRepo(tx);
          const txCandidateRepo = createCandidateRepo(tx);
          const user = await txUserRepo.createUnique(ctx, {
            username: data.username,
            passwordHash,
            name: data.name,
            role: "Candidate" as const,
            isActive: true,
          });
          // RBAC-M10-E: a candidate created here MUST get a primary active
          // Candidate assignment in the SAME transaction, or the M10-E flip
          // would leave the new candidate with no authority row (locked out).
          await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
            tx,
            ctx,
            {
              userId: user.id,
              role: "Candidate",
              isPrimary: true,
              isActive: true,
            },
          );
          return txCandidateRepo.create(ctx, {
            userId: user.id,
            fields: data.fields,
          });
        });
      } catch (err: unknown) {
        if (err instanceof UserAlreadyExistsError) {
          return reply
            .code(409)
            .send(buildErrorResponse(request.id, "USER_ALREADY_EXISTS"));
        }
        if (
          err &&
          typeof err === "object" &&
          (err as Record<string, unknown>).code === "23505"
        ) {
          const constraint = String(
            (err as Record<string, unknown>).constraint ?? "",
          );
          if (constraint === "candidate_profiles_org_user_unique") {
            return reply
              .code(409)
              .send(
                buildErrorResponse(request.id, "CANDIDATE_IDENTITY_CONFLICT"),
              );
          }
          return reply
            .code(409)
            .send(buildErrorResponse(request.id, "RESOURCE_CONFLICT"));
        }
        throw err;
      }
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
        name: data.name,
        username: data.username,
        isActive: true,
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
        fastify.requireCapability(Permission.CandidateUpdate),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateCandidateRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: candidateItemSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    /**
     * PATCH /candidates/:id — update an existing candidate's fields, name, or active status.
     *
     * When updating fields, validates them against configured candidate fields
     * and checks identity uniqueness against other candidates.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = UpdateCandidateRequestSchema.parse(request.body);
      const candidateRepo = createCandidateRepo(fastify.db);
      const candidate = await candidateRepo.findById(ctx, id);
      if (!candidate) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
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
          throw new CandidateIdentityConflictError();
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
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      recordAudit(fastify, request, ctx, "candidate.update", "candidate", id);
      const user = await createUserRepo(fastify.db).findById(
        ctx,
        updated.userId,
      );
      return {
        ...updated,
        name: user?.name ?? "",
        username: user?.username ?? "",
        isActive: user?.isActive ?? false,
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
        fastify.requireCapability(Permission.CandidateImport),
      ],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60 * 1000,
        },
      },
      schema: {
        body: CandidateImportRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          200: CandidateImportResultSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    /**
     * POST /candidates/import — bulk import candidates from rows.
     *
     * Creates new candidates or updates existing ones (matched by identity
     * field or username). Returns a summary of created, updated, and errored rows.
     * Rate-limited to 10 requests per minute.
     */
    async (request, reply) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const parsed = CandidateImportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(buildValidationErrorResponse(request.id, parsed.error));
      }
      const data = parsed.data;
      const userRepo = createUserRepo(fastify.db);
      const candidateRepo = createCandidateRepo(fastify.db);
      const configuredFields = await createCandidateFieldRepo(fastify.db).list(
        ctx,
      );

      const allCandidates = await candidateRepo.list(ctx);
      const existingUsernames = new Set<string>();
      const userIdMap = new Map<string, string>();
      for (const user of await userRepo.list(ctx)) {
        existingUsernames.add(user.username);
        userIdMap.set(user.username, user.id);
      }

      let created = 0;
      let updated = 0;
      const errors: { row: number; code: string; message: string }[] = [];

      for (let i = 0; i < data.rows.length; i++) {
        try {
          const row = data.rows[i]!;
          const username = row.username;
          const password = row.password;
          const name = row.name;
          const fields = row.fields ?? {};

          if (!username || !name) {
            errors.push({
              row: i + 1,
              code: "MISSING_REQUIRED_FIELD",
              message: "缺少用户名或姓名",
            });
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
              code: "MISSING_PASSWORD",
              message: "新增考生需要初始密码",
            });
            continue;
          }

          const passwordHash = await hashPassword(password);
          // RBAC-M10-E: create user + primary Candidate assignment +
          // candidate profile in ONE per-row transaction. A failure in any of
          // the three rolls back all three for THIS row only; other rows are
          // unaffected. The catch below records the row-level import error.
          const candidate = await executeInTransaction(
            fastify.db,
            async (tx) => {
              const txUserRepo = createUserRepo(tx);
              const txCandidateRepo = createCandidateRepo(tx);
              const createdUser = await txUserRepo.createUnique(ctx, {
                username,
                passwordHash,
                name,
                role: "Candidate" as const,
                isActive: true,
              });
              await createUserRoleAssignmentRepo(tx).assignWithinTransaction(
                tx,
                ctx,
                {
                  userId: createdUser.id,
                  role: "Candidate",
                  isPrimary: true,
                  isActive: true,
                },
              );
              return txCandidateRepo.create(ctx, {
                userId: createdUser.id,
                fields,
              });
            },
          );
          existingUsernames.add(username);
          userIdMap.set(username, candidate.userId);
          allCandidates.push(candidate);
          created++;
        } catch (err) {
          errors.push({
            row: i + 1,
            code:
              err instanceof ValidationError
                ? "VALIDATION_ERROR"
                : "INTERNAL_ERROR",
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
      const candidateLogStatus = resolveImportStatus({
        errors: errors.length,
        affectedCount: created + updated,
      });
      let logId: string | undefined;
      try {
        const candidateLog = await createImportJobLogRepo(fastify.db).create(
          ctx,
          {
            type: "candidate",
            status: candidateLogStatus,
            total: data.rows.length,
            createdCount: created,
            updatedCount: updated,
            errors: errors.length,
            metadata: {},
            errorsDetail: errors.length > 0 ? errors : null,
          },
        );
        logId = candidateLog.id;
      } catch (logError) {
        fastify.log.error(
          { err: logError, type: "candidate", status: candidateLogStatus },
          "Failed to persist candidate import log; import result is unchanged",
        );
      }
      return {
        total: data.rows.length,
        created,
        updated,
        errors,
        ...(logId ? { logId } : {}),
      };
    },
  );
};

export default candidateRoutes;
