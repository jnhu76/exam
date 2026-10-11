/**
 * Coverage accounting (#764 §21) — the machine-readable, human-reviewable
 * inventory report derived from a built snapshot plus the inventory
 * curation. Counts are derived, never hand-set; UNKNOWN/UNMAPPED/CONFLICT
 * are explicit outputs and are never optimized toward zero.
 */

import type { SnapshotEnvelope } from "./types.js";
import type { CurationBundle } from "../curation/assemble.js";

export interface CoverageReport {
  seed_families_total: number;
  seed_families_reconciled: number;
  seed_same: number;
  seed_renamed: number;
  seed_split: number;
  seed_merged: number;
  seed_not_applicable: number;
  unaccounted_seed_families: string[];

  capabilities_total: number;
  capabilities_mapped: number;
  capabilities_partial: number;
  capabilities_unmapped: number;
  capabilities_unknown: number;

  workflows_total: number;
  operations_total: number;
  interfaces_total: number;
  permissions_total: number;
  role_presets_total: number;
  scopes_total: number;

  claims_total: number;
  support_verdicts: Record<string, number>;

  conflict_records: number;
  unresolved_conflicts: number;

  stale_source_refs: number;
  missing_source_refs: number;
  ambiguous_source_refs: number;

  facets_total: number;
  facets_mapped: number;
  facets_partial: number;
  facets_unmapped: number;
  facets_unknown: number;
  interface_family_orphans: number;
  interface_family_orphan_ids: string[];

  /** Capabilities the coverage seed names in no family row (discovered
   * beyond the seed — explained by the inventory's beyond_seed_capabilities). */
  capabilities_not_named_by_family: number;
  capabilities_not_named_by_family_ids: string[];

  /** Claims that declare a boundary and cite evidence, where NO cited record's
   * boundary_coverage includes that boundary (ATLAS-SEM-083 membership). A
   * claim citing nothing at all is reported by the incomplete-claim finding
   * instead, never here. */
  claims_boundary_not_covered: number;
  claims_boundary_not_covered_ids: string[];

  runtime_routes_total: number;
  protected_routes_total: number;
  registry_entries: number;
  runtime_only_protected: number;
  declared_only_orphans: number;
}

function countBy(nodes: Array<Record<string, unknown>>, kind: string): number {
  return nodes.filter((n) => n["kind"] === kind).length;
}

export function coverageReport(
  envelope: SnapshotEnvelope,
  curation: CurationBundle,
  o07: {
    runtime_routes_total: number;
    protected_routes_total: number;
    registry_entries: number;
    runtime_only_protected: unknown[];
    declared_only_orphans: unknown[];
  },
): CoverageReport {
  const body = envelope.body;
  const nodes = body.nodes;

  const inventory = curation.files.get("capability-inventory.json");
  const families =
    (inventory?.["families"] as Array<Record<string, unknown>> | undefined) ??
    [];
  const capabilityIds = new Set(
    nodes.filter((n) => n["kind"] === "Capability").map((n) => String(n["id"])),
  );
  const unaccounted = families
    .map((f) => String(f["capability_ref"]))
    .filter((ref) => !capabilityIds.has(ref));
  const reconciliation = (value: string): number =>
    families.filter((f) => f["reconciliation"] === value).length;

  const VERDICT_VALUES = new Set([
    "SUPPORTED",
    "GATED",
    "DEFERRED",
    "NOT_SUPPORTED",
    "UNKNOWN",
    "MIXED",
    "REJECTED",
  ]);
  const supportVerdicts: Record<string, number> = {};
  for (const claim of body.claims) {
    const axes = claim["axes"] as Record<string, unknown> | undefined;
    let verdict = axes?.["activation_support"] as string | undefined;
    if (verdict === undefined && claim["claim_kind"] === "CAPABILITY_SUPPORT") {
      const value = String(claim["value"]);
      if (VERDICT_VALUES.has(value)) {
        verdict = value;
      }
    }
    if (verdict !== undefined) {
      supportVerdicts[verdict] = (supportVerdicts[verdict] ?? 0) + 1;
    }
  }

  const refStates = { stale: 0, missing: 0, ambiguous: 0 };
  for (const node of nodes) {
    for (const ref of (node["source_refs"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      const state = ref["resolution_state"];
      if (state === "STALE") refStates.stale += 1;
      if (state === "MISSING") refStates.missing += 1;
      if (state === "AMBIGUOUS") refStates.ambiguous += 1;
    }
  }
  for (const evidence of body.evidence) {
    const ref = evidence["source_ref"] as Record<string, unknown> | undefined;
    const state = ref?.["resolution_state"];
    if (state === "STALE") refStates.stale += 1;
    if (state === "MISSING") refStates.missing += 1;
    if (state === "AMBIGUOUS") refStates.ambiguous += 1;
  }

  const mappingState = (kind: "Capability" | "Facet", value: string): number =>
    nodes.filter((n) => n["kind"] === kind && n["mapping_state"] === value)
      .length;

  // Orphan interfaces: captured routes no capability/facet reaches through
  // the graph (contains → performs → exposes). Route count and family
  // reconciliation can both look green while double-digit routes are
  // claimed by no family — this metric makes that visible.
  // frozen exposes direction is interface --exposes--> operation, so
  // interfaces are reached by walking contains/performs forward and then
  // reversing exposes.
  const reachableOperations = new Set<string>();
  const children = new Map<string, string[]>();
  for (const edge of envelope.body.edges) {
    const kind = String(edge["kind"]);
    if (kind === "contains" || kind === "performs") {
      const list = children.get(String(edge["source"])) ?? [];
      list.push(String(edge["target"]));
      children.set(String(edge["source"]), list);
    }
  }
  const roots = nodes
    .filter((n) => n["kind"] === "Capability" || n["kind"] === "Facet")
    .map((n) => String(n["id"]));
  const walk = (id: string): void => {
    if (reachableOperations.has(id)) return;
    const node = nodes.find((n) => String(n["id"]) === id);
    if (node?.["kind"] === "Operation") reachableOperations.add(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  const reachableInterfaces = new Set(
    envelope.body.edges
      .filter(
        (e) =>
          String(e["kind"]) === "exposes" &&
          reachableOperations.has(String(e["target"])),
      )
      .map((e) => String(e["source"])),
  );
  const orphanInterfaces = nodes
    .filter(
      (n) =>
        n["kind"] === "Interface" && !reachableInterfaces.has(String(n["id"])),
    )
    .map((n) => String(n["id"]));

  // Capabilities no family row names: the coverage seed may have missed a
  // capability the graph carries. Reported, never silently folded into a
  // neighbouring family.
  const namedCapabilities = new Set(
    families.map((f) => String(f["capability_ref"])),
  );
  const unnamedCapabilities = [...capabilityIds]
    .filter((id) => !namedCapabilities.has(id))
    .sort();

  // Boundary membership (ATLAS-SEM-083): a claim that cites evidence none of
  // which covers its declared boundary is asserting more than it can show.
  const coverageByEvidence = new Map<string, Set<string>>();
  for (const evidence of body.evidence) {
    const coverage = Array.isArray(evidence["boundary_coverage"])
      ? (evidence["boundary_coverage"] as string[])
      : [];
    coverageByEvidence.set(String(evidence["evidence_id"]), new Set(coverage));
  }
  const uncoveredBoundaryClaims = body.claims
    .filter((claim) => {
      const boundary = claim["boundary"];
      if (typeof boundary !== "string") return false;
      const cited = [
        ...(Array.isArray(claim["supporting_evidence"])
          ? (claim["supporting_evidence"] as string[])
          : []),
        ...(Array.isArray(claim["challenging_evidence"])
          ? (claim["challenging_evidence"] as string[])
          : []),
      ];
      if (cited.length === 0) return false;
      return !cited.some((id) => coverageByEvidence.get(id)?.has(boundary));
    })
    .map((claim) => String(claim["claim_id"]))
    .sort();

  return {
    seed_families_total: families.length,
    seed_families_reconciled: families.length - unaccounted.length,
    seed_same: reconciliation("SAME"),
    seed_renamed: reconciliation("RENAMED"),
    seed_split: reconciliation("SPLIT"),
    seed_merged: reconciliation("MERGED"),
    seed_not_applicable: reconciliation("NOT_APPLICABLE"),
    unaccounted_seed_families: unaccounted,

    capabilities_total: countBy(nodes, "Capability"),
    capabilities_mapped: mappingState("Capability", "MAPPED"),
    capabilities_partial: mappingState("Capability", "PARTIAL"),
    capabilities_unmapped: mappingState("Capability", "UNMAPPED"),
    capabilities_unknown: mappingState("Capability", "UNKNOWN"),
    facets_total: countBy(nodes, "Facet"),
    facets_mapped: mappingState("Facet", "MAPPED"),
    facets_partial: mappingState("Facet", "PARTIAL"),
    facets_unmapped: mappingState("Facet", "UNMAPPED"),
    facets_unknown: mappingState("Facet", "UNKNOWN"),
    interface_family_orphans: orphanInterfaces.length,
    interface_family_orphan_ids: orphanInterfaces.slice(0, 30),
    capabilities_not_named_by_family: unnamedCapabilities.length,
    capabilities_not_named_by_family_ids: unnamedCapabilities,
    claims_boundary_not_covered: uncoveredBoundaryClaims.length,
    claims_boundary_not_covered_ids: uncoveredBoundaryClaims,

    workflows_total: countBy(nodes, "Workflow"),
    operations_total: countBy(nodes, "Operation"),
    interfaces_total: countBy(nodes, "Interface"),
    permissions_total: countBy(nodes, "Permission"),
    role_presets_total: countBy(nodes, "RolePreset"),
    scopes_total: countBy(nodes, "Scope"),

    claims_total: body.claims.length,
    support_verdicts: supportVerdicts,

    conflict_records: body.conflicts.length,
    unresolved_conflicts: body.conflicts.filter(
      (c) => c["resolution_status"] === "UNRESOLVED",
    ).length,

    stale_source_refs: refStates.stale,
    missing_source_refs: refStates.missing,
    ambiguous_source_refs: refStates.ambiguous,

    runtime_routes_total: o07.runtime_routes_total,
    protected_routes_total: o07.protected_routes_total,
    registry_entries: o07.registry_entries,
    runtime_only_protected: o07.runtime_only_protected.length,
    declared_only_orphans: o07.declared_only_orphans.length,
  };
}
