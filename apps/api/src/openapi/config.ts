import type { FastifyInstance } from "fastify";

export const errorResponseSchema = {
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

export const openApiConfig = {
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
} as const;

export function addCommonResponseSchemas(app: FastifyInstance): void {
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
