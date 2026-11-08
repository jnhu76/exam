import corsPlugin from "@fastify/cors";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * Registers the `@fastify/cors` plugin on the given Fastify instance,
 * configuring the allowed origin(s) from runtime config and enabling
 * credential support for cookie-based authentication.
 *
 * INVARIANT (#865): fp-wrapped so @fastify/cors's onRequest hook applies at
 * ROOT scope, like every other root-registered plugin here. An encapsulated
 * registration would confine the hook to this plugin's own routeless scope:
 * preflights would still answer via the wildcard OPTIONS route, but
 * non-preflight responses would never carry Access-Control-Allow-Origin /
 * -Expose-Headers — credentials-mode CORS and the x-request-id expose (#865)
 * would silently apply to no route at all. That was the pre-#865 wiring; the
 * gap surfaced in the live #865 correlation experiment.
 */
export default fp(async function cors(app: FastifyInstance) {
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
});
