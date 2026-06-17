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
  });
}
