import { jsonSchemaTransform } from "fastify-type-provider-zod";

// P2.0-J1 — Runtime-first API contract.
//
// Route option schemas are authored as Zod (see routes/*.ts) and serve as the
// single source of truth for both runtime validation/serialization (via the
// validator/serializer compilers registered in zodProviderPlugin) and OpenAPI
// generation (via the `jsonSchemaTransform` below).
//
// Auth is HTTP-only cookie "auth-token" carrying a JWT.

// Cast away the provider-internal `Schema` type from the transform signature
// so tsc can emit declarations (the provider does not export that type).
const transform = jsonSchemaTransform as (input: {
  schema: unknown;
  url: string;
}) => unknown;

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
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "auth-token",
          description: "HTTP-only session cookie set by POST /api/auth/login.",
        },
      },
    },
  },
  // Read Zod route schemas directly off route options and convert them to
  // OpenAPI/JSON-Schema.
  transform,
};
