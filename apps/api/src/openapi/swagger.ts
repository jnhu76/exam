import Fastify, { type FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { openApiConfig } from "./config.js";

import authRoutes from "../routes/auth.js";
import settingsRoutes from "../routes/settings.js";
import candidateFieldRoutes from "../routes/candidateField.js";
import userRoutes from "../routes/user.js";
import candidateRoutes from "../routes/candidate.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import scoreRoutes from "../routes/scores.js";
import { exportRoutes } from "../routes/export.js";
import systemRoutes from "../routes/system.js";
import auditRoutes from "../routes/audit.js";

/** Default API route prefix used when registering route plugins. */
const routePrefix = "/api";

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
  app.decorate("db", null as never);
  app.decorate("now", () => new Date());
  app.decorateRequest("ctx", null as never);

  await app.register(swaggerPlugin as never, openApiConfig);

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(settingsRoutes, { prefix: routePrefix });
  await app.register(candidateFieldRoutes, { prefix: routePrefix });
  await app.register(userRoutes, { prefix: routePrefix });
  await app.register(candidateRoutes, { prefix: routePrefix });
  await app.register(courseRoutes, { prefix: routePrefix });
  await app.register(questionRoutes, { prefix: routePrefix });
  await app.register(examRoutes, { prefix: routePrefix });
  await app.register(attemptRoutes, { prefix: routePrefix });
  await app.register(scoreRoutes, { prefix: routePrefix });
  await app.register(exportRoutes, { prefix: routePrefix });
  await app.register(systemRoutes, { prefix: routePrefix });
  await app.register(auditRoutes, { prefix: routePrefix });

  // Mirror server.ts: GET /api/health (public liveness probe).
  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: z.object({ status: z.string() }),
        },
      },
    },
    async () => ({ status: "ok" }),
  );

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
    return app.swagger() as OpenAPISpecDocument;
  } finally {
    await app.close();
  }
}
