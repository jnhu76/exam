import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCandidateRequestSchema,
  CandidateImportRequestSchema,
  CandidateImportResultSchema,
  UpdateCandidateRequestSchema,
  candidateFieldValidationMessages,
  ErrorResponseSchema,
  getErrorMessage,
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
import { resolveTeacherCourseScope } from "./teacherScope.js";
import {
  recordAtomicHttpAudit,
  recordBestEffortAudit,
} from "../audit/auditWriter.js";
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
            // Machine params per message contract D0.4/D0.7: the dynamic
            // fact (which configured field failed) is structural, the prose
            // in message is non-authoritative compatibility text.
            params: { label: field.label },
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
            params: { label: field.label },
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
            params: { label: field.label },
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
  email: z.string().email().nullable(),
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
     * Teacher actors see only candidates enrolled in exams under their
     * assigned courses (SQL-side EXISTS, before pagination — issue #286).
     */
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize } = PaginationParamsSchema.parse(request.query);
      const repo = createCandidateRepo(fastify.db);
      const userRepo = createUserRepo(fastify.db);
      const scope = await resolveTeacherCourseScope(fastify.db, ctx);
      const { items, total } = scope
        ? await repo.listByCourseScopePaginated(ctx, scope, page, pageSize)
        : await repo.listPaginated(ctx, page, pageSize);

      const itemsWithUsers = await Promise.all(
        items.map(async (c) => {
          const user = await userRepo.findById(ctx, c.userId);
          return {
            ...c,
            name: user?.name ?? "",
            username: user?.username ?? "",
            isActive: user?.isActive ?? false,
            email: user?.email ?? null,
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
      let createdEmail: string | null;
      try {
        const created = await executeInTransaction(fastify.db, async (tx) => {
          const txUserRepo = createUserRepo(tx);
          const txCandidateRepo = createCandidateRepo(tx);
          const user = await txUserRepo.createUnique(ctx, {
            username: data.username,
            passwordHash,
            name: data.name,
            role: "Candidate" as const,
            isActive: true,
            // P5-N1 §13: optional recipient email; contract normalizes + maps
            // blank to undefined, so we store null when absent.
            email: data.email ?? null,
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
          const createdProfile = await txCandidateRepo.create(ctx, {
            userId: user.id,
            fields: data.fields,
          });
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: "candidate.create",
            targetType: "candidate",
            targetId: createdProfile.id,
          });
          return { profile: createdProfile, email: user.email };
        });
        candidate = created.profile;
        createdEmail = created.email;
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
      return reply.code(201).send({
        ...candidate,
        name: data.name,
        username: data.username,
        isActive: true,
        email: createdEmail ?? null,
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
      }
      // P5-N1 §13: `email` is optional. Treat "field present in body" as an
      // explicit write (blank -> null clears it); "field absent" is a no-op.
      const emailProvided =
        request.body != null && "email" in (request.body as object);
      const updated = await executeInTransaction(fastify.db, async (tx) => {
        const txCandidateRepo = createCandidateRepo(tx);
        const txUserRepo = createUserRepo(tx);
        const targetUser = await txUserRepo.findById(ctx, candidate.userId);
        const activeChanged =
          data.isActive !== undefined &&
          targetUser !== null &&
          data.isActive !== targetUser.isActive;
        if (data.fields) {
          await txCandidateRepo.update(ctx, id, { fields: data.fields });
        }
        if (
          data.name !== undefined ||
          data.isActive !== undefined ||
          emailProvided
        ) {
          await txUserRepo.update(ctx, candidate.userId, {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(emailProvided ? { email: data.email ?? null } : {}),
          });
        }
        const changed = await txCandidateRepo.findById(ctx, id);
        if (!changed) return null;
        if (activeChanged) {
          await recordAtomicHttpAudit(tx, request, ctx, {
            action: data.isActive ? "user.reactivated" : "user.disabled",
            targetType: "user",
            targetId: candidate.userId,
          });
        }
        return changed;
      });
      if (!updated) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      const user = await createUserRepo(fastify.db).findById(
        ctx,
        updated.userId,
      );
      const changedFields = [
        ...(data.fields ? ["fields"] : []),
        ...(data.name !== undefined ? ["name"] : []),
        ...(emailProvided ? ["email"] : []),
      ];
      if (changedFields.length > 0) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "candidate.update",
          targetType: "candidate",
          targetId: id,
          metadata: { changedFields },
        });
      }
      return {
        ...updated,
        name: user?.name ?? "",
        username: user?.username ?? "",
        isActive: user?.isActive ?? false,
        email: user?.email ?? null,
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
              // i18n-copy-allow: wire-compat — non-authoritative import-row compatibility message persisted for logs; row code is the contract
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
            await executeInTransaction(fastify.db, async (tx) => {
              await createCandidateRepo(tx).update(ctx, existing.id, {
                fields,
              });
              await createUserRepo(tx).update(ctx, existing.userId, { name });
            });
            existingUsernames.add(username);
            userIdMap.set(username, existing.userId);
            updated++;
            continue;
          }
          if (!password) {
            errors.push({
              row: i + 1,
              code: "MISSING_PASSWORD",
              // i18n-copy-allow: wire-compat — non-authoritative import-row compatibility message persisted for logs; row code is the contract
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
              const createdCandidate = await txCandidateRepo.create(ctx, {
                userId: createdUser.id,
                fields,
              });
              await recordAtomicHttpAudit(tx, request, ctx, {
                action: "candidate.create",
                targetType: "candidate",
                targetId: createdCandidate.id,
              });
              return createdCandidate;
            },
          );
          existingUsernames.add(username);
          userIdMap.set(username, candidate.userId);
          allCandidates.push(candidate);
          created++;
        } catch (err) {
          // INVARIANT (message contract D0.5, C6 F-12): only the explicitly
          // classified ValidationError may carry its prose into the row
          // error. Any unexpected internal exception (SQL, driver, trigger,
          // filesystem) is reduced to the canonical INTERNAL_ERROR
          // compatibility message — raw err.message must never reach
          // errors[], the response, or the persisted import log.
          errors.push({
            row: i + 1,
            code:
              err instanceof ValidationError
                ? "VALIDATION_ERROR"
                : "INTERNAL_ERROR",
            message:
              err instanceof ValidationError
                ? err.message
                : getErrorMessage("INTERNAL_ERROR"),
          });
        }
      }

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
      recordBestEffortAudit(fastify, request, ctx, {
        action: "candidate.import",
        targetType: "candidate_import",
        targetId: logId ?? request.id,
        metadata: {
          total: data.rows.length,
          created,
          updated,
          errors: errors.length,
        },
      });
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
