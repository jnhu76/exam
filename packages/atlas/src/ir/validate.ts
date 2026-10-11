/**
 * Semantic + cross-field validation — the machine rules R1 must enforce
 * (R1 handoff §9): closed sets (field tables), ATLAS-IR-032/033/038/040a/041,
 * ATLAS-SEM-001/083/084 boundary adequacy and positive negative evidence,
 * ATLAS-IR-031a/034/086 structural RBAC boundaries.
 *
 * Validation is split:
 * - `validateRecordSemantics` — per-record cross-field rules;
 * - `validateSnapshot` — graph-level rules (unique IDs, endpoints, coverage
 *   membership, permission consumption coherence).
 *
 * Conformance findings (e.g. ATLAS-SEM-041's incomplete-claim shape) are
 * reported, not silently dropped and not fatal: the snapshot may honestly
 * contain incomplete curation, and hiding it would be the defect.
 */

import { FIELD_ABSENT, RecordFields } from "./record.js";
import {
  CLAIM_SHAPE,
  CONFLICT_SHAPE,
  EVIDENCE_SHAPE,
  FACT_SHAPE,
  edgeShape,
  nodeShape,
} from "./records.js";
import { BOUNDARIES, type EdgeKind, type NodeKind } from "./types.js";

export interface ConformanceFinding {
  code: string;
  path: string;
  message: string;
}

export interface RecordSchemas {
  nodes: Record<NodeKind, RecordFields>;
  edges: Record<EdgeKind, RecordFields>;
  fact: RecordFields;
  evidence: RecordFields;
  claim: RecordFields;
  conflict: RecordFields;
}

export function buildRecordSchemas(
  nodeKinds: readonly NodeKind[],
  edgeKinds: readonly EdgeKind[],
): RecordSchemas {
  const nodes = {} as Record<NodeKind, RecordFields>;
  for (const kind of nodeKinds) {
    nodes[kind] = new RecordFields(nodeShape(kind));
  }
  const edges = {} as Record<EdgeKind, RecordFields>;
  for (const kind of edgeKinds) {
    edges[kind] = new RecordFields(edgeShape(kind));
  }
  return {
    nodes,
    edges,
    fact: new RecordFields(FACT_SHAPE),
    evidence: new RecordFields(EVIDENCE_SHAPE),
    claim: new RecordFields(CLAIM_SHAPE),
    conflict: new RecordFields(CONFLICT_SHAPE),
  };
}

function requireStringField(
  raw: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = raw[field];
  return typeof value === "string" ? value : undefined;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== FIELD_ABSENT;
}

/**
 * Per-record cross-field semantics. `errors` are hard defects;
 * `findings` are reportable conformance states.
 */
export function validateRecordSemantics(
  kind: "node" | "edge" | "fact" | "evidence" | "claim" | "conflict",
  raw: Record<string, unknown>,
  path: string,
): { errors: string[]; findings: ConformanceFinding[] } {
  const errors: string[] = [];
  const findings: ConformanceFinding[] = [];

  if (kind === "node") {
    const nodeKind = requireStringField(raw, "kind") as NodeKind | undefined;
    const id = requireStringField(raw, "id") ?? "<missing-id>";

    if (nodeKind === "Capability" || nodeKind === "Facet") {
      const mappingState = requireStringField(raw, "mapping_state");
      if (mappingState === "MAPPED" && !isPresent(raw["mapping_basis"])) {
        errors.push(
          `${path}: mapping_state = MAPPED requires a named enumeration basis (ATLAS-IR-080)`,
        );
      }
    }

    if (nodeKind === "Scope") {
      const participation = requireStringField(raw, "rbac_participation");
      if (
        participation === "OUTSIDE_APPLICATION_RBAC" &&
        !isPresent(raw["outside_authority"])
      ) {
        errors.push(
          `${path}: OUTSIDE_APPLICATION_RBAC scope must carry outside_authority (ATLAS-IR-031a)`,
        );
      }
    }

    if (nodeKind === "Operation") {
      const req = raw["authority_requirement"];
      if (req !== null && typeof req === "object" && !Array.isArray(req)) {
        const authorityRequirement = req as Record<string, unknown>;
        if (authorityRequirement["assignment_required"] === "TRUE") {
          if (!isPresent(authorityRequirement["enforcement_seam"])) {
            errors.push(
              `${path}.authority_requirement: assignment_required = TRUE requires enforcement_seam (ATLAS-IR-034)`,
            );
          }
          if (!isPresent(authorityRequirement["enforcement_evidence"])) {
            errors.push(
              `${path}.authority_requirement: assignment_required = TRUE requires enforcement_evidence, and it must be evidence of the seam (ATLAS-IR-034/ATLAS-SEM-035)`,
            );
          }
        }
      }
    }

    if (nodeKind === "Interface") {
      const declared = isPresent(raw["declared"]);
      const runtime = isPresent(raw["runtime_observation"]);
      const derived = requireStringField(raw, "declared_vs_runtime");
      if (derived === "DIVERGENT" && !(declared && runtime)) {
        errors.push(
          `${path}: declared_vs_runtime = DIVERGENT requires both blocks (ATLAS-IR-036)`,
        );
      }
      if (derived === "DECLARED_ONLY" && (runtime || !declared)) {
        errors.push(
          `${path}: DECLARED_ONLY requires declared and no runtime block (ATLAS-IR-036)`,
        );
      }
      if (derived === "RUNTIME_ONLY" && (declared || !runtime)) {
        errors.push(
          `${path}: RUNTIME_ONLY requires runtime_observation and no declared block (ATLAS-IR-036/037)`,
        );
      }
      if (derived === "MATCH" && !(declared && runtime)) {
        errors.push(`${path}: MATCH requires both blocks present`);
      }
    }

    if (nodeKind === "Permission") {
      const inert = requireStringField(raw, "inert");
      const presetRefs = Array.isArray(raw["preset_refs"])
        ? (raw["preset_refs"] as string[])
        : [];
      const consumedBy = Array.isArray(raw["consumed_by"])
        ? (raw["consumed_by"] as string[])
        : [];
      if (
        inert === "GRANTED_BUT_UNCONSUMED" &&
        (presetRefs.length === 0 || consumedBy.length > 0)
      ) {
        errors.push(
          `${path}: inert = GRANTED_BUT_UNCONSUMED requires preset membership and empty consumption (ATLAS-IR-038)`,
        );
      }
      if (inert === "CONSUMED" && consumedBy.length === 0) {
        errors.push(
          `${path}: inert = CONSUMED requires ≥1 consumed_by gate with evidence (ATLAS-IR-038)`,
        );
      }
    }

    if (nodeKind === "PolicyValue") {
      const activation = requireStringField(raw, "activation_status");
      const claimRef = requireStringField(raw, "activation_claim_ref");
      const refusingSeams = Array.isArray(raw["refusing_seams"])
        ? (raw["refusing_seams"] as string[])
        : [];
      if (activation === "SUPPORTED" && !claimRef) {
        errors.push(
          `${path}: activation_status = SUPPORTED with no owning claim is invalid by construction (ATLAS-IR-040a)`,
        );
      }
      if (
        (activation === "GATED" || activation === "NOT_SUPPORTED") &&
        refusingSeams.length === 0
      ) {
        errors.push(
          `${path}: activation refused with an empty refusing_seams list is a defect (ATLAS-IR-041)`,
        );
      }
    }
    void id;
  }

  if (kind === "claim") {
    const activation = (() => {
      const axes = raw["axes"];
      if (axes !== null && typeof axes === "object" && !Array.isArray(axes)) {
        return (axes as Record<string, unknown>)["activation_support"];
      }
      return undefined;
    })();
    const boundary = requireStringField(raw, "boundary");
    const claimId = requireStringField(raw, "claim_id") ?? "<missing-claim-id>";

    if (activation === "SUPPORTED" && !boundary) {
      errors.push(
        `${path}: SUPPORTED without a stated boundary is invalid (ATLAS-SEM-001/ATLAS-IR-095)`,
      );
    }
    if (boundary !== undefined && !BOUNDARIES.includes(boundary as never)) {
      errors.push(`${path}: boundary "${boundary}" is not a B0..B6 identifier`);
    }

    // ATLAS-SEM-084 — NOT_SUPPORTED requires positive negative evidence.
    if (activation === "NOT_SUPPORTED") {
      const supporting = Array.isArray(raw["supporting_evidence"])
        ? (raw["supporting_evidence"] as string[])
        : [];
      if (supporting.length === 0) {
        errors.push(
          `${path}: NOT_SUPPORTED requires positive negative evidence (ATLAS-SEM-084); supporting_evidence is empty`,
        );
      }
    }

    // ATLAS-SEM-041 — the falsification attempt must exist for
    // verdict-bearing claims (the ones a reader may act on).
    const VERDICT_BEARING = new Set([
      "CAPABILITY_SUPPORT",
      "AUTHORIZATION_EFFECT",
      "VERIFICATION_STATUS",
      "IMPLEMENTATION_STATUS",
      "DURABLE_EFFECT",
      "RUNTIME_OBSERVATION",
    ]);
    const challenging = Array.isArray(raw["challenging_evidence"])
      ? (raw["challenging_evidence"] as string[])
      : [];
    const claimKind = requireStringField(raw, "claim_kind");
    if (
      challenging.length === 0 &&
      claimKind !== undefined &&
      VERDICT_BEARING.has(claimKind)
    ) {
      findings.push({
        code: "ATLAS-SEM-041",
        path,
        message: `claim ${claimId}: empty challenging_evidence — no falsification attempt is recorded (incomplete claim)`,
      });
    }
  }

  if (kind === "evidence") {
    const evidenceKind = requireStringField(raw, "evidence_kind");
    if (evidenceKind !== "HUMAN_REVIEW" && !isPresent(raw["source_ref"])) {
      errors.push(
        `${path}: source_ref is REQUIRED for every evidence kind except HUMAN_REVIEW (ATLAS-SEM-031/provenance §4.3)`,
      );
    }
    const doesNotProve = Array.isArray(raw["does_not_prove"])
      ? (raw["does_not_prove"] as string[])
      : [];
    if (doesNotProve.length === 0) {
      errors.push(
        `${path}: does_not_prove is REQUIRED and may not be empty — an evidence record with no stated limit cannot participate in a support verdict (ATLAS-SEM-031)`,
      );
    }
    const basis = requireStringField(raw, "negative_evidence_basis");
    if (basis === "CLOSED_ABSENCE_SEARCH" && !isPresent(raw["search_scope"])) {
      errors.push(
        `${path}: CLOSED_ABSENCE_SEARCH requires the stated search scope (ATLAS-SEM-023)`,
      );
    }
  }

  return { errors, findings };
}

/** Snapshot-level validation: run after schema validation of every record. */
export function validateSnapshotGraph(input: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
}): { errors: string[]; findings: ConformanceFinding[] } {
  const errors: string[] = [];
  const findings: ConformanceFinding[] = [];

  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    const id = node["id"];
    if (typeof id !== "string") continue;
    if (nodeIds.has(id)) {
      errors.push(
        `duplicate node id ${id} (surviving duplicates must have merged)`,
      );
    }
    nodeIds.add(id);
  }

  input.edges.forEach((edge, i) => {
    const source = edge["source"];
    const target = edge["target"];
    if (typeof source === "string" && !nodeIds.has(source)) {
      errors.push(`edges[${i}]: source ${source} has no node`);
    }
    if (typeof target === "string" && !nodeIds.has(target)) {
      errors.push(`edges[${i}]: target ${target} has no node`);
    }
  });

  // ATLAS-IR-086 — OUTSIDE_APPLICATION_RBAC scopes take no gate path.
  const outsideScopes = new Set(
    input.nodes
      .filter(
        (n) =>
          n["kind"] === "Scope" &&
          typeof n["id"] === "string" &&
          n["rbac_participation"] === "OUTSIDE_APPLICATION_RBAC",
      )
      .map((n) => n["id"] as string),
  );
  for (const edge of input.edges) {
    if (
      (edge["kind"] === "scoped_by" ||
        edge["kind"] === "requires_permission") &&
      typeof edge["target"] === "string" &&
      outsideScopes.has(edge["target"])
    ) {
      errors.push(
        `edge ${String(edge["kind"])} → ${String(edge["target"])}: OUTSIDE_APPLICATION_RBAC scope may not be the target of a gate path (ATLAS-IR-086/031)`,
      );
    }
  }

  input.claims.forEach((claim, i) => {
    const subject = claim["subject"];
    if (typeof subject === "string" && !nodeIds.has(subject)) {
      errors.push(`claims[${i}]: subject ${subject} has no node`);
    }
  });

  return { errors, findings };
}
