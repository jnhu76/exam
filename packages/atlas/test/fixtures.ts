/**
 * Test fixture builders — minimal valid R0 records for the R1-A suite.
 * Kept explicit: every fixture shows the fields the schema requires, which
 * doubles as executable documentation of the record shapes.
 */

import type { SemanticInput } from "../src/snapshot/types.js";
import type { SourceRef } from "../src/sref/types.js";

export const SHA = "a".repeat(40);

export function sourceRef(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    source_ref_version: "SREF-1",
    repo: "jnhu76/exam",
    git_sha: SHA,
    source_kind: "REPO_FILE",
    path_or_uri: "docs/example.md",
    extractor: { id: "test", version: "0.0.0" },
    extraction_method: "MANUAL_CURATION",
    resolution_state: "RESOLVED",
    repo_freshness: "CURRENT",
    sensitivity: "NONE",
    ...overrides,
  };
}

export function capabilityNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "Capability",
    id: "capability:test.thing",
    label: "Test thing",
    source_refs: [sourceRef()],
    authority_refs: [],
    review_state: "PROPOSED",
    open_governance_item: { kind: "NONE" },
    support_summary: "UNKNOWN",
    support_boundary: "B4",
    mapping_state: "MAPPED",
    mapping_basis: "test enumeration basis",
    ...overrides,
  };
}

export function facetNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "Facet",
    id: "facet:test.thing.part",
    label: "Test part",
    source_refs: [sourceRef()],
    authority_refs: [],
    review_state: "PROPOSED",
    open_governance_item: { kind: "NONE" },
    support_summary: "UNKNOWN",
    support_boundary: "B4",
    mapping_state: "MAPPED",
    mapping_basis: "test enumeration basis",
    ...overrides,
  };
}

export function evidenceRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    evidence_id: "ev-1",
    evidence_kind: "STATIC_SOURCE",
    source_ref: sourceRef(),
    proves: "the declaration exists",
    does_not_prove: ["reachability", "activation"],
    strength: "TOKEN_EXISTENCE",
    boundary_coverage: ["B0"],
    snapshot: SHA,
    ...overrides,
  };
}

export function claimRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    claim_id: "claim-1",
    subject: "capability:test.thing",
    predicate: "activation_support",
    value: "SUPPORTED",
    claim_kind: "CAPABILITY_SUPPORT",
    boundary: "B4",
    axes: { activation_support: "SUPPORTED", verification: "PASS" },
    authority_owner: "UNKNOWN",
    supporting_evidence: ["ev-1"],
    challenging_evidence: [],
    review_state: "PROPOSED",
    open_governance_item: { kind: "NONE" },
    source_snapshot: SHA,
    ...overrides,
  };
}

export function emptyInput(): SemanticInput {
  return {
    repo: "jnhu76/exam",
    source_sha: SHA,
    nodes: [],
    edges: [],
    facts: [],
    evidence: [],
    claims: [],
    conflicts: [],
  };
}

/** Deterministic reshuffle: reversed + rotated, distinct from input order. */
export function shuffle<T>(items: T[], rounds: number): T[] {
  const copy = [...items];
  for (let r = 0; r < rounds; r += 1) {
    copy.push(...copy.splice(0, 1 + ((r * 7) % Math.max(copy.length, 1))));
    copy.reverse();
  }
  return copy;
}
