/**
 * #429 router-native /api namespace boundary — Fastify owns ALL routing
 * semantics; the application owns only the 404 response policy.
 *
 * The production authority is the apiSurface plugin (routes/apiSurface.ts):
 * one encapsulated `{ prefix: "/api" }` scope that registers every API route
 * module AND the scoped `setNotFoundHandler`. This suite drives the REAL
 * production composition (apiSurface + registerStaticFrontend + the same
 * CORS dispatch mechanics the runtime registers) through a real HTTP server
 * — no test-side reimplementation of the dispatch.
 *
 * Authority model under test:
 *   Fastify/find-my-way classifies a request as /api (registered route
 *   matched, or the /api-scoped not-found handler selected by the router's
 *   own URL semantics). The application's only job is the canonical
 *   RESOURCE_NOT_FOUND JSON body. There is no handwritten URL classifier.
 *
 * The raw-socket cases (encoded spelling, dot segments) are wire-level
 * witnesses of the ROUTER's classification — they are not parser unit
 * tests. fetch()/undici normalize request-targets client-side, so every
 * case that pins routing semantics is driven with the target bytes sent
 * verbatim.
 *
 * Frozen defect baseline (reality audit @ d86d3f79): 9 unmatched /api probes
 * escaped as 200 text/html SPA + immutable cache, 2 as 404 text/plain,
 * 0 canonical JSON. CORRECTIVE-2 fixed the raw /api cases but still
 * diverged from the router for encoded spellings (e.g. /%61pi/...). The
 * matrices below must all be canonical JSON for router-classified /api
 * requests, and the controls must keep non-/api behavior unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import corsPlugin from "@fastify/cors";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { decorateApiRouteStubs } from "../openapi/swagger.js";
import { registerStaticFrontend } from "../plugins/staticFrontend.js";
import apiSurfacePlugin from "./apiSurface.js";

const INDEX_MARKER = "exam-429-spa-fixture-marker";

let app: FastifyInstance;
let baseUrl: string;

/** Captured composition for the governance assertion (§46). */
let capturedRoutes: Array<{ url: string; routePath: string }> = [];

beforeAll(async () => {
  const publicDir = await mkdtemp(join(tmpdir(), "exam-429-public-"));
  await mkdir(join(publicDir, "assets"));
  await writeFile(
    join(publicDir, "index.html"),
    `<!doctype html><html><head><title>${INDEX_MARKER}</title></head></html>`,
  );
  await writeFile(join(publicDir, "assets", "real.js"), "// real asset\n");

  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  decorateApiRouteStubs(app);
  app.addHook("onRoute", (route) => {
    capturedRoutes.push({
      url: String(route.url),
      routePath: String(route.routePath),
    });
  });
  // Same CORS dispatch mechanics as production (server.ts registers the cors
  // plugin on the root scope): an onRequest hook plus a real options('*')
  // catch-all route with @fastify/cors defaults (strictPreflight: true).
  // Origin reflection keeps the fixture self-contained; the probes measure
  // dispatch mechanics, not origin configuration.
  await app.register(corsPlugin, { origin: true, credentials: true } as never);
  // The real production composition: one /api scope + the root static
  // fallback, exactly like server.ts.
  await app.register(apiSurfacePlugin, { prefix: "/api" });
  await registerStaticFrontend(app, publicDir);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.addresses()[0];
  if (!address) throw new Error("server did not report a listen address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

interface CanonicalEnvelope {
  error: { code: string; message: string; requestId: unknown };
}

/**
 * Assert the #429 boundary contract for one unmatched /api request:
 * canonical JSON 404 (RESOURCE_NOT_FOUND + non-empty requestId), never HTML,
 * never the text/plain asset fallback, never immutable caching.
 */
async function expectCanonicalApiNotFound(
  method: string,
  path: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, { method });
  const label = `${method} ${path}`;
  expect(res.status, label).toBe(404);
  expect(res.headers.get("content-type"), label).toContain("application/json");
  expect(res.headers.get("cache-control") ?? "", label).not.toContain(
    "immutable",
  );
  const body = (await res.json()) as CanonicalEnvelope;
  expect(body.error.code, label).toBe("RESOURCE_NOT_FOUND");
  expect(typeof body.error.requestId, label).toBe("string");
  expect(String(body.error.requestId).length, label).toBeGreaterThan(0);
}

interface RawResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Drive one raw HTTP GET with an exact request-target over a TCP socket.
 * fetch()/undici normalize request-targets (dot segments, encodings) before
 * they reach the server, so every case that pins routing semantics must go
 * through here with the target bytes sent verbatim.
 */
function rawGet(target: string): Promise<RawResponse> {
  const address = app.addresses()[0];
  if (!address) throw new Error("server lost its listen address");
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port: address.port });
    let data = "";
    const fail = (err: Error) => {
      sock.destroy();
      reject(err);
    };
    sock.setTimeout(5_000, () =>
      fail(new Error(`raw socket timeout: ${target}`)),
    );
    sock.on("error", fail);
    sock.on("connect", () => {
      sock.write(
        `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
    });
    sock.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    sock.on("close", () => {
      const [head = "", ...bodyParts] = data.split("\r\n\r\n");
      const [statusLine = "", ...headerLines] = head.split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 1).trim();
      }
      resolve({
        statusCode: Number(statusLine.split(" ")[1] ?? "0"),
        headers,
        body: bodyParts.join("\r\n\r\n"),
      });
    });
  });
}

/**
 * Assert the #429 boundary contract for one raw-socket request-target: the
 * response must be the canonical API JSON 404 — never SPA HTML, never the
 * text/plain asset fallback, never immutable caching.
 */
async function expectCanonicalApiNotFoundRaw(target: string): Promise<void> {
  const res = await rawGet(target);
  expect(res.statusCode, target).toBe(404);
  expect(res.headers["content-type"] ?? "", target).toContain(
    "application/json",
  );
  expect(res.headers["cache-control"] ?? "", target).not.toContain("immutable");
  expect(res.body, target).not.toContain(INDEX_MARKER);
  const body = JSON.parse(res.body) as CanonicalEnvelope;
  expect(body.error.code, target).toBe("RESOURCE_NOT_FOUND");
  expect(typeof body.error.requestId, target).toBe("string");
  expect(String(body.error.requestId).length, target).toBeGreaterThan(0);
}

/**
 * Assert the non-API appearance contract for one raw-socket request-target:
 * SPA index.html fallback with text/html.
 */
async function expectSpaFallbackRaw(target: string): Promise<void> {
  const res = await rawGet(target);
  expect(res.statusCode, target).toBe(200);
  expect(res.headers["content-type"] ?? "", target).toContain("text/html");
  expect(res.body, target).toContain(INDEX_MARKER);
}

describe("#429 /api namespace boundary (router-native)", () => {
  it("registered API routes beat the scoped 404 — the real route still answers", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    const head = await fetch(`${baseUrl}/api/health`, { method: "HEAD" });
    expect(head.status).toBe(200);
  });

  it("unmatched extensionless /api requests stay in the API JSON error boundary", async () => {
    await expectCanonicalApiNotFound("GET", "/api");
    await expectCanonicalApiNotFound("GET", "/api/");
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__");
    await expectCanonicalApiNotFound("POST", "/api/__429_unknown__");
  });

  it("dotted /api asset-looking paths get the canonical JSON error, not the text/plain asset 404", async () => {
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__.json");
  });

  it("a query string cannot make /api look like a static asset", async () => {
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__?x=a.js");
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__?f=assets.js");
  });

  it("wrong methods on a registered /api path stay in the API JSON error boundary (404 is accepted; #429 does not require 405)", async () => {
    await expectCanonicalApiNotFound("POST", "/api/health");
    await expectCanonicalApiNotFound("PUT", "/api/health");
    await expectCanonicalApiNotFound("DELETE", "/api/health");
  });

  it("nonexistent /api child/action paths stay in the API JSON error boundary", async () => {
    await expectCanonicalApiNotFound("GET", "/api/attempts");
    await expectCanonicalApiNotFound("GET", "/api/users/not-a-uuid");
  });

  describe("raw-socket routing-semantics witnesses — the ROUTER classifies, the app only answers", () => {
    it("a literal dot segment does not normalize the /api namespace away", async () => {
      // Fastify matches dot segments literally (no URL normalization), so
      // the router classifies /api/../x as /api — the scoped 404 answers.
      await expectCanonicalApiNotFoundRaw("/api/../__429_dot__");
      await expectCanonicalApiNotFoundRaw("/api/../x");
    });

    it("percent-encoded dot segments stay in the /api namespace too", async () => {
      await expectCanonicalApiNotFoundRaw("/api/%2e%2e/__429_encoded_dot__");
      await expectCanonicalApiNotFoundRaw("/api/%2e%2e/x");
    });

    it("CORRECTIVE-3 P1: an encoded spelling of /api is classified by the ROUTER as /api", async () => {
      // find-my-way decodes non-reserved percent-escapes before matching
      // (%61 -> a), so /%61pi/__429_unknown__ is a /api request to the
      // router: it must hit the scoped canonical 404 — never the SPA
      // fallback. This is the case CORRECTIVE-1 (WHATWG URL) and
      // CORRECTIVE-2 (raw-byte classifier) both got wrong because they
      // parsed the path themselves.
      await expectCanonicalApiNotFoundRaw("/%61pi/__429_encoded_prefix__");
      // The registered-route twin: the router decodes the same way for
      // success paths, so /%61pi/health reaches the real route.
      const res = await rawGet("/%61pi/health");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"] ?? "").toContain("application/json");
    });

    it("router-semantics control: /api%2Fx is NOT /api, because the router does not decode %2F in the path", async () => {
      // Expected because Fastify classified it this way — %2F is a reserved
      // escape the router leaves encoded in path matching, so /api%2Fx is a
      // single segment outside the /api namespace. The application must not
      // independently reinterpret it.
      await expectSpaFallbackRaw("/api%2Fx");
    });

    it("raw-socket boundary table — every router-classified /api unmatched target stays canonical JSON", async () => {
      for (const target of [
        "/api",
        "/api/",
        "/api/x",
        "/api/x?foo=a.js",
        "/api/../x",
        "/api/%2e%2e/x",
        "/%61pi/__429_unknown__",
      ]) {
        await expectCanonicalApiNotFoundRaw(target);
      }
      for (const target of ["/apix", "/api-docs", "/api%2Fx"]) {
        await expectSpaFallbackRaw(target);
      }
    });
  });

  describe("negative controls — non-/api namespaces keep their existing behavior", () => {
    it("pathnames outside the exact /api namespace are NOT captured by the /api boundary", async () => {
      for (const path of ["/apix/__429_control__", "/api-docs", "/api%2Fx"]) {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("content-type"), path).toContain("text/html");
        expect(await res.text(), path).toContain(INDEX_MARKER);
      }
    });

    it("a request-target too malformed for the router's absolute-form rule keeps the SPA fallback and never becomes a 500", async () => {
      // `http://[invalid` does not match find-my-way's absolute-form prefix
      // rule (no `/` after the authority), so it stays a non-API path — SPA
      // fallback, never a throw into the 500 handler.
      await expectSpaFallbackRaw("http://[invalid");
    });

    it("SPA deep links still get the index.html fallback", async () => {
      const res = await fetch(`${baseUrl}/some/spa/deep/link`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain(INDEX_MARKER);
    });

    it("missing static assets keep the real text/plain 404 (not SPA, not API JSON)", async () => {
      const res = await fetch(`${baseUrl}/assets/__429_missing__.js`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text()).toBe("Not Found");
    });

    it("existing static assets are still served", async () => {
      const res = await fetch(`${baseUrl}/assets/real.js`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("real asset");
    });
  });

  describe("#451 non-regression — OPTIONS dispatch is untouched (fixing #451 is OUT of scope)", () => {
    it("bare OPTIONS stays the strictPreflight 400, never the API boundary (unchanged from OLD_HEAD)", async () => {
      for (const path of ["/api/health", "/api/__429_unknown__"]) {
        const res = await fetch(`${baseUrl}${path}`, { method: "OPTIONS" });
        expect(res.status, path).toBe(400);
        expect(res.headers.get("content-type"), path).toContain("text/plain");
        expect(await res.text(), path).toContain("Invalid Preflight Request");
      }
    });

    it("valid CORS preflight to registered and unmatched /api paths still gets the 204 + CORS headers", async () => {
      for (const path of ["/api/health", "/api/__429_unknown__"]) {
        const res = await fetch(`${baseUrl}${path}`, {
          method: "OPTIONS",
          headers: {
            Origin: "http://probe.example.test",
            "Access-Control-Request-Method": "GET",
          },
        });
        expect(res.status, path).toBe(204);
        expect(res.headers.get("access-control-allow-origin"), path).toContain(
          "http://probe.example.test",
        );
        expect(
          res.headers.get("access-control-allow-methods") ?? "",
          path,
        ).toContain("GET");
      }
    });
  });

  describe("governance — the apiSurface scope owns every /api route (§46)", () => {
    it("no /api route is registered at the root level: every /api url has a relative routePath", async () => {
      // A route registered INSIDE the apiSurface scope has a routePath
      // relative to /api (e.g. url=/api/health, routePath=/health). A route
      // that escaped to the root scope would carry its /api prefix in
      // routePath too — this test turns that topology violation red.
      const escaped = capturedRoutes.filter(
        (r) => r.url.startsWith("/api") && r.routePath.startsWith("/api"),
      );
      expect(escaped, JSON.stringify(escaped.slice(0, 5))).toEqual([]);
    });

    it("the composition captured a real API surface: registered routes and the scoped policy coexist", async () => {
      const urls = new Set(capturedRoutes.map((r) => r.url));
      expect(urls.has("/api/health")).toBe(true);
      expect(urls.has("/api/auth/login")).toBe(true);
      expect(urls.has("/api/exams")).toBe(true);
      // The static fallback stays at the root scope (its routePath keeps the
      // root prefix), i.e. the two scopes coexist.
      const staticEntry = capturedRoutes.find((r) =>
        r.url.endsWith("/index.html"),
      );
      expect(staticEntry?.routePath).toBe("/index.html");
    });
  });
});
