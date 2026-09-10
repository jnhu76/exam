import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";

/**
 * Normalize a raw request-target to its pathname, or `null` when the target
 * is too malformed to parse (an invalid absolute-form such as
 * `http://[invalid`). Query string and — for parseable absolute-form
 * targets — the authority are stripped; percent-encoding is preserved.
 */
function pathnameOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return null;
  }
}

/**
 * Register the static frontend serving and the global unmatched-request
 * handler. Owner of the request-appearance boundary that decides whether an
 * unmatched request gets the canonical API JSON error, a real missing-asset
 * 404, or the SPA fallback.
 *
 * @param app - Root Fastify instance (must be the same scope the API routes
 *   were registered on — the not-found handler is scope-encapsulated).
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
    // INVARIANT (#429): an unmatched request whose pathname is in the /api
    // namespace ("/api" or "/api/**") always stays in the API JSON error
    // boundary — it must never reach the SPA/static appearance fallback
    // below (no HTML body, no immutable asset caching). Classification uses
    // the URL pathname with the query string stripped, so
    // "/api/__unknown__?x=a.js" cannot be mistaken for a static asset by
    // its query suffix. Percent-encoded path segments are NOT decoded: the
    // router does not decode them for static-path matching either, so
    // "/api%2Fx" is consistently non-API on both paths. A request-target
    // too malformed for the URL constructor skips this branch and keeps
    // the SPA/static classification below — it never throws into the 500
    // error handler.
    const pathname = pathnameOf(req.url);
    if (
      pathname !== null &&
      (pathname === "/api" || pathname.startsWith("/api/"))
    ) {
      reply.code(404).send(buildErrorResponse(req.id, "RESOURCE_NOT_FOUND"));
      return;
    }
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
