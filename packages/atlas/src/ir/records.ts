/**
 * Atlas IR v0.1 record shapes — executable field tables for ir-v0.1.md §4
 * (nodes), §5 (edges) and the semantic-contract records (Fact §3.2,
 * Evidence §4.3, Claim §5.2, Conflict §12/ATLAS-SEM-111).
 *
 * Each table row is also the default-table row for its optional field
 * (ATLAS-IR-069). Derived fields (DERIVED per ATLAS-IR-003) are required in
 * the canonical form — the builder computes them; hand-set values that
 * disagree with inputs are writer defects, not curation.
 */

import {
  ADDITIONAL_GATE_EFFECTS,
  ACTIVATION_SUPPORT_AXIS,
  AUTHORITY_STATUS,
  BOUNDARIES,
  CARRIER_RESOLUTION,
  CATALOG_STATUS,
  CLAIM_KINDS,
  CLAIM_RESOLUTION_AXIS,
  CLOSURE_SEMANTICS,
  CONFLICT_KINDS,
  CONFLICT_RESOLUTION_STATUSES,
  DECLARED_VS_RUNTIME,
  DESIGN_AXIS,
  EFFECT_KINDS,
  EVIDENCE_KINDS,
  EVIDENCE_STRENGTHS,
  FRESHNESS_AXIS,
  GATE_KINDS,
  IDEMPOTENCY,
  IMPLEMENTATION_AXIS,
  MAPPING_STATE,
  MUTABILITY,
  NEGATIVE_EVIDENCE_BASES,
  NODE_KINDS,
  OBSERVED_KINDS,
  OPEN_GOVERNANCE_KINDS,
  PERMISSION_INERT,
  PRESET_KINDS,
  RBAC_PARTICIPATION,
  REVIEW_STATE,
  SEAM_KINDS,
  SUPPORT_SUMMARY,
  TRACKED_BY_RELATIONS,
  TRANSITION_DIRECTIONS,
  TRANSITION_REACHABILITY,
  TRI_STATE,
  VERIFICATION_AXIS,
  VOCABULARY_CLASSES,
  WORK_ITEM_KINDS,
  type EdgeKind,
  type NodeKind,
} from "./types.js";
import {
  EXTRACTION_METHODS,
  RESOLUTION_STATES,
  SENSITIVITY_LEVELS,
  SOURCE_KINDS,
  SOURCE_REF_VERSION,
} from "../sref/types.js";
import {
  FIELD_ABSENT,
  arrayOf,
  enumOf,
  int,
  literal,
  optEnum,
  optInt,
  optLiteral,
  optRec,
  optRef,
  optRefArray,
  optSentinel,
  optStr,
  optTrue,
  optArrayOf,
  rec,
  ref,
  refArray,
  sentinel,
  shape,
  str,
  type ObjectShape,
} from "./record.js";

/** All ID namespaces that carry nodes (§6.1). */
const ANY_NODE_NS = [
  "capability",
  "facet",
  "workflow",
  "operation",
  "interface",
  "permission",
  "role",
  "scope",
  "policy",
  "entity",
  "authority",
  "work",
] as const;

/**
 * A stable, deterministic locator key for cross-records that reference a
 * source ref without re-embedding it (interface declared/runtime blocks,
 * conflict parties). Format:
 * `<source_kind>@<sha8>:<path_or_uri>#<symbol|section>`.
 */
export function locatorKey(ref: {
  source_kind: string;
  git_sha?: string;
  path_or_uri: string;
  symbol?: string;
  section?: string;
}): string {
  const sha = ref.git_sha ? ref.git_sha.slice(0, 8) : "external";
  const anchor = ref.symbol ?? ref.section ?? "";
  return `${ref.source_kind}@${sha}:${ref.path_or_uri}#${anchor}`;
}

/** SREF-1 record shape, embedded in Fact/Evidence/authority records. */
export function sourceRefShape(): ObjectShape {
  return shape({
    source_ref_version: literal(SOURCE_REF_VERSION),
    repo: optStr("jnhu76/exam"),
    git_sha: optStr(""),
    source_kind: enumOf(SOURCE_KINDS, "source_kind"),
    path_or_uri: str(),
    symbol: optStr(""),
    section: optStr(""),
    line_or_range: optRec(shape({ start: int(), end: int() }), FIELD_ABSENT),
    extractor: rec(shape({ id: str(), version: str() })),
    extraction_method: enumOf(EXTRACTION_METHODS, "extraction_method"),
    resolution_state: enumOf(RESOLUTION_STATES, "resolution_state"),
    resolution_detail: optRec(
      shape({
        candidates: optArrayOf(str(), []),
        nearest_anchor: optStr(""),
        reason: optStr(""),
      }),
      FIELD_ABSENT,
    ),
    external_revision: optRec(
      shape({
        observed_state: str(),
        observed_updated_at: str(),
        observed_at: str(),
      }),
      FIELD_ABSENT,
    ),
    external_freshness: optEnum(
      FRESHNESS_AXIS,
      "external_freshness",
      "UNKNOWN",
    ),
    repo_freshness: optEnum(FRESHNESS_AXIS, "repo_freshness", "UNKNOWN"),
    historical: optTrue(FIELD_ABSENT),
    anchor_text: optStr(""),
    sensitivity: enumOf(SENSITIVITY_LEVELS, "sensitivity"),
  });
}

function governanceItemShape(): ObjectShape {
  return shape({
    kind: enumOf(OPEN_GOVERNANCE_KINDS, "open_governance_item.kind"),
    ref: optStr(""),
    lift_condition: optStr(""),
  });
}

/** Shared node header (ir §4). */
function nodeHeader(kind: NodeKind): ObjectShape {
  return shape({
    kind: literal(kind),
    id: ref(ANY_NODE_NS),
    label: str(),
    source_refs: arrayOf(rec(sourceRefShape())),
    authority_refs: refArray(["authority"]),
    freshness: optEnum(FRESHNESS_AXIS, "freshness", "UNKNOWN"),
    resolution: optEnum(CLAIM_RESOLUTION_AXIS, "resolution", "UNKNOWN"),
    resolution_causes: optArrayOf(str(), []),
    review_state: enumOf(REVIEW_STATE, "review_state"),
    claim_refs: optArrayOf(str(), []),
    open_governance_item: rec(governanceItemShape()),
    renamed_from: optRefArray(ANY_NODE_NS, []),
    renamed_to: optRef(ANY_NODE_NS, FIELD_ABSENT),
    retired_at: optStr(FIELD_ABSENT),
    rename_reason: optStr(FIELD_ABSENT),
  });
}

const AUTHORITY_REQ_SHAPE = shape({
  capability_ref: sentinel(shape({ id: ref(["permission"]) }), [
    "NONE",
    "UNKNOWN",
  ]),
  scope_ref: optRef(["scope"], FIELD_ABSENT),
  resource_anchor_ref: optRef(["scope"], FIELD_ABSENT),
  assignment_required: enumOf(TRI_STATE, "assignment_required"),
  assignment_applies_to: arrayOf(str()),
  enforcement_seam: optStr(FIELD_ABSENT),
  enforcement_evidence: optStr(FIELD_ABSENT),
  resource_resolution: optStr(FIELD_ABSENT),
  deny_mapping: optStr(FIELD_ABSENT),
});

/** ir §4 — the type-specific fields per node kind. */
const CAPABILITY_FACET_FIELDS = shape({
  // DERIVED by the ATLAS-IR-032 roll-up; raw input may omit it, and a
  // supplied value is overwritten — the claims are the single authority.
  support_summary: optEnum(SUPPORT_SUMMARY, "support_summary", "UNKNOWN"),
  support_boundary: enumOf(BOUNDARIES, "support_boundary"),
  mapping_state: enumOf(MAPPING_STATE, "mapping_state"),
  // ATLAS-IR-080: MAPPED requires a NAMED enumeration basis.
  mapping_basis: optStr(FIELD_ABSENT),
  // ATLAS-IR-032 clause 2: the closed-search statement that no known
  // non-supported part is unmapped (its presence enables clause 2).
  closed_search_statement: optStr(FIELD_ABSENT),
  external_identity: optRef(["work"], FIELD_ABSENT),
});

export const NODE_TYPE_FIELDS: Record<NodeKind, ObjectShape> = {
  Capability: CAPABILITY_FACET_FIELDS,
  Facet: CAPABILITY_FACET_FIELDS,
  Workflow: shape({
    capability_ref: ref(["capability", "facet"]),
    // DERIVED from performs edges; raw input may omit it.
    step_count: optInt(0),
    terminal_step_ref: optRef(["operation"], FIELD_ABSENT),
  }),
  Operation: shape({
    gate_kind: enumOf(GATE_KINDS, "gate_kind"),
    authority_requirement: rec(AUTHORITY_REQ_SHAPE),
    state_prerequisites: arrayOf(str()),
    durable_effects: arrayOf(
      rec(
        shape({
          entity_ref: ref(["entity"]),
          effect_kind: enumOf(EFFECT_KINDS, "effect_kind"),
          mutability: enumOf(MUTABILITY, "mutability"),
        }),
      ),
    ),
    durable_effects_state: enumOf(
      ["ESTABLISHED", "UNKNOWN"],
      "durable_effects_state",
    ),
    idempotency: enumOf(IDEMPOTENCY, "idempotency"),
    atomicity: str(),
  }),
  Interface: shape({
    seam_kind: enumOf(SEAM_KINDS, "seam_kind"),
    contract_identity: str(),
    declared: optRec(
      shape({
        source_ref: str(),
        permission_ref: optRef(["permission"], FIELD_ABSENT),
        scope_ref: optRef(["scope"], FIELD_ABSENT),
        // The mirrored catalog scope VALUE from the declared metadata (the
        // IR scope_ref is curated; the raw value is extra metadata).
        scope_value: optStr(FIELD_ABSENT),
        gate_kind: optEnum(GATE_KINDS, "gate_kind", FIELD_ABSENT),
        resolver: optStr(FIELD_ABSENT),
        audit_action: optStr(FIELD_ABSENT),
      }),
      FIELD_ABSENT,
    ),
    runtime_observation: optRec(
      shape({
        capture_ref: str(),
        permission_ref: optRef(["permission"], FIELD_ABSENT),
        gate_kind: optEnum(GATE_KINDS, "gate_kind", FIELD_ABSENT),
        resolver: optStr(FIELD_ABSENT),
      }),
      FIELD_ABSENT,
    ),
    // DERIVED from the declared/runtime blocks; raw input may omit it.
    declared_vs_runtime: optEnum(
      DECLARED_VS_RUNTIME,
      "declared_vs_runtime",
      "UNKNOWN",
    ),
    additional_gates: arrayOf(
      rec(
        shape({
          capability_ref: ref(["permission"]),
          effect: enumOf(ADDITIONAL_GATE_EFFECTS, "effect"),
          evidence: str(),
          applies_to_responses: optArrayOf(str(), []),
        }),
      ),
    ),
  }),
  Permission: shape({
    key: str(),
    catalog_status: enumOf(CATALOG_STATUS, "catalog_status"),
    // DERIVED from preset membership ∪ consumed_by gates (ATLAS-IR-038).
    preset_refs: optRefArray(["role"], []),
    consumed_by: optRefArray(["interface", "operation"], []),
    inert: optEnum(PERMISSION_INERT, "inert", "UNKNOWN"),
    consumption_evidence: optArrayOf(str(), []),
  }),
  RolePreset: shape({
    key: str(),
    preset_kind: enumOf(PRESET_KINDS, "preset_kind"),
    login_allowed: enumOf(TRI_STATE, "login_allowed"),
    assignable: enumOf(TRI_STATE, "assignable"),
    default_scope: optRef(["scope"], FIELD_ABSENT),
    permissions: refArray(["permission"]),
    sensitive_permissions: refArray(["permission"]),
  }),
  Scope: shape({
    value: str(),
    rbac_participation: enumOf(RBAC_PARTICIPATION, "rbac_participation"),
    resource_domain: str(),
    assignment_carrier: sentinel(
      shape({
        entity_ref: ref(["entity"]),
        enforcement_seam: str(),
        evidence: str(),
      }),
      ["NONE", "UNKNOWN"],
    ),
    list_filtering: enumOf(TRI_STATE, "list_filtering"),
    outside_authority: optRec(
      shape({
        holder_identity: str(),
        granted_by: str(),
        governed_by: str(),
        resources: arrayOf(str()),
        excluded_from: arrayOf(str()),
      }),
      FIELD_ABSENT,
    ),
  }),
  PolicyValue: shape({
    value: str(),
    vocabulary_class: enumOf(VOCABULARY_CLASSES, "vocabulary_class"),
    representable: enumOf(TRI_STATE, "representable"),
    storable: enumOf(TRI_STATE, "storable"),
    write_reachable: enumOf(TRI_STATE, "write_reachable"),
    read_compatible: enumOf(TRI_STATE, "read_compatible"),
    // DERIVED from activation_claim_ref (ATLAS-IR-040a); raw input may omit
    // it, and a supplied value is overwritten.
    activation_status: optEnum(
      ACTIVATION_SUPPORT_AXIS,
      "activation_status",
      "UNKNOWN",
    ),
    activation_claim_ref: optStr(FIELD_ABSENT),
    activation_gate: optRec(
      shape({ locator: str(), lift_condition: str() }),
      FIELD_ABSENT,
    ),
    refusing_seams: arrayOf(str()),
    // DERIVED from transitions_to edges.
    transition_refs: optArrayOf(
      rec(
        shape({
          target: ref(["policy"]),
          direction: enumOf(TRANSITION_DIRECTIONS, "direction"),
        }),
      ),
      [],
    ),
    default_when_absent: optSentinel(
      shape({ value: str() }),
      ["NONE"],
      FIELD_ABSENT,
    ),
  }),
  DurableEntity: shape({
    semantic_name: str(),
    semantic_authority_refs: refArray(["authority"]),
    physical_carrier: sentinel(
      shape({
        schema_ref: str(),
        table: str(),
        columns: arrayOf(str()),
        migrations: arrayOf(str()),
      }),
      ["NONE", "UNKNOWN"],
    ),
    carrier_resolution: enumOf(CARRIER_RESOLUTION, "carrier_resolution"),
    state_values: refArray(["policy"]),
    freeze_rule: optStr(FIELD_ABSENT),
  }),
  NormativeAuthority: shape({
    governs_fact_types: arrayOf(str()),
    source_ref: str(),
    authority_status: enumOf(AUTHORITY_STATUS, "authority_status"),
    supersedes: optRefArray(["authority"], []),
    superseded_by: optRefArray(["authority"], []),
    amendment_of: optRefArray(["authority"], []),
    declared_scope: str(),
    enforcement_seam: optStr(FIELD_ABSENT),
  }),
  WorkItem: shape({
    // semantic-contract §6.2 `kind`; renamed in the node form to avoid
    // colliding with the node-header `kind` (the node type).
    work_kind: enumOf(WORK_ITEM_KINDS, "work_kind"),
    external_ref: str(),
    external_revision: optRec(
      shape({
        observed_state: str(),
        observed_updated_at: str(),
        observed_at: str(),
      }),
      FIELD_ABSENT,
    ),
    title: str(),
    requested_scope: str(),
    closure_semantics: enumOf(CLOSURE_SEMANTICS, "closure_semantics"),
    state: str(),
    owns: optRefArray(ANY_NODE_NS, []),
    related_claims: optArrayOf(str(), []),
  }),
};

/** Full node shape = header + type-specific fields. */
export function nodeShape(kind: NodeKind): ObjectShape {
  return { ...nodeHeader(kind), ...NODE_TYPE_FIELDS[kind] };
}

/** ir §5 — edge endpoint namespaces per kind. */
export const EDGE_ENDPOINTS: Record<
  EdgeKind,
  { source: readonly string[]; target: readonly string[] }
> = {
  contains: {
    source: ["capability", "facet", "workflow"],
    target: ["facet", "workflow"],
  },
  performs: { source: ["workflow"], target: ["operation"] },
  exposes: { source: ["interface"], target: ["operation"] },
  requires_permission: { source: ["operation"], target: ["permission"] },
  scoped_by: { source: ["operation"], target: ["scope"] },
  reads: { source: ["operation"], target: ["entity"] },
  writes: { source: ["operation"], target: ["entity"] },
  governed_by: { source: ANY_NODE_NS, target: ["authority"] },
  tracked_by: { source: ANY_NODE_NS, target: ["work"] },
  transitions_to: { source: ["policy"], target: ["policy"] },
  depends_on: {
    source: ["capability", "facet"],
    target: ["capability", "facet"],
  },
};

/** ir §5 — qualifying-attribute fields per edge kind (the discriminator). */
export const EDGE_ATTRIBUTE_FIELDS: Record<EdgeKind, ObjectShape | null> = {
  contains: null,
  performs: shape({
    step_index: int(),
    optionality: enumOf(["REQUIRED", "OPTIONAL", "UNKNOWN"], "optionality"),
  }),
  exposes: null,
  requires_permission: null,
  scoped_by: null,
  reads: shape({
    effect_kind: enumOf(EFFECT_KINDS, "effect_kind"),
    mutability: enumOf(MUTABILITY, "mutability"),
  }),
  writes: shape({
    effect_kind: enumOf(EFFECT_KINDS, "effect_kind"),
    mutability: enumOf(MUTABILITY, "mutability"),
  }),
  governed_by: null,
  tracked_by: shape({ relation: enumOf(TRACKED_BY_RELATIONS, "relation") }),
  transitions_to: shape({
    direction: enumOf(TRANSITION_DIRECTIONS, "direction"),
    guard_ref: optStr(FIELD_ABSENT),
    reachability: enumOf(TRANSITION_REACHABILITY, "reachability"),
  }),
  depends_on: null,
};

export function edgeShape(kind: EdgeKind): ObjectShape {
  return shape({
    kind: literal(kind),
    source: ref(EDGE_ENDPOINTS[kind].source),
    target: ref(EDGE_ENDPOINTS[kind].target),
    ...(EDGE_ATTRIBUTE_FIELDS[kind] ?? {}),
  });
}

/** Semantic-contract §3.2 — Fact record. */
export const FACT_SHAPE = shape({
  fact_id: str(),
  statement: str(),
  source_ref: rec(sourceRefShape()),
  snapshot: str(),
  observed_kind: enumOf(OBSERVED_KINDS, "observed_kind"),
});

/** Semantic-contract §4.3 — Evidence record. */
export const EVIDENCE_SHAPE = shape({
  evidence_id: str(),
  evidence_kind: enumOf(EVIDENCE_KINDS, "evidence_kind"),
  source_ref: optRec(sourceRefShape(), FIELD_ABSENT),
  proves: str(),
  does_not_prove: arrayOf(str()),
  strength: enumOf(EVIDENCE_STRENGTHS, "strength"),
  boundary_coverage: arrayOf(enumOf(BOUNDARIES, "boundary_coverage")),
  mechanism: optStr(FIELD_ABSENT),
  locator: optStr(FIELD_ABSENT),
  pg_class: optStr(FIELD_ABSENT),
  e2e_class: optStr(FIELD_ABSENT),
  snapshot: str(),
  negative_evidence_basis: optEnum(
    NEGATIVE_EVIDENCE_BASES,
    "negative_evidence_basis",
    FIELD_ABSENT,
  ),
  search_scope: optStr(FIELD_ABSENT),
});

/** Semantic-contract §5.2 — Claim record. */
export const CLAIM_SHAPE = shape({
  claim_id: str(),
  subject: ref(ANY_NODE_NS),
  predicate: str(),
  value: str(),
  claim_kind: enumOf(CLAIM_KINDS, "claim_kind"),
  boundary: optEnum(BOUNDARIES, "boundary", FIELD_ABSENT),
  axes: rec(
    shape({
      design: optEnum(DESIGN_AXIS, "design", FIELD_ABSENT),
      implementation: optEnum(
        IMPLEMENTATION_AXIS,
        "implementation",
        FIELD_ABSENT,
      ),
      verification: optEnum(VERIFICATION_AXIS, "verification", FIELD_ABSENT),
      activation_support: optEnum(
        ACTIVATION_SUPPORT_AXIS,
        "activation_support",
        FIELD_ABSENT,
      ),
    }),
  ),
  authority_owner: sentinel(shape({ id: ref(["authority"]) }), ["UNKNOWN"]),
  supporting_evidence: arrayOf(str()),
  challenging_evidence: arrayOf(str()),
  // DERIVED from the cited refs (provenance §7.3); raw input may omit.
  freshness: optEnum(FRESHNESS_AXIS, "freshness", "UNKNOWN"),
  resolution: optEnum(CLAIM_RESOLUTION_AXIS, "resolution", "UNKNOWN"),
  resolution_causes: optArrayOf(str(), []),
  current_support_usable: optRec(
    shape({
      usable: enumOf(["YES", "NO"], "usable"),
      non_usable_refs: arrayOf(str()),
    }),
    FIELD_ABSENT,
  ),
  review_state: enumOf(REVIEW_STATE, "review_state"),
  open_governance_item: rec(governanceItemShape()),
  source_snapshot: str(),
});

/** Semantic-contract §12 — Conflict record. */
export const CONFLICT_SHAPE = shape({
  conflict_id: str(),
  kind: enumOf(CONFLICT_KINDS, "conflict.kind"),
  proposition: str(),
  parties: arrayOf(
    rec(
      shape({
        party: str(),
        claim_ref: optStr(""),
        statement: str(),
        source_refs: arrayOf(str()),
      }),
    ),
  ),
  resolution_status: enumOf(CONFLICT_RESOLUTION_STATUSES, "resolution_status"),
  open_governance_item: rec(governanceItemShape()),
  source_refs: arrayOf(str()),
});
