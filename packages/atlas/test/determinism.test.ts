/**
 * Determinism proofs (R1-A gate): byte-identical rebuilds across shuffled
 * enumeration order, defaults materialization, duplicate merge/conflict,
 * canonical ordering, and UNKNOWN ≠ NONE sentinel discipline.
 */

import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/snapshot/build.js";
import {
  normalizeRecords,
  SemanticConflictError,
} from "../src/canon/canonicalize.js";
import { canonicalJson } from "../src/canon/serialize.js";
import { buildRecordSchemas } from "../src/ir/validate.js";
import { EDGE_KINDS, NODE_KINDS } from "../src/ir/types.js";
import { MemoryRevisionView } from "../src/view/revision.js";
import {
  SHA,
  capabilityNode,
  claimRecord,
  emptyInput,
  evidenceRecord,
  facetNode,
  shuffle,
  sourceRef,
} from "./fixtures.js";

function richInput() {
  const input = emptyInput();
  input.nodes.push(
    capabilityNode({
      id: "capability:grading.manual",
      label: "Manual grading",
    }),
    facetNode({ id: "facet:grading.manual.retry", label: "Retry support" }),
    {
      kind: "Permission",
      id: "permission:grading.score.write",
      label: "Score write",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      key: "grading.score.write",
      catalog_status: "ACTIVE",
      preset_refs: [],
      consumed_by: [],
      inert: "UNKNOWN",
    },
    {
      kind: "RolePreset",
      id: "role:Grader",
      label: "Grader",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      key: "Grader",
      preset_kind: "APPLICATION_ROLE",
      login_allowed: "TRUE",
      assignable: "TRUE",
      permissions: ["permission:grading.score.write"],
      sensitive_permissions: ["permission:grading.score.write"],
    },
    {
      kind: "Workflow",
      id: "workflow:x",
      label: "Manual review workflow",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      capability_ref: "capability:grading.manual",
      step_count: 0,
    },
    {
      kind: "WorkItem",
      id: "work:jnhu76/exam#296",
      label: "Grader@Exam scoped authority",
      source_refs: [],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      work_kind: "ISSUE",
      external_ref: "jnhu76/exam#296",
      title: "Grader@Exam scoped authority and assignment flow",
      requested_scope: "the assignment dimension of the grading capability",
      closure_semantics: "CLOSED_IMPLEMENTED",
      state: "CLOSED",
    },
    {
      kind: "Operation",
      id: "operation:grading.grade-question",
      label: "Grade question",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      gate_kind: "RESOURCE_AWARE_CAPABILITY",
      authority_requirement: {
        capability_ref: { id: "permission:grading.score.write" },
        assignment_required: "TRUE",
        assignment_applies_to: ["!Admin"],
        enforcement_seam: "apps/api/src/authz/scopedCapability.ts",
        enforcement_evidence: "ev-seam",
      },
      state_prerequisites: ["attempt.status = submitted"],
      durable_effects: [
        {
          entity_ref: "entity:grading.entry",
          effect_kind: "WRITE",
          mutability: "APPEND_ONLY",
        },
      ],
      durable_effects_state: "ESTABLISHED",
      idempotency: "NOT_IDEMPOTENT",
      atomicity: "entry completion + terminal aggregation commit together",
    },
  );
  input.edges.push(
    {
      kind: "contains",
      source: "capability:grading.manual",
      target: "facet:grading.manual.retry",
    },
    {
      kind: "performs",
      source: "workflow:x",
      target: "operation:grading.grade-question",
      step_index: 0,
      optionality: "REQUIRED",
    },
    {
      kind: "requires_permission",
      source: "operation:grading.grade-question",
      target: "permission:grading.score.write",
    },
    {
      kind: "tracked_by",
      source: "capability:grading.manual",
      target: "work:jnhu76/exam#296",
      relation: "DELIVERS",
    },
  );
  input.evidence.push(
    evidenceRecord({ evidence_id: "ev-seam", boundary_coverage: ["B3"] }),
    evidenceRecord({
      evidence_id: "ev-2",
      evidence_kind: "TEST_INTEGRATION",
      strength: "BEHAVIOURAL_COMPOSITION",
      boundary_coverage: ["B2", "B4"],
      proves: "the closure commits atomically",
      does_not_prove: ["lock contention"],
    }),
  );
  input.claims.push(
    claimRecord({
      claim_id: "claim-grading",
      subject: "capability:grading.manual",
      supporting_evidence: ["ev-2"],
    }),
  );
  input.conflicts.push({
    conflict_id: "conflict-o07",
    kind: "DECLARED_VS_RUNTIME_DIVERGENCE",
    proposition: "declared registry coverage vs runtime route surface",
    parties: [
      {
        party: "DECLARED_METADATA",
        statement: "registry declares exhaustive intent",
        source_refs: ["loc-a"],
      },
      {
        party: "RUNTIME_OBSERVATION",
        statement: "capture counts differ",
        source_refs: ["loc-b"],
      },
    ],
    resolution_status: "UNRESOLVED",
    open_governance_item: { kind: "WORK_ITEM", ref: "work:jnhu76/exam#762" },
    source_refs: ["loc-a", "loc-b"],
  });
  return input;
}

describe("determinism (ATLAS-IR-060)", () => {
  it("two rebuilds of the same input produce byte-identical snapshots", () => {
    const input = richInput();
    const a = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur-1",
      "rf-1",
    );
    const b = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur-1",
      "rf-1",
    );
    expect(Buffer.from(a.bytes).toString("utf8")).toBe(
      Buffer.from(b.bytes).toString("utf8"),
    );
  });

  it("shuffled source enumeration produces the identical snapshot", () => {
    const input = richInput();
    const canonical = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    for (const rounds of [1, 2, 3]) {
      const shuffled = emptyInput();
      shuffled.nodes = shuffle(input.nodes, rounds);
      shuffled.edges = shuffle(input.edges, rounds);
      shuffled.evidence = shuffle(input.evidence, rounds);
      shuffled.claims = shuffle(input.claims, rounds);
      shuffled.conflicts = shuffle(input.conflicts, rounds);
      const output = buildSnapshot(
        shuffled,
        { bound: new MemoryRevisionView(SHA, new Map()) },
        "cur",
        "rf",
      );
      expect(Buffer.from(output.bytes).toString("utf8")).toBe(
        Buffer.from(canonical.bytes).toString("utf8"),
      );
    }
  });

  it("the manifest is deterministic: no wall clock, no working directory, no network", () => {
    const output = buildSnapshot(
      richInput(),
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const manifest = output.envelope.manifest;
    expect(Object.keys(manifest).sort()).toEqual([
      "curation_input_revision",
      "extractor",
      "git_sha",
      "ir_schema_version",
      "normalized_body_hash",
      "repo",
      "route_facts_digest",
      "snapshot_id",
      "source_ref_version",
    ]);
    expect(manifest.snapshot_id).toBe(
      `sref1-ir0.1-${SHA.slice(0, 8)}-${output.bodyHash.slice(0, 8)}`,
    );
  });

  it("volatile build metadata is absent from the semantic body", () => {
    const output = buildSnapshot(
      richInput(),
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const bodyText = canonicalJson(output.envelope.body);
    expect(bodyText).not.toMatch(/generated_at|duration|telemetry|timestamp/i);
  });
});

describe("duplicate handling (ATLAS-IR-065)", () => {
  it("agreeing duplicates merge deterministically; array fields union", () => {
    const base = richInput();
    const doubled = {
      ...base,
      nodes: [
        ...base.nodes,
        JSON.parse(JSON.stringify(base.nodes[0])) as Record<string, unknown>,
      ],
      evidence: [
        ...base.evidence,
        JSON.parse(JSON.stringify(base.evidence[0])) as Record<string, unknown>,
      ],
    };
    const result = normalizeRecords(doubled);
    expect(result.nodes).toHaveLength(base.nodes.length);
    expect(result.evidence).toHaveLength(base.evidence.length);
  });

  it("disagreeing single-valued duplicates are a conflict, never last-write-wins", () => {
    const base = richInput();
    const conflicting = JSON.parse(JSON.stringify(base.nodes[0])) as Record<
      string,
      unknown
    >;
    conflicting["label"] = "A different label";
    expect(() =>
      normalizeRecords({ ...base, nodes: [...base.nodes, conflicting] }),
    ).toThrow(SemanticConflictError);
    expect(() =>
      normalizeRecords({ ...base, nodes: [...base.nodes, conflicting] }),
    ).toThrow(/never last-write-wins/);
  });
});

describe("canonical normalization (ir §7)", () => {
  it("nodes are sorted by (kind, id); edges by (source, kind, target, discriminator)", () => {
    const result = normalizeRecords(richInput());
    const nodeKeys = result.nodes.map(
      (n) => `${String(n["kind"])}|${String(n["id"])}`,
    );
    expect(nodeKeys).toEqual([...nodeKeys].sort());
    const edgeKeys = result.edges.map(
      (e) =>
        `${String(e["source"])}|${String(e["kind"])}|${String(e["target"])}`,
    );
    expect(edgeKeys).toEqual([...edgeKeys].sort());
  });

  it("omitted optional fields and explicitly-default fields normalize to identical bytes", () => {
    const omitted = capabilityNode({});
    delete omitted["resolution_causes"];
    const explicit = capabilityNode({ resolution_causes: [] });
    const fields = buildRecordSchemas(NODE_KINDS, EDGE_KINDS).nodes.Capability;
    expect(canonicalJson(fields.applyDefaults(omitted))).toBe(
      canonicalJson(fields.applyDefaults(explicit)),
    );
  });

  it("UNKNOWN and NONE remain distinct, and unknown closed-set values are rejected", () => {
    const bad = capabilityNode({ mapping_state: "NOT_A_STATE" });
    expect(() => normalizeRecords({ ...richInput(), nodes: [bad] })).toThrow(
      /closed set/,
    );

    const scopeWithWrongSentinel = {
      kind: "Scope",
      id: "scope:exam.assignment",
      label: "Exam assignment",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      value: "exam",
      rbac_participation: "APPLICATION_SCOPE",
      resource_domain: "exam",
      // INVALID sentinel: NOT_APPLICABLE is not in the R0 sentinel set.
      assignment_carrier: "NOT_APPLICABLE",
      list_filtering: "TRUE",
    };
    expect(() =>
      normalizeRecords({ ...richInput(), nodes: [scopeWithWrongSentinel] }),
    ).toThrow(/sentinel/);
  });

  it("unknown fields are rejected — no free-text escape hatch (ATLAS-IR-071)", () => {
    const withNotes = capabilityNode({ notes: "why I think this is fine" });
    expect(() =>
      normalizeRecords({ ...richInput(), nodes: [withNotes] }),
    ).toThrow(/unknown field/);
  });

  it("identical parallel edges collapse; differently-qualified parallel edges stay distinct", () => {
    const edges = [
      {
        kind: "reads",
        source: "operation:a",
        target: "entity:e",
        effect_kind: "READ",
        mutability: "MUTABLE",
      },
      {
        kind: "reads",
        source: "operation:a",
        target: "entity:e",
        effect_kind: "READ",
        mutability: "MUTABLE",
      },
      {
        kind: "reads",
        source: "operation:a",
        target: "entity:e",
        effect_kind: "READ",
        mutability: "IMMUTABLE",
      },
    ];
    const result = normalizeRecords({
      ...emptyInput(),
      nodes: [],
      edges,
      facts: [],
      evidence: [],
      claims: [],
      conflicts: [],
    });
    expect(result.edges).toHaveLength(2);
  });
});

describe("derived fields are computed, not trusted (ATLAS-IR-003)", () => {
  it("Permission.inert and preset_refs are derived from the graph", () => {
    const output = buildSnapshot(
      richInput(),
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const permission = output.envelope.body.nodes.find(
      (n) => n["kind"] === "Permission",
    );
    expect(permission["preset_refs"]).toEqual(["role:Grader"]);
    // grading.score.write is required by the operation → CONSUMED.
    expect(permission["inert"]).toBe("CONSUMED");
    expect(permission["consumed_by"]).toContain(
      "operation:grading.grade-question",
    );
  });

  it("Workflow.step_count is derived from performs edges, overwriting hand-set values", () => {
    const input = richInput();
    const workflow = input.nodes.find((n) => n["id"] === "workflow:x");
    workflow["step_count"] = 999; // hand-set wrong value must be overwritten
    const output = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const derived = output.envelope.body.nodes.find(
      (n) => n["id"] === "workflow:x",
    );
    expect(derived["step_count"]).toBe(1);
  });

  it("a rich capability with mixed facets rolls up MIXED (golden A shape)", () => {
    const input = emptyInput();
    input.nodes.push(
      capabilityNode({
        id: "capability:content.rich",
        closed_search_statement: "none unmapped",
      }),
      facetNode({ id: "facet:content.rich.formula" }),
      facetNode({ id: "facet:content.rich.char-count" }),
    );
    input.edges.push(
      {
        kind: "contains",
        source: "capability:content.rich",
        target: "facet:content.rich.formula",
      },
      {
        kind: "contains",
        source: "capability:content.rich",
        target: "facet:content.rich.char-count",
      },
    );
    input.evidence.push(
      evidenceRecord({
        evidence_id: "ev-b4",
        boundary_coverage: ["B4"],
        strength: "BEHAVIOURAL_BROWSER",
      }),
      evidenceRecord({
        evidence_id: "ev-residual",
        boundary_coverage: ["B5"],
        strength: "OWNER_JUDGEMENT",
        negative_evidence_basis: "CURRENT_AUTHORITY_REJECTION",
        evidence_kind: "CONTRACT",
        proves: "authority rejects the facet",
      }),
    );
    input.claims.push(
      claimRecord({
        claim_id: "claim-core",
        subject: "facet:content.rich.formula",
        supporting_evidence: ["ev-b4"],
      }),
      claimRecord({
        claim_id: "claim-residual",
        subject: "facet:content.rich.char-count",
        value: "NOT_SUPPORTED",
        boundary: "B5",
        axes: {
          activation_support: "NOT_SUPPORTED",
          design: "REJECTED",
          verification: "PASS",
        },
        supporting_evidence: ["ev-residual"],
      }),
    );
    const bound = new MemoryRevisionView(
      SHA,
      new Map([["docs/example.md", "x"]]),
    );
    const output = buildSnapshot(input, { bound }, "cur", "rf");
    const capability = output.envelope.body.nodes.find(
      (n) => n["id"] === "capability:content.rich",
    );
    expect(capability["support_summary"]).toBe("MIXED");
  });
});
