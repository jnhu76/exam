import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";

/**
 * Mirrors find-my-way's absolute-form handling (`FULL_PATH_REGEXP` applied
 * in find-my-way's `find()`): a request-target that does not start with `/`
 * has its `http(s)://authority` prefix replaced by `/` — exactly the
 * transformation the router applies before path matching. Targets the
 * regex does not cover (e.g. `http://[invalid`, other schemes) are left
 * untouched, like the router leaves them.
 */
const ABSOLUTE_FORM_PREFIX = /^https?:\/\/.*?\//;

/**
 * Extract the router-visible path from a raw request-target, without doing
 * more work than find-my-way@9.6.0 itself does before matching:
 *
 * - query/fragment are split at the first `?` or `#` (find-my-way's
 *   `safeDecodeURI` with Fastify's default `useSemicolonDelimiter: false`);
 * - absolute-form targets get the same minimal `http(s)://authority`
 *   stripping the router applies;
 * - the path bytes are otherwise preserved verbatim: no dot-segment
 *   normalization, no percent-decoding, no slash collapsing.
 *
 * The router never normalizes `.`/`..` segments (they match literally, so
 * `/api/../x` never becomes `/x`), and it never decodes `%2F` into a path
 * separator — the classifier must not either, or it would re-classify
 * requests the router saw inside the `/api` namespace.
 */
function routerPathOf(rawUrl: string): string {
  let path = rawUrl;
  if (path.charCodeAt(0) !== 47 /* "/" */) {
    path = path.replace(ABSOLUTE_FORM_PREFIX, "/");
  }
  const queryIndex = path.search(/[?#]/);
  return queryIndex === -1 ? path : path.slice(0, queryIndex);
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
    // INVARIANT (#429): an unmatched request whose router-visible path is in
    // the /api namespace ("/api" or "/api/**") always stays in the API JSON
    // error boundary — it must never reach the SPA/static appearance
    // fallback below (no HTML body, no immutable asset caching).
    // Classification uses the same path semantics as the router: query
    // stripped at the first ?/#, absolute-form authority stripped with the
    // router's own prefix rule, and the remaining path bytes preserved
    // verbatim. Dot segments are NOT normalized (the router matches them
    // literally, so "/api/../x" never becomes "/x") and percent-encoding is
    // NOT decoded (the router does not decode %2F into a path separator for
    // static-path matching either, so "/api%2Fx" is consistently non-API on
    // both paths).
    const path = routerPathOf(req.url);
    if (path === "/api" || path.startsWith("/api/")) {
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
