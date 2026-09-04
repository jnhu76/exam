import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  CreateCourseRequestSchema,
  UpdateCourseRequestSchema,
  PaginationParamsSchema,
  ErrorResponseSchema,
} from "@exam/contracts";
import { Permission, AuditAction } from "@exam/authz";
import { createCourseRepo } from "@exam/db/src/repository/courseRepo.js";
import type { CourseListFilters } from "@exam/db/src/repository/courseRepo.js";
import { createQuestionRepo } from "@exam/db/src/repository/questionRepo.js";
import { createTeacherCourseAssignmentRepo } from "@exam/db/src/repository/teacherCourseAssignmentRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { isOrgWideAdmin, resolveTeacherCourseScope } from "./teacherScope.js";
import {
  recordBestEffortAudit,
  recordAtomicHttpAudit,
} from "../audit/auditWriter.js";
import { buildErrorResponse } from "../lib/errorResponse.js";

/** OpenAPI security scheme: HTTP-only cookie authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/** Zod schema for a single course item returned in list and detail responses. */
const courseItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Zod schema for the paginated course list response. */
const courseListResponseSchema = z.object({
  items: z.array(courseItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
});

/** Zod schema for course list query parameters (extends PaginationParamsSchema with optional search). */
const CourseListQuerySchema = PaginationParamsSchema.extend({
  // Bound the search term so a very long value cannot amplify the
  // case-insensitive full-scan predicate. Matches the longest searchable
  // field (course name, max 200); no trim() to avoid changing the matched
  // value (the repo already trims internally).
  search: z.string().max(200).optional(),
});

/** Zod schema for route params containing a UUID `id`. */
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * INVARIANT (message contract D0.3/D0.6): COURSE_CODE_EXISTS is published
 * only for the DB-authoritative unique failure on (organization_id, code),
 * matched by structured SQLSTATE + exact constraint name through the cause
 * chain — never by error message text. The create pre-check, the create
 * race path, and the rename path must all resolve to this same predicate so
 * one domain failure always carries the same reason on the wire.
 */
export function isCourseCodeConflict(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const e = current as Record<string, unknown>;
    const constraint = e.constraint ?? e.constraint_name;
    if (e.code === "23505" && constraint === "courses_org_code_unique") {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/** Fastify plugin that registers all course CRUD routes. */
const courseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/courses",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseView),
      ],
      schema: {
        querystring: CourseListQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 200: courseListResponseSchema },
      },
    },
    /** List courses with pagination and optional search. Teacher actors see only their assigned courses (SQL-side, before pagination). */
    async (request: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize, search } = CourseListQuerySchema.parse(
        request.query,
      );
      const repo = createCourseRepo(fastify.db);
      const filters: CourseListFilters = {};
      if (search) filters.search = search;
      // Issue #286 LIST scope: Admin → org-wide (null); Teacher → active
      // assigned course ids, filtered in SQL before pagination/count.
      const scope = await resolveTeacherCourseScope(fastify.db, ctx);
      if (scope) {
        if (scope.length === 0) {
          return {
            items: [],
            total: 0,
            page,
            pageSize,
            totalPages: 0,
          };
        }
        filters.courseIds = scope;
      }
      const { items, total } = await repo.listFiltered(ctx, filters, {
        page,
        pageSize,
      });

      return {
        items: items.map((c) => ({
          id: c.id,
          organizationId: c.organizationId,
          name: c.name,
          code: c.code,
          description: c.description,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );

  fastify.get(
    "/courses/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(Permission.CourseView, "course", "id", {
          teacherAccess: "course_assignment_scoped",
        }),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 200: courseItemSchema, 404: ErrorResponseSchema },
      },
    },
    /** Get a single course by ID. Returns 404 if not found OR out of the caller's Teacher course scope (anti-enumeration). */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const repo = createCourseRepo(fastify.db);
      const course = await repo.findById(ctx, id);
      if (!course) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return {
        id: course.id,
        organizationId: course.organizationId,
        name: course.name,
        code: course.code,
        description: course.description,
        createdAt: course.createdAt.toISOString(),
        updatedAt: course.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/courses",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseCreate),
      ],
      schema: {
        body: CreateCourseRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: { 201: courseItemSchema, 409: ErrorResponseSchema },
      },
    },
    /** Create a new course. Non-Admin creators get an active self-assignment episode in the same transaction (issue #286 §3G). Returns 409 if the course code already exists. */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const data = CreateCourseRequestSchema.parse(request.body);
      const repo = createCourseRepo(fastify.db);

      const existing = await repo.list(ctx);
      if (existing.some((c) => c.code === data.code)) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
            // Machine semantics per message contract D0.3/D0.4: the specific
            // condition and the dynamic fact are structured, the prose in
            // fields[] is non-authoritative compatibility text only.
            reason: "COURSE_CODE_EXISTS",
            params: { courseCode: data.code },
            fields: [
              {
                field: "code",
                code: "RESOURCE_CONFLICT",
                // i18n-copy-allow: wire-compat — non-authoritative field compatibility message on the wire; field code+params are the contract
                message: "课程代码已存在",
              },
            ],
          }),
        );
      }

      // Issue #286 §3G: a non-Admin creator (Teacher product path) holds NO
      // assignment to the course it just created, so every follow-up write
      // would 404. The self-assignment episode is created in the SAME
      // transaction with an atomic audit fact; Admin stays org-wide and
      // never receives episode rows.
      const isSelfAssigning = !isOrgWideAdmin(ctx);
      try {
        const course = await executeInTransaction(fastify.db, async (tx) => {
          const created = await createCourseRepo(tx).create(ctx, {
            name: data.name,
            code: data.code,
            description: data.description,
          });
          if (isSelfAssigning) {
            const now = fastify.now();
            const assignment = await createTeacherCourseAssignmentRepo(
              tx,
            ).insertAssignment(ctx, {
              teacherUserId: ctx.actorId,
              courseId: created.id,
              assignedBy: ctx.actorId,
              assignedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            await recordAtomicHttpAudit(tx, request, ctx, {
              action: AuditAction.CourseTeacherAssigned,
              targetType: "course",
              targetId: created.id,
              metadata: {
                organizationId: ctx.organizationId,
                courseId: created.id,
                teacherUserId: ctx.actorId,
                assignmentId: assignment.id,
                actorId: ctx.actorId,
                assignedAt: now.toISOString(),
              },
            });
          }
          return created;
        });
        recordBestEffortAudit(fastify, request, ctx, {
          action: "course.create",
          targetType: "course",
          targetId: course.id,
        });
        return reply.code(201).send({
          id: course.id,
          organizationId: course.organizationId,
          name: course.name,
          code: course.code,
          description: course.description,
          createdAt: course.createdAt.toISOString(),
          updatedAt: course.updatedAt.toISOString(),
        });
      } catch (err) {
        // C1-R1: the pre-check above is an optimization, not the authority —
        // the courses_org_code_unique index decides. A create that loses the
        // concurrent-insert race must carry the same reason as the pre-check
        // path (message contract D0.3 stability invariant).
        if (isCourseCodeConflict(err)) {
          return reply.code(409).send(
            buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
              reason: "COURSE_CODE_EXISTS",
              params: { courseCode: data.code },
              fields: [
                {
                  field: "code",
                  code: "RESOURCE_CONFLICT",
                  // i18n-copy-allow: wire-compat — non-authoritative field compatibility message on the wire; field code+params are the contract
                  message: "课程代码已存在",
                },
              ],
            }),
          );
        }
        throw err;
      }
    },
  );

  fastify.patch(
    "/courses/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireScopedCapability(
          Permission.CourseUpdate,
          "course",
          "id",
          { teacherAccess: "course_assignment_scoped" },
        ),
      ],
      schema: {
        params: idParamsSchema,
        body: UpdateCourseRequestSchema,
        security: cookieAuth,
        "x-role": ["Admin", "Teacher"],
        response: {
          200: courseItemSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /** Update an existing course by ID. Returns 404 if not found OR out of the caller's Teacher course scope, 409 if the new code collides with an existing course (courses_org_code_unique). */
    async (request: any, reply: any) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const data = UpdateCourseRequestSchema.parse(request.body);
      try {
        const updated = await createCourseRepo(fastify.db).update(
          ctx,
          id,
          data as Record<string, unknown>,
        );
        if (!updated) {
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        }
        recordBestEffortAudit(fastify, request, ctx, {
          action: "course.update",
          targetType: "course",
          targetId: id,
          metadata: { changedFields: Object.keys(data) },
        });
        return {
          id: updated.id,
          organizationId: updated.organizationId,
          name: updated.name,
          code: updated.code,
          description: updated.description,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        };
      } catch (err) {
        // C1-R1: PATCH has no create-style pre-check — renaming onto an
        // existing code is rejected by the courses_org_code_unique index and
        // must carry the same reason as create (message contract D0.3
        // stability invariant). The UPDATE only writes `code` when
        // data.code is provided, so the (organization_id, code) violation
        // implies data.code is the colliding value.
        if (isCourseCodeConflict(err) && data.code !== undefined) {
          return reply.code(409).send(
            buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
              reason: "COURSE_CODE_EXISTS",
              params: { courseCode: data.code },
              fields: [
                {
                  field: "code",
                  code: "RESOURCE_CONFLICT",
                  // i18n-copy-allow: wire-compat — non-authoritative field compatibility message on the wire; field code+params are the contract
                  message: "课程代码已存在",
                },
              ],
            }),
          );
        }
        throw err;
      }
    },
  );

  fastify.delete(
    "/courses/:id",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.CourseDelete),
      ],
      schema: {
        params: idParamsSchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: {
          204: z.null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    /** Delete a course by ID. Returns 409 if the course still contains questions, 404 if not found. Teacher assignment episodes are removed in the same transaction (issue #286). */
    async (request: any, reply: any) => {
      const ctx: RequestContext = ensureTargetOrg(getRequestContext(request));
      const { id } = request.params as { id: string };
      const questionCount = await createQuestionRepo(
        fastify.db,
      ).countByCourseId(ctx, id);
      if (questionCount > 0) {
        return reply.code(409).send(
          buildErrorResponse(request.id, "RESOURCE_CONFLICT", {
            // Machine semantics per message contract D0.3/D0.4: the specific
            // condition and the dynamic fact are structured, the prose in
            // fields[] is non-authoritative compatibility text only.
            reason: "COURSE_HAS_QUESTIONS",
            params: { questionCount },
            fields: [
              {
                field: "courseId",
                code: "RESOURCE_CONFLICT",
                // i18n-copy-allow: wire-compat — non-authoritative field compatibility message on the wire; field code+params are the contract
                message: "课程下仍有题目，无法删除",
              },
            ],
          }),
        );
      }
      const deleted = await executeInTransaction(fastify.db, async (tx) => {
        // Episodes reference the course by composite FK; remove them first
        // so Admin deletion is not blocked once any assignment exists.
        await createTeacherCourseAssignmentRepo(tx).deleteByCourse(ctx, id);
        return createCourseRepo(tx).delete(ctx, id);
      });
      if (deleted) {
        recordBestEffortAudit(fastify, request, ctx, {
          action: "course.delete",
          targetType: "course",
          targetId: id,
        });
      }
      if (!deleted) {
        return reply
          .code(404)
          .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
      }
      return reply.code(204).send();
    },
  );
};

export default courseRoutes;
