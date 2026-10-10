/**
 * The snapshot builder — turns a raw semantic input into the canonical
 * snapshot envelope.
 *
 * Pipeline (all deterministic; no wall clock, no filesystem enumeration
 * order, no network):
 *
 *   1. resolve every source ref against the bound revision (and live, when
 *      provided) — ATLAS-SREF resolution states + repo freshness;
 *   2. compute DERIVED fields from the resolved graph (ATLAS-IR-003: derived
 *      fields are never hand-set — input values are overwritten);
 *   3. normalize: validate, apply defaults, merge duplicates, sort —
 *      ir §7;
 *   4. hash the canonical body, seal the manifest.
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
    node["claim_refs"] = (claimsOf.get(subject ?? "") ?? []).map(
      (c) => getString(c, "claim_id") ?? "",
    );
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
    const divergent =
      declared!["permission_ref"] !== runtime!["permission_ref"] ||
      declared!["scope_ref"] !== runtime!["scope_ref"] ||
      declared!["gate_kind"] !== runtime!["gate_kind"] ||
      declared!["resolver"] !== runtime!["resolver"];
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
      ).sort((a, b) =>
        `${String(a["target"])}|${String(a["direction"])}` <
        `${String(b["target"])}|${String(b["direction"])}`
          ? -1
          : 1,
      );
    }
  }

  // ——— Capability/Facet.support_summary via ATLAS-IR-032 ———
  const facetsOf = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge["kind"] === "contains") {
      const source = getString(edge, "source");
      const target = getString(edge, "target");
      if (source !== undefined && target !== undefined) {
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
      const ref = getRecord(evidence, "source_ref");
      if (ref === undefined) return true; // HUMAN_REVIEW evidence has no ref.
      return usableAsBoundRevisionEvidence(ref as unknown as SourceRef);
    });
  };

  for (const node of input.nodes) {
    const kind = getString(node, "kind");
    if (kind !== "Capability" && kind !== "Facet") {
      continue;
    }
    const id = getString(node, "id") ?? "";
    const supportBoundary = getString(node, "support_boundary") ?? "B4";
    const ownClaims = (claimsOf.get(id) ?? []).filter(
      (claim) => getString(claim, "claim_kind") === "CAPABILITY_SUPPORT",
    );

    const partIds =
      kind === "Capability"
        ? [id, ...(facetsOf.get(id) ?? [])]
        : [id, ...(facetsOf.get(id) ?? [])];
    const parts: RollupPart[] = partIds.map((partId) => {
      const partNode = nodeById.get(partId);
      const claims =
        partId === id
          ? ownClaims
          : (claimsOf.get(partId) ?? []).filter(
              (claim) =>
                getString(claim, "claim_kind") === "CAPABILITY_SUPPORT",
            );
      const supportClaim = claims[0];
      const tracked = trackedByOwners.get(partId) ?? [];
      const owningWorkItem = tracked.find(
        (e) => e["relation"] === "DELIVERS" || e["relation"] === "RESIDUAL",
      );
      const decisionGate = tracked.find(
        (e) => e["relation"] === "DECISION_GATE",
      );
      const axes = getRecord(supportClaim ?? {}, "axes");
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
        hasAcceptedDesign:
          axes?.["design"] === "ACCEPTED" || axes?.["design"] === "PROPOSED",
        owningWorkItem:
          owningWorkItem === undefined
            ? undefined
            : getString(owningWorkItem, "target"),
        decisionGate:
          decisionGate === undefined
            ? undefined
            : {
                locator: getString(decisionGate, "target") ?? "",
                lift_condition: "see DECISION_GATE work item",
              },
      };
    });

    const result = rollupSupport({
      mapping_state: (getString(node, "mapping_state") ?? "UNKNOWN") as never,
      parts,
      support_boundary: supportBoundary as never,
      closedSearchStatement:
        getString(node, "closed_search_statement") !== undefined,
      positiveNegativeEvidenceAtBoundary: ownClaims.some((claim) => {
        const value = getString(claim, "value");
        const axes = getRecord(claim, "axes");
        const activation = (axes?.["activation_support"] as string) ?? value;
        if (activation !== "NOT_SUPPORTED") return false;
        return evidenceAdequateFor(claim, supportBoundary);
      }),
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

  // Resolve refs + compute derived fields on the working copies.
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
  resolveAllRefs(working, context);
  computeDerivedFields(working);

  const normalized = normalizeRecords(working);

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

  // Every semantic-validation error on normalized records is fatal here too
  // (records were already validated pre-merge; merged records must still
  // satisfy the cross-field rules).
  for (const [i, claim] of normalized.claims.entries()) {
    const { errors, findings } = validateRecordSemantics(
      "claim",
      claim,
      `claims[${i}]`,
    );
    if (errors.length > 0) {
      throw new BuildError(errors.join("\n"));
    }
    normalized.findings.push(...findings);
  }
  for (const [i, node] of normalized.nodes.entries()) {
    const { errors } = validateRecordSemantics("node", node, `nodes[${i}]`);
    if (errors.length > 0) {
      throw new BuildError(errors.join("\n"));
    }
  }

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
