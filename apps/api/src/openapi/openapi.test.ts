import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { openApiConfig } from "./config.js";
import { generateOpenAPISpec, type OpenAPISpecDocument } from "./swagger.js";

// P2.0-J1 — runtime-first contract. OpenAPI is generated from Zod route
// schemas via the provider's jsonSchemaTransform. Probe routes here use Zod so
// they mirror how real routes are authored.
async function generateSpecWithProbeRoutes(
  registerRoutes: (app: FastifyInstance) => void,
): Promise<OpenAPISpecDocument> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const authenticate = async () => {};
  Object.assign(authenticate, { _isAuthenticate: true });
  app.decorate("authenticate", authenticate);
  try {
    await app.register(swaggerPlugin as never, openApiConfig);
    registerRoutes(app);
    await app.ready();
    return app.swagger() as OpenAPISpecDocument;
  } finally {
    await app.close();
  }
}

describe("OpenAPI spec generation", () => {
  it("generates a valid OpenAPI 3.0 document", async () => {
    const spec = await generateOpenAPISpec();

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toEqual(expect.any(String));
    expect(spec.info.version).toEqual(expect.any(String));
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths!).length).toBeGreaterThan(0);
  });

  // Security-scheme ownership: the cookieAuth apiKey scheme is the auth surface
  // every protected route declares (`security: cookieAuth`). `api:openapi:check`
  // only verifies byte-parity of the committed openapi.json, so a silent removal
  // of the scheme (or its rename) would be blessed on regenerate. This test is
  // the explicit property owner.
  it("declares the cookieAuth security scheme in components", async () => {
    const spec = await generateOpenAPISpec();
    const schemes = (
      spec as unknown as {
        components?: { securitySchemes?: Record<string, unknown> };
      }
    ).components?.securitySchemes;
    expect(schemes?.cookieAuth).toBeDefined();
  });

  it("documents a Zod-typed probe route with a typed 200 response", async () => {
    const spec = await generateSpecWithProbeRoutes((app) => {
      app.get(
        "/probe",
        {
          schema: {
            response: {
              200: z.object({ ok: z.boolean() }),
            },
          },
        },
        async () => ({ ok: true }),
      );
    });

    const op = (
      (spec.paths as Record<string, unknown>)["/probe"] as
        | { get?: { responses?: Record<string, unknown> } }
        | undefined
    )?.get;
    expect(op).toBeDefined();
    const r200 = op!.responses!["200"] as {
      content?: Record<string, { schema?: Record<string, unknown> }>;
    };
    expect(r200.content?.["application/json"]?.schema).toBeDefined();
    expect(
      (r200.content!["application/json"]!.schema as Record<string, unknown>)
        .properties,
    ).toBeDefined();
  });

  it("does not classify arbitrary preHandlers as auth (no auto 401)", async () => {
    const spec = await generateSpecWithProbeRoutes((app) => {
      app.get("/probe-public", { preHandler: async () => {} }, async () => ({
        ok: true,
      }));
    });

    const probe = spec.paths["/probe-public"]?.get;
    expect(probe).toBeDefined();
    expect(probe!.responses["200"]).toBeDefined();
    expect(probe!.responses["401"]).toBeUndefined();
  });

  // Health-endpoint response-schema ownership: /api/health is the liveness
  // surface. Its typed 200 response is a real contract consumed by probes/load
  // balancers. `api:openapi:check` only verifies byte-parity, so a schema removal
  // would be blessed on regenerate. This test is the explicit property owner.
  it("includes GET /api/health with a typed 200 response", async () => {
    const spec = await generateOpenAPISpec();
    const op = spec.paths["/api/health"]?.get;
    expect(op).toBeDefined();
    const r200 = op!.responses["200"] as {
      content?: Record<string, { schema?: Record<string, unknown> }>;
    };
    expect(r200.content?.["application/json"]?.schema).toBeDefined();
  });
});
