/**
 * EXAM-HTTP-SURFACE-AUTHORITY-CLOSURE-1 — architecture invariants I1–I10.
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
 *
 * I4/I5/I7/I9 behavior is asserted over real HTTP in staticFrontend.test.ts /
 * registerDocs.test.ts; the gates here are the deterministic source-level and
 * onRoute-level complements that make the authority model checkable.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function readSource(relPath: string): string {
  return readFileSync(join(SRC, relPath), "utf8");
}

describe("HTTP surface authority — source gates", () => {
  it("I3: the API surface and its classifier sites never re-parse a raw request URL", () => {
    for (const rel of [
      "routes/apiSurface.ts",
      "routes/registerApiRouteModules.ts",
      "plugins/staticFrontend.ts",
      "plugins/rateLimit.ts",
      "openapi/registerDocs.ts",
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
    for (const rel of [
      "../../packages/auth/src/tenantGuard.ts",
      "plugins/tenant.ts",
    ]) {
      expect(existsSync(join(SRC, rel)), rel).toBe(false);
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
  it("the advertised spec path equals the real swagger-ui JSON route (uiPath + /json)", async () => {
    const { resetRuntimeConfigForTest, getRuntimeConfig } =
      await import("../config/runtimeConfig.js");
    const { registerOpenApiDocs } = await import("../openapi/registerDocs.js");
    const { registerStaticFrontend } =
      await import("../plugins/staticFrontend.js");
    const apiSurfacePlugin = (await import("../routes/apiSurface.js")).default;
    const { decorateApiRouteStubs } = await import("../openapi/swagger.js");
    const Fastify = (await import("fastify")).default;
    const { serializerCompiler, validatorCompiler } =
      await import("fastify-type-provider-zod");

    process.env.API_DOCS_ENABLED = "true";
    process.env.NODE_ENV = "test";
    process.env.APP_MODE = "test";
    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();

    const config = getRuntimeConfig();
    const specPath = config.apiReference.specPath;
    const uiPath = config.apiReference.uiPath;
    expect(specPath).toBe(`${uiPath}/json`);

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
    expect(captured.has(`GET ${specPath}`)).toBe(true);
    // The UI route is a real registered route too.
    expect(captured.has(`GET ${uiPath}`)).toBe(true);

    await app.close();
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
      SRC,
      "test-fixtures/api-route-manifest.snapshot.json",
    );
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as string[];

    expect(apiRoutes).toEqual(snapshot);
    await app.close();
  });
});
