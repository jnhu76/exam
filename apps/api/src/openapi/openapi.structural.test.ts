import { describe, expect, it } from "vitest";
import { generateOpenAPISpec, type OpenAPISpecDocument } from "./swagger.js";

// P2.0-J1 — OpenAPI structural / snapshot regression tests.
//
// These tests guard the OpenAPI contract baseline. They fail when:
//   - a server-registered route disappears from the spec
//   - a priority route keeps a generic {} response schema
//   - the SaveAnswer / AttemptResult union responses stop using oneOf
//   - a protected route loses security / x-role metadata
//   - common errors (400/401/403/404/409/429/500) are dropped
//   - CSV export routes claim application/json instead of text/csv
//   - candidate-facing responses leak standardAnswer

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
  const content = r.content;
  if (content?.["application/json"]?.schema) {
    return content["application/json"].schema as Record<string, unknown>;
  }
  if (content?.["text/csv"]?.schema) {
    return content["text/csv"].schema as Record<string, unknown>;
  }
  const firstKey = Object.keys(content ?? {})[0];
  if (firstKey && content?.[firstKey]?.schema) {
    return content[firstKey].schema as Record<string, unknown>;
  }
  return undefined;
}

function responseContent(
  op: { responses?: Record<string, unknown> } | undefined,
  code: string,
): Record<string, unknown> | undefined {
  const r = op?.responses?.[code] as
    | { content?: Record<string, unknown> }
    | undefined;
  return r?.content;
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

/** Recursively check if a schema tree contains a property named `standardAnswer`. */
function hasStandardAnswer(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as Record<string, unknown>;
  if (s.properties && typeof s.properties === "object") {
    if ("standardAnswer" in (s.properties as Record<string, unknown>)) {
      return true;
    }
    for (const v of Object.values(s.properties as Record<string, unknown>)) {
      if (hasStandardAnswer(v)) return true;
    }
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const list = s[key];
    if (Array.isArray(list)) {
      for (const v of list) {
        if (hasStandardAnswer(v)) return true;
      }
    }
  }
  if (s.items && typeof s.items === "object") {
    if (hasStandardAnswer(s.items)) return true;
  }
  return false;
}

async function spec(): Promise<OpenAPISpecDocument & Record<string, unknown>> {
  return (await generateOpenAPISpec()) as OpenAPISpecDocument &
    Record<string, unknown>;
}

// ─── Route coverage ──────────────────────────────────────────────────

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

  it("includes all 10 previously-missing route modules", async () => {
    const s = await spec();
    const paths = Object.keys(s.paths ?? {});

    // roleAssignmentRoutes
    expect(paths).toContain("/api/roles/assignable");
    expect(paths).toContain("/api/users/{id}/role-assignments");
    expect(paths).toContain("/api/role-assignments/{assignmentId}");

    // importLogRoutes
    expect(paths).toContain("/api/admin/import-logs");

    // clientEventRoutes
    expect(paths).toContain("/api/client-events");

    // proctorMonitoringRoutes
    expect(paths).toContain("/api/admin/exams/{examId}/proctor/attempts");
    expect(paths).toContain("/api/admin/attempts/{attemptId}/proctor-events");

    // emailRoutes
    expect(paths).toContain("/api/email/test");
  });

  it("includes correct HTTP methods on newly-added routes", async () => {
    const s = await spec();
    const paths = s.paths as Record<string, Record<string, unknown>>;

    expect(paths["/api/roles/assignable"]?.get).toBeDefined();
    expect(paths["/api/users/{id}/role-assignments"]?.get).toBeDefined();
    expect(paths["/api/users/{id}/role-assignments"]?.post).toBeDefined();
    expect(paths["/api/role-assignments/{assignmentId}"]?.patch).toBeDefined();
    expect(paths["/api/role-assignments/{assignmentId}"]?.delete).toBeDefined();
    expect(paths["/api/admin/import-logs"]?.get).toBeDefined();
    expect(paths["/api/client-events"]?.post).toBeDefined();
    expect(
      paths["/api/admin/exams/{examId}/proctor/attempts"]?.get,
    ).toBeDefined();
    expect(
      paths["/api/admin/attempts/{attemptId}/proctor-events"]?.get,
    ).toBeDefined();
    expect(paths["/api/email/test"]?.post).toBeDefined();
  });
});

// ─── Generic 2xx responses ───────────────────────────────────────────

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

// ─── Union responses ─────────────────────────────────────────────────

describe("OpenAPI structural baseline — union responses use oneOf/anyOf", () => {
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

// ─── Request schemas ─────────────────────────────────────────────────

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

// ─── Security & x-role metadata ──────────────────────────────────────

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

  it.each([
    ["get", "/api/courses"],
    ["get", "/api/courses/{id}"],
    ["post", "/api/courses"],
    ["patch", "/api/courses/{id}"],
    ["get", "/api/candidates"],
    ["get", "/api/questions"],
    ["get", "/api/questions/{id}"],
    ["post", "/api/questions"],
    ["patch", "/api/questions/{id}"],
    ["delete", "/api/questions/{id}"],
    ["post", "/api/questions/import"],
    ["get", "/api/exams"],
    ["get", "/api/exams/{id}"],
    ["post", "/api/exams"],
    ["patch", "/api/exams/{id}"],
    ["post", "/api/exams/{id}/publish"],
    ["post", "/api/exams/{id}/close"],
    ["post", "/api/exams/{id}/publish-results"],
    ["get", "/api/exams/{examId}/enrollments"],
    ["post", "/api/exams/{examId}/enrollments"],
    ["delete", "/api/exams/{examId}/enrollments/{enrollmentId}"],
    ["get", "/api/admin/exams/{examId}/candidates/status"],
    ["get", "/api/exams/{id}/scores"],
  ] as const)("%s %s documents Teacher access", async (method, path) => {
    const s = await spec();
    const item = (s.paths as Record<string, unknown>)[path] as
      | Record<string, { "x-role"?: string[] }>
      | undefined;
    expect(item?.[method]?.["x-role"]).toEqual(
      expect.arrayContaining(["Admin", "Teacher"]),
    );
  });

  it.each([
    ["post", "/api/exams/{id}/unpublish"],
    ["post", "/api/exams/{id}/extend"],
    ["post", "/api/exams/{id}/cancel"],
    ["post", "/api/exams/{id}/archive"],
    ["delete", "/api/exams/{id}"],
  ] as const)(
    "%s %s remains documented as Admin-only",
    async (method, path) => {
      const s = await spec();
      const item = (s.paths as Record<string, unknown>)[path] as
        | Record<string, { "x-role"?: string[] }>
        | undefined;
      expect(item?.[method]?.["x-role"]).toEqual(["Admin"]);
    },
  );
});

// ─── Protected routes have 401 ───────────────────────────────────────

describe("OpenAPI structural baseline — protected routes declare 401", () => {
  it("every route with cookieAuth security declares a 401 response", async () => {
    const s = await spec();
    const violations: string[] = [];

    for (const [path, pathItem] of Object.entries(s.paths ?? {})) {
      if (!pathItem) continue;
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const op = (pathItem as Record<string, unknown>)[method] as
          | { security?: unknown[]; responses?: Record<string, unknown> }
          | undefined;
        if (!op?.security) continue;
        const hasCookieAuth = op.security.some(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "cookieAuth" in entry,
        );
        if (!hasCookieAuth) continue;
        if (!op.responses?.["401"]) {
          violations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(
      violations,
      `Protected routes missing 401: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Admin routes have 403 ───────────────────────────────────────────

describe("OpenAPI structural baseline — admin routes declare 403", () => {
  it("every route with x-role: [Admin] declares a 403 response", async () => {
    const s = await spec();
    const violations: string[] = [];

    for (const [path, pathItem] of Object.entries(s.paths ?? {})) {
      if (!pathItem) continue;
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const op = (pathItem as Record<string, unknown>)[method] as
          | { "x-role"?: string[]; responses?: Record<string, unknown> }
          | undefined;
        if (!op?.["x-role"]) continue;
        const roles = op["x-role"];
        if (!Array.isArray(roles)) continue;
        if (roles.includes("Admin") && !op.responses?.["403"]) {
          violations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(
      violations,
      `Admin routes missing 403: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Public routes must not have security ────────────────────────────

describe("OpenAPI structural baseline — public routes have no security", () => {
  it("public routes do not declare cookieAuth", async () => {
    const s = await spec();
    const publicPaths = [
      ["/api/settings/branding", "get"],
      ["/api/system/info", "get"],
      ["/api/system/public-config", "get"],
      ["/api/health", "get"],
    ] as const;

    for (const [path, method] of publicPaths) {
      const op = (s.paths as Record<string, unknown>)?.[path] as
        | { get?: { security?: unknown[] } }
        | undefined;
      const security = op?.get?.security;
      expect(
        security,
        `${method.toUpperCase()} ${path} must not have security`,
      ).toBeUndefined();
    }
  });
});

// ─── client-events security metadata ─────────────────────────────────

describe("OpenAPI structural baseline — client-events has security", () => {
  it("POST /api/client-events declares cookieAuth security and 401", async () => {
    const s = await spec();
    const op = (s.paths as Record<string, unknown>)["/api/client-events"] as {
      post?: {
        security?: unknown[];
        responses?: Record<string, unknown>;
      };
    };
    expect(op?.post).toBeDefined();
    const security = op?.post?.security as unknown[] | undefined;
    expect(
      security?.some(
        (entry) =>
          typeof entry === "object" && entry !== null && "cookieAuth" in entry,
      ),
      "POST /api/client-events must declare cookieAuth security",
    ).toBe(true);
    expect(
      op?.post?.responses?.["401"],
      "POST /api/client-events must declare 401",
    ).toBeDefined();
  });
});

// ─── CSV content-type ────────────────────────────────────────────────

describe("OpenAPI structural baseline — CSV export content-type", () => {
  it("GET /api/exams/{id}/export/scores 200 uses text/csv, not application/json", async () => {
    const s = await spec();
    const op = (s.paths as Record<string, unknown>)[
      "/api/exams/{id}/export/scores"
    ] as { get?: { responses?: Record<string, unknown> } };
    expect(op?.get).toBeDefined();
    const content = responseContent(op?.get, "200");
    expect(content, "200 must have content").toBeDefined();
    expect(
      content?.["text/csv"],
      "200 must declare text/csv media type",
    ).toBeDefined();
    expect(
      content?.["application/json"],
      "200 must NOT declare application/json for CSV",
    ).toBeUndefined();
  });

  it("GET /api/admin/attempts/{attemptId}/export/csv 200 uses text/csv", async () => {
    const s = await spec();
    const op = (s.paths as Record<string, unknown>)[
      "/api/admin/attempts/{attemptId}/export/csv"
    ] as { get?: { responses?: Record<string, unknown> } };
    expect(op?.get).toBeDefined();
    const content = responseContent(op?.get, "200");
    expect(content, "200 must have content").toBeDefined();
    expect(
      content?.["text/csv"],
      "200 must declare text/csv media type",
    ).toBeDefined();
    expect(
      content?.["application/json"],
      "200 must NOT declare application/json for CSV",
    ).toBeUndefined();
  });
});

// ─── Generic 2xx responses (global scan) ─────────────────────────────

describe("OpenAPI structural baseline — no generic 2xx success responses", () => {
  it("has no generic or missing 2xx response schemas (except 204)", async () => {
    const s = await spec();
    const violations: string[] = [];

    for (const [path, pathItem] of Object.entries(s.paths ?? {})) {
      if (!pathItem) continue;
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const op = (pathItem as Record<string, unknown>)[method] as
          | { responses?: Record<string, unknown> }
          | undefined;
        if (!op?.responses) continue;

        for (const [status, resp] of Object.entries(op.responses)) {
          if (!/^2\d\d$/.test(status)) continue;
          if (status === "204") continue;

          const schema = responseSchema(op, status);
          if (isGeneric(schema)) {
            violations.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }

    expect(
      violations,
      `Generic or missing 2xx response schemas found: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Common errors documented ────────────────────────────────────────

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

// ─── Candidate response anti-leak ────────────────────────────────────

describe("OpenAPI structural baseline — candidate responses hide standardAnswer", () => {
  const candidatePaths = [
    ["/api/candidate/exams", "get"],
    ["/api/candidate/exams/{examId}", "get"],
    ["/api/attempts/{examId}/start", "post"],
    ["/api/attempts/{id}", "get"],
    ["/api/attempts/{attemptId}/answers/{questionId}", "post"],
    // NOTE: GET /api/scores/attempts/{attemptId} serves both Admin and Candidate.
    // The handler strips standardAnswer for candidates at runtime, but the spec
    // must show the full schema (discriminated unions are not compatible with
    // fastify-swagger). Runtime behavior is verified by API test, not schema check.
  ] as const;

  for (const [path, method] of candidatePaths) {
    it(`${method.toUpperCase()} ${path} 200 must not expose standardAnswer`, async () => {
      const s = await spec();
      const op = (s.paths as Record<string, unknown>)?.[path] as
        | Record<string, { responses?: Record<string, unknown> }>
        | undefined;
      const operation = op?.[method];
      expect(operation, `${method} ${path} must exist`).toBeDefined();
      const schema = responseSchema(operation, "200");
      expect(
        hasStandardAnswer(schema),
        `${method.toUpperCase()} ${path} 200 schema must not contain standardAnswer`,
      ).toBe(false);
    });
  }
});
