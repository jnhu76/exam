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
      // socket instead. This pins the corrective for the adversarial-review
      // P1: the not-found handler must not throw on unparseable targets.
      const address = app.addresses()[0];
      if (!address) throw new Error("server lost its listen address");
      const response = await new Promise<string>((resolve, reject) => {
        const sock = net.connect({ host: "127.0.0.1", port: address.port });
        let data = "";
        const fail = (err: Error) => {
          sock.destroy();
          reject(err);
        };
        sock.setTimeout(5_000, () => fail(new Error("raw socket timeout")));
        sock.on("error", fail);
        sock.on("connect", () => {
          sock.write(
            `GET http://[invalid HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
          );
        });
        sock.on("data", (chunk: Buffer) => {
          data += chunk.toString("utf8");
        });
        sock.on("close", () => resolve(data));
      });
      expect(response).toMatch(/^HTTP\/1\.1 200 /);
      expect(response).toContain("text/html");
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
