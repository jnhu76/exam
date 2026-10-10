/**
 * Atlas IR v0.1 closed sets — executable implementation of the frozen R0
 * contract (`docs/architecture/atlas/ir-v0.1.md`, `semantic-contract.md`).
 *
 * This module is an IMPLEMENTATION of the R0 semantic contract, not a second
 * semantic authority. Every closed set here is pinned verbatim to R0 v0.1;
 * widening any of them is a contract regression (R1 handoff §3), not a code
 * change.
 *
 * `UNKNOWN` and `NONE` are distinct sentinels everywhere (ATLAS-IR-068):
 * `UNKNOWN` = required by the schema, not establishable; `NONE` = the concept
 * does not apply. Neither may be substituted for the other, and `null` is not
 * used in v0.1.
 */

/** §ir-v0.1 §2 — the 12 node kinds. */
export const NODE_KINDS = [
  "Capability",
  "Facet",
  "Workflow",
  "Operation",
  "Interface",
  "Permission",
  "RolePreset",
  "Scope",
  "PolicyValue",
  "DurableEntity",
  "NormativeAuthority",
  "WorkItem",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** §ir-v0.1 §5 — the 11 edge kinds (reads/writes counted separately). */
export const EDGE_KINDS = [
  "contains",
  "performs",
  "exposes",
  "requires_permission",
  "scoped_by",
  "reads",
  "writes",
  "governed_by",
  "tracked_by",
  "transitions_to",
  "depends_on",
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** Curated ID namespaces (§6.3): dot-separated curated local names. */
export const CURATED_NAMESPACES = [
  "capability",
  "facet",
  "workflow",
  "operation",
  "entity",
  "scope",
] as const;
/** Mirrored ID namespaces (§6.3): the owning source's key, verbatim. */
export const MIRRORED_NAMESPACES = [
  "permission",
  "role",
  "policy",
  "authority",
  "work",
] as const;

/** Semantic-contract §9.3 — boundary identifiers. Opaque, never a rank. */
export const BOUNDARIES = ["B0", "B1", "B2", "B3", "B4", "B5", "B6"] as const;
export type Boundary = (typeof BOUNDARIES)[number];

/** ir §4.1 — Capability/Facet mapping_state. Coverage, never support. */
export const MAPPING_STATE = [
  "MAPPED",
  "PARTIAL",
  "UNMAPPED",
  "UNKNOWN",
] as const;
export type MappingState = (typeof MAPPING_STATE)[number];

/**
 * ir §4.1 ATLAS-IR-032 — derived support_summary. `MIXED` exists so a
 * delivered core and a residual facet can coexist (ATLAS-IR-033).
 */
export const SUPPORT_SUMMARY = [
  "SUPPORTED",
  "MIXED",
  "GATED",
  "DEFERRED",
  "NOT_SUPPORTED",
  "UNKNOWN",
] as const;
export type SupportSummary = (typeof SUPPORT_SUMMARY)[number];

/** Semantic-contract §8 — the six independent status axes. */
export const DESIGN_AXIS = [
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "UNKNOWN",
] as const;
export const IMPLEMENTATION_AXIS = [
  "ABSENT",
  "PARTIAL",
  "PRESENT",
  "UNKNOWN",
] as const;
export const VERIFICATION_AXIS = [
  "PASS",
  "FAIL",
  "INSUFFICIENT",
  "UNKNOWN",
] as const;
export const ACTIVATION_SUPPORT_AXIS = [
  "SUPPORTED",
  "GATED",
  "DEFERRED",
  "NOT_SUPPORTED",
  "UNKNOWN",
] as const;
export const FRESHNESS_AXIS = ["CURRENT", "STALE", "UNKNOWN"] as const;
export const CLAIM_RESOLUTION_AXIS = [
  "RESOLVED",
  "STALE_REF",
  "MISSING_REF",
  "AMBIGUOUS",
  "CONFLICT",
  "UNKNOWN",
] as const;

export type DesignAxis = (typeof DESIGN_AXIS)[number];
export type ImplementationAxis = (typeof IMPLEMENTATION_AXIS)[number];
export type VerificationAxis = (typeof VERIFICATION_AXIS)[number];
export type ActivationSupport = (typeof ACTIVATION_SUPPORT_AXIS)[number];
export type Freshness = (typeof FRESHNESS_AXIS)[number];
export type ClaimResolution = (typeof CLAIM_RESOLUTION_AXIS)[number];

/** Semantic-contract §5.3 — claim_kind closed set. */
export const CLAIM_KINDS = [
  "CAPABILITY_SUPPORT",
  "DESIGN_STATUS",
  "IMPLEMENTATION_STATUS",
  "VERIFICATION_STATUS",
  "AUTHORIZATION_EFFECT",
  "AUTHORITY_STATEMENT",
  "DECLARED_METADATA",
  "RUNTIME_OBSERVATION",
  "DURABLE_EFFECT",
  "RESIDUAL_OR_EXCLUSION",
  "WORK_STATUS",
  "PROVENANCE_INTEGRITY",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** Semantic-contract §5.4 — Atlas's own curation workflow state. */
export const REVIEW_STATE = [
  "PROPOSED",
  "CURATED",
  "REVIEWED",
  "DISPUTED",
  "SUPERSEDED",
  "UNKNOWN",
] as const;
export type ReviewState = (typeof REVIEW_STATE)[number];

/** Semantic-contract §6.4 — who owns the gap. */
export const OPEN_GOVERNANCE_KINDS = [
  "NONE",
  "WORK_ITEM",
  "DECISION_GATED",
  "OWNER_UNRESOLVED",
  "UNKNOWN",
] as const;
export type OpenGovernanceKind = (typeof OPEN_GOVERNANCE_KINDS)[number];

/** Semantic-contract §8.2 observed_kind on a Fact. */
export const OBSERVED_KINDS = [
  "DECLARED",
  "RUNTIME",
  "DURABLE",
  "TEST_BEHAVIOUR",
  "DOCUMENT",
  "WORK_HISTORY",
] as const;
export type ObservedKind = (typeof OBSERVED_KINDS)[number];

/** Semantic-contract §4.2 — evidence_kind closed set. */
export const EVIDENCE_KINDS = [
  "STATIC_SOURCE",
  "RUNTIME_ROUTE_CAPTURE",
  "CONTRACT",
  "TEST_SEMANTIC",
  "TEST_INTEGRATION",
  "TEST_PHYSICAL",
  "PROCESS_RESTART",
  "HISTORICAL_WORK_ITEM",
  "HUMAN_REVIEW",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Semantic-contract §4.4 — mechanism grades, not adjectives. */
export const EVIDENCE_STRENGTHS = [
  "TOKEN_EXISTENCE",
  "READ_COMPATIBILITY",
  "BEHAVIOURAL_PURE",
  "BEHAVIOURAL_COMPOSITION",
  "BEHAVIOURAL_PHYSICAL",
  "BEHAVIOURAL_BROWSER",
  "PROCESS_LIFECYCLE",
  "OWNER_JUDGEMENT",
] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

/**
 * Machine representation of the ATLAS-SEM-084 positive-negative-evidence
 * bases. A `NOT_SUPPORTED` verdict is valid only when supported by evidence
 * carrying one of these bases — never from absent supporting claims.
 */
export const NEGATIVE_EVIDENCE_BASES = [
  "CURRENT_AUTHORITY_REJECTION",
  "CLOSED_ABSENCE_SEARCH",
  "PROVEN_REFUSAL",
] as const;
export type NegativeEvidenceBasis = (typeof NEGATIVE_EVIDENCE_BASES)[number];

/** Semantic-contract §6.3 — closure semantics for closed work items. */
export const CLOSURE_SEMANTICS = [
  "OPEN",
  "CLOSED_IMPLEMENTED",
  "CLOSED_NOT_PLANNED",
  "CLOSED_SUPERSEDED",
  "CLOSED_PARTIAL",
  "CLOSED_UNKNOWN",
] as const;
export type ClosureSemantics = (typeof CLOSURE_SEMANTICS)[number];

/** ir §3.12 / semantic-contract §6.2 — work item kinds. */
export const WORK_ITEM_KINDS = [
  "ISSUE",
  "PR",
  "DECISION_RECORD",
  "REVIEW",
] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

/** ir §5.8 tracked_by relation types. */
export const TRACKED_BY_RELATIONS = [
  "DELIVERS",
  "BLOCKS",
  "RESIDUAL",
  "DECISION_GATE",
] as const;
export type TrackedByRelation = (typeof TRACKED_BY_RELATIONS)[number];

/** Semantic-contract §12 — the six conflict kinds. */
export const CONFLICT_KINDS = [
  "AUTHORITY_CONFLICT",
  "DECLARED_VS_RUNTIME_DIVERGENCE",
  "EVIDENCE_CONTRADICTION",
  "LOCATOR_CONFLICT",
  "TEMPORAL_CONFLICT",
  "DOCUMENTATION_DISSONANCE",
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/** Semantic-contract §12 ATLAS-SEM-115 — conflict resolution statuses. */
export const CONFLICT_RESOLUTION_STATUSES = [
  "UNRESOLVED",
  "RESOLVED_BY_SCOPE",
  "RESOLVED_BY_SUPERSESSION",
  "RESOLVED_BY_CORRECTION",
  "RESOLVED_BY_DERIVATION",
] as const;
export type ConflictResolutionStatus =
  (typeof CONFLICT_RESOLUTION_STATUSES)[number];

/** ir §4.3 — Operation gate kinds. */
export const GATE_KINDS = [
  "CAPABILITY",
  "RESOURCE_AWARE_CAPABILITY",
  "AUTH_ONLY",
  "PUBLIC",
  "INTERNAL_SYNTHETIC",
  "UNKNOWN",
] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/** ir §4.5 — Interface seam kinds and declared/runtime divergence states. */
export const SEAM_KINDS = ["HTTP", "INTERNAL"] as const;
export type SeamKind = (typeof SEAM_KINDS)[number];
export const DECLARED_VS_RUNTIME = [
  "MATCH",
  "DECLARED_ONLY",
  "RUNTIME_ONLY",
  "DIVERGENT",
  "UNKNOWN",
] as const;
export type DeclaredVsRuntime = (typeof DECLARED_VS_RUNTIME)[number];

/** ir §4.6 — Permission catalog status and derived consumption state. */
export const CATALOG_STATUS = [
  "ACTIVE",
  "RESERVED",
  "DEPRECATED",
  "UNKNOWN",
] as const;
export type CatalogStatus = (typeof CATALOG_STATUS)[number];
export const PERMISSION_INERT = [
  "GRANTED_BUT_UNCONSUMED",
  "CONSUMED",
  "UNKNOWN",
] as const;
export type PermissionInert = (typeof PERMISSION_INERT)[number];

/** ir §4.7 — RolePreset kinds. */
export const PRESET_KINDS = ["APPLICATION_ROLE", "SYNTHETIC_ACTOR"] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

/** ir §4.8 — Scope RBAC participation. */
export const RBAC_PARTICIPATION = [
  "APPLICATION_SCOPE",
  "OUTSIDE_APPLICATION_RBAC",
] as const;
export type RbacParticipation = (typeof RBAC_PARTICIPATION)[number];

/** ir §4.9 — PolicyValue vocabulary classes. */
export const VOCABULARY_CLASSES = [
  "STATE",
  "MODE",
  "FLAG",
  "VISIBILITY",
  "POLICY_VALUE",
] as const;
export type VocabularyClass = (typeof VOCABULARY_CLASSES)[number];

/** Tri-state boolean: UNKNOWN is a value, never a blank (ATLAS-SEM-100). */
export const TRI_STATE = ["TRUE", "FALSE", "UNKNOWN"] as const;
export type TriState = (typeof TRI_STATE)[number];

/** ir §4.3 — Operation durable effect kinds. */
export const EFFECT_KINDS = [
  "READ",
  "WRITE",
  "MATERIALIZE",
  "PROJECT",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
export const MUTABILITY = [
  "MUTABLE",
  "IMMUTABLE",
  "APPEND_ONLY",
  "UNKNOWN",
] as const;
export type Mutability = (typeof MUTABILITY)[number];

/** ir §4.3 — Operation idempotency. */
export const IDEMPOTENCY = [
  "IDEMPOTENT",
  "SINGLE_WINNER",
  "NOT_IDEMPOTENT",
  "UNKNOWN",
] as const;
export type Idempotency = (typeof IDEMPOTENCY)[number];

/** ir §4.10 — DurableEntity physical carrier resolution. */
export const CARRIER_RESOLUTION = [
  "RESOLVED",
  "STALE",
  "MISSING",
  "AMBIGUOUS",
  "UNKNOWN",
] as const;
export type CarrierResolution = (typeof CARRIER_RESOLUTION)[number];

/** Semantic-contract §2.2 — authority status. */
export const AUTHORITY_STATUS = [
  "CURRENT",
  "HISTORICAL",
  "SUPERSEDED",
  "AMENDED",
  "UNKNOWN",
] as const;
export type AuthorityStatus = (typeof AUTHORITY_STATUS)[number];

/** ir §4.5 — in-handler additional gate effect. */
export const ADDITIONAL_GATE_EFFECTS = ["NARROW", "EXPAND"] as const;
export type AdditionalGateEffect = (typeof ADDITIONAL_GATE_EFFECTS)[number];

/** ir §5.9 — transition direction. */
export const TRANSITION_DIRECTIONS = ["ONE_WAY", "BIDIRECTIONAL"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/** ir §5.9 — per-transition reachability (closed-search result). */
export const TRANSITION_REACHABILITY = [
  "REACHABLE",
  "NOT_REACHABLE",
  "UNKNOWN",
] as const;
export type TransitionReachability = (typeof TRANSITION_REACHABILITY)[number];
