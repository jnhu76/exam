import type { RequestContext } from "@exam/domain";
import type { ZodError } from "zod";
import { buildErrorResponse } from "../lib/errorResponse.js";

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
