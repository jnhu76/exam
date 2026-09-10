import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Register the static frontend serving and the global (non-API) unmatched-
 * request handler.
 *
 * This is the ROOT appearance fallback only. The /api namespace has its own
 * encapsulated unmatched-request policy inside the apiSurface plugin
 * (routes/apiSurface.ts); Fastify routes the two by router prefix, so this
 * handler must not know anything about /api — it never inspects whether a
 * request "is API". That authority belongs to the router.
 *
 * @param app - Root Fastify instance.
 * @param publicDir - Absolute path of the built web frontend directory.
 */
export async function registerStaticFrontend(
  app: FastifyInstance,
  publicDir: string,
): Promise<void> {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    wildcard: false,
    immutable: true,
    maxAge: "1y",
    setHeaders: (res, pathname) => {
      if (pathname.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("immutable", "false");
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: serve index.html only for navigation (route) requests,
    // NOT for static asset requests. With `wildcard: false`, @fastify/static
    // does not register a catch-all route, so requests for missing assets
    // (e.g. /assets/*.js with a stale hash) would otherwise fall through here
    // and return index.html as text/html — the browser then rejects the JS
    // module (wrong MIME) and the app white-screens. Asset-looking requests
    // get a real 404 instead. See fastify/fastify-static#299, fastify/help#74.
    if (req.url.startsWith("/assets/") || /\.[^/]+$/.test(req.url)) {
      reply.code(404).send("Not Found");
      return;
    }
    reply.sendFile("index.html");
  });
}
