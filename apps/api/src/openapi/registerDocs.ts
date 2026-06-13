import type { FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import swaggerUiPlugin from "@fastify/swagger-ui";

import { openApiConfig } from "./config.js";

function isDocsEnabled(): boolean {
  return (
    process.env.API_DOCS_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export async function registerOpenApiDocs(app: FastifyInstance): Promise<void> {
  if (!isDocsEnabled()) {
    return;
  }

  await app.register(swaggerPlugin as never, openApiConfig);

  await app.register(swaggerUiPlugin as never, {
    routePrefix: "/docs",
  });
}
