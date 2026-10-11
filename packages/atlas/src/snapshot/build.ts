/**
 * The snapshot builder — turns a raw semantic input into the canonical
 * snapshot envelope.
 *
 * Pipeline (all deterministic; no wall clock, no filesystem enumeration
 * order, no network):
 *
 *   1. normalize: validate, apply defaults, canonicalize set-valued fields,
 *      merge duplicates, sort — ir §7. Derivations run on MERGED records so
 *      a collapsed duplicate edge can never inflate a derived count
 *      (ATLAS-IR-066);
 *   2. resolve every source ref against the bound revision (and live, when
 *      provided) — ATLAS-SREF resolution states + repo freshness;
 *   3. compute DERIVED fields from the resolved graph (ATLAS-IR-003: derived
 *      fields are never hand-set — input values are overwritten), sorting
 *      each derived set field where it is written;
 *   4. re-validate the merged records, hash the canonical body, seal the
 *      manifest.
 */

import {
  canonicalHash,
  canonicalJson,
  canonicalBytes,
} from "../canon/serialize.js";
import {
  normalizeRecords,
  SemanticConflictError,
} from "../canon/canonicalize.js";
import { rollupSupport, type RollupPart } from "../ir/rollup.js";
import {
  buildRecordSchemas,
  validateRecordSemantics,
  validateSnapshotGraph,
} from "../ir/validate.js";
import { EDGE_KINDS, NODE_KINDS } from "../ir/types.js";
import { deriveClaimResolution } from "../sref/claimResolution.js";
import {
  repoFreshnessFor,
  resolveRef,
  type RevisionView,
} from "../sref/resolve.js";
import {
  usableAsBoundRevisionEvidence,
  validateSourceRef,
  type SourceRef,
} from "../sref/types.js";
import {
  EXTRACTOR_ID,
  EXTRACTOR_VERSION,
  IR_SCHEMA_VERSION,
  SOURCE_REF_VERSION,
  type BuildOutput,
  type SemanticInput,
  type SnapshotBody,
} from "./types.js";

export interface BuildContext {
  /** Revision views. `bound` observes SOURCE_SHA; `live` observes the live
   * master when it has advanced (enables STALE detection). */
  bound: RevisionView;
  live?: RevisionView;
}

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

/** Deep-clone helper (records come straight from parsed JSON). */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function getString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function getRecord(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = record[field];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Resolve all refs, writing resolution_state + repo_freshness in place. */
function resolveAllRefs(input: SemanticInput, context: BuildContext): void {
  const resolveContext =
    context.live !== undefined
      ? { bound: context.bound, live: context.live }
      : { bound: context.bound };
  const resolveInPlace = (ref: SourceRef): void => {
    const outcome = resolveRef(ref, resolveContext);
    ref.resolution_state = outcome.resolution_state;
    if (outcome.resolution_detail !== undefined) {
      ref.resolution_detail = outcome.resolution_detail;
    }
    if (ref.source_kind !== "GITHUB_ISSUE" && ref.source_kind !== "GITHUB_PR") {
      ref.repo_freshness = repoFreshnessFor(ref, input.source_sha);
    }
  };

  for (const node of input.nodes) {
    const refs = node["source_refs"];
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        resolveInPlace(ref as SourceRef);
      }
    }
  }

  for (const fact of input.facts) {
    const ref = getRecord(fact, "source_ref");
    if (ref !== undefined) {
      resolveInPlace(ref as unknown as SourceRef);
    }
  }

  for (const evidence of input.evidence) {
    const ref = getRecord(evidence, "source_ref");
    if (ref !== undefined) {
      resolveInPlace(ref as unknown as SourceRef);
    }
  }
}

/** Compute every DERIVED field on nodes and claims from the resolved graph. */
function computeDerivedFields(input: SemanticInput): void {
  const nodeById = new Map<string, Record<string, unknown>>();
  for (const node of input.nodes) {
    const id = getString(node, "id");
    if (id !== undefined) {
      nodeById.set(id, node);
    }
  }

  const evidenceById = new Map<string, Record<string, unknown>>();
  for (const evidence of input.evidence) {
    const id = getString(evidence, "evidence_id");
    if (id !== undefined) {
      evidenceById.set(id, evidence);
    }
  }

  const claimsOf = new Map<string, Array<Record<string, unknown>>>();
  for (const claim of input.claims) {
    const subject = getString(claim, "subject");
    if (subject !== undefined) {
      const list = claimsOf.get(subject) ?? [];
      list.push(claim);
      claimsOf.set(subject, list);
    }
  }

  const evidenceAdequateFor = (
    claim: Record<string, unknown>,
    boundary: string,
  ): boolean => {
    const supporting = Array.isArray(claim["supporting_evidence"])
      ? (claim["supporting_evidence"] as string[])
      : [];
    return supporting.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      if (evidence === undefined) return false;
      const coverage = Array.isArray(evidence["boundary_coverage"])
        ? (evidence["boundary_coverage"] as string[])
        : [];
      if (!coverage.includes(boundary)) return false;
      // The ref must still be usable as evidence about the bound revision.
      // Only human review is exempt from carrying a ref (ATLAS-SREF-003).
      const ref = getRecord(evidence, "source_ref");
      if (ref === undefined) {
        return evidence["evidence_kind"] === "HUMAN_REVIEW";
      }
      return usableAsBoundRevisionEvidence(ref as unknown as SourceRef);
    });
  };

  // ATLAS-SEM-084 negative evidence: a recorded non-support statement at the
  // boundary, carried by ONE evidence record that has BOTH the boundary
  // coverage and the negative basis — splitting basis and coverage across
  // two records would launder the boundary. A captured external work-item
  // record counts (the frozen slices cite closed issues as the authority
  // for non-adoption decisions) but the ref must actually RESOLVE.
  const negativeEvidenceCovers = (
    claim: Record<string, unknown>,
    boundary: string,
  ): boolean => {
    const supporting = Array.isArray(claim["supporting_evidence"])
      ? (claim["supporting_evidence"] as string[])
      : [];
    return supporting.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      if (evidence === undefined) return false;
      const coverage = Array.isArray(evidence["boundary_coverage"])
        ? (evidence["boundary_coverage"] as string[])
        : [];
      if (!coverage.includes(boundary)) return false;
      if (typeof evidence["negative_evidence_basis"] !== "string") return false;
      const ref = getRecord(evidence, "source_ref");
      if (ref === undefined) return false;
      return ref["resolution_state"] === "RESOLVED";
    });
  };

  // ——— claims: freshness / resolution / eligibility (ATLAS-SREF-034) ———
  for (const claim of input.claims) {
    const citedIds = [
      ...(Array.isArray(claim["supporting_evidence"])
        ? (claim["supporting_evidence"] as string[])
        : []),
      ...(Array.isArray(claim["challenging_evidence"])
        ? (claim["challenging_evidence"] as string[])
        : []),
    ];
    const citedRefs: SourceRef[] = [];
    for (const evidenceId of citedIds) {
      const evidence = evidenceById.get(evidenceId);
      const ref =
        evidence === undefined ? undefined : getRecord(evidence, "source_ref");
      if (ref !== undefined) {
        citedRefs.push(ref as unknown as SourceRef);
      }
    }
    const derivation = deriveClaimResolution(citedRefs);
    claim["freshness"] = derivation.freshness;
    claim["resolution"] = derivation.resolution;
    claim["resolution_causes"] = derivation.resolution_causes;
    claim["current_support_usable"] = derivation.current_support_usable;
  }

  // ——— nodes: freshness / resolution / claim_refs ———
  for (const node of input.nodes) {
    const nodeRefs = (
      Array.isArray(node["source_refs"]) ? node["source_refs"] : []
    ) as SourceRef[];
    const derivation = deriveClaimResolution(nodeRefs);
    node["freshness"] = derivation.freshness;
    node["resolution"] = derivation.resolution;
    node["resolution_causes"] = derivation.resolution_causes;
    const subject = getString(node, "id");
    node["claim_refs"] = (claimsOf.get(subject ?? "") ?? [])
      .map((c) => getString(c, "claim_id") ?? "")
      .sort();
  }

  // ——— Workflow.step_count from performs edges (DERIVED) ———
  const performsBySource = new Map<string, Array<Record<string, unknown>>>();
  for (const edge of input.edges) {
    if (edge["kind"] === "performs") {
      const source = getString(edge, "source");
      if (source !== undefined) {
        const list = performsBySource.get(source) ?? [];
        list.push(edge);
        performsBySource.set(source, list);
      }
    }
  }
  for (const node of input.nodes) {
    if (getString(node, "kind") === "Workflow") {
      node["step_count"] = (
        performsBySource.get(getString(node, "id") ?? "") ?? []
      ).length;
    }
  }

  // ——— Permission.preset_refs / consumed_by / inert (DERIVED, ATLAS-IR-038) ———
  const consumingPermissions = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge["kind"] === "requires_permission") {
      const target = getString(edge, "target");
      const source = getString(edge, "source");
      if (target !== undefined && source !== undefined) {
        const list = consumingPermissions.get(target) ?? [];
        list.push(source);
        consumingPermissions.set(target, list);
      }
    }
  }
  for (const node of input.nodes) {
    if (getString(node, "kind") === "Interface") {
      for (const blockField of ["declared", "runtime_observation"]) {
        const block = getRecord(node, blockField);
        const permission =
          block === undefined ? undefined : getString(block, "permission_ref");
        if (permission !== undefined) {
          const interfaceId = getString(node, "id") ?? "";
          const list = consumingPermissions.get(permission) ?? [];
          list.push(interfaceId);
          consumingPermissions.set(permission, list);
        }
      }
      // In-handler additional gates (ATLAS-IR-091) consume their capability
      // just like pre-handler gates — omitting them mislabels real
      // consumption as GRANTED_BUT_UNCONSUMED.
      const gates = Array.isArray(node["additional_gates"])
        ? (node["additional_gates"] as Array<Record<string, unknown>>)
        : [];
      for (const gate of gates) {
        const capability = getString(gate, "capability_ref");
        if (capability !== undefined) {
          const list = consumingPermissions.get(capability) ?? [];
          list.push(getString(node, "id") ?? "");
          consumingPermissions.set(capability, list);
        }
      }
    }
  }
  const presetMembership = new Map<string, string[]>();
  for (const node of input.nodes) {
    if (getString(node, "kind") === "RolePreset") {
      const permissions = Array.isArray(node["permissions"])
        ? (node["permissions"] as string[])
        : [];
      const roleId = getString(node, "id") ?? "";
      for (const permission of permissions) {
        const list = presetMembership.get(permission) ?? [];
        list.push(roleId);
        presetMembership.set(permission, list);
      }
    }
  }
  for (const node of input.nodes) {
    if (getString(node, "kind") !== "Permission") {
      continue;
    }
    const permissionId = getString(node, "id") ?? "";
    const key =
      getString(node, "key") ?? permissionId.slice("permission:".length);
    const presetRefs = [
      ...new Set([
        ...(presetMembership.get(permissionId) ?? []),
        ...(presetMembership.get(key) ?? []),
      ]),
    ].sort();
    const consumedBy = [
      ...new Set([
        ...(consumingPermissions.get(permissionId) ?? []),
        ...(consumingPermissions.get(key) ?? []),
      ]),
    ].sort();
    node["preset_refs"] = presetRefs;
    node["consumed_by"] = consumedBy;
    if (consumedBy.length > 0) {
      node["inert"] = "CONSUMED";
    } else if (presetRefs.length > 0) {
      node["inert"] = "GRANTED_BUT_UNCONSUMED";
    } else {
      node["inert"] = "UNKNOWN";
    }
  }

  // ——— Interface.declared_vs_runtime (DERIVED, ATLAS-IR-036) ———
  for (const node of input.nodes) {
    if (getString(node, "kind") !== "Interface") {
      continue;
    }
    const declared = getRecord(node, "declared");
    const runtime = getRecord(node, "runtime_observation");
    if (declared === undefined && runtime === undefined) {
      node["declared_vs_runtime"] = "UNKNOWN";
      continue;
    }
    if (declared !== undefined && runtime === undefined) {
      node["declared_vs_runtime"] = "DECLARED_ONLY";
      continue;
    }
    if (declared === undefined && runtime !== undefined) {
      node["declared_vs_runtime"] = "RUNTIME_ONLY";
      continue;
    }
    // ATLAS-IR-036 compares the permission gate the two observation modes
    // can both speak about. The blocks are produced differently (declared
    // registry metadata vs runtime introspection) and legitimately carry
    // different field sets — declared has scope_value, runtime has authz
    // kinds, and the two `resolver` fields have different semantics — so
    // only permission_ref is compared. Presence asymmetry IS divergence:
    // a declared permission gate the runtime capture cannot see (dynamic
    // score gates) is exactly the C-K1 seam.
    const declaredPermission = declared!["permission_ref"];
    const runtimePermission = runtime!["permission_ref"];
    const divergent = declaredPermission !== runtimePermission;
    node["declared_vs_runtime"] = divergent ? "DIVERGENT" : "MATCH";
  }

  // ——— PolicyValue.transition_refs (DERIVED from transitions_to edges) ———
  const transitionsBySource = new Map<string, Array<Record<string, unknown>>>();
  for (const edge of input.edges) {
    if (edge["kind"] === "transitions_to") {
      const source = getString(edge, "source");
      if (source !== undefined) {
        const list = transitionsBySource.get(source) ?? [];
        list.push({
          target: getString(edge, "target") ?? "",
          direction: edge["direction"],
        });
        transitionsBySource.set(source, list);
      }
    }
  }
  for (const node of input.nodes) {
    if (getString(node, "kind") === "PolicyValue") {
      node["transition_refs"] = (
        transitionsBySource.get(getString(node, "id") ?? "") ?? []
      ).sort((a, b) => {
        const ka = `${String(a["target"])}|${String(a["direction"])}`;
        const kb = `${String(b["target"])}|${String(b["direction"])}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    }
  }

  // ——— PolicyValue.activation_status (DERIVED, ATLAS-IR-040a) ———
  // SUPPORTED only when the owning claim carries all four SEM-080 conjuncts
  // at its boundary with adequate evidence; otherwise the strongest
  // non-supported value the claim itself carries; UNKNOWN when the claim
  // carries no activation information. This is what makes the timed_sync
  // negative control non-bypassable at node level: flipping a hand-set
  // field cannot survive derivation.
  const claimById = new Map<string, Record<string, unknown>>();
  for (const claim of input.claims) {
    const claimId = getString(claim, "claim_id");
    if (claimId !== undefined) {
      claimById.set(claimId, claim);
    }
  }
  for (const node of input.nodes) {
    if (getString(node, "kind") !== "PolicyValue") {
      continue;
    }
    const claimRef = getString(node, "activation_claim_ref");
    if (claimRef === undefined) {
      node["activation_status"] = "UNKNOWN";
      continue;
    }
    const claim = claimById.get(claimRef);
    if (claim === undefined) {
      throw new BuildError(
        `PolicyValue ${String(node["id"])}: activation_claim_ref "${claimRef}" does not resolve to a claim (ATLAS-IR-040a)`,
      );
    }
    const axes = getRecord(claim, "axes") ?? {};
    const activation = axes["activation_support"];
    const conjunctsComplete =
      activation === "SUPPORTED" &&
      axes["design"] === "ACCEPTED" &&
      axes["implementation"] === "PRESENT" &&
      axes["verification"] === "PASS" &&
      evidenceAdequateFor(claim, getString(claim, "boundary") ?? "B4");
    if (conjunctsComplete) {
      node["activation_status"] = "SUPPORTED";
    } else if (typeof activation === "string") {
      node["activation_status"] = activation;
    } else {
      node["activation_status"] = "UNKNOWN";
    }
  }

  // ——— Capability/Facet.support_summary via ATLAS-IR-032 ———
  // IR-032 is a function over the capability's own claims and its FACETS'
  // claims; Workflow children are composition, never roll-up parts (a
  // workflow carries no claims, so counting it as a part would force MIXED
  // on every workflow-bearing capability — the false-MIXED the R1-D
  // reviewers caught on grading.manual / result.publication).
  const facetsOf = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge["kind"] === "contains") {
      const source = getString(edge, "source");
      const target = getString(edge, "target");
      if (
        source !== undefined &&
        target !== undefined &&
        nodeById.get(target)?.["kind"] === "Facet"
      ) {
        const list = facetsOf.get(source) ?? [];
        list.push(target);
        facetsOf.set(source, list);
      }
    }
  }
  const trackedByOwners = new Map<string, Array<Record<string, unknown>>>();
  for (const edge of input.edges) {
    if (edge["kind"] === "tracked_by") {
      const source = getString(edge, "source");
      if (source !== undefined) {
        const list = trackedByOwners.get(source) ?? [];
        list.push(edge);
        trackedByOwners.set(source, list);
      }
    }
  }

  // A part's support claim is its CAPABILITY_SUPPORT claim about activation
  // (predicate `activation_support`). Claims whose predicate is
  // `support_summary` are recorded roll-up OUTPUTS (A-11), never inputs; two
  // competing activation claims on one part is a CONFLICT, not first-wins
  // (ATLAS-IR-065).
  const supportClaimOf = (
    partId: string,
  ): Record<string, unknown> | undefined => {
    const candidates = (claimsOf.get(partId) ?? []).filter((claim) => {
      if (getString(claim, "claim_kind") !== "CAPABILITY_SUPPORT") return false;
      return getString(claim, "predicate") === "activation_support";
    });
    if (candidates.length > 1) {
      throw new SemanticConflictError(
        `part ${partId} carries ${String(candidates.length)} activation_support claims (${candidates
          .map((c) => getString(c, "claim_id") ?? "?")
          .join(", ")}) — ATLAS-IR-065 forbids first-wins`,
      );
    }
    return candidates[0];
  };

  for (const node of input.nodes) {
    const kind = getString(node, "kind");
    if (kind !== "Capability" && kind !== "Facet") {
      continue;
    }
    const id = getString(node, "id") ?? "";
    // ATLAS-SEM-001: a support_summary without a boundary is invalid —
    // never silently default one.
    const supportBoundary = getString(node, "support_boundary");
    if (supportBoundary === undefined) {
      throw new BuildError(
        `${id}: support_boundary missing — a support_summary without a boundary is invalid (ATLAS-SEM-001)`,
      );
    }

    const partIds = [id, ...(facetsOf.get(id) ?? [])];
    const parts: RollupPart[] = partIds.map((partId) => {
      const supportClaim = supportClaimOf(partId);
      const tracked = trackedByOwners.get(partId) ?? [];
      const owningWorkItem = tracked.find(
        (e) => e["relation"] === "DELIVERS" || e["relation"] === "RESIDUAL",
      );
      const decisionGateEdge = tracked.find(
        (e) => e["relation"] === "DECISION_GATE",
      );
      // A clause-3 gate is only a gate when its lift condition is nameable:
      // `GATED` requires the gate's locator AND lift condition, and a
      // synthesized placeholder would manufacture a verdict no record
      // supports (ATLAS-SEM-071). The gate's lift condition lives on the
      // gate work item, so an unnamed one is a curation defect, not a
      // tolerated gap.
      const gateTarget =
        decisionGateEdge === undefined
          ? undefined
          : getString(decisionGateEdge, "target");
      const gateNode =
        gateTarget === undefined ? undefined : nodeById.get(gateTarget);
      const gateLift = getRecord(gateNode ?? {}, "open_governance_item")?.[
        "lift_condition"
      ];
      if (
        decisionGateEdge !== undefined &&
        !(typeof gateLift === "string" && gateLift.length > 0)
      ) {
        throw new BuildError(
          `${partId}: DECISION_GATE edge to ${String(gateTarget)} names no lift condition — a gate that cannot state its lift condition cannot carry GATED (ATLAS-SEM-071)`,
        );
      }
      const axes = getRecord(supportClaim ?? {}, "axes");
      // Clause-3 ownership is claim-kind-agnostic: a RESIDUAL_OR_EXCLUSION
      // claim can carry the accepted design for a deferred future (A-08).
      const hasAcceptedDesign = (claimsOf.get(partId) ?? []).some(
        (c) => getRecord(c, "axes")?.["design"] === "ACCEPTED",
      );
      return {
        partId,
        support:
          supportClaim === undefined
            ? undefined
            : {
                activation_support:
                  (axes?.["activation_support"] as never) ??
                  (getString(supportClaim, "value") as never),
                verification: (axes?.["verification"] as string) ?? "UNKNOWN",
                boundary: getString(supportClaim, "boundary") as never,
                evidenceAdequateForDeclaredBoundary: evidenceAdequateFor(
                  supportClaim,
                  getString(supportClaim, "boundary") ?? supportBoundary,
                ),
              },
        // Clause 3's frozen wording is "an accepted design" — PROPOSED alone
        // does not own a future (IR-032 binding rules).
        hasAcceptedDesign,
        owningWorkItem:
          owningWorkItem === undefined
            ? undefined
            : getString(owningWorkItem, "target"),
        decisionGate:
          decisionGateEdge === undefined
            ? undefined
            : {
                locator: gateTarget ?? "",
                lift_condition: gateLift as string,
              },
      };
    });

    const result = rollupSupport({
      mapping_state: (getString(node, "mapping_state") ?? "UNKNOWN") as never,
      parts,
      support_boundary: supportBoundary as never,
      closedSearchStatement:
        getString(node, "closed_search_statement") !== undefined,
      positiveNegativeEvidenceAtBoundary: partIds.some((partId) =>
        (claimsOf.get(partId) ?? []).some((claim) => {
          const value = getString(claim, "value");
          const axes = getRecord(claim, "axes");
          const activation = (axes?.["activation_support"] as string) ?? value;
          if (activation !== "NOT_SUPPORTED") return false;
          return negativeEvidenceCovers(claim, supportBoundary);
        }),
      ),
    });
    node["support_summary"] = result.summary;
  }
}

/**
 * Build the canonical snapshot. Throws {@link BuildError} (or
 * {@link SemanticConflictError}) on any validation failure — never
 * silently drops a record.
 */
export function buildSnapshot(
  input: SemanticInput,
  context: BuildContext,
  curationInputRevision: string,
  routeFactsDigest: string,
): BuildOutput {
  if (!/^[0-9a-f]{40}$/.test(input.source_sha)) {
    throw new BuildError(`source_sha "${input.source_sha}" is not full 40-hex`);
  }

  // Normalize on the working copies, THEN resolve + derive on the merged
  // records (see pipeline note above).
  const working: SemanticInput = {
    repo: input.repo,
    source_sha: input.source_sha,
    nodes: input.nodes.map(clone),
    edges: input.edges.map(clone),
    facts: input.facts.map(clone),
    evidence: input.evidence.map(clone),
    claims: input.claims.map(clone),
    conflicts: input.conflicts.map(clone),
  };
  const normalized = normalizeRecords(working);
  // Findings recorded by the normalizer name PRE-merge indices, and the merge
  // drops duplicates, shifting every later index; keeping both sets would
  // report one finding twice with two different paths. Re-derive them below
  // against the merged record set so each `path` names the record the
  // snapshot actually carries.
  normalized.findings.length = 0;
  const merged: SemanticInput = {
    repo: input.repo,
    source_sha: input.source_sha,
    nodes: normalized.nodes,
    edges: normalized.edges,
    facts: normalized.facts,
    evidence: normalized.evidence,
    claims: normalized.claims,
    conflicts: normalized.conflicts,
  };
  resolveAllRefs(merged, context);
  computeDerivedFields(merged);

  // SREF-1 field discipline on every ref (ATLAS-SREF-020/051): shape rules
  // were checked per-record during normalization; these are the ref-level
  // cross rules that were previously unenforced.
  for (const [i, node] of merged.nodes.entries()) {
    const refs = node["source_refs"];
    if (!Array.isArray(refs)) continue;
    for (const [j, ref] of (refs as SourceRef[]).entries()) {
      const refErrors = validateSourceRef(ref);
      if (refErrors.length > 0) {
        throw new BuildError(
          `nodes[${i}].source_refs[${j}] (${String(node["id"])}): ${refErrors.join("; ")}`,
        );
      }
    }
  }

  // Graph-level validation on the normalized records.
  const graph = validateSnapshotGraph({
    nodes: normalized.nodes,
    edges: normalized.edges,
    claims: normalized.claims,
  });
  if (graph.errors.length > 0) {
    throw new BuildError(
      `snapshot graph validation failed:\n${graph.errors.join("\n")}`,
    );
  }
  // Graph-level conformance findings (e.g. ATLAS-IR-080's unmapped-part
  // report) are part of the build output, never dropped.
  normalized.findings.push(...graph.findings);

  // Semantic re-validation on the merged records: errors stay fatal, findings
  // are reported once with the merged indices (see the note above).
  const revalidate = (
    kind: "node" | "edge" | "fact" | "evidence" | "claim" | "conflict",
    records: Array<Record<string, unknown>>,
    label: string,
  ): void => {
    for (const [i, record] of records.entries()) {
      const { errors, findings } = validateRecordSemantics(
        kind,
        record,
        `${label}[${i}]`,
      );
      if (errors.length > 0) {
        throw new BuildError(errors.join("\n"));
      }
      normalized.findings.push(...findings);
    }
  };
  revalidate("node", normalized.nodes, "nodes");
  revalidate("edge", normalized.edges, "edges");
  revalidate("fact", normalized.facts, "facts");
  revalidate("evidence", normalized.evidence, "evidence");
  revalidate("claim", normalized.claims, "claims");
  revalidate("conflict", normalized.conflicts, "conflicts");

  // ATLAS-SEM-084 — a NOT_SUPPORTED claim must cite positive negative
  // evidence: ≥1 supporting evidence record carrying a negative-evidence
  // basis (current-authority rejection, closed absence search, proven
  // refusal). Absence of supporting claims is never negative evidence.
  const normalizedEvidenceById = new Map(
    normalized.evidence.map((e) => [getString(e, "evidence_id") ?? "", e]),
  );
  for (const [i, claim] of normalized.claims.entries()) {
    const axes = getRecord(claim, "axes");
    const activation =
      (axes?.["activation_support"] as string) ?? getString(claim, "value");
    if (activation !== "NOT_SUPPORTED") {
      continue;
    }
    const supporting = Array.isArray(claim["supporting_evidence"])
      ? (claim["supporting_evidence"] as string[])
      : [];
    const hasNegativeBasis = supporting.some((evidenceId) => {
      const evidence = normalizedEvidenceById.get(evidenceId);
      return (
        evidence !== undefined &&
        typeof evidence["negative_evidence_basis"] === "string"
      );
    });
    if (!hasNegativeBasis) {
      throw new BuildError(
        `claims[${i}]: NOT_SUPPORTED without positive negative evidence (ATLAS-SEM-084) — none of the cited evidence carries a negative-evidence basis`,
      );
    }
  }

  const body: SnapshotBody = {
    ir_schema_version: IR_SCHEMA_VERSION,
    source_ref_version: SOURCE_REF_VERSION,
    repo: input.repo,
    source_sha: input.source_sha,
    nodes: normalized.nodes,
    edges: normalized.edges,
    facts: normalized.facts,
    evidence: normalized.evidence,
    claims: normalized.claims,
    conflicts: normalized.conflicts,
  };

  const bodyHash = canonicalHash(body);
  const snapshotId = `sref1-ir0.1-${input.source_sha.slice(0, 8)}-${bodyHash.slice(0, 8)}`;

  const envelope = {
    manifest: {
      snapshot_id: snapshotId,
      repo: input.repo,
      git_sha: input.source_sha,
      ir_schema_version: IR_SCHEMA_VERSION,
      source_ref_version: SOURCE_REF_VERSION,
      extractor: { id: EXTRACTOR_ID, version: EXTRACTOR_VERSION },
      curation_input_revision: curationInputRevision,
      route_facts_digest: routeFactsDigest,
      normalized_body_hash: bodyHash,
    },
    body,
  };

  return {
    envelope,
    bytes: canonicalBytes(envelope),
    bodyHash,
    findings: normalized.findings,
  };
}

export { canonicalJson };
