/**
 * R0-D regression inputs (R1 handoff §10) — permanent conformance tests.
 * These are the false inputs the R0 review actually discovered; they may
 * never be replaced with prose.
 */

import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/snapshot/build.js";
import { rollupSupport } from "../src/ir/rollup.js";
import { deriveClaimResolution } from "../src/sref/claimResolution.js";
import { usableAsCurrentEvidence } from "../src/sref/types.js";
import { NODE_TYPE_FIELDS } from "../src/ir/records.js";
import { MemoryRevisionView } from "../src/view/revision.js";
import {
  SHA,
  capabilityNode,
  claimRecord,
  emptyInput,
  evidenceRecord,
  facetNode,
  sourceRef,
} from "./fixtures.js";

describe("R0-D regression inputs", () => {
  it("A: mapping_state = UNMAPPED with zero parts rolls up UNKNOWN, never NOT_SUPPORTED", () => {
    const result = rollupSupport({
      mapping_state: "UNMAPPED",
      parts: [],
      support_boundary: "B4",
      closedSearchStatement: false,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(result.summary).toBe("UNKNOWN");
    expect(result.clause).toBe(0);
  });

  it("B: a zero-part capability is never vacuously SUPPORTED", () => {
    const result = rollupSupport({
      mapping_state: "MAPPED",
      parts: [],
      support_boundary: "B4",
      closedSearchStatement: true,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(result.summary).not.toBe("SUPPORTED");
    expect(result.summary).toBe("UNKNOWN");
    expect(result.clause).toBe(5);
  });

  it("C: a facet with UNKNOWN support blocks the parent roll-up at SUPPORTED", () => {
    const result = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "facet:x",
          support: {
            activation_support: "UNKNOWN",
            verification: "UNKNOWN",
            boundary: "B4",
            evidenceAdequateForDeclaredBoundary: true,
          },
          hasAcceptedDesign: false,
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: true,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(result.summary).toBe("UNKNOWN");
    expect(result.clause).toBe(0);
  });

  it("D: facet evidenced only at B3 cannot boundary-launder a B4 parent to SUPPORTED", () => {
    const result = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "facet:x",
          support: {
            activation_support: "SUPPORTED",
            verification: "PASS",
            boundary: "B3",
            evidenceAdequateForDeclaredBoundary: true,
          },
          hasAcceptedDesign: false,
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: true,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(result.summary).not.toBe("SUPPORTED");
    // At B4 nothing qualifies: neither MIXED (needs one qualifier at B4)
    // nor SUPPORTED. The honest outcome is UNKNOWN, not laundering.
    expect(result.summary).toBe("UNKNOWN");
  });

  it("E: NOT_SUPPORTED without positive negative evidence is invalid/UNKNOWN", () => {
    // The roll-up: without negative evidence the capability falls to clause 5.
    const result = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "capability:x",
          support: {
            activation_support: "NOT_SUPPORTED",
            verification: "INSUFFICIENT",
            boundary: "B4",
            evidenceAdequateForDeclaredBoundary: true,
          },
          hasAcceptedDesign: false,
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: false,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(result.summary).not.toBe("NOT_SUPPORTED");
    expect(result.summary).toBe("UNKNOWN");

    // The builder: a NOT_SUPPORTED claim whose evidence carries no
    // negative-evidence basis is rejected outright (ATLAS-SEM-084).
    const input = emptyInput();
    input.nodes.push(
      capabilityNode({ mapping_state: "UNMAPPED", mapping_basis: undefined }),
    );
    input.claims.push(
      claimRecord({
        subject: "capability:test.thing",
        axes: {
          activation_support: "NOT_SUPPORTED",
          verification: "INSUFFICIENT",
        },
        value: "NOT_SUPPORTED",
        supporting_evidence: ["ev-1"],
      }),
    );
    input.evidence.push(evidenceRecord()); // STATIC_SOURCE, no negative basis
    expect(() =>
      buildSnapshot(
        input,
        { bound: new MemoryRevisionView(SHA, new Map()) },
        "cur",
        "rf",
      ),
    ).toThrow(/ATLAS-SEM-084/);
  });

  it("F: RESOLVED + freshness STALE keeps resolution RESOLVED, freshness STALE, current_support_usable NO", () => {
    const ref = sourceRef({
      resolution_state: "RESOLVED",
      repo_freshness: "STALE",
    });
    const derivation = deriveClaimResolution([ref]);
    expect(derivation.resolution).toBe("RESOLVED");
    expect(derivation.freshness).toBe("STALE");
    expect(derivation.current_support_usable.usable).toBe("NO");
    expect(derivation.current_support_usable.non_usable_refs).toHaveLength(1);
  });

  it("G: a HISTORICAL ref with CURRENT freshness is still not usable as current evidence", () => {
    const ref = sourceRef({
      resolution_state: "HISTORICAL",
      historical: true,
      repo_freshness: "CURRENT",
    });
    expect(usableAsCurrentEvidence(ref)).toBe(false);
    const derivation = deriveClaimResolution([ref]);
    expect(derivation.current_support_usable.usable).toBe("NO");
    // ...but it remains usable as evidence about the bound revision/past.
    expect(derivation.resolution).toBe("RESOLVED");
  });

  it("H: a shape/representability claim vs an activation-legality claim is not automatically a conflict", () => {
    const input = emptyInput();
    input.nodes.push(capabilityNode({ id: "capability:exam.timing" }));
    input.claims.push(
      claimRecord({
        claim_id: "claim-shape",
        subject: "capability:exam.timing",
        predicate: "representable",
        value: "TRUE",
        claim_kind: "IMPLEMENTATION_STATUS",
        boundary: "B1",
        axes: { implementation: "PRESENT", verification: "PASS" },
        supporting_evidence: ["ev-shape"],
      }),
      claimRecord({
        claim_id: "claim-activation",
        subject: "capability:exam.timing",
        predicate: "activation_support",
        value: "GATED",
        claim_kind: "CAPABILITY_SUPPORT",
        boundary: "B4",
        axes: { activation_support: "GATED", verification: "INSUFFICIENT" },
        supporting_evidence: ["ev-activation"],
      }),
    );
    input.evidence.push(
      evidenceRecord({
        evidence_id: "ev-shape",
        evidence_kind: "CONTRACT",
        strength: "OWNER_JUDGEMENT",
        boundary_coverage: ["B1"],
      }),
      evidenceRecord({
        evidence_id: "ev-activation",
        evidence_kind: "CONTRACT",
        strength: "OWNER_JUDGEMENT",
        boundary_coverage: ["B4"],
        negative_evidence_basis: "CURRENT_AUTHORITY_REJECTION",
      }),
    );
    const output = buildSnapshot(
      input,
      {
        bound: new MemoryRevisionView(SHA, new Map([["docs/example.md", "x"]])),
      },
      "cur",
      "rf",
    );
    // Different propositions on different boundaries coexist; the model does
    // not mint a DECLARED_VS_RUNTIME_DIVERGENCE or any conflict from them.
    expect(output.envelope.body.conflicts).toHaveLength(0);
    expect(output.envelope.body.claims).toHaveLength(2);
  });

  it("I: declared-exhaustive metadata vs contradictory runtime capture stays DECLARED_VS_RUNTIME_DIVERGENCE", () => {
    const input = emptyInput();
    input.nodes.push({
      kind: "Interface",
      id: "interface:http.GET./api/example",
      label: "Example",
      source_refs: [sourceRef()],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      seam_kind: "HTTP",
      contract_identity: "GET /api/example",
      declared: {
        source_ref: "declared-locator",
        permission_ref: "permission:exam.view",
      },
      runtime_observation: {
        capture_ref: "capture-1",
        permission_ref: "permission:exam.edit",
      },
      declared_vs_runtime: "DIVERGENT",
      additional_gates: [],
    });
    const output = buildSnapshot(
      input,
      {
        bound: new MemoryRevisionView(SHA, new Map([["docs/example.md", "x"]])),
      },
      "cur",
      "rf",
    );
    const iface = output.envelope.body.nodes[0];
    expect(iface["declared_vs_runtime"]).toBe("DIVERGENT");
  });

  it("J: RolePreset carries no resource-reach field — preset membership can never express global access", () => {
    const rolePresetFields = Object.keys(NODE_TYPE_FIELDS.RolePreset);
    // ATLAS-IR-039: resource reach exists only as Operation.authority_requirement.
    expect(rolePresetFields).toEqual([
      "key",
      "preset_kind",
      "login_allowed",
      "assignable",
      "default_scope",
      "permissions",
      "sensitive_permissions",
    ]);
    expect(
      rolePresetFields.some((f) => f.toLowerCase().includes("resource")),
    ).toBe(false);
    expect(
      rolePresetFields.some((f) => f.toLowerCase().includes("reach")),
    ).toBe(false);
  });

  it("facet with all parts SUPPORTED at the boundary + closed search rolls up SUPPORTED (clause 2 happy path)", () => {
    const result = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "facet:x",
          support: {
            activation_support: "SUPPORTED",
            verification: "PASS",
            boundary: "B4",
            evidenceAdequateForDeclaredBoundary: true,
          },
          hasAcceptedDesign: false,
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: true,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(result.summary).toBe("SUPPORTED");
    expect(result.clause).toBe(2);
  });

  it("GATED vs DEFERRED differ by the named carrier (ATLAS-SEM-072)", () => {
    const gated = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "policy:x",
          support: undefined,
          hasAcceptedDesign: true,
          decisionGate: {
            locator: "authority:policy-doc",
            lift_condition: "explicit activation decision",
          },
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: false,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(gated.summary).toBe("GATED");
    expect(gated.basis).toContain("explicit activation decision");

    const deferred = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "policy:y",
          support: undefined,
          hasAcceptedDesign: true,
          owningWorkItem: "work:jnhu76/exam#756",
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: false,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(deferred.summary).toBe("DEFERRED");
    expect(deferred.basis).toContain("work:jnhu76/exam#756");
  });

  it("NOT_SUPPORTED requires positive negative evidence even in the roll-up (clause 4)", () => {
    const without = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "capability:x",
          support: undefined,
          hasAcceptedDesign: false,
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: false,
      positiveNegativeEvidenceAtBoundary: false,
    });
    expect(without.summary).toBe("UNKNOWN");

    const with_ = rollupSupport({
      mapping_state: "MAPPED",
      parts: [
        {
          partId: "capability:x",
          support: undefined,
          hasAcceptedDesign: false,
        },
      ],
      support_boundary: "B4",
      closedSearchStatement: false,
      positiveNegativeEvidenceAtBoundary: true,
    });
    expect(with_.summary).toBe("NOT_SUPPORTED");
    expect(with_.clause).toBe(4);
  });
});
