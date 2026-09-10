import type { FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import swaggerUiPlugin from "@fastify/swagger-ui";

import { openApiConfig } from "./config.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { API_REFERENCE_UI_PATH } from "./docsPaths.js";

/**
 * Register the docs surface on the Fastify instance.
 *
 * The /_dev/api-reference namespace is ALWAYS router-owned (I11): this
 * function registers an encapsulated scope at that prefix regardless of the
 * docs capability state, so a disabled API reference never surrenders its
 * namespace to the web fallback. Unmatched requests inside the namespace
 * (including every request when docs are disabled) answer with the
 * docs-owned 404, never the SPA shell.
 *
 * The OpenAPI capability (spec generator + swagger-ui) mounts only when
 * `apiReference.enabled` is true; the namespace scope itself is
 * capability-independent. The swagger spec generator is fastify-plugin
 * wrapped and registers on the root instance so its onRoute hook observes
 * every /api route — it must run before the /api surface is registered
 * (server.ts keeps that order).
 */
export async function registerOpenApiDocs(app: FastifyInstance): Promise<void> {
  const config = getRuntimeConfig();

  // docsSurface: namespace ownership is separate from capability state.
  await app.register(
    async (docs) => {
      docs.setNotFoundHandler((_req, reply) => {
        reply.code(404).type("text/plain").send("Not Found");
      });
    },
    { prefix: API_REFERENCE_UI_PATH },
  );

  if (!config.apiReference.enabled) {
    return;
  }

  await app.register(swaggerPlugin as never, openApiConfig);

  await app.register(swaggerUiPlugin as never, {
    routePrefix: API_REFERENCE_UI_PATH,
    staticCSP: config.apiReference.staticCSP,
  });
}
