/**
 * registerStaticFrontend — root static/SPA appearance contract.
 *
 * This plugin is the ROOT (non-API) fallback only. The /api namespace has
 * its own router-scoped unmatched-request policy inside the apiSurface
 * plugin; Fastify selects between the two by router prefix. This suite
 * therefore asserts ONLY the static/SPA behavior — it contains no /api
 * knowledge, mirroring the plugin's own responsibility boundary.
 *
 * The /api boundary contract (canonical JSON 404 for router-classified /api
 * unmatched requests, encoded/dot-segment raw-socket witnesses, #451
 * OPTIONS non-regression) lives in routes/apiSurface.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  await registerStaticFrontend(app, publicDir);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.addresses()[0];
  if (!address) throw new Error("server did not report a listen address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

describe("registerStaticFrontend — root static/SPA fallback", () => {
  it("SPA navigation deep links get the index.html fallback", async () => {
    for (const path of ["/", "/some/spa/deep/link", "/candidate/exams"]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(await res.text(), path).toContain(INDEX_MARKER);
      // NOTE: the SPA root cache policy (immutable on index.html) is a
      // PRE-EXISTING quirk explicitly OUT of #429 scope — not asserted here.
    }
  });

  it("missing static assets keep the real text/plain 404 (not the SPA fallback)", async () => {
    const res = await fetch(`${baseUrl}/assets/__429_missing__.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("Not Found");
  });

  it("existing static assets are still served with their own cache policy", async () => {
    const res = await fetch(`${baseUrl}/assets/real.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("real asset");
    expect(res.headers.get("cache-control") ?? "").toContain("immutable");
  });
});
