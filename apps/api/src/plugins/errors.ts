import type { FastifyInstance } from "fastify";
import { AppError } from "@exam/domain";
import { ZodError } from "zod";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
  normalizeErrorCode,
} from "../lib/errorResponse.js";
function isConstraintError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e.code === "23505" || e.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  const cause = e.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause === "object" && cause.code === "23505") return true;
  if (
    typeof e.message === "string" &&
    (e.message.includes("duplicate key") ||
      e.message.includes("unique constraint"))
  )
    return true;
  return false;
}

function isClientError(
  err: unknown,
): err is Error & { statusCode: number; code: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    err instanceof Error &&
    "statusCode" in err &&
    typeof (err as Error & { statusCode: unknown }).statusCode === "number" &&
    (err as Error & { statusCode: number }).statusCode >= 400 &&
    (err as Error & { statusCode: number }).statusCode < 500
  );
}

export function setupErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send(buildValidationErrorResponse(request.id, error));
    }
    if (error instanceof AppError) {
      const code = normalizeErrorCode(error.code, error.statusCode);
      return reply
        .code(error.statusCode)
        .send(buildErrorResponse(request.id, code, error.details));
    }
    if (isClientError(error)) {
      const code = normalizeErrorCode(error.code, error.statusCode);
      return reply
        .code(error.statusCode)
        .send(buildErrorResponse(request.id, code));
    }
    if (isConstraintError(error)) {
      return reply
        .code(409)
        .send(buildErrorResponse(request.id, "RESOURCE_CONFLICT"));
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply
      .code(500)
      .send(buildErrorResponse(request.id, "INTERNAL_ERROR"));
  });
}
