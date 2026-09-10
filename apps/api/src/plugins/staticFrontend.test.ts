/**
 * registerStaticFrontend — the router-native web surface.
 *
 * Fastify owns every routing decision; this plugin registers three
 * surface scopes (assets / fonts / shell) with their own cache and
 * unmatched-file policies. There is NO pathname inspection anywhere.
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
import net from "node:net";
import { registerStaticFrontend } from "./staticFrontend.js";

const INDEX_MARKER = "exam-429-spa-fixture-marker";

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  const publicDir = await mkdtemp(join(tmpdir(), "exam-429-public-"));
  await mkdir(join(publicDir, "assets"));
  await mkdir(join(publicDir, "fonts", "x"), { recursive: true });
  await writeFile(
    join(publicDir, "index.html"),
    `<!doctype html><html><head><title>${INDEX_MARKER}</title></head></html>`,
  );
  await writeFile(join(publicDir, "assets", "real.js"), "// real asset\n");
  await writeFile(
    join(publicDir, "fonts", "x", "Regular.css"),
    "/* font css */\n",
  );

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

describe("registerStaticFrontend — router-native web surface", () => {
  it("HTML shell (/, /index.html, SPA deep links) is served with no-cache, never immutable (I4 / #500)", async () => {
    for (const path of ["/", "/index.html", "/some/spa/deep/link"]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(await res.text(), path).toContain(INDEX_MARKER);
      const cacheControl = res.headers.get("cache-control") ?? "";
      expect(cacheControl, path).toBe("no-cache");
      expect(cacheControl, path).not.toContain("immutable");
    }
  });

  it("fingerprinted assets keep the immutable long-lived policy (I5)", async () => {
    const res = await fetch(`${baseUrl}/assets/real.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("real asset");
    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("immutable");
    expect(cacheControl).toContain("max-age=31536000");
  });

  it("stable-name public resources (fonts) revalidate instead of being immutable", async () => {
    const res = await fetch(`${baseUrl}/fonts/x/Regular.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).not.toContain("immutable");
    expect(cacheControl).toContain("max-age=0");
  });

  it("missing static assets keep the real text/plain 404 inside their own scope (never the SPA shell)", async () => {
    for (const path of [
      "/assets/__missing__.js",
      "/fonts/__missing__.woff2",
      "/assets/__missing__.css",
    ]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).toContain("text/plain");
      expect(await res.text(), path).toBe("Not Found");
    }
    // HEAD is inside the assets scope too (the wildcard registers GET+HEAD):
    // a missing asset must never fall through to the SPA shell.
    const head = await fetch(`${baseUrl}/assets/__missing__.js`, {
      method: "HEAD",
    });
    expect(head.status).toBe(404);
    expect(head.headers.get("content-type")).toContain("text/plain");
  });

  it("only GET/HEAD navigation reaches the shell; other unmatched methods get a plain 404 (§11)", async () => {
    const head = await fetch(`${baseUrl}/some/spa/deep/link`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("text/html");

    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await fetch(`${baseUrl}/random-non-api-path`, { method });
      expect(res.status, method).toBe(404);
      expect(res.headers.get("content-type"), method).toContain("text/plain");
      expect(await res.text(), method).toBe("Not Found");
    }
  });

  it("TRACE unmatched stays a plain 404 too (any non-GET/HEAD method)", async () => {
    // fetch()/undici refuse TRACE, so drive the request-target bytes over a
    // raw socket (same technique as apiSurface.test.ts).
    const address = app.addresses()[0];
    if (!address) throw new Error("server lost its listen address");
    const res = await new Promise<{ status: number; ct: string }>(
      (resolve, reject) => {
        const sock = net.connect(address.port, "127.0.0.1");
        let data = "";
        sock.setTimeout(5_000, () => {
          sock.destroy();
          reject(new Error("raw socket timeout"));
        });
        sock.on("error", reject);
        sock.on("connect", () => {
          sock.write(
            `TRACE /random-non-api-path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
          );
        });
        sock.on("data", (chunk: Buffer) => {
          data += chunk.toString("utf8");
        });
        sock.on("close", () => {
          const [head] = data.split("\r\n\r\n");
          const lines = (head ?? "").split("\r\n");
          const statusLine = lines[0] ?? "";
          const ct =
            lines
              .find((line) => line.toLowerCase().startsWith("content-type:"))
              ?.split(":")[1]
              ?.trim() ?? "";
          resolve({
            status: Number(statusLine.split(" ")[1] ?? "0"),
            ct,
          });
        });
      },
    );
    expect(res.status).toBe(404);
    expect(res.ct).toContain("text/plain");
  });

  it("existing static assets under a subdirectory are still served", async () => {
    const res = await fetch(`${baseUrl}/fonts/x/Regular.css`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("font css");
  });
});
