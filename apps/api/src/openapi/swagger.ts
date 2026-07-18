import Fastify, { type FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { openApiConfig } from "./config.js";
import { registerApiRoutes } from "../routes/registerApiRoutes.js";
import { healthResponseSchema } from "../routes/healthSchema.js";
import type {
  AuthzPreHandler,
  AuthzMetadata,
  EligibilityDenialMode,
} from "../types/fastify-auth.d.js";
import type { PermissionKey } from "@exam/authz";

/**
 * Build a throwaway Fastify instance pre-loaded with all route plugins and
 * the Swagger plugin. The returned instance can be used to generate the
 * OpenAPI spec via `app.swagger()` and must be closed afterwards.
 *
 * @returns A ready Fastify instance with the Swagger plugin registered.
 */
export async function buildSwaggerApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Zod is the runtime contract source — register the same compilers the
  // runtime app uses so the spec reflects runtime-validated schemas.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const authenticate = async () => {};
  Object.assign(authenticate, { _isAuthenticate: true });
  app.decorate("authenticate", authenticate);
  app.decorate("requireRole", () => async () => {});
  // requireCapability (Phase 3 capability gate, RBAC runtime activation) —
  // no-op stub so OpenAPI generation can register flipped routes.
  app.decorate("requireCapability", () => {
    const h: AuthzPreHandler = async () => {};
    h.authz = { kind: "flat", permission: "exam.view" };
    return h;
  });
  // requireScopedCapability (RBAC-M10-finish resource-aware gate, P4-2A) —
  // no-op stub so OpenAPI generation can register routes that adopted the
  // scoped gate (grading-details / grade-question). Same rationale as the
  // requireCapability stub above.
  app.decorate("requireScopedCapability", () => {
    const h: AuthzPreHandler = async () => {};
    h.authz = {
      kind: "scoped",
      permission: "exam.view",
      resolverKey: "attempt",
      resourceIdKey: "stub" as const,
    };
    return h;
  });
  // requireScoreCapability (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1) — no-op
  // stub so OpenAPI generation can register the score route, which now uses
  // the dedicated score-capability gate (own/all arbitration). Same rationale
  // as the requireScopedCapability stub above.
  app.decorate("requireScoreCapability", () => async () => {});
  // Candidate-runtime capability gates (RBAC-M10-A archetypes A/B/C-D) — no-op
  // stubs so OpenAPI generation can register the 10 candidate runtime routes
  // that now use the dedicated candidate-context / exam-eligibility /
  // own-attempt gates. Each attaches a stub `.authz` matching its kind so the
  // route registers cleanly (the spec is driven by route `schema.security` /
  // `schema["x-role"]`, not the preHandler — same rationale as above).
  app.decorate("requireCandidateContext", (permission: PermissionKey) => {
    const h: AuthzPreHandler = async () => {};
    h.authz = { kind: "candidate_context", permission };
    return h;
  });
  app.decorate(
    "requireExamEligibility",
    (
      permission: PermissionKey,
      resourceIdKey: string,
      eligibilityDenialMode: EligibilityDenialMode,
    ) => {
      const h: AuthzPreHandler = async () => {};
      h.authz = {
        kind: "exam_eligibility",
        permission,
        resourceIdKey,
        eligibilityDenialMode,
      };
      return h;
    },
  );
  app.decorate(
    "requireOwnAttempt",
    (permission: PermissionKey, resourceIdKey: string) => {
      const h: AuthzPreHandler = async () => {};
      h.authz = {
        kind: "own_attempt",
        permission,
        resourceIdKey,
      };
      return h;
    },
  );
  // Swagger-only bootstrap placeholders: DB and ctx are not used during
  // OpenAPI generation; they exist only to satisfy Fastify's decorator
  // contract when routes register.
  app.decorate("db", null as unknown as never);
  app.decorate("now", () => new Date());
  app.decorateRequest("ctx", null as unknown as never);

  await app.register(swaggerPlugin as never, openApiConfig);

  // Mirror server.ts: GET /api/health (public liveness probe).
  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  // Register all API route modules — shared with runtime server.
  await registerApiRoutes(app);

  await app.ready();
  return app;
}

/** Minimal representation of a single HTTP operation within an OpenAPI path item. */
export interface PathOperation {
  responses: Record<
    string,
    {
      description?: string;
      content?: Record<string, unknown>;
    }
  >;
}

/** Minimal representation of an OpenAPI path item containing one or more HTTP operations. */
export interface PathItem {
  get?: PathOperation;
  post?: PathOperation;
  put?: PathOperation;
  patch?: PathOperation;
  delete?: PathOperation;
}

/** Minimal representation of a complete OpenAPI specification document. */
export interface OpenAPISpecDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItem | undefined>;
  components?: {
    schemas?: Record<string, Record<string, unknown>>;
  };
}

/**
 * Generate the OpenAPI specification document by bootstrapping a Swagger-
 * enabled Fastify instance, extracting the generated spec, and tearing
 * the instance down.
 *
 * @returns A parsed {@link OpenAPISpecDocument}.
 */
export async function generateOpenAPISpec(): Promise<OpenAPISpecDocument> {
  const app = await buildSwaggerApp();
  try {
    const spec = app.swagger() as OpenAPISpecDocument;
    fixCsvContentTypes(spec);
    injectMissingErrorResponses(spec);
    return spec;
  } finally {
    await app.close();
  }
}

/**
 * Patches CSV export routes whose 200 response is declared as `z.string()`
 * (which fastify-swagger renders as `application/json`) to correctly report
 * `text/csv`. Only the two known CSV endpoints are affected.
 */
function fixCsvContentTypes(spec: OpenAPISpecDocument): void {
  if (!spec.paths) return;
  const csvPaths = [
    "/api/exams/{id}/export/scores",
    "/api/admin/attempts/{attemptId}/export/csv",
  ];

  for (const path of csvPaths) {
    const item = spec.paths[path];
    if (!item) continue;
    for (const method of ["get"] as const) {
      const op = item[method] as
        | {
            responses?: Record<
              string,
              {
                description?: string;
                content?: Record<string, unknown>;
              }
            >;
          }
        | undefined;
      if (!op?.responses?.["200"]) continue;
      const resp = op.responses["200"];
      if (resp.content && resp.content["application/json"]) {
        resp.content["text/csv"] = resp.content["application/json"];
        delete resp.content["application/json"];
      }
    }
  }
}

/**
 * Injects missing error responses into the generated spec:
 * - 401 for all routes with cookieAuth security (authenticate preHandler)
 * - 403 for all routes with x-role (requireRole/requireCapability preHandler)
 */
function injectMissingErrorResponses(spec: OpenAPISpecDocument): void {
  const unauthorizedSchema = {
    description: "Unauthorized — missing or invalid authentication cookie",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            requestId: { type: "string" },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  };

  const forbiddenSchema = {
    description: "Forbidden — insufficient role or capability",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            requestId: { type: "string" },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  };

  for (const [, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | {
            security?: unknown[];
            "x-role"?: string[];
            responses?: Record<string, unknown>;
          }
        | undefined;
      if (!op) continue;

      // Inject 401 for routes with cookieAuth security.
      if (op.security && Array.isArray(op.security)) {
        const hasCookieAuth = op.security.some(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "cookieAuth" in entry,
        );
        if (hasCookieAuth && !op.responses?.["401"]) {
          if (!op.responses) op.responses = {};
          op.responses["401"] = unauthorizedSchema;
        }
      }

      // Inject 403 for routes with x-role.
      if (op["x-role"] && Array.isArray(op["x-role"])) {
        if (!op.responses) op.responses = {};
        if (!op.responses["403"]) {
          op.responses["403"] = forbiddenSchema;
        }
      }
    }
  }
}
