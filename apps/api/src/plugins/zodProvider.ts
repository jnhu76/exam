import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

// P2.0-J1 — Runtime-first API contract.
//
// Registers Zod as Fastify's validator AND serializer. Route option schemas
// (`params` / `querystring` / `body` / `response`) are now authored as Zod
// schemas and become the single source of truth for both runtime validation
// (request) / serialization (response) and OpenAPI generation (via
// `jsonSchemaTransform` configured in the swagger build app).
//
// This is an INTENTIONAL runtime behavior change:
//   - malformed path params / body / querystring -> 400 VALIDATION_ERROR
//   - response payloads are serialized to the declared response schema
//
// Registered in both server.ts and the test app builder so behavior is
// identical across runtime and tests.
const zodProviderPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
};

export default fp(zodProviderPlugin);
