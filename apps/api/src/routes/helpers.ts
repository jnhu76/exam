import type { RequestContext } from "@exam/domain";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { ZodError } from "zod";
import { ImportJobLogStatusEnum } from "@exam/contracts";
import { buildErrorResponse } from "../lib/errorResponse.js";

/**
 * Extracts the typed `RequestContext` from an authenticated Fastify request.
 * Throws if `ctx` is absent (i.e. the route was reached without authentication).
 * Use this instead of `request.ctx!` to get a runtime guard plus type narrowing.
 */
export function getRequestContext(request: FastifyRequest): RequestContext {
  const ctx = request.ctx;
  if (!ctx) {
    throw new Error(
      "Request context not available — authenticate preHandler missing?",
    );
  }
  return ctx;
}

/**
 * Import job status values persisted to `import_job_logs`, derived from the
 * shared contracts enum so there is a single source of truth.
 * - `completed`: no error rows at all.
 * - `partial`:   some rows errored but at least one row succeeded.
 * - `failed`:    all rows errored (no row succeeded).
 */
export type ImportJobStatus = z.infer<typeof ImportJobLogStatusEnum>;

/**
 * Resolves the import job status from the per-run outcome. Centralizes the
 * three-state mapping so candidate and question import routes share one
 * definition and cannot diverge.
 *
 * @param errors       Count of rows that errored in this run.
 * @param affectedCount Count of rows that succeeded (created or updated).
 * @returns The resolved status.
 */
export function resolveImportStatus(input: {
  errors: number;
  affectedCount: number;
}): ImportJobStatus {
  if (input.errors === 0) return "completed";
  return input.affectedCount > 0 ? "partial" : "failed";
}

/**
 * Ensures that the request context has a `targetOrganizationId` set.
 * If `targetOrganizationId` is missing, it defaults to the context's own
 * `organizationId`. This is used to enforce single-tenant data boundaries
 * where all operations target the caller's own organization.
 *
 * @param ctx - The incoming request context.
 * @returns A new context with `targetOrganizationId` guaranteed to be set.
 */
export function ensureTargetOrg(ctx: RequestContext): RequestContext {
  if (!ctx.targetOrganizationId) {
    return { ...ctx, targetOrganizationId: ctx.organizationId };
  }
  return ctx;
}

/**
 * Converts a Zod validation error into a structured error response
 * conforming to the `ErrorResponseSchema` (code/message/details/requestId).
 * Used by handler-level validation fallbacks; the shared Fastify error
 * handler produces the same envelope for route-schema validation failures.
 *
 * @param requestId - The unique request identifier to include in the response.
 * @param error - The Zod validation error to convert.
 * @returns A structured error response object with field-level detail.
 */
export function formatZodError(requestId: string, error: ZodError) {
  return buildErrorResponse(
    requestId,
    "VALIDATION_ERROR",
    {
      fields: error.issues.map((i) => ({
        field: i.path.map(String).join(".") || "_root",
        code: i.code.toUpperCase(),
        message: i.message,
      })),
    },
    error.issues.map((i) => i.message).join("; "),
  );
}
