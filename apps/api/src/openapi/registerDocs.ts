import type { FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import swaggerUiPlugin from "@fastify/swagger-ui";

import { openApiConfig } from "./config.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * Register the Swagger/OpenAPI UI and spec routes on the Fastify instance.
 *
 * No-op when the runtime config has `apiReference.enabled` set to `false`
 * (the default in production).
 *
 * @param app - The Fastify application instance.
 */
export async function registerOpenApiDocs(app: FastifyInstance): Promise<void> {
  const config = getRuntimeConfig();

  if (!config.apiReference.enabled) {
    return;
  }

  await app.register(swaggerPlugin as never, openApiConfig);

  await app.register(swaggerUiPlugin as never, {
    routePrefix: config.apiReference.uiPath,
    staticCSP: config.apiReference.staticCSP,
  });
}
