import { jsonSchemaTransform } from "fastify-type-provider-zod";

// P2.0-J1 — Runtime-first API contract.
//
// Route option schemas are authored as Zod (see routes/*.ts) and serve as the
// single source of truth for both runtime validation/serialization (via the
// validator/serializer compilers registered in zodProviderPlugin) and OpenAPI
// generation (via the `jsonSchemaTransform` below).
//
// Auth is HTTP-only cookie "auth-token" carrying a JWT.

/**
 * Cast `jsonSchemaTransform` from `fastify-type-provider-zod` so that
 * TypeScript can emit declarations without requiring the provider-internal
 * `Schema` type (which is not exported).
 */
const transform = jsonSchemaTransform as (input: {
  schema: unknown;
  url: string;
}) => unknown;

/**
 * OpenAPI configuration object passed to `@fastify/swagger`.
 *
 * Defines the document metadata (title, version, description), the
 * cookie-based security scheme, and the Zod-to-JSON-Schema transform
 * that converts route-level Zod schemas into OpenAPI-compatible JSON
 * Schema.
 */
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
