import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { join } from "node:path";

/**
 * The router-native web surface (EXAM-HTTP-SURFACE-AUTHORITY-CLOSURE-1).
 *
 * Fastify owns every routing decision; no application code inspects a raw
 * URL to decide which surface a request belongs to. Each surface is a
 * Fastify scope with its own prefix, its own unmatched-file policy, and its
 * own cache policy:
 *
 *   /assets/**  fingerprinted build output      immutable, 1y   (I5)
 *   /fonts/**   stable-name public resources    revalidate      (§9C)
 *   /           HTML shell (and SPA navigation) no-cache        (I4)
 *   /index.html HTML shell                      no-cache        (I4)
 *   GET/HEAD unmatched navigation               -> shell        (I4)
 *   any other unmatched method                  -> 404 plain    (§11)
 *
 * A missing file inside a static scope stays in THAT scope's 404 policy —
 * the scoped setNotFoundHandler answers — so a stale hashed asset never
 * falls through to the SPA shell.
 *
 * @param app - Root Fastify instance.
 * @param publicDir - Absolute path of the built web frontend directory.
 */
export async function registerStaticFrontend(
  app: FastifyInstance,
  publicDir: string,
): Promise<void> {
  // Decorate reply.sendFile for the shell handler without registering any
  // static route at the root scope.
  await app.register(fastifyStatic, { root: publicDir, serve: false });

  // Fingerprinted build assets: every file name in /assets carries a
  // content hash, so the long-lived immutable policy is surface-owned.
  await app.register(
    async (assets) => {
      assets.setNotFoundHandler((_req, reply) => {
        reply.code(404).type("text/plain").send("Not Found");
      });
      await assets.register(fastifyStatic, {
        root: join(publicDir, "assets"),
        prefix: "/",
        wildcard: true,
        immutable: true,
        maxAge: "1y",
      });
    },
    { prefix: "/assets" },
  );

  // Stable-name public resources (fonts): the entry files referenced by
  // index.html (e.g. fonts/harmonyos-sans-sc/Regular.css) have stable,
  // non-hashed names, so this surface must revalidate instead of being
  // cached immutably.
  await app.register(
    async (fonts) => {
      fonts.setNotFoundHandler((_req, reply) => {
        reply.code(404).type("text/plain").send("Not Found");
      });
      await fonts.register(fastifyStatic, {
        root: join(publicDir, "fonts"),
        prefix: "/",
        wildcard: true,
        immutable: false,
        maxAge: 0,
      });
    },
    { prefix: "/fonts" },
  );

  // HTML shell + SPA navigation fallback. The router invokes this root-level
  // policy only for requests no other scope owns; it answers with the shell
  // for GET/HEAD navigation and a plain 404 for every other method.
  app.setNotFoundHandler(async (req: FastifyRequest, reply: FastifyReply) => {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD") {
      // no-cache, applied before sendFile: @fastify/static is registered
      // with serve:false here, so its computed Cache-Control is never
      // applied on this path (I4 — the HTML shell never carries immutable).
      reply.header("Cache-Control", "no-cache");
      return reply.sendFile("index.html", publicDir, { cacheControl: false });
    }
    reply.code(404).type("text/plain").send("Not Found");
  });
}
