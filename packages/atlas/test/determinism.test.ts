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
  factRecord,
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
      kind: "contains",
      source: "facet:grading.manual.retry",
      target: "workflow:x",
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
  input.facts.push(
    factRecord({
      fact_id: "fact-grading-route",
      statement:
        "the registry declares the grading route under the grading capability",
      observed_kind: "DECLARED",
    }),
    factRecord({
      fact_id: "fact-grading-write",
      statement:
        "the grading command writes the grading entry in one transaction",
      observed_kind: "DURABLE",
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
      shuffled.facts = shuffle(input.facts, rounds);
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

describe("intra-record set order is not semantic (ATLAS-IR-063/067)", () => {
  it("reversing set-valued fields inside records leaves the bytes identical", () => {
    const input = richInput();
    const claimSide = input.claims.find(
      (c) => c["claim_id"] === "claim-grading",
    )!;
    claimSide["supporting_evidence"] = ["ev-2", "ev-seam"];
    const evidenceSide = input.evidence.find(
      (e) => e["evidence_id"] === "ev-2",
    )!;
    evidenceSide["boundary_coverage"] = ["B4", "B3", "B2"];
    const graded = input.nodes.find((n) => n["kind"] === "RolePreset")!;
    graded["permissions"] = [
      "permission:grading.score.write",
      "permission:grading.queue.view",
    ];
    graded["sensitive_permissions"] = [
      "permission:grading.queue.view",
      "permission:grading.score.write",
    ];
    input.conflicts[0]!["source_refs"] = ["loc-b", "loc-a"];
    const bound = new MemoryRevisionView(SHA, new Map());
    const canonical = buildSnapshot(input, { bound }, "cur", "rf");

    const permuted = JSON.parse(JSON.stringify(input)) as typeof input;
    for (const claim of permuted.claims) {
      const list = claim["supporting_evidence"];
      if (Array.isArray(list))
        claim["supporting_evidence"] = [...list].reverse();
    }
    for (const evidence of permuted.evidence) {
      const list = evidence["boundary_coverage"];
      if (Array.isArray(list))
        evidence["boundary_coverage"] = [...list].reverse();
    }
    for (const node of permuted.nodes) {
      for (const field of ["permissions", "sensitive_permissions"]) {
        const list = node[field];
        if (Array.isArray(list)) node[field] = [...list].reverse();
      }
    }
    for (const conflict of permuted.conflicts) {
      const refs = conflict["source_refs"];
      if (Array.isArray(refs)) conflict["source_refs"] = [...refs].reverse();
      const parties = conflict["parties"];
      if (Array.isArray(parties)) conflict["parties"] = [...parties].reverse();
    }
    const other = buildSnapshot(permuted, { bound }, "cur", "rf");
    expect(Buffer.from(other.bytes).toString("utf8")).toBe(
      Buffer.from(canonical.bytes).toString("utf8"),
    );
    // …and the rendered order is the canonical one, not the input's.
    const rendered = other.envelope.body.evidence.find(
      (e) => e["evidence_id"] === "ev-2",
    );
    expect(rendered!["boundary_coverage"]).toEqual(["B2", "B3", "B4"]);
    const renderedConflict = other.envelope.body.conflicts[0]!;
    expect(
      (renderedConflict["parties"] as Array<Record<string, unknown>>).map(
        (p) => p["party"],
      ),
    ).toEqual(["DECLARED_METADATA", "RUNTIME_OBSERVATION"]);
  });

  it("free-prose lists keep the author's order — they are content, not enumeration", () => {
    const input = richInput();
    const evidence = input.evidence.find((e) => e["evidence_id"] === "ev-2")!;
    evidence["does_not_prove"] = [
      "lock contention",
      "that the seam fails closed when the assignment lookup is unavailable",
    ];
    const output = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const rendered = output.envelope.body.evidence.find(
      (e) => e["evidence_id"] === "ev-2",
    );
    expect(rendered!["does_not_prove"]).toEqual([
      "lock contention",
      "that the seam fails closed when the assignment lookup is unavailable",
    ]);
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
    input.nodes.push({
      kind: "WorkItem",
      id: "work:jnhu76/exam#900",
      label: "Rich follow-up",
      source_refs: [],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      work_kind: "ISSUE",
      external_ref: "jnhu76/exam#900",
      title: "Rich follow-up",
      requested_scope: "rich content",
      closure_semantics: "OPEN",
      state: "OPEN",
    });
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
      {
        kind: "tracked_by",
        source: "capability:content.rich",
        target: "work:jnhu76/exam#900",
        relation: "DELIVERS",
      },
      {
        kind: "tracked_by",
        source: "facet:content.rich.formula",
        target: "work:jnhu76/exam#900",
        relation: "DELIVERS",
      },
      {
        kind: "tracked_by",
        source: "facet:content.rich.char-count",
        target: "work:jnhu76/exam#900",
        relation: "RESIDUAL",
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

  it("a hand-set support_summary cannot survive the IR-032 roll-up", () => {
    const input = richInput();
    // One qualifying capability-level claim at B4 plus one non-qualifying
    // facet part is clause 1: MIXED must be rendered. A curator writing
    // SUPPORTED by hand must not survive derivation.
    const capability = input.nodes.find(
      (n) => n["id"] === "capability:grading.manual",
    )!;
    capability["support_summary"] = "SUPPORTED";
    const bound = new MemoryRevisionView(
      SHA,
      new Map([["docs/example.md", "x"]]),
    );
    const output = buildSnapshot(input, { bound }, "cur", "rf");
    const derived = output.envelope.body.nodes.find(
      (n) => n["id"] === "capability:grading.manual",
    );
    expect(derived!["support_summary"]).toBe("MIXED");
  });

  it("a hand-set PolicyValue.activation_status cannot survive ATLAS-IR-040a", () => {
    const input = richInput();
    input.nodes.push({
      kind: "PolicyValue",
      id: "policy:exam.timingMode/timed_sync",
      label: "typed sync mode",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      value: "timed_sync",
      vocabulary_class: "MODE",
      representable: "TRUE",
      storable: "TRUE",
      write_reachable: "FALSE",
      read_compatible: "TRUE",
      activation_status: "SUPPORTED", // hand-set: derives from the claim instead
      activation_claim_ref: "claim-policy",
      activation_gate: {
        locator: "docs/SPEC.md:292",
        lift_condition: "an explicit activation decision by the product owner",
      },
      refusing_seams: ["canonical authoring validator", "publish guard"],
    });
    input.claims.push(
      claimRecord({
        claim_id: "claim-policy",
        subject: "policy:exam.timingMode/timed_sync",
        value: "GATED",
        boundary: "B4",
        axes: {
          design: "ACCEPTED",
          implementation: "PARTIAL",
          verification: "PASS",
          activation_support: "GATED",
        },
        supporting_evidence: ["ev-2"],
      }),
    );
    const output = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const policy = output.envelope.body.nodes.find(
      (n) => n["id"] === "policy:exam.timingMode/timed_sync",
    );
    expect(policy!["activation_status"]).toBe("GATED");
  });

  it("a PolicyValue with no owning claim records UNKNOWN, never a stale value", () => {
    const input = richInput();
    input.nodes.push({
      kind: "PolicyValue",
      id: "policy:attempt.status/voided",
      label: "voided",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      value: "voided",
      vocabulary_class: "STATE",
      representable: "TRUE",
      storable: "TRUE",
      write_reachable: "FALSE",
      read_compatible: "TRUE",
      activation_status: "NOT_SUPPORTED", // no claim owns it
      refusing_seams: ["no production writer"],
    });
    const output = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const policy = output.envelope.body.nodes.find(
      (n) => n["id"] === "policy:attempt.status/voided",
    );
    expect(policy!["activation_status"]).toBe("UNKNOWN");
  });
});

describe("ATLAS-IR-080 — a MAPPED part must carry a sanctioned mapping", () => {
  it("MAPPED with no operation path and no work item is a build error", () => {
    const input = emptyInput();
    input.nodes.push(capabilityNode({ id: "capability:prose.only" }));
    expect(() =>
      buildSnapshot(
        input,
        { bound: new MemoryRevisionView(SHA, new Map()) },
        "cur",
        "rf",
      ),
    ).toThrow(/ATLAS-IR-080/);
  });

  it("PARTIAL without a sanctioned mapping is a reported finding, never dropped", () => {
    const input = emptyInput();
    input.nodes.push(
      capabilityNode({
        id: "capability:partial.only",
        mapping_state: "PARTIAL",
      }),
    );
    const output = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const finding = output.findings.find((f) => f.code === "ATLAS-IR-080");
    expect(finding).toBeDefined();
    expect(String(finding!.path)).toBe("capability:partial.only");
    // An incomplete mapping yields no aggregate verdict (clause 0).
    expect(output.envelope.body.nodes[0]!["support_summary"]).toBe("UNKNOWN");
  });
});

describe("ATLAS-SEM-071 — a gate must name its lift condition", () => {
  function gatedInput(liftCondition: string): ReturnType<typeof emptyInput> {
    const input = emptyInput();
    input.nodes.push(
      capabilityNode({ id: "capability:runtime.candidate-exam" }),
      {
        kind: "WorkItem",
        id: "work:jnhu76/exam#302",
        label: "Submit barrier",
        source_refs: [],
        authority_refs: [],
        review_state: "PROPOSED",
        open_governance_item:
          liftCondition === ""
            ? { kind: "WORK_ITEM", ref: "work:jnhu76/exam#302" }
            : { kind: "DECISION_GATED", lift_condition: liftCondition },
        work_kind: "ISSUE",
        external_ref: "jnhu76/exam#302",
        title: "Submit barrier",
        requested_scope: "submit",
        closure_semantics: "CLOSED_SUPERSEDED",
        state: "CLOSED",
      },
    );
    input.edges.push({
      kind: "tracked_by",
      source: "capability:runtime.candidate-exam",
      target: "work:jnhu76/exam#302",
      relation: "DECISION_GATE",
    });
    return input;
  }

  it("a gate whose work item states no lift condition cannot yield GATED", () => {
    // A closed, superseded work item is not a decision gate: without a lift
    // condition there is nothing to name, so no verdict may be manufactured.
    expect(() =>
      buildSnapshot(
        gatedInput(""),
        { bound: new MemoryRevisionView(SHA, new Map()) },
        "cur",
        "rf",
      ),
    ).toThrow(/lift condition/);
  });

  it("a gate with a stated lift condition rolls the capability up as GATED", () => {
    const output = buildSnapshot(
      gatedInput("an explicit activation decision by the product owner"),
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const capability = output.envelope.body.nodes.find(
      (n) => n["id"] === "capability:runtime.candidate-exam",
    );
    expect(capability!["support_summary"]).toBe("GATED");
  });
});
