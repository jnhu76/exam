/**
 * R1-B extractor conformance — runtime/authority facts.
 *
 * The authz tests run against the REAL @exam/authz closed sets (the owning
 * implementation); the route tests run against a synthetic capture artifact
 * shaped exactly like the committed one.
 */

import { describe, expect, it } from "vitest";
import {
  authzFragment,
  assertRoleNamespaceMatchesCatalog,
  permissionNodes,
  rolePresetNodes,
  scopeDimensionNodes,
} from "../src/extract/authz.js";
import {
  deriveO07Divergence,
  interfaceNodesFromRouteFacts,
  routeFragment,
  unclassifiedAdditionalGates,
  type RouteFacts,
} from "../src/extract/routes.js";
import { Permission, Role, Scope, ROLE_PRESETS } from "@exam/authz";
import { normalizeHttpPathTemplate } from "../src/ir/ids.js";

const SHA = "a".repeat(40);

describe("authz extraction", () => {
  it("extracts the complete permission catalog — mirrored verbatim, no invented keys", () => {
    const nodes = permissionNodes(SHA);
    const catalogValues = Object.values(Permission);
    expect(nodes).toHaveLength(catalogValues.length);
    expect(nodes.map((n) => n["id"])).toEqual(
      catalogValues.map((k) => `permission:${k}`).sort(),
    );
    for (const node of nodes) {
      expect(node["key"]).toBe(String(node["id"]).slice("permission:".length));
    }
  });

  it("extracts the closed role preset set with preset facts (ATLAS-IR-030)", () => {
    const nodes = rolePresetNodes(SHA);
    expect(nodes).toHaveLength(Object.values(Role).length);
    assertRoleNamespaceMatchesCatalog(nodes);
    const system = nodes.find((n) => n["id"] === "role:System");
    expect(system["preset_kind"]).toBe("SYNTHETIC_ACTOR");
    expect(system["login_allowed"]).toBe("FALSE");
    expect(system["assignable"]).toBe("FALSE");
    const maintainer = nodes.find((n) => n["id"] === "role:Maintainer");
    expect(maintainer["permissions"]).toEqual(
      ROLE_PRESETS.Maintainer.permissions.map((p) => `permission:${p}`).sort(),
    );
    // default_scope names a scope KIND only (ATLAS-IR-092) — never a resource.
    expect(maintainer["default_scope"]).toBe(
      `scope:${ROLE_PRESETS.Maintainer.defaultScope}`,
    );
  });

  it("extracts the closed scope dimensions with carrier NONE", () => {
    const nodes = scopeDimensionNodes(SHA);
    expect(nodes.map((n) => n["id"]).sort()).toEqual(
      Object.values(Scope)
        .map((v) => `scope:${v}`)
        .sort(),
    );
    for (const node of nodes) {
      expect(node["assignment_carrier"]).toBe("NONE");
    }
  });

  it("rejects a role: namespace that drifts from the catalog", () => {
    const drifted = rolePresetNodes(SHA).concat([
      { kind: "RolePreset", id: "role:HostOperator" },
    ]);
    expect(() => assertRoleNamespaceMatchesCatalog(drifted)).toThrow(
      /ATLAS-IR-030/,
    );
  });

  it("the authz fragment carries catalog facts bound to SOURCE_SHA", () => {
    const fragment = authzFragment(SHA);
    expect(fragment.facts.length).toBeGreaterThanOrEqual(2);
    for (const fact of fragment.facts) {
      expect(fact["snapshot"]).toBe(SHA);
    }
    // ATLAS-SREF-050: every extracted ref is bound to the source SHA.
    for (const node of fragment.nodes) {
      for (const ref of node["source_refs"] as Array<Record<string, unknown>>) {
        expect(ref["git_sha"]).toBe(SHA);
      }
    }
  });
});

function syntheticRouteFacts(): RouteFacts {
  return {
    extractor: { id: "@exam/api/atlas-route-facts", version: "0.1.0" },
    observed_head: SHA,
    routes: [
      {
        method: "POST",
        url: "/api/attempts/:attemptId/answers/:questionId",
        gate: {
          authentication_handler_count: 1,
          role_handler_count: 0,
          permission_list_handler_count: 0,
          capability_handler_count: 1,
        },
        gate_kind: "RESOURCE_AWARE_CAPABILITY",
        permission: "attempt.answer.save",
        resolver: "attempt",
        resource_id_key: "attemptId",
      },
      {
        method: "GET",
        url: "/api/exam-profiles",
        gate: {
          authentication_handler_count: 1,
          role_handler_count: 0,
          permission_list_handler_count: 0,
          capability_handler_count: 1,
        },
        gate_kind: "CAPABILITY",
        permission: "exam.view",
      },
      {
        method: "GET",
        url: "/api/auth/me",
        gate: {
          authentication_handler_count: 1,
          role_handler_count: 0,
          permission_list_handler_count: 0,
          capability_handler_count: 0,
        },
        gate_kind: "AUTH_ONLY",
      },
      {
        method: "GET",
        url: "/api/health",
        gate: {
          authentication_handler_count: 0,
          role_handler_count: 0,
          permission_list_handler_count: 0,
          capability_handler_count: 0,
        },
        gate_kind: "PUBLIC",
      },
    ],
    registry: [
      {
        method: "POST",
        path: "/attempts/:attemptId/answers/:questionId",
        permission: "attempt.answer.save",
        scope: "own_attempt",
        resolver: "organization",
        legacy_gate: "Candidate",
      },
      // Declared but not captured at runtime → RUNTIME_ONLY divergence.
      {
        method: "GET",
        path: "/exam-profiles/:id",
        permission: "exam.view",
        scope: "organization",
        resolver: "organization",
        legacy_gate: "Admin",
      },
    ],
    additional_gate_candidates: [
      {
        file: "apps/api/src/routes/system.ts",
        line: 392,
        permission_key: "SystemBusinessIntegrityView",
        enclosing_function: "integrity",
        inside_prehandler_registration: false,
      },
    ],
  };
}

describe("route extraction and O-07 re-derivation", () => {
  it("emits one HTTP Interface per captured route with a normalized wire ID", () => {
    const routeFacts = syntheticRouteFacts();
    const nodes = interfaceNodesFromRouteFacts(routeFacts, SHA);
    expect(nodes.map((n) => n["id"])).toEqual(
      [
        normalizeHttpPathTemplate("GET", "/api/auth/me"),
        normalizeHttpPathTemplate("GET", "/api/exam-profiles"),
        normalizeHttpPathTemplate("GET", "/api/health"),
        normalizeHttpPathTemplate(
          "POST",
          "/api/attempts/:attemptId/answers/:questionId",
        ),
      ].sort(),
    );
    const answerSave = nodes.find(
      (n) =>
        String(n["id"]) ===
        normalizeHttpPathTemplate(
          "POST",
          "/api/attempts/:attemptId/answers/:questionId",
        ),
    );
    expect(answerSave["runtime_observation"]["permission_ref"]).toBe(
      "permission:attempt.answer.save",
    );
    expect(answerSave["declared"]["permission_ref"]).toBe(
      "permission:attempt.answer.save",
    );
    expect(answerSave["declared"]["scope_value"]).toBe("own_attempt");
  });

  it("re-derives the declared/runtime divergence without inheriting #762 numbers", () => {
    const o07 = deriveO07Divergence(syntheticRouteFacts());
    expect(o07.runtime_routes_total).toBe(4);
    expect(o07.protected_routes_total).toBe(2);
    expect(o07.runtime_only_protected).toEqual([
      { method: "GET", url: "/api/exam-profiles", permission: "exam.view" },
    ]);
    expect(o07.declared_only_orphans).toEqual([
      { method: "GET", path: "/exam-profiles/:id" },
    ]);
    expect(o07.ambiguous_declared_joins).toEqual([]);
  });

  it("flags suffix-only declared joins as ambiguous instead of silently accepting them", () => {
    const routeFacts = syntheticRouteFacts();
    // No exact /api/exam-profiles route exists, but /api/admin/exam-profiles
    // does — the entry joins only by suffix, which must be flagged.
    routeFacts.routes = routeFacts.routes.map((r) =>
      r.url === "/api/exam-profiles"
        ? { ...r, url: "/api/admin/exam-profiles" }
        : r,
    );
    routeFacts.registry = [
      {
        method: "GET",
        path: "/exam-profiles",
        permission: "exam.view",
        scope: "organization",
        resolver: "organization",
      },
    ];
    const o07 = deriveO07Divergence(routeFacts);
    expect(o07.ambiguous_declared_joins).toEqual([
      {
        method: "GET",
        path: "/exam-profiles",
        candidates: ["/api/admin/exam-profiles"],
      },
    ]);
  });

  it("an unmapped in-handler gate candidate stays visible as unclassified (ATLAS-IR-091)", () => {
    const routeFacts = syntheticRouteFacts();
    expect(unclassifiedAdditionalGates(routeFacts, [])).toEqual([
      {
        file: "apps/api/src/routes/system.ts",
        line: 392,
        permission_key: "SystemBusinessIntegrityView",
        enclosing_function: "integrity",
      },
    ]);
    expect(
      unclassifiedAdditionalGates(routeFacts, [
        { file: "apps/api/src/routes/system.ts", line: 392 },
      ]),
    ).toEqual([]);
  });

  it("the route fragment carries capture facts bound to the source SHA", () => {
    const { nodes, facts } = routeFragment(syntheticRouteFacts(), SHA);
    expect(nodes).toHaveLength(4);
    expect(facts.map((f) => f["fact_id"])).toContain(
      "fact:routes.o07-divergence",
    );
    for (const fact of facts) {
      expect(fact["snapshot"]).toBe(SHA);
    }
  });
});
