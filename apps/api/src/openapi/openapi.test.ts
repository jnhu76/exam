import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import swaggerPlugin from "@fastify/swagger";
import { addCommonResponseSchemas, openApiConfig } from "./config.js";
import { generateOpenAPISpec, type OpenAPISpecDocument } from "./swagger.js";

async function generateSpecWithProbeRoutes(
  registerRoutes: (app: FastifyInstance) => void,
): Promise<OpenAPISpecDocument> {
  const app = Fastify({ logger: false });
  const authenticate = async () => {};
  Object.assign(authenticate, { _isAuthenticate: true });
  app.decorate("authenticate", authenticate);
  try {
    await app.register(swaggerPlugin as never, openApiConfig);
    addCommonResponseSchemas(app);
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

  it("documents auth endpoints with success and error responses", async () => {
    const spec = await generateOpenAPISpec();

    const login = spec.paths["/api/auth/login"]?.post;
    expect(login).toBeDefined();
    expect(login!.responses["200"]).toBeDefined();
    expect(login!.responses["400"]).toBeDefined();
    expect(login!.responses["401"]).toBeDefined();
  });

  it("documents exam endpoints with success and error responses", async () => {
    const spec = await generateOpenAPISpec();

    const listExams = spec.paths["/api/exams"]?.get;
    expect(listExams).toBeDefined();
    expect(listExams!.responses["200"]).toBeDefined();
    expect(listExams!.responses["401"]).toBeDefined();
    expect(listExams!.responses["403"]).toBeDefined();

    const publishExam = spec.paths["/api/exams/{id}/publish"]?.post;
    expect(publishExam).toBeDefined();
    expect(publishExam!.responses["200"]).toBeDefined();
    expect(publishExam!.responses["404"]).toBeDefined();
    expect(publishExam!.responses["409"]).toBeDefined();
  });

  it("documents candidate import with success and error responses", async () => {
    const spec = await generateOpenAPISpec();

    const importCandidates = spec.paths["/api/candidates/import"]?.post;
    expect(importCandidates).toBeDefined();
    expect(importCandidates!.responses["200"]).toBeDefined();
    expect(importCandidates!.responses["400"]).toBeDefined();
    expect(importCandidates!.responses["401"]).toBeDefined();
    expect(importCandidates!.responses["403"]).toBeDefined();
  });

  it("documents export scores with CSV success and JSON error", async () => {
    const spec = await generateOpenAPISpec();

    const exportScores = spec.paths["/api/exams/{id}/export/scores"]?.get;
    expect(exportScores).toBeDefined();
    expect(exportScores!.responses["200"]).toBeDefined();
    expect(exportScores!.responses["200"]!.content?.["text/csv"]).toBeDefined();
    expect(exportScores!.responses["404"]).toBeDefined();
    expect(exportScores!.responses["401"]).toBeDefined();
    expect(exportScores!.responses["403"]).toBeDefined();
  });

  it("documents audit log endpoint with auth and pagination responses", async () => {
    const spec = await generateOpenAPISpec();

    const auditLogs = spec.paths["/api/admin/audit-logs"]?.get;
    expect(auditLogs).toBeDefined();
    expect(auditLogs!.responses["200"]).toBeDefined();
    expect(auditLogs!.responses["401"]).toBeDefined();
    expect(auditLogs!.responses["403"]).toBeDefined();
  });

  it("does not classify arbitrary preHandlers as auth", async () => {
    const spec = await generateSpecWithProbeRoutes((app) => {
      app.get("/probe-public", { preHandler: async () => {} }, async () => ({
        ok: true,
      }));
    });

    const probe = spec.paths["/probe-public"]?.get;
    expect(probe).toBeDefined();
    expect(probe!.responses["200"]).toBeDefined();
    expect(probe!.responses["401"]).toBeUndefined();
    expect(probe!.responses["403"]).toBeUndefined();
  });

  it("documents auth when the marked auth hook runs outside preHandler", async () => {
    const spec = await generateSpecWithProbeRoutes((app) => {
      const authenticate = async () => {};
      Object.assign(authenticate, { _isAuthenticate: true });
      app.get("/probe-on-request", { onRequest: authenticate }, async () => ({
        ok: true,
      }));
      app.get(
        "/probe-pre-validation",
        { preValidation: authenticate },
        async () => ({ ok: true }),
      );
    });

    expect(
      spec.paths["/probe-on-request"]?.get?.responses["401"],
    ).toBeDefined();
    expect(
      spec.paths["/probe-pre-validation"]?.get?.responses["401"],
    ).toBeDefined();
  });

  it("documents DELETE endpoints with 204 response", async () => {
    const spec = await generateOpenAPISpec();

    const deleteExam = spec.paths["/api/exams/{id}"]?.delete;
    expect(deleteExam).toBeDefined();
    expect(deleteExam!.responses["204"]).toBeDefined();

    const deleteQuestion = spec.paths["/api/questions/{id}"]?.delete;
    expect(deleteQuestion).toBeDefined();
    expect(deleteQuestion!.responses["204"]).toBeDefined();
  });

  it("includes ErrorResponse schema in components", async () => {
    const spec = await generateOpenAPISpec();

    expect(spec.components?.schemas?.ErrorResponse).toBeDefined();
    const errorResponse = spec.components!.schemas!.ErrorResponse as Record<
      string,
      unknown
    >;
    const props = errorResponse.properties as Record<string, unknown>;
    expect(props.error).toBeDefined();
    const errorProps = (props.error as Record<string, unknown>)
      .properties as Record<string, unknown>;
    expect(errorProps.code).toBeDefined();
    expect(errorProps.message).toBeDefined();
    expect(errorProps.requestId).toBeDefined();
  });
});
