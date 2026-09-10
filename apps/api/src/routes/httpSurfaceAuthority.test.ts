/**
 * EXAM-HTTP-SURFACE-AUTHORITY-CLOSURE-2 — architecture invariants I1–I11.
 *
 * These gates pin the HTTP surface authority model on the REAL production
 * composition: Fastify owns routing identity, route/surface metadata owns
 * policy, and no production code re-parses a raw URL to rediscover routing
 * identity.
 *
 *   I1  All production /api routes belong to the apiSurface scope.
 *   I2  No root-level production route independently registers /api/**.
 *   I3  No application-written /api request-path classifier exists.
 *   I4  HTML shell never carries immutable.          (staticFrontend.test.ts)
 *   I5  Fingerprint assets preserve immutable.       (staticFrontend.test.ts)
 *   I6  Docs spec path has one runtime/config identity.
 *   I7  Rate-limit exemption does not classify raw URL. (registerDocs.test.ts)
 *   I8  Tenant/public/platform policy does not classify raw URL.
 *   I9  Static frontend does not classify asset-vs-SPA by pathname heuristics.
 *   I10 Route manifest does not drift unintentionally.
 *   I11 Docs namespace is always router-owned — never the SPA fallback,
 *       regardless of the docs capability state.
 *
 * I4/I5/I7/I9 behavior is asserted over real HTTP in staticFrontend.test.ts /
 * registerDocs.test.ts; the gates here are the deterministic source-level and
 * onRoute-level complements that make the authority model checkable. I8 and
 * I11 additionally point at REAL repo paths / real HTTP behavior so a
 * regression cannot pass while the assertion looks at the wrong reality.
 */
import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// This test file lives at <repo>/apps/api/src/routes/. Deriving both roots
// from the file's own URL keeps the absolute-path assertions (I8) pointing
// at the real package locations — the OLD relative ".." chain resolved to
// <repo>/apps/packages/... and made the check vacuous.
const API_SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

function readSource(relPath: string): string {
  return readFileSync(join(API_SRC_ROOT, relPath), "utf8");
}

describe("HTTP surface authority — source gates", () => {
  it("I3: the API surface and its classifier sites never re-parse a raw request URL", () => {
    for (const rel of [
      "routes/apiSurface.ts",
      "routes/registerApiRouteModules.ts",
      "plugins/staticFrontend.ts",
      "plugins/rateLimit.ts",
      "openapi/registerDocs.ts",
      "openapi/docsPaths.ts",
    ]) {
      const src = readSource(rel);
      expect(src, rel).not.toMatch(/request\.url|req\.url|raw\.url/);
      expect(src, rel).not.toMatch(/startsWith\(|decodeURI|split\(/);
    }
  });

  it("I7: the rate-limit plugin carries no allow-list / URL classification", () => {
    const src = readSource("plugins/rateLimit.ts");
    expect(src).not.toMatch(
      /allowList|isApiReferenceRequest|url\.split|pathOnly/,
    );
  });

  it("I8: the tenant path registries are gone (no second router for tenant/public/platform)", () => {
    // Self-check the derived roots before asserting on them: if the repo
    // layout ever shifts the derivation off the real paths, these two
    // existence assertions fail loudly instead of silently vacuous.
    expect(existsSync(join(REPO_ROOT, "package.json")), "REPO_ROOT").toBe(true);
    expect(
      existsSync(join(REPO_ROOT, "packages/auth/package.json")),
      "packages/auth",
    ).toBe(true);
    for (const abs of [
      join(REPO_ROOT, "packages/auth/src/tenantGuard.ts"),
      join(API_SRC_ROOT, "plugins/tenant.ts"),
    ]) {
      expect(existsSync(abs), abs).toBe(false);
    }
    const serverSrc = readSource("server.ts");
    expect(serverSrc).not.toMatch(/tenantPlugin|validateTenantAccess/);
  });

  it("I9: the static frontend registers scopes; it contains no pathname heuristic", () => {
    const src = readSource("plugins/staticFrontend.ts");
    expect(src).not.toMatch(/startsWith|\.test\(|\.split\(/);
    expect(src).toMatch(/prefix: "\/assets"/);
    expect(src).toMatch(/prefix: "\/fonts"/);
  });
});

describe("HTTP surface authority — docs identity (I6)", () => {
  it("spec path is derived from the single UI path authority; both are real registered routes", async () => {
    const { resetRuntimeConfigForTest, getRuntimeConfig, buildPublicConfig } =
      await import("../config/runtimeConfig.js");
    const { registerOpenApiDocs } = await import("../openapi/registerDocs.js");
    const { registerStaticFrontend } =
      await import("../plugins/staticFrontend.js");
    const apiSurfacePlugin = (await import("../routes/apiSurface.js")).default;
    const { decorateApiRouteStubs } = await import("../openapi/swagger.js");
    const { API_REFERENCE_UI_PATH, API_REFERENCE_SPEC_PATH } =
      await import("../openapi/docsPaths.js");
    const Fastify = (await import("fastify")).default;
    const { serializerCompiler, validatorCompiler } =
      await import("fastify-type-provider-zod");

    process.env.API_DOCS_ENABLED = "true";
    process.env.NODE_ENV = "test";
    process.env.APP_MODE = "test";
    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();

    // One canonical root; the spec path is derived, never independently
    // authored (CORRECTIVE-3).
    expect(API_REFERENCE_SPEC_PATH).toBe(`${API_REFERENCE_UI_PATH}/json`);

    const config = getRuntimeConfig();
    expect(config.apiReference.uiPath).toBe(API_REFERENCE_UI_PATH);
    // The spec path is not stored in the internal config at all — it is
    // derived in the public projection, so no second authority can diverge.
    expect(config.apiReference).not.toHaveProperty("specPath");
    expect(buildPublicConfig().apiReference.specPath).toBe(
      API_REFERENCE_SPEC_PATH,
    );

    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    decorateApiRouteStubs(app);
    const captured = new Set<string>();
    app.addHook("onRoute", (route) => {
      captured.add(`${route.method} ${String(route.url)}`);
    });
    await registerOpenApiDocs(app);
    await app.register(apiSurfacePlugin, { prefix: "/api" });
    // serve:false static decoration so the composition matches production.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const publicDir = await mkdtemp(join(tmpdir(), "exam-authority-"));
    await writeFile(join(publicDir, "index.html"), "<html></html>");
    await registerStaticFrontend(app, publicDir);
    await app.ready();

    // The advertised machine-readable spec path is a REAL registered route.
    expect(captured.has(`GET ${API_REFERENCE_SPEC_PATH}`)).toBe(true);
    // The UI route is a real registered route too.
    expect(captured.has(`GET ${API_REFERENCE_UI_PATH}`)).toBe(true);

    await app.close();
  });
});

describe("HTTP surface authority — docs namespace ownership (I11)", () => {
  const DOCS_PROBES = [
    ["GET", "/_dev/api-reference"],
    ["GET", "/_dev/api-reference/"],
    ["GET", "/_dev/api-reference/json"],
    ["GET", "/_dev/api-reference/unknown"],
    ["HEAD", "/_dev/api-reference"],
    ["POST", "/_dev/api-reference"],
  ] as const;
  const SPA_MARKER = "SPA-SHELL-MARKER";

  async function buildProductionComposition(
    docsEnabled: string,
  ): Promise<{ app: FastifyInstance }> {
    const { resetRuntimeConfigForTest } =
      await import("../config/runtimeConfig.js");
    const { registerOpenApiDocs } = await import("../openapi/registerDocs.js");
    const { registerStaticFrontend } =
      await import("../plugins/staticFrontend.js");
    const apiSurfacePlugin = (await import("../routes/apiSurface.js")).default;
    const { decorateApiRouteStubs } = await import("../openapi/swagger.js");
    const Fastify = (await import("fastify")).default;
    const { serializerCompiler, validatorCompiler } =
      await import("fastify-type-provider-zod");

    process.env.API_DOCS_ENABLED = docsEnabled;
    process.env.NODE_ENV = "test";
    process.env.APP_MODE = "test";
    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();

    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    decorateApiRouteStubs(app);
    await registerOpenApiDocs(app);
    await app.register(apiSurfacePlugin, { prefix: "/api" });
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const publicDir = await mkdtemp(join(tmpdir(), "exam-authority-"));
    await writeFile(
      join(publicDir, "index.html"),
      `<html>${SPA_MARKER}</html>`,
    );
    await registerStaticFrontend(app, publicDir);
    await app.ready();
    return { app };
  }

  it("docs disabled: every namespace probe is a docs-owned 404 — never SPA, never API JSON", async () => {
    const { app } = await buildProductionComposition("false");
    try {
      for (const [method, url] of DOCS_PROBES) {
        const res = await app.inject({ method, url });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(
          String(res.headers["content-type"] ?? ""),
          `${method} ${url}`,
        ).toMatch(/text\/plain/);
        expect(res.body, `${method} ${url}`).not.toContain(SPA_MARKER);
      }
    } finally {
      await app.close();
    }
  });

  it("docs enabled: UI/spec routes work; unknown children stay docs-owned (no SPA escape)", async () => {
    const { app } = await buildProductionComposition("true");
    try {
      const uiBare = await app.inject({
        method: "GET",
        url: "/_dev/api-reference",
      });
      expect(uiBare.statusCode).toBe(200);
      expect(String(uiBare.headers["content-type"] ?? "")).toMatch(
        /text\/html/,
      );
      expect(uiBare.body).not.toContain(SPA_MARKER);

      const uiSlash = await app.inject({
        method: "GET",
        url: "/_dev/api-reference/",
      });
      expect(uiSlash.statusCode).toBe(200);

      const spec = await app.inject({
        method: "GET",
        url: "/_dev/api-reference/json",
      });
      expect(spec.statusCode).toBe(200);
      expect(String(spec.headers["content-type"] ?? "")).toMatch(
        /application\/json/,
      );

      const head = await app.inject({
        method: "HEAD",
        url: "/_dev/api-reference",
      });
      expect(head.statusCode).toBe(200);

      // Unknown docs child and non-GET on the namespace root: docs-owned
      // 404 (the root web fallback must never see them).
      const unknown = await app.inject({
        method: "GET",
        url: "/_dev/api-reference/unknown",
      });
      expect(unknown.statusCode).toBe(404);
      expect(String(unknown.headers["content-type"] ?? "")).toMatch(
        /text\/plain/,
      );
      expect(unknown.body).not.toContain(SPA_MARKER);

      const post = await app.inject({
        method: "POST",
        url: "/_dev/api-reference",
      });
      expect(post.statusCode).toBe(404);
      expect(String(post.headers["content-type"] ?? "")).toMatch(/text\/plain/);
    } finally {
      await app.close();
    }
  });
});

describe("HTTP surface authority — /api route manifest stability (I10)", () => {
  it("the production /api route set matches the checked-in snapshot (update the snapshot on intentional changes)", async () => {
    const Fastify = (await import("fastify")).default;
    const { serializerCompiler, validatorCompiler } =
      await import("fastify-type-provider-zod");
    const { decorateApiRouteStubs } = await import("../openapi/swagger.js");
    const apiSurfacePlugin = (await import("../routes/apiSurface.js")).default;
    const { resetRuntimeConfigForTest } =
      await import("../config/runtimeConfig.js");
    const { registerStaticFrontend } =
      await import("../plugins/staticFrontend.js");

    process.env.API_DOCS_ENABLED = "false";
    process.env.NODE_ENV = "test";
    process.env.APP_MODE = "test";
    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();

    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    decorateApiRouteStubs(app);
    const captured: string[] = [];
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method)
        ? route.method
        : [route.method ?? "GET"];
      for (const method of methods) {
        captured.push(`${method} ${String(route.url)}`);
      }
    });
    await app.register(apiSurfacePlugin, { prefix: "/api" });
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const publicDir = await mkdtemp(join(tmpdir(), "exam-authority-"));
    await writeFile(join(publicDir, "index.html"), "<html></html>");
    await registerStaticFrontend(app, publicDir);
    await app.ready();

    const apiRoutes = captured
      .filter((entry) => entry.includes(" /api") || entry.includes(" /api/"))
      .sort()
      .filter((v, i, a) => a.indexOf(v) === i);

    const snapshotPath = join(
      API_SRC_ROOT,
      "test-fixtures/api-route-manifest.snapshot.json",
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as string[];

    expect(apiRoutes).toEqual(snapshot);
    await app.close();
  });
});
