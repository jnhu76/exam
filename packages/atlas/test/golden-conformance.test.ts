/**
 * R1-C golden conformance — the four frozen slice outcomes, the anti-demo
 * inventory rules, and snapshot freeze integrity, proven against the REAL
 * curation bundle and the committed route-facts capture.
 *
 * PROTOCOL — the freeze binds at the OBSERVED revision (the committed
 * snapshot's manifest.git_sha), never at HEAD: committing the snapshot moves
 * HEAD, so a HEAD-bound rebuild could never equal the committed bytes
 * (SOURCE_SHA ≠ final PR HEAD, handoff §0). The freeze test additionally
 * proves the observation is still current: no product-tree drift between the
 * recorded revision and HEAD. A drifted anchor (renamed test, moved section)
 * fails here, which is the freeze semantics working — curation must be
 * re-anchored deliberately.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildAtlasInput,
  curationInputRevisionOf,
  loadCurationInputs,
} from "../src/curation/assemble.js";
import { deriveO07Divergence, type RouteFacts } from "../src/extract/routes.js";
import { buildSnapshot } from "../src/snapshot/build.js";
import { canonicalJson, sha256Hex } from "../src/canon/serialize.js";
import {
  CompositeRevisionView,
  GitRevisionView,
} from "../src/view/revision.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const COMMITTED = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "generated", "atlas-snapshot.json"), "utf8"),
) as {
  manifest: { git_sha: string; curation_input_revision: string };
};
const SOURCE_SHA = COMMITTED.manifest.git_sha;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

function assemble() {
  const routeFacts = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "input", "route-facts.json"), "utf8"),
  ) as RouteFacts;
  const curation = loadCurationInputs(join(PACKAGE_ROOT, "curation"));
  return {
    routeFacts,
    curation,
    assembled: buildAtlasInput({
      repo: "jnhu76/exam",
      sourceSha: SOURCE_SHA,
      curation,
      routeFacts,
    }),
  };
}

function buildFresh() {
  const { assembled, curation, routeFacts } = assemble();
  const bound = new CompositeRevisionView(
    SOURCE_SHA,
    new GitRevisionView(SOURCE_SHA, REPO_ROOT),
    "packages/atlas/",
    REPO_ROOT,
  );
  return {
    assembled,
    routeFacts,
    envelope: buildSnapshot(
      assembled,
      { bound },
      curationInputRevisionOf(curation),
      sha256Hex(canonicalJson(routeFacts)),
    ).envelope,
  };
}

// The full snapshot build (AST ref resolution over ~300 refs) is far slower
// than the default 5s test timeout under root-suite parallel load, so the
// shared build runs once in a generously-timed beforeAll.
let cached: ReturnType<typeof buildFresh> | undefined;
beforeAll(() => {
  cached ??= buildFresh();
}, 240_000);
function built(): ReturnType<typeof buildFresh> {
  if (cached === undefined) throw new Error("snapshot build not ready");
  return cached;
}

function node(id: string): Record<string, unknown> {
  const hit = built().envelope.body.nodes.find((n) => n["id"] === id);
  if (hit === undefined) throw new Error(`node ${id} missing from snapshot`);
  return hit;
}

function claim(id: string): Record<string, unknown> {
  const hit = built().envelope.body.claims.find((c) => c["claim_id"] === id);
  if (hit === undefined) throw new Error(`claim ${id} missing from snapshot`);
  return hit;
}

function conflict(id: string): Record<string, unknown> {
  const hit = built().envelope.body.conflicts.find(
    (c) => c["conflict_id"] === id,
  );
  if (hit === undefined) throw new Error(`conflict ${id} missing`);
  return hit;
}

describe("golden slice A — rich subjective content (MIXED, not flattened)", () => {
  it("rolls the capability up as MIXED at B4 with every facet verdict rendered", () => {
    expect(node("capability:content.rich-subjective")["support_summary"]).toBe(
      "MIXED",
    );
    expect(node("capability:content.rich-subjective")["support_boundary"]).toBe(
      "B4",
    );
    expect(node("facet:content.rich.formula")["support_summary"]).toBe(
      "SUPPORTED",
    );
    // A-C6: table/code are declared at B3 — component-level tests are the
    // boundary their evidence covers; boundary laundering to B4 is closed.
    expect(node("facet:content.rich.table")["support_boundary"]).toBe("B3");
    expect(node("facet:content.rich.table")["support_summary"]).toBe(
      "SUPPORTED",
    );
    expect(node("facet:content.rich.code")["support_summary"]).toBe(
      "SUPPORTED",
    );
    expect(node("facet:content.rich.typed-shortcuts")["support_summary"]).toBe(
      "NOT_SUPPORTED",
    );
    expect(node("facet:content.rich.char-count")["support_summary"]).toBe(
      "NOT_SUPPORTED",
    );
    expect(node("facet:content.rich.attachments")["support_summary"]).toBe(
      "NOT_SUPPORTED",
    );
    expect(
      node("facet:content.rich.visual-source-sync")["support_summary"],
    ).toBe("DEFERRED");
  });

  it("keeps A-16 REJECTED and never optimizes A-11/A-15 away from UNKNOWN", () => {
    expect(claim("A-16")["value"]).toBe("REJECTED");
    expect(claim("A-11")["value"]).toBe("MIXED");
    expect(claim("A-11")["resolution"]).toBe("UNKNOWN");
    expect(claim("A-15")["resolution"]).toBe("UNKNOWN");
  });

  it("preserves the A-K2 temporal conflict unresolved", () => {
    expect(conflict("A-K2")["resolution_status"]).toBe("UNRESOLVED");
  });
});

describe("golden slice B — manual grading trace", () => {
  it("rolls grading.manual up as MIXED with its boundary rendered", () => {
    expect(node("capability:grading.manual")["support_summary"]).toBe("MIXED");
    expect(node("capability:grading.manual")["support_boundary"]).toBe("B4");
  });

  it("resolves the authority chain: authority → workflow → operations", () => {
    const edges = built().envelope.body.edges;
    const governed = edges.filter(
      (e) =>
        e["kind"] === "governed_by" &&
        String(e["target"]).startsWith("authority:"),
    );
    expect(governed.length).toBeGreaterThan(0);
    const gradingWorkflow = built().envelope.body.nodes.find(
      (n) => n["kind"] === "Workflow" && String(n["id"]).includes("grading"),
    );
    expect(gradingWorkflow).toBeDefined();
    const performed = edges.filter(
      (e) => e["source"] === gradingWorkflow!["id"] && e["kind"] === "performs",
    );
    expect(performed.length).toBeGreaterThan(0);
  });

  it("keeps the B-K2 declared-vs-runtime divergence unresolved", () => {
    expect(conflict("B-K2")["resolution_status"]).toBe("UNRESOLVED");
  });
});

describe("golden slice C — RBAC: preset ≠ effective authorization", () => {
  it("never carries grantee sets on any RolePreset", () => {
    const presets = built().envelope.body.nodes.filter(
      (n) => n["kind"] === "RolePreset",
    );
    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      for (const key of Object.keys(preset)) {
        expect(String(key)).not.toMatch(/grantee|members?\b|user_ids|actors/);
      }
      // A preset names a scope KIND (snake_case kind words allowed), never
      // resource reach — no second colon, no path segments (ATLAS-IR-092).
      expect(preset["default_scope"]).toMatch(/^scope:[a-z][a-zA-Z0-9_]*$/);
    }
  });

  it("re-derives O-07 from the capture: zero declared-only orphans (no hardcoded counts)", () => {
    const { routeFacts, assembled } = built();
    const recomputed = deriveO07Divergence(routeFacts);
    expect(assembled.o07["runtime_only_protected"]).toEqual(
      recomputed.runtime_only_protected,
    );
    expect(assembled.o07["declared_only_orphans"]).toEqual(
      recomputed.declared_only_orphans,
    );
    // Structural invariant, not a count: every declared entry matches a
    // protected runtime route (O-07 is one-directional).
    expect(recomputed.declared_only_orphans).toHaveLength(0);
    expect(recomputed.runtime_only_protected.length).toBeGreaterThan(0);
    // The snapshot pins the capture cryptographically; the counts in the
    // committed coverage report must match the same capture.
    const manifest = built().envelope.manifest;
    expect(manifest["route_facts_digest"]).toBe(
      sha256Hex(canonicalJson(routeFacts)),
    );
    const coverage = JSON.parse(
      readFileSync(
        join(PACKAGE_ROOT, "generated", "coverage-report.json"),
        "utf8",
      ),
    ) as Record<string, number>;
    expect(coverage["runtime_routes_total"]).toBe(routeFacts.routes.length);
    expect(coverage["registry_entries"]).toBe(routeFacts.registry.length);
    expect(coverage["runtime_only_protected"]).toBe(
      recomputed.runtime_only_protected.length,
    );
    expect(coverage["declared_only_orphans"]).toBe(0);
  });

  it("classifies every in-handler additional gate (ATLAS-IR-091 gate)", () => {
    expect(built().assembled.ir091Findings).toHaveLength(0);
    const patched = built().envelope.body.nodes.filter(
      (n) =>
        n["kind"] === "Interface" &&
        Array.isArray(n["additional_gates"]) &&
        (n["additional_gates"] as unknown[]).length > 0,
    );
    expect(patched.length).toBeGreaterThanOrEqual(4);
    for (const iface of patched) {
      expect(iface["declared_vs_runtime"]).not.toBe("DECLARED_ONLY");
    }
  });

  it("preserves C-K1 (registry vs runtime) unresolved and owned by #762", () => {
    const c = conflict("C-K1");
    expect(c["resolution_status"]).toBe("UNRESOLVED");
    const openItem = c["open_governance_item"] as Record<string, unknown>;
    expect(openItem["ref"]).toBe("work:jnhu76/exam#762");
  });
});

describe("golden slice D — timed_sync negative control (GATED, non-bypassable)", () => {
  const POLICY = "policy:exam.timingMode/timed_sync";

  it("derives activation_status GATED from the owning claim, with refusing seams", () => {
    const policy = node(POLICY);
    expect(policy["activation_status"]).toBe("GATED");
    expect(policy["activation_claim_ref"]).toBe("D-04");
    // ATLAS-IR-041: GATED with an empty seam list is a defect.
    const seams = policy["refusing_seams"] as string[];
    expect(seams.length).toBeGreaterThanOrEqual(2);
    const gate = policy["activation_gate"] as Record<string, unknown>;
    expect(String(gate["locator"]).length).toBeGreaterThan(0);
    expect(String(gate["lift_condition"]).length).toBeGreaterThan(0);
  });

  it("never records a SUPPORTED claim for timed_sync", () => {
    const dClaims = built().envelope.body.claims.filter(
      (c) => c["subject"] === POLICY,
    );
    expect(dClaims.length).toBeGreaterThan(0);
    for (const c of dClaims) {
      const axes = c["axes"] as Record<string, unknown> | undefined;
      const activation = axes?.["activation_support"] ?? c["value"];
      expect(activation).not.toBe("SUPPORTED");
    }
  });

  it("keeps the REJECTED false-support traps on record (D-07/D-08)", () => {
    expect(claim("D-07")["value"]).toBe("REJECTED");
    expect(claim("D-08")["value"]).toBe("REJECTED");
  });

  it("grounds the writer absence in a closed search with stated scope", () => {
    const evidence = built().envelope.body.evidence.find(
      (e) => e["evidence_id"] === "ev-ts-writer-absence",
    );
    expect(evidence).toBeDefined();
    expect(evidence!["negative_evidence_basis"]).toBe("CLOSED_ABSENCE_SEARCH");
    expect(String(evidence!["search_scope"]).length).toBeGreaterThan(0);
  });

  it("resolves D-K3 by scope and keeps D-K1 dissonance visible", () => {
    expect(conflict("D-K3")["resolution_status"]).toBe("RESOLVED_BY_SCOPE");
    expect(conflict("D-K1")["resolution_status"]).toBe("UNRESOLVED");
  });
});

describe("anti-demo inventory — 23 families, all accounted", () => {
  it("reconciles every seed family with a disposition and an enumeration basis", () => {
    const inventory = JSON.parse(
      readFileSync(
        join(PACKAGE_ROOT, "curation", "capability-inventory.json"),
        "utf8",
      ),
    ) as {
      families: Array<{
        seed_label: string;
        reconciliation: string;
        capability_ref: string;
        enumeration_basis: string;
        coverage_result: string;
        known_gaps: string[];
      }>;
    };
    expect(inventory.families).toHaveLength(23);
    const dispositions = new Set(
      inventory.families.map((f) => f.reconciliation),
    );
    // NOT_APPLICABLE is a coverage-seed escape hatch — using it here would
    // be the demo pattern the handoff forbids.
    expect(dispositions.has("NOT_APPLICABLE")).toBe(false);
    const nodeIds = new Set(
      built().envelope.body.nodes.map((n) => String(n["id"])),
    );
    for (const family of inventory.families) {
      expect(family.enumeration_basis.length).toBeGreaterThan(0);
      expect(["MAPPED", "PARTIAL"]).toContain(family.coverage_result);
      expect(nodeIds.has(family.capability_ref)).toBe(true);
    }
  });

  it("deep-reviews beyond the golden slices across all four required categories", () => {
    // candidate-facing + durable state, operational, authorization-heavy —
    // each family exists and is MAPPED with its gaps named, not hidden.
    for (const id of [
      "capability:runtime.candidate-exam", // candidate-facing + durable state
      "capability:audit", // operational
      "capability:proctoring", // authorization-heavy
      "capability:operations.diagnostics", // operational + authorization boundary
    ]) {
      const capability = node(id);
      expect(capability["mapping_state"]).toBe("MAPPED");
      expect(capability["closed_search_statement"]).toBeDefined();
    }
  });

  it("keeps support verdicts UNKNOWN outside the golden slices (no invented support)", () => {
    const goldenSubjects = new Set([
      "capability:content.rich-subjective",
      "capability:grading.manual",
      "capability:result.publication",
      ...built()
        .envelope.body.nodes.filter((n) => n["kind"] === "Facet")
        .map((n) => String(n["id"])),
    ]);
    const verdictful = built().envelope.body.nodes.filter(
      (n) =>
        (n["kind"] === "Capability" || n["kind"] === "Facet") &&
        n["support_summary"] !== "UNKNOWN",
    );
    for (const n of verdictful) {
      expect(goldenSubjects.has(String(n["id"]))).toBe(true);
    }
  });
});

describe("snapshot provenance quality and freeze integrity", () => {
  it("resolves every repo ref — no MISSING, STALE or AMBIGUOUS anchors", () => {
    const { envelope } = built();
    const states: string[] = [];
    for (const n of envelope.body.nodes) {
      for (const ref of (n["source_refs"] as Array<Record<string, unknown>>) ??
        []) {
        states.push(String(ref["resolution_state"]));
      }
    }
    for (const f of envelope.body.facts) {
      const ref = f["source_ref"] as Record<string, unknown> | undefined;
      if (ref) states.push(String(ref["resolution_state"]));
    }
    for (const e of envelope.body.evidence) {
      const ref = e["source_ref"] as Record<string, unknown> | undefined;
      if (ref) states.push(String(ref["resolution_state"]));
    }
    const bad = states.filter(
      (s) => s === "MISSING" || s === "STALE" || s === "AMBIGUOUS",
    );
    expect(bad).toEqual([]);
    // External captures may legitimately be RESOLVED; repo refs dominate.
    expect(states.filter((s) => s === "RESOLVED").length).toBeGreaterThan(100);
  });

  it("rebuilds byte-identical from the same inputs", () => {
    const first = built();
    const second = buildFresh();
    expect(canonicalJson(second.envelope)).toBe(canonicalJson(first.envelope));
  }, 240_000);

  it("matches the committed canonical snapshot (freeze integrity, bound at the observed revision)", () => {
    const committed = readFileSync(
      join(PACKAGE_ROOT, "generated", "atlas-snapshot.json"),
      "utf8",
    );
    expect(canonicalJson(built().envelope)).toBe(committed);
    expect(built().envelope.manifest.curation_input_revision).toBe(
      COMMITTED.manifest.curation_input_revision,
    );
  });

  it("records an observation that is still current at HEAD (no product-tree drift)", () => {
    // The observed revision must be part of this branch's history…
    git(["merge-base", "--is-ancestor", SOURCE_SHA, "HEAD"]);
    // …and nothing the snapshot claims to describe may have changed since,
    // except the atlas package itself and the route-facts extractor.
    const drift = git([
      "diff",
      "--name-only",
      `${SOURCE_SHA}..HEAD`,
      "--",
      "apps/",
      "packages/",
      ":(exclude)packages/atlas/",
      ":(exclude)apps/api/src/atlas/",
    ]).trim();
    expect(drift).toBe("");
  });
});
