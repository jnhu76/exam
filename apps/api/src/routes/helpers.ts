import type { RequestContext } from "@exam/domain";
import type { ZodError } from "zod";

export function ensureTargetOrg(ctx: RequestContext): RequestContext {
  if (!ctx.targetOrganizationId) {
    return { ...ctx, targetOrganizationId: ctx.organizationId };
  }
  return ctx;
}

export function formatZodError(error: ZodError) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: error.issues.map((i) => i.message).join("; "),
    },
  };
}
