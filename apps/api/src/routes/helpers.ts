import type { RequestContext } from "@exam/domain";
import type { ZodError } from "zod";
import { buildErrorResponse } from "../lib/errorResponse.js";

export function ensureTargetOrg(ctx: RequestContext): RequestContext {
  if (!ctx.targetOrganizationId) {
    return { ...ctx, targetOrganizationId: ctx.organizationId };
  }
  return ctx;
}

// Conforms to ErrorResponseSchema (code/message/details/requestId). Used by
// handler-level validation fallbacks; the shared error handler produces the
// same envelope for route-schema validation failures.
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
