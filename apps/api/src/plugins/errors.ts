import type { FastifyInstance } from "fastify";
import { AppError } from "@exam/domain";
import { ZodError } from "zod";

function isConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
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
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues.map((issue) => issue.message).join("; "),
        },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    if (isClientError(error)) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code || "BAD_REQUEST",
          message: error.message,
        },
      });
    }
    if (isConstraintError(error)) {
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "Resource already exists" },
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
}
