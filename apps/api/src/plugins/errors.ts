import type { FastifyInstance } from "fastify";
import { AppError } from "@exam/domain";
import { ZodError, type ZodIssue } from "zod";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import {
  buildErrorResponse,
  buildValidationErrorResponse,
  normalizeErrorCode,
} from "../lib/errorResponse.js";

// Extract Zod issues from a Zod type-provider validation error. The provider
// wraps each Zod issue under validation[i].params.issue.
/**
 * Extracts individual `ZodIssue` objects from a Fastify Zod type-provider
 * validation error. The provider wraps each issue under `validation[i].params.issue`.
 * Returns an empty array if the error shape does not match.
 */
function extractValidationIssues(error: unknown): ZodIssue[] {
  if (typeof error !== "object" || error === null) return [];
  const validation = (error as { validation?: unknown[] }).validation;
  if (!Array.isArray(validation)) return [];
  return validation
    .map((entry) => {
      const issue = (entry as { params?: { issue?: unknown } })?.params?.issue;
      return issue as ZodIssue;
    })
    .filter((issue): issue is ZodIssue => issue != null);
}

/**
 * Checks whether an error represents a database unique-constraint violation
 * or serialization failure. These are mapped to 409 Conflict responses.
 *
 * 23505 = unique_violation — duplicate key value violation (permanent conflict)
 * 40001 = serialization_failure — "could not serialize access due to
 *         concurrent update" — occurs in REPEATABLE READ isolation when
 *         two transactions race to lock the same row. After exhausting
 *         retries in executeInTransaction, surfaces as 409 to the client.
 *
 * Walks the error chain iteratively (Drizzle may wrap the underlying
 * Postgres error multiple levels deep). Uses a `visited` Set to guard
 * against circular `cause` references.
 */
function isConstraintError(err: unknown): boolean {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (typeof current !== "object" || current === null) break;
    const e = current as Record<string, unknown>;
    if (e.code === "23505" || e.code === "40001") return true;
    if (
      typeof e.message === "string" &&
      (e.message.includes("duplicate key") ||
        e.message.includes("unique constraint") ||
        e.message.includes("serialize"))
    ) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/**
 * Type guard that identifies errors with a numeric `statusCode` in the
 * 4xx range (400–499), indicating a client-caused error that can be
 * safely surfaced to the caller.
 */
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

/**
 * Installs the global Fastify error handler that converts thrown errors
 * into structured JSON responses. Handles Zod validation errors (400),
 * `AppError` domain errors, generic 4xx client errors, unique-constraint
 * conflicts (409), response-serialization failures (500), and any
 * unhandled errors (500).
 */
export function setupErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Runtime-first contract: Zod route-schema validation failures -> 400.
    // The Zod type provider wraps each Zod issue under validation[i].params.
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = extractValidationIssues(error);
      const synthetic = new ZodError(issues);
      return reply
        .code(400)
        .send(buildValidationErrorResponse(request.id, synthetic));
    }
    // Handlers may also throw raw ZodErrors (e.g. .parse() in handlers).
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
    // Response serialization failure: the handler returned a payload that does
    // not match the declared response schema. This is a server/contract bug,
    // not a client error -> 500 with logging.
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, url: request.url, method: request.method },
        "Response serialization error",
      );
      return reply
        .code(500)
        .send(buildErrorResponse(request.id, "INTERNAL_ERROR"));
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply
      .code(500)
      .send(buildErrorResponse(request.id, "INTERNAL_ERROR"));
  });
}
