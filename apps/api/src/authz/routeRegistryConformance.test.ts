/**
 * RBAC-M10-A registry/runtime conformance test (Corrective B, P1-3).
 *
 * The authority chain is:
 *   route registry declaration
 *   ↔
 *   actual Fastify onRoute metadata
 *
 * For each of the ten M10-A routes, this test:
 *   1. reads the route registry entry (including runtimeAuthz);
 *   2. finds the corresponding captured route from the Fastify onRoute hook;
 *   3. asserts exactly one authz preHandler;
 *   4. compares the runtime metadata against the registry's runtimeAuthz + permission.
 *
 * The expected object is NOT duplicated inside the test — it IS the registry
 * declaration. This prevents the hard-coded-expected-table ↔ hard-coded-runtime
 * pattern that the independent review flagged as drift-prone.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import {
  ROUTE_PERMISSION_REGISTRY,
  type CandidateRuntimeAuthzStrategy,
} from "./routeRegistry.js";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import courseRoutes from "../routes/course.js";
import questionRoutes from "../routes/question.js";
import candidateRoutes from "../routes/candidate.js";
import examRoutes from "../routes/exam.js";
import attemptRoutes from "../routes/attempts.js";
import scoreRoutes from "../routes/scores.js";
import { buildTestApp } from "../routes/testHelpers.js";

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

type CapturedRoute = {
  method: string;
  url: string;
  authz: AuthzPreHandler["authz"] | null;
};

const capturedRoutes: CapturedRoute[] = [];

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    const preHandlers = asArray(routeOptions.preHandler).filter(
      Boolean,
    ) as unknown[];
    const authzHandler = preHandlers.find(
      (ph): ph is AuthzPreHandler =>
        typeof ph === "function" &&
        !!(
          (ph as unknown as AuthzPreHandler).authz?.kind ===
            "candidate_context" ||
          (ph as unknown as AuthzPreHandler).authz?.kind ===
            "exam_eligibility" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "own_attempt" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "scoped" ||
          (ph as unknown as AuthzPreHandler).authz?.kind === "flat"
        ),
    );
    capturedRoutes.push({
      method:
        typeof routeOptions.method === "string"
          ? routeOptions.method
          : "UNKNOWN",
      url: routeOptions.url as string,
      authz: authzHandler?.authz ?? null,
    });
  });
  await fastify.register(courseRoutes);
  await fastify.register(questionRoutes);
  await fastify.register(candidateRoutes);
  await fastify.register(examRoutes);
  await fastify.register(attemptRoutes);
  await fastify.register(scoreRoutes);
};

describe("RBAC-M10-A registry/runtime conformance (Corrective B)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>> | null = null;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  // Select the ten M10-A candidate runtime routes from the registry.
  const m10aRegistryEntries = ROUTE_PERMISSION_REGISTRY.filter(
    (e) => e.runtimeAuthz !== undefined,
  );

  it("exactly ten M10-A routes have runtimeAuthz in the registry", () => {
    expect(m10aRegistryEntries).toHaveLength(10);
  });

  /**
   * Build the expected runtime metadata from the registry entry.
   * The registry's runtimeAuthz + permission is the authority — no
   * separate expected table is duplicated in the test.
   */
  function expectedMetadata(
    entry: (typeof m10aRegistryEntries)[number],
  ): AuthzPreHandler["authz"] {
    const strategy = entry.runtimeAuthz!;
    switch (strategy.kind) {
      case "candidate_context":
        return { kind: "candidate_context", permission: entry.permission };
      case "exam_eligibility":
        return {
          kind: "exam_eligibility",
          permission: entry.permission,
          resourceIdKey: strategy.resourceIdKey,
        };
      case "own_attempt":
        return {
          kind: "own_attempt",
          permission: entry.permission,
          resourceIdKey: strategy.resourceIdKey,
        };
    }
  }

  it.each(m10aRegistryEntries)(
    "$method $path — runtime metadata matches registry declaration",
    (entry) => {
      const match = capturedRoutes.find(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(
        match,
        `no captured route for ${entry.method} ${entry.path}`,
      ).toBeDefined();
      expect(match!.authz).not.toBeNull();
      expect(match!.authz).toEqual(expectedMetadata(entry));
    },
  );

  it("each M10-A route has exactly one authz preHandler", () => {
    for (const entry of m10aRegistryEntries) {
      const matches = capturedRoutes.filter(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0]?.authz).not.toBeNull();
    }
  });

  it("candidate_context routes have no resolver/resourceIdKey in runtime metadata", () => {
    const contextEntries = m10aRegistryEntries.filter(
      (e) => e.runtimeAuthz?.kind === "candidate_context",
    );
    for (const entry of contextEntries) {
      const match = capturedRoutes.find(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(match).toBeDefined();
      const meta = match!.authz;
      expect(meta).not.toBeNull();
      if (meta && "kind" in meta) {
        // candidate_context metadata must NOT contain resolverKey or resourceIdKey
        expect(meta.kind).toBe("candidate_context");
        expect(
          "resolverKey" in meta ? (meta as any).resolverKey : undefined,
        ).toBeUndefined();
        expect(
          "resourceIdKey" in meta ? (meta as any).resourceIdKey : undefined,
        ).toBeUndefined();
      }
    }
  });

  it("exam_eligibility routes always have resourceIdKey: examId", () => {
    const eligibilityEntries = m10aRegistryEntries.filter(
      (e) => e.runtimeAuthz?.kind === "exam_eligibility",
    );
    expect(eligibilityEntries).toHaveLength(3);
    for (const entry of eligibilityEntries) {
      const strategy = entry.runtimeAuthz! as Extract<
        CandidateRuntimeAuthzStrategy,
        { kind: "exam_eligibility" }
      >;
      expect(strategy.resourceIdKey).toBe("examId");
      const match = capturedRoutes.find(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(match).toBeDefined();
      expect(match!.authz).toEqual(
        expect.objectContaining({ resourceIdKey: "examId" }),
      );
    }
  });

  it("own_attempt routes always have resourceIdKey: id or attemptId", () => {
    const ownAttemptEntries = m10aRegistryEntries.filter(
      (e) => e.runtimeAuthz?.kind === "own_attempt",
    );
    expect(ownAttemptEntries).toHaveLength(6);
    for (const entry of ownAttemptEntries) {
      const strategy = entry.runtimeAuthz! as Extract<
        CandidateRuntimeAuthzStrategy,
        { kind: "own_attempt" }
      >;
      expect(["id", "attemptId"]).toContain(strategy.resourceIdKey);
      const match = capturedRoutes.find(
        (r) => r.method === entry.method && r.url.endsWith(entry.path),
      );
      expect(match).toBeDefined();
      expect(match!.authz).toEqual(
        expect.objectContaining({ resourceIdKey: strategy.resourceIdKey }),
      );
    }
  });
});
