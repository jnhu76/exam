import corsPlugin from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * Registers the `@fastify/cors` plugin on the given Fastify instance,
 * configuring the allowed origin(s) from runtime config and enabling
 * credential support for cookie-based authentication.
 */
export default async function cors(app: FastifyInstance) {
  const { origin } = getRuntimeConfig().cors;
  await app.register(corsPlugin, {
    origin,
    credentials: true,
    // #865: let the configured web origin's JS read the server-minted
    // x-request-id (success-path correlation). This only adds an entry to
    // Access-Control-Expose-Headers — it does not broaden origin reflection;
    // unknown origins still receive no CORS headers.
    exposedHeaders: ["x-request-id"],
  });
}
