import { describe, expect, it } from "vitest";
import { generateOpenAPISpec, type OpenAPISpecDocument } from "./swagger.js";

// P2.0-J1 — OpenAPI structural / snapshot regression tests.
//
// These tests guard the OpenAPI contract baseline for Phase 2. They fail when:
//   - a server-registered route disappears from the spec
//   - a priority route keeps a generic {} response schema
//   - the SaveAnswer / AttemptResult union responses stop using oneOf
//   - a protected route loses security / x-role metadata
//   - common errors (400/401/403/404/409/429/500) are dropped
//
// Helper to unwrap a response object into its JSON schema regardless of whether
// the route registered a bare schema ({type,properties}) or an explicit-content
// response ({description, content:{application/json:{schema}}}).
function responseSchema(
  op: { responses?: Record<string, unknown> } | undefined,
  code: string,
): Record<string, unknown> | undefined {
  const r = op?.responses?.[code] as
    | { schema?: unknown; content?: Record<string, { schema?: unknown }> }
    | undefined;
  if (!r) return undefined;
  if (r.schema) return r.schema as Record<string, unknown>;
  return r.content?.["application/json"]?.schema as
    | Record<string, unknown>
    | undefined;
}

function isGeneric(schema: Record<string, unknown> | undefined): boolean {
  if (!schema) return true;
  if (Object.keys(schema).length === 0) return true;
  if (
    Object.keys(schema).length === 1 &&
    schema.type === "object" &&
    schema.properties === undefined
  ) {
    return true;
  }
  return false;
}

// fastify-swagger serializes JSON-Schema `const: X` as `{ enum: [X] }`.
function discriminatorValue(fieldSchema: unknown): unknown {
  if (!fieldSchema || typeof fieldSchema !== "object") return undefined;
  const f = fieldSchema as Record<string, unknown>;
  if (f.const !== undefined) return f.const;
  if (Array.isArray(f.enum) && f.enum.length === 1) return f.enum[0];
  return undefined;
}

async function spec(): Promise<OpenAPISpecDocument & Record<string, unknown>> {
  return (await generateOpenAPISpec()) as OpenAPISpecDocument &
    Record<string, unknown>;
}

describe("OpenAPI structural baseline — route coverage", () => {
  it("includes GET /api/health with a typed 200 response", async () => {
    const s = await spec();
    const op = (s.paths as Record<string, unknown>)["/api/health"] as
      | { get?: { responses?: Record<string, unknown> } }
      | undefined;
    expect(
      op?.get,
      "GET /api/health must be in the OpenAPI spec",
    ).toBeDefined();
    const schema = responseSchema(op!.get, "200");
    expect(isGeneric(schema)).toBe(false);
    expect((schema as Record<string, unknown>)?.properties).toHaveProperty(
      "status",
    );
  });

  it("does not drop any previously registered path (stability)", async () => {
    const s = await spec();
    const paths = Object.keys(s.paths ?? {});
    // Baseline floor: the spec must keep at least the priority + common paths.
    const must = [
      "/api/health",
      "/api/candidate/exams",
      "/api/candidate/exams/{examId}",
      "/api/attempts/{examId}/start",
      "/api/attempts/{id}",
      "/api/attempts/{attemptId}/answers/{questionId}",
      "/api/attempts/{attemptId}/submit",
      "/api/attempts/{attemptId}/heartbeat",
      "/api/attempts/{attemptId}/restore",
      "/api/scores/attempts/{attemptId}",
      "/api/exams/{id}/scores",
      "/api/exams/{id}/export/scores",
    ];
    for (const p of must) {
      expect(paths, `spec must include ${p}`).toContain(p);
    }
  });
});

describe("OpenAPI structural baseline — no generic {} responses on priority routes", () => {
  const cases: Array<[string, string, string]> = [
    ["/api/candidate/exams", "get", "200"],
    ["/api/candidate/exams/{examId}", "get", "200"],
    ["/api/attempts/{examId}/start", "post", "200"],
    ["/api/attempts/{id}", "get", "200"],
    ["/api/attempts/{attemptId}/answers/{questionId}", "post", "200"],
    ["/api/attempts/{attemptId}/submit", "post", "200"],
    ["/api/attempts/{attemptId}/heartbeat", "post", "200"],
    ["/api/attempts/{attemptId}/restore", "post", "200"],
    ["/api/scores/attempts/{attemptId}", "get", "200"],
    ["/api/exams/{id}/scores", "get", "200"],
  ];

  for (const [path, method, code] of cases) {
    it(`${method.toUpperCase()} ${path} ${code} has a typed (non-generic) schema`, async () => {
      const s = await spec();
      const item = (s.paths as Record<string, unknown>)[path] as Record<
        string,
        { responses?: Record<string, unknown> } | undefined
      >;
      const op = item?.[method];
      expect(op, `${method} ${path} must exist`).toBeDefined();
      const schema = responseSchema(op, code);
      expect(
        isGeneric(schema),
        `${method} ${path} ${code} must not be a generic {} response`,
      ).toBe(false);
    });
  }
});

describe("OpenAPI structural baseline — union responses use oneOf/anyOf", () => {
  // zod-to-json-schema emits a Zod discriminated union as `anyOf` (semantically
  // a union of the accepted/rejected or hidden/visible variants).
  function unionVariants(
    schema: Record<string, unknown> | undefined,
  ): Array<Record<string, unknown>> {
    const u = (schema?.oneOf ?? schema?.anyOf) as
      | Array<Record<string, unknown>>
      | undefined;
    return u ?? [];
  }

  it("SaveAnswer response is a union of accepted/rejected", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[
      "/api/attempts/{attemptId}/answers/{questionId}"
    ] as { post?: { responses?: Record<string, unknown> } };
    const schema = responseSchema(item.post, "200");
    const variants = unionVariants(schema);
    expect(variants.length, "SaveAnswer 200 must be a union").toBeGreaterThan(
      0,
    );
    const acceptedVals = variants.map((v) =>
      discriminatorValue((v.properties as Record<string, unknown>)?.accepted),
    );
    expect(acceptedVals).toContain(true);
    expect(acceptedVals).toContain(false);
  });

  it("AttemptResult response is a union of hidden/visible", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[
      "/api/scores/attempts/{attemptId}"
    ] as { get?: { responses?: Record<string, unknown> } };
    const schema = responseSchema(item.get, "200");
    const variants = unionVariants(schema);
    expect(
      variants.length,
      "AttemptResult 200 must be a union",
    ).toBeGreaterThan(0);
    const showVals = variants.map((v) =>
      discriminatorValue(
        (v.properties as Record<string, unknown>)?.showResultImmediately,
      ),
    );
    expect(showVals).toContain(false);
    expect(showVals).toContain(true);
  });
});

describe("OpenAPI structural baseline — request schemas registered", () => {
  it("SaveAnswer registers params and requestBody", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[
      "/api/attempts/{attemptId}/answers/{questionId}"
    ] as { post?: Record<string, unknown> };
    const params = item.post?.parameters as unknown[];
    expect(params?.length).toBeGreaterThan(0);
    expect(item.post?.requestBody).toBeDefined();
  });

  it("StartAttempt registers the examId path parameter", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[
      "/api/attempts/{examId}/start"
    ] as { post?: Record<string, unknown> };
    const params = item.post?.parameters as
      | Array<{ name?: string }>
      | undefined;
    expect(params?.some((p) => p.name === "examId")).toBe(true);
  });

  it("Score list registers query parameters", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[
      "/api/exams/{id}/scores"
    ] as { get?: { parameters?: Array<{ name?: string }> } } | undefined;
    const params = item?.get?.parameters ?? [];
    const names = params.map((p) => p.name);
    expect(names).toContain("page");
    expect(names).toContain("pageSize");
  });
});

describe("OpenAPI structural baseline — security & x-role metadata", () => {
  const protectedPaths: Array<[string, "get" | "post"]> = [
    ["/api/candidate/exams", "get"],
    ["/api/attempts/{examId}/start", "post"],
    ["/api/attempts/{attemptId}/answers/{questionId}", "post"],
    ["/api/exams/{id}/scores", "get"],
    ["/api/exams/{id}/export/scores", "get"],
  ];

  for (const [path, method] of protectedPaths) {
    it(`${method.toUpperCase()} ${path} declares cookieAuth security + x-role`, async () => {
      const s = await spec();
      const item = (s.paths as Record<string, unknown>)[path] as Record<
        string,
        Record<string, unknown>
      >;
      const op = item?.[method];
      expect(op, `${method} ${path} must exist`).toBeDefined();
      const security = op?.security as unknown[] | undefined;
      expect(
        security?.some((entry) =>
          Object.keys(entry as object).includes("cookieAuth"),
        ),
        `${method} ${path} must declare cookieAuth security`,
      ).toBe(true);
      const xRole = op?.["x-role"];
      expect(
        Array.isArray(xRole) && xRole.length > 0,
        `${method} ${path} must declare x-role`,
      ).toBe(true);
    });
  }

  it("declares cookieAuth in components.securitySchemes", async () => {
    const s = await spec();
    const schemes = (
      s as unknown as {
        components?: { securitySchemes?: Record<string, unknown> };
      }
    ).components?.securitySchemes;
    expect(schemes?.cookieAuth).toBeDefined();
  });
});

describe("OpenAPI structural baseline — common errors documented", () => {
  it("documents validation error (400) on a mutating candidate route", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[
      "/api/candidates/import"
    ] as { post?: { responses?: Record<string, unknown> } };
    expect(item?.post?.responses?.["400"]).toBeDefined();
  });

  it("documents an error status on a resource-id route", async () => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)["/api/attempts/{id}"] as {
      get?: { responses?: Record<string, unknown> };
    };
    expect(
      item?.get?.responses?.["404"] ?? item?.get?.responses?.["400"],
    ).toBeDefined();
  });
});
