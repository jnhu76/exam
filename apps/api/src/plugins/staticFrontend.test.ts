/**
 * #429 regression: the /api namespace boundary of the global
 * unmatched-request handler.
 *
 * The production owner is `registerStaticFrontend` (server.ts delegates to
 * it), so this suite drives the REAL registration through a real HTTP server
 * — no test-side reimplementation of the dispatch. A bare Fastify instance
 * plus one registered GET /api/health route mirrors the production inventory
 * shape: "registered path + unregistered method" and "unregistered path"
 * both reach the not-found handler, exactly as the #429 reality audit
 * observed on the Docker artifact.
 *
 * Frozen defect baseline (reality audit @ d86d3f79): 9 unmatched /api probes
 * escaped as 200 text/html SPA + immutable cache, 2 as 404 text/plain
 * "Not Found", 0 canonical JSON. The matrix below must stay canonical JSON;
 * the control matrix must keep non-/api SPA/static behavior unchanged.
 *
 * CORRECTIVE-2 (PR #499 fresh review P1): the fallback classifier must not
 * run WHATWG `new URL()` dot-segment normalization. It would collapse
 * `/api/../x` and `/api/%2e%2e/x` to `/x` and let requests whose raw
 * request-target still lives in the /api namespace escape into the SPA/static
 * authority. Classification now mirrors the raw router path semantics of
 * find-my-way@9.6.0 (query stripped at the first ?/#, absolute-form
 * authority stripped with the router's own prefix rule, path bytes preserved
 * verbatim), and the dot-segment cases below are pinned through raw sockets,
 * because fetch()/undici normalize request-targets client-side.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { registerStaticFrontend } from "./staticFrontend.js";

const INDEX_MARKER = "exam-429-spa-fixture-marker";

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  const publicDir = await mkdtemp(join(tmpdir(), "exam-429-public-"));
  await mkdir(join(publicDir, "assets"));
  await writeFile(
    join(publicDir, "index.html"),
    `<!doctype html><html><head><title>${INDEX_MARKER}</title></head></html>`,
  );
  await writeFile(join(publicDir, "assets", "real.js"), "// real asset\n");

  app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ status: "ok" }));
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
 * they reach the server, so every case that pins parsing semantics must go
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

describe("#429 /api namespace boundary (registerStaticFrontend)", () => {
  it("unmatched extensionless /api requests stay in the API JSON error boundary", async () => {
    await expectCanonicalApiNotFound("GET", "/api");
    await expectCanonicalApiNotFound("GET", "/api/");
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__");
    await expectCanonicalApiNotFound("POST", "/api/__429_unknown__");
  });

  it("dotted /api asset-looking paths get the canonical JSON error, not the text/plain asset 404", async () => {
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__.json");
  });

  it("classification uses the pathname, not the raw URL suffix — a query string cannot make /api look like a static asset", async () => {
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__?x=a.js");
    await expectCanonicalApiNotFound("GET", "/api/__429_unknown__?f=assets.js");
  });

  it("wrong methods on a registered /api path stay in the API JSON error boundary (404 is accepted; #429 does not require 405)", async () => {
    const healthy = await fetch(`${baseUrl}/api/health`);
    expect(healthy.status).toBe(200);
    await expectCanonicalApiNotFound("POST", "/api/health");
    await expectCanonicalApiNotFound("PUT", "/api/health");
    await expectCanonicalApiNotFound("DELETE", "/api/health");
  });

  it("nonexistent /api child/action paths stay in the API JSON error boundary", async () => {
    await expectCanonicalApiNotFound("GET", "/api/attempts");
    await expectCanonicalApiNotFound("GET", "/api/users/not-a-uuid");
  });

  describe("CORRECTIVE-2 — dot-segment request-targets keep the raw /api boundary (raw socket)", () => {
    it("Case A: a literal dot segment does not normalize the /api namespace away", async () => {
      // WHATWG `new URL().pathname` would collapse /api/../x to /x and drop
      // the request into the SPA/static authority. The router matches dot
      // segments literally and never normalizes them, so the boundary must
      // follow the raw path: still /api namespace, still canonical JSON.
      await expectCanonicalApiNotFoundRaw("/api/../__429_dot__");
      await expectCanonicalApiNotFoundRaw("/api/../x");
    });

    it("Case B: percent-encoded dot segments stay in the /api namespace too", async () => {
      // %2e is a non-reserved encoding: the router decodes it to a literal
      // `.` segment but never collapses the resulting .. path — and the
      // classifier preserves the raw bytes, so /api/%2e%2e/x is API either
      // way. It must not be re-interpreted as /x by a URL parser.
      await expectCanonicalApiNotFoundRaw("/api/%2e%2e/__429_encoded_dot__");
      await expectCanonicalApiNotFoundRaw("/api/%2e%2e/x");
    });

    it("parsing-semantics regression table — boundary ownership follows raw router path semantics", async () => {
      // The table pins the classifier's parsing contract case by case; every
      // case is driven raw so no client-side normalization can mask a
      // regression. The /api cases assert boundary ownership (canonical JSON
      // 404), the non-API cases assert the SPA fallback is untouched.
      for (const target of [
        "/api",
        "/api/",
        "/api/x",
        "/api/x?foo=a.js",
        "/api/../x",
        "/api/%2e%2e/x",
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
      // /apix and /api-docs merely share the leading letters; /api%2Fx keeps
      // its percent-encoding — %2F is not a path separator for the router
      // either, so it is consistently non-API on both routing paths.
      for (const path of ["/apix/__429_control__", "/api-docs", "/api%2Fx"]) {
        const res = await fetch(`${baseUrl}${path}`);
        expect(res.status, path).toBe(200);
        expect(res.headers.get("content-type"), path).toContain("text/html");
        expect(await res.text(), path).toContain(INDEX_MARKER);
      }
    });

    it("a request-target too malformed for URL parsing keeps the SPA fallback and never becomes a 500", async () => {
      // fetch() cannot emit an absolute-form request-target; drive a raw
      // socket instead. `http://[invalid` does not match the router's
      // absolute-form prefix rule (no `/` after the authority), so it stays
      // a non-API path — SPA fallback, never a throw into the 500 handler.
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
});
