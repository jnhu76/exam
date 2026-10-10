/**
 * Runtime/declared route extraction (#764 R1-B) — consumes the committed
 * apps/api route-facts capture and emits Interface nodes plus the O-07
 * declared/runtime divergence, re-derived from the CURRENT capture rather
 * than inherited from #762.
 *
 * Preserved truths (ir §4.5, golden C): DECLARED_ROUTE_METADATA and
 * OBSERVED_RUNTIME_ROUTE are two facts about one seam; neither block is
 * promoted, the divergence is a renderable finding, and R1 does NOT fix the
 * registry.
 */

import { normalizeHttpPathTemplate } from "../ir/ids.js";
import type { SemanticInput } from "../snapshot/types.js";
import { EXTRACTOR_ID, EXTRACTOR_VERSION } from "../snapshot/types.js";
import { sourceRefRecord } from "./refs.js";

export interface RouteFacts {
  extractor: { id: string; version: string };
  observed_head: string;
  routes: Array<{
    method: string;
    url: string;
    gate: {
      authentication_handler_count: number;
      role_handler_count: number;
      permission_list_handler_count: number;
      capability_handler_count: number;
    };
    gate_kind: string;
    permission?: string;
    resolver?: string;
    resource_id_key?: string;
    score_capability?: boolean;
  }>;
  registry: Array<{
    method: string;
    path: string;
    permission: string;
    scope: string;
    resolver: string;
    legacy_gate?: string;
    runtime_authz_kind?: string;
    audit_action?: string;
    sensitive?: boolean;
    proctor_access?: string;
    migration_stage?: number;
  }>;
  additional_gate_candidates: Array<{
    file: string;
    line: number;
    permission_key: string;
    enclosing_function: string;
    inside_prehandler_registration: boolean;
  }>;
}

export interface O07Divergence {
  runtime_routes_total: number;
  protected_routes_total: number;
  auth_only_total: number;
  public_total: number;
  registry_entries: number;
  runtime_only_protected: Array<{
    method: string;
    url: string;
    permission?: string;
  }>;
  declared_only_orphans: Array<{ method: string; path: string }>;
  ambiguous_declared_joins: Array<{
    method: string;
    path: string;
    candidates: string[];
  }>;
}

export function deriveO07Divergence(routeFacts: RouteFacts): O07Divergence {
  const routes = routeFacts.routes;
  const registry = routeFacts.registry;
  const protectedRoutes = routes.filter(
    (r) =>
      r.gate_kind === "CAPABILITY" ||
      r.gate_kind === "RESOURCE_AWARE_CAPABILITY",
  );

  const runtimeOnly = protectedRoutes
    .filter(
      (r) =>
        !registry.some(
          (e) => e.method === r.method && `/api${e.path}` === r.url,
        ),
    )
    .map((r) => ({
      method: r.method,
      url: r.url,
      ...(r.permission !== undefined ? { permission: r.permission } : {}),
    }));

  const orphans: Array<{ method: string; path: string }> = [];
  const ambiguous: Array<{
    method: string;
    path: string;
    candidates: string[];
  }> = [];
  for (const entry of registry) {
    const exact = routes.filter(
      (r) => r.method === entry.method && r.url === `/api${entry.path}`,
    );
    if (exact.length === 1) continue;
    const suffix = routes.filter(
      (r) => r.method === entry.method && r.url.endsWith(entry.path),
    );
    if (exact.length === 0 && suffix.length === 1) {
      // Joined only by suffix — recorded, not silently accepted.
      ambiguous.push({
        method: entry.method,
        path: entry.path,
        candidates: suffix.map((r) => r.url),
      });
    } else {
      orphans.push({ method: entry.method, path: entry.path });
    }
  }

  return {
    runtime_routes_total: routes.length,
    protected_routes_total: protectedRoutes.length,
    auth_only_total: routes.filter((r) => r.gate_kind === "AUTH_ONLY").length,
    public_total: routes.filter((r) => r.gate_kind === "PUBLIC").length,
    registry_entries: registry.length,
    runtime_only_protected: runtimeOnly,
    declared_only_orphans: orphans,
    ambiguous_declared_joins: ambiguous,
  };
}

function registryEntryFor(
  routeFacts: RouteFacts,
  method: string,
  url: string,
): RouteFacts["registry"][number] | undefined {
  const exact = routeFacts.registry.filter(
    (e) => e.method === method && `/api${e.path}` === url,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

/**
 * Interface nodes — one per captured runtime route. The HTTP interface ID
 * normalizes method + wire path template (ATLAS-IR-024/-027); the runtime
 * block is the capture, the declared block (when an exact registry join
 * exists) stays distinct alongside it.
 */
export function interfaceNodesFromRouteFacts(
  routeFacts: RouteFacts,
  sourceSha: string,
): Array<Record<string, unknown>> {
  const captureRef = (symbol: string): ReturnType<typeof sourceRefRecord> =>
    sourceRefRecord(sourceSha, {
      path_or_uri: "packages/atlas/input/route-facts.json",
      symbol,
      extraction_method: "ROUTE_CAPTURE",
      source_kind: "RUNTIME_CAPTURE",
    });

  return routeFacts.routes
    .map((route) => {
      const id = normalizeHttpPathTemplate(route.method, route.url);
      const entry = registryEntryFor(routeFacts, route.method, route.url);
      const runtimeGateKind =
        route.gate_kind === "RESOURCE_AWARE_CAPABILITY"
          ? "RESOURCE_AWARE_CAPABILITY"
          : route.gate_kind === "CAPABILITY"
            ? route.score_capability === true
              ? "CAPABILITY"
              : "CAPABILITY"
            : route.gate_kind === "AUTH_ONLY"
              ? "AUTH_ONLY"
              : "PUBLIC";
      return {
        kind: "Interface",
        id,
        label: `${route.method} ${route.url}`,
        source_refs: [captureRef(`${route.method} ${route.url}`)],
        authority_refs: [],
        review_state: "CURATED",
        open_governance_item: { kind: "NONE" },
        seam_kind: "HTTP",
        contract_identity: `${route.method} ${route.url}`,
        ...(entry !== undefined
          ? {
              declared: {
                source_ref: `${sourceSha}:apps/api/src/authz/routeRegistry.ts#${entry.method} ${entry.path}`,
                permission_ref: `permission:${entry.permission}`,
                scope_value: entry.scope,
                resolver: entry.resolver,
                ...(entry.audit_action !== undefined
                  ? { audit_action: entry.audit_action }
                  : {}),
              },
            }
          : {}),
        runtime_observation: {
          capture_ref: `${routeFacts.observed_head}:${routeFacts.extractor.id}#${route.method} ${route.url}`,
          ...(route.permission !== undefined
            ? { permission_ref: `permission:${route.permission}` }
            : {}),
          gate_kind: runtimeGateKind,
          ...(route.resolver !== undefined ? { resolver: route.resolver } : {}),
        },
        additional_gates: [],
      };
    })
    .sort((a, b) => (String(a["id"]) < String(b["id"]) ? -1 : 1));
}

/**
 * ATLAS-IR-091 completeness gate: every detected in-handler branch must be
 * either mapped to an interface by the curation input or reported as an
 * unclassified finding — never silently omitted.
 */
export function unclassifiedAdditionalGates(
  routeFacts: RouteFacts,
  curatedMappings: Array<{ file: string; line: number }>,
): Array<{
  file: string;
  line: number;
  permission_key: string;
  enclosing_function: string;
}> {
  const mapped = new Set(curatedMappings.map((m) => `${m.file}:${m.line}`));
  return routeFacts.additional_gate_candidates
    .filter((c) => !c.inside_prehandler_registration)
    .filter((c) => !mapped.has(`${c.file}:${c.line}`))
    .map((c) => ({
      file: c.file,
      line: c.line,
      permission_key: c.permission_key,
      enclosing_function: c.enclosing_function,
    }));
}

/** The extracted route fragment. */
export function routeFragment(
  routeFacts: RouteFacts,
  sourceSha: string,
): {
  nodes: SemanticInput["nodes"];
  facts: SemanticInput["facts"];
  o07: O07Divergence;
} {
  const nodes = interfaceNodesFromRouteFacts(routeFacts, sourceSha);
  const o07 = deriveO07Divergence(routeFacts);
  const facts: SemanticInput["facts"] = [
    {
      fact_id: "fact:routes.whole-app-capture",
      statement: `The composed Fastify application registers ${o07.runtime_routes_total} primary routes (${o07.protected_routes_total} capability-protected, ${o07.auth_only_total} authenticate-only, ${o07.public_total} public) at the observed revision.`,
      source_ref: sourceRefRecord(sourceSha, {
        path_or_uri: "packages/atlas/input/route-facts.json",
        extraction_method: "ROUTE_CAPTURE",
        source_kind: "RUNTIME_CAPTURE",
      }),
      snapshot: sourceSha,
      observed_kind: "RUNTIME",
    },
    {
      fact_id: "fact:routes.registry-declared-size",
      statement: `The route permission registry declares ${o07.registry_entries} entries for routes gated by a capability gate (declared exhaustive intent, test-only metadata).`,
      source_ref: sourceRefRecord(sourceSha, {
        path_or_uri: "apps/api/src/authz/routeRegistry.ts",
        symbol: "ROUTE_PERMISSION_REGISTRY",
        extraction_method: "AST_SYMBOL_LOOKUP",
      }),
      snapshot: sourceSha,
      observed_kind: "DECLARED",
    },
    {
      fact_id: "fact:routes.o07-divergence",
      statement: `Declared/runtime divergence re-derived from the current capture: ${o07.runtime_only_protected.length} protected runtime routes absent from the registry; ${o07.declared_only_orphans.length} registry entries with no runtime route.`,
      source_ref: sourceRefRecord(sourceSha, {
        path_or_uri: "packages/atlas/input/route-facts.json",
        extraction_method: "ROUTE_CAPTURE",
        source_kind: "RUNTIME_CAPTURE",
      }),
      snapshot: sourceSha,
      observed_kind: "RUNTIME",
    },
  ];
  void EXTRACTOR_ID;
  void EXTRACTOR_VERSION;
  return { nodes, facts, o07 };
}
