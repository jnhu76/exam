import Fastify, { type FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";

import authRoutes from "../routes/auth.js";
import settingsRoutes from "../routes/settings.js";
import organizationRoutes from "../routes/organization.js";
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

const errorResponseSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "object" },
        requestId: { type: "string" },
      },
      required: ["code", "message", "requestId"],
    },
  },
  required: ["error"],
} as const;

const genericSuccessSchema = {
  type: "object",
};

const noContentResponse = {
  description: "No content",
};

const csvSuccessResponse = {
  description: "CSV file download",
  content: {
    "text/csv": {
      schema: { type: "string" },
    },
  },
};

const routePrefix = "/api";

function addCommonSchemas(app: FastifyInstance): void {
  app.addHook("onRoute", (routeOptions) => {
    if (!routeOptions.schema) routeOptions.schema = {};
    if (!routeOptions.schema.response) routeOptions.schema.response = {};

    const response = routeOptions.schema.response as Record<string, unknown>;
    const method = routeOptions.method;
    const methods = Array.isArray(method) ? method : [method];
    const hasAuth = routeOptions.preHandler !== undefined;
    const path = String(routeOptions.url ?? routeOptions.path ?? "");
    const hasIdParam = path.includes(":id") || path.includes("{id}");

    if (hasAuth && !methods.includes("HEAD") && !path.includes("/auth/login")) {
      if (!response["401"]) response["401"] = errorResponseSchema;
    }

    if (path.includes("/auth/login") && !response["401"]) {
      response["401"] = errorResponseSchema;
    }

    const adminPaths = [
      "/exams",
      "/questions",
      "/candidates",
      "/users",
      "/settings",
      "/courses",
      "/export",
      "/scores",
      "/admin",
    ];
    if (hasAuth && adminPaths.some((p) => path.includes(p))) {
      if (!response["403"]) response["403"] = errorResponseSchema;
    }

    if (hasIdParam && !response["404"]) {
      response["404"] = errorResponseSchema;
    }

    if (methods.includes("DELETE") && !response["204"]) {
      response["204"] = noContentResponse;
    }

    if (path.includes("/export/scores") && !response["200"]) {
      response["200"] = csvSuccessResponse;
    }

    if (
      methods.includes("GET") &&
      !response["200"] &&
      !path.includes("/export")
    ) {
      response["200"] = genericSuccessSchema;
    }

    if (
      (methods.includes("POST") || methods.includes("PATCH")) &&
      !response["200"] &&
      !response["201"]
    ) {
      response["200"] = genericSuccessSchema;
    }

    if (
      (methods.includes("POST") || methods.includes("PATCH")) &&
      !response["400"]
    ) {
      response["400"] = errorResponseSchema;
    }

    if (methods.includes("POST") && path.includes("/publish")) {
      if (response["409"] === undefined) response["409"] = errorResponseSchema;
    }
  });
}

export async function buildSwaggerApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("authenticate", async () => {});
  app.decorate("requireRole", () => async () => {});
  app.decorate("db", null as never);
  app.decorate("now", () => new Date());
  app.decorateRequest("ctx", null as never);

  await app.register(swaggerPlugin as never, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Exam Platform API",
        version: "1.0.0",
        description:
          "Configurable LAN/on-premise exam and assessment platform API",
      },
      components: {
        schemas: {
          ErrorResponse: errorResponseSchema,
        },
      },
    },
  });

  addCommonSchemas(app);

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(settingsRoutes, { prefix: routePrefix });
  await app.register(organizationRoutes, { prefix: routePrefix });
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

  await app.ready();
  return app;
}

export interface PathOperation {
  responses: Record<
    string,
    {
      description?: string;
      content?: Record<string, unknown>;
    }
  >;
}

export interface PathItem {
  get?: PathOperation;
  post?: PathOperation;
  put?: PathOperation;
  patch?: PathOperation;
  delete?: PathOperation;
}

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

export async function generateOpenAPISpec(): Promise<OpenAPISpecDocument> {
  const app = await buildSwaggerApp();
  return app.swagger() as OpenAPISpecDocument;
}
