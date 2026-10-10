/**
 * SREF-1 resolver proofs (provenance §10): broken locator → MISSING/STALE,
 * ambiguity detection, freshness separation, identity stability across a
 * pure move.
 */

import { describe, expect, it } from "vitest";
import { MemoryRevisionView } from "../src/view/revision.js";
import { resolveRef, repoFreshnessFor } from "../src/sref/resolve.js";
import { usableAsCurrentEvidence, type SourceRef } from "../src/sref/types.js";
import { buildSnapshot } from "../src/snapshot/build.js";
import { SHA, emptyInput, sourceRef } from "./fixtures.js";

const FILE = "docs/example.md";

function refWith(overrides: Partial<SourceRef>): SourceRef {
  return sourceRef({
    path_or_uri: FILE,
    ...overrides,
  });
}

describe("SREF resolution proofs", () => {
  it("a broken locator at the bound revision is MISSING, never silently resolved", () => {
    const bound = new MemoryRevisionView(SHA, new Map());
    const outcome = resolveRef(refWith({ source_kind: "REPO_FILE" }), {
      bound,
    });
    expect(outcome.resolution_state).toBe("MISSING");
  });

  it("an absent symbol in an existing file is MISSING", () => {
    const bound = new MemoryRevisionView(
      SHA,
      new Map([[FILE, "export const other = 1;\n"]]),
    );
    const outcome = resolveRef(
      refWith({
        source_kind: "REPO_SYMBOL",
        path_or_uri: "src/thing.ts",
        symbol: "missingSymbol",
      }),
      {
        bound: new MemoryRevisionView(
          SHA,
          new Map([["src/thing.ts", "export const other = 1;\n"]]),
        ),
        live: bound,
      },
    );
    expect(outcome.resolution_state).toBe("MISSING");
  });

  it("resolved-at-bound but deleted at live is STALE", () => {
    const bound = new MemoryRevisionView(SHA, new Map([[FILE, "hello"]]));
    const live = new MemoryRevisionView("b".repeat(40), new Map());
    const outcome = resolveRef(refWith({ source_kind: "REPO_FILE" }), {
      bound,
      live,
    });
    expect(outcome.resolution_state).toBe("STALE");
  });

  it("resolved-at-bound but anchor moved at live is STALE", () => {
    const bound = new MemoryRevisionView(
      SHA,
      new Map([["src/thing.ts", "export function target(): void {}\n"]]),
    );
    const live = new MemoryRevisionView(
      "b".repeat(40),
      new Map([["src/thing.ts", "export function renamedAway(): void {}\n"]]),
    );
    const outcome = resolveRef(
      refWith({
        source_kind: "REPO_SYMBOL",
        path_or_uri: "src/thing.ts",
        symbol: "target",
      }),
      { bound, live },
    );
    expect(outcome.resolution_state).toBe("STALE");
  });

  it("a duplicated anchor is AMBIGUOUS with both candidates listed", () => {
    const text = [
      "export const config = {",
      "  retries: 1,",
      "};",
      "export const other = {",
      "  retries: 2,",
      "};",
    ].join("\n");
    const outcome = resolveRef(
      refWith({
        source_kind: "REPO_SYMBOL",
        path_or_uri: "src/dupe.ts",
        symbol: "retries",
      }),
      { bound: new MemoryRevisionView(SHA, new Map([["src/dupe.ts", text]])) },
    );
    expect(outcome.resolution_state).toBe("AMBIGUOUS");
    expect(outcome.resolution_detail?.candidates).toHaveLength(2);
  });

  it("a historical ref resolves HISTORICAL and is never current evidence", () => {
    const bound = new MemoryRevisionView(
      SHA,
      new Map([[FILE, "archived section\n"]]),
    );
    const ref = refWith({
      source_kind: "REPO_FILE",
      historical: true,
      anchor_text: "archived section",
    });
    const outcome = resolveRef(ref, { bound });
    expect(outcome.resolution_state).toBe("HISTORICAL");
    expect(
      usableAsCurrentEvidence({
        ...ref,
        resolution_state: outcome.resolution_state,
      }),
    ).toBe(false);
  });

  it("repo freshness is the SHA dimension only: CURRENT at the base, STALE past it", () => {
    expect(repoFreshnessFor(refWith({}), SHA)).toBe("CURRENT");
    expect(repoFreshnessFor(refWith({ git_sha: "c".repeat(40) }), SHA)).toBe(
      "STALE",
    );
    expect(repoFreshnessFor(refWith({ git_sha: undefined }), SHA)).toBe(
      "UNKNOWN",
    );
  });

  it("external refs carry their own freshness dimension and never infer repo state", () => {
    const external = refWith({
      source_kind: "GITHUB_ISSUE",
      repo: undefined,
      git_sha: undefined,
      path_or_uri: "https://github.com/jnhu76/exam/issues/291",
      external_revision: {
        observed_state: "CLOSED",
        observed_updated_at: "2026-09-04",
        observed_at: "2026-10-11",
      },
      external_freshness: "UNKNOWN",
    });
    const bound = new MemoryRevisionView(SHA, new Map());
    const outcome = resolveRef(external, { bound });
    expect(outcome.resolution_state).toBe("RESOLVED");
    expect(usableAsCurrentEvidence(external)).toBe(false); // external_freshness UNKNOWN
  });

  it("an AST symbol ref resolves exactly one declaration", () => {
    const text =
      "export function gradeQuestion(): void {}\nexport const other = 2;\n";
    const outcome = resolveRef(
      refWith({
        source_kind: "REPO_SYMBOL",
        path_or_uri: "src/manualGrading.ts",
        symbol: "gradeQuestion",
        extraction_method: "AST_SYMBOL_LOOKUP",
      }),
      {
        bound: new MemoryRevisionView(
          SHA,
          new Map([["src/manualGrading.ts", text]]),
        ),
      },
    );
    expect(outcome.resolution_state).toBe("RESOLVED");
  });

  it("a test-case ref matches the declared test name via AST", () => {
    const text = `import { test } from "vitest";\ntest("rejects the merge-class seed at the wire", () => {});\n`;
    const outcome = resolveRef(
      refWith({
        source_kind: "TEST_CASE",
        path_or_uri: "src/closure.test.ts",
        symbol: "rejects the merge-class seed at the wire",
        extraction_method: "TEST_NAME_MATCH",
      }),
      {
        bound: new MemoryRevisionView(
          SHA,
          new Map([["src/closure.test.ts", text]]),
        ),
      },
    );
    expect(outcome.resolution_state).toBe("RESOLVED");
  });
});

describe("identity stability (ir §6.4)", () => {
  it("a pure file move does not change any semantic ID", () => {
    // The semantic ID is curated; the source ref is a locator. Moving the
    // file changes the locator, never the ID.
    const input = emptyInput();
    input.nodes.push({
      kind: "PolicyValue",
      id: "policy:exam.timingMode/timed_sync",
      label: "timed_sync",
      source_refs: [
        sourceRef({ path_or_uri: "packages/old-location/enums.ts" }),
      ],
      authority_refs: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      value: "timed_sync",
      vocabulary_class: "MODE",
      representable: "TRUE",
      storable: "TRUE",
      write_reachable: "FALSE",
      read_compatible: "TRUE",
      activation_status: "GATED",
      activation_claim_ref: "claim-negative",
      refusing_seams: ["packages/exam-engine/src/examPolicy.ts"],
    });
    input.claims.push({
      claim_id: "claim-negative",
      subject: "policy:exam.timingMode/timed_sync",
      predicate: "activation_support",
      value: "GATED",
      claim_kind: "CAPABILITY_SUPPORT",
      boundary: "B4",
      axes: { activation_support: "GATED", verification: "INSUFFICIENT" },
      authority_owner: "UNKNOWN",
      supporting_evidence: [],
      challenging_evidence: [],
      review_state: "PROPOSED",
      open_governance_item: { kind: "NONE" },
      source_snapshot: SHA,
    });

    const movedInput = JSON.parse(JSON.stringify(input)) as typeof input;
    const movedRef = (movedInput.nodes[0]["source_refs"] as SourceRef[])[0];
    movedRef.path_or_uri = "packages/new-location/enums.ts";

    const before = buildSnapshot(
      input,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    const after = buildSnapshot(
      movedInput,
      { bound: new MemoryRevisionView(SHA, new Map()) },
      "cur",
      "rf",
    );
    expect(after.envelope.body.nodes[0]["id"]).toBe(
      before.envelope.body.nodes[0]["id"],
    );
    expect(after.envelope.body.nodes[0]["id"]).toBe(
      "policy:exam.timingMode/timed_sync",
    );
    // The locator moved with the file.
    expect(
      (after.envelope.body.nodes[0]["source_refs"] as SourceRef[])[0]
        .path_or_uri,
    ).toBe("packages/new-location/enums.ts");
  });

  it("a semantic ID may not embed a path, extension, line or SHA", async () => {
    const { assertIdIsNotASourcePath, isValidAtlasId } =
      await import("../src/ir/ids.js");
    expect(isValidAtlasId("capability:grading.manual")).toBe(true);
    expect(
      isValidAtlasId(
        "interface:http.POST./api/attempts/:attemptId/grade-question",
      ),
    ).toBe(true);
    expect(isValidAtlasId("policy:exam.timingMode/timed_sync")).toBe(true);
    expect(isValidAtlasId("work:jnhu76/exam#756")).toBe(true);
    expect(isValidAtlasId("capability:Grading")).toBe(false); // curated segments are lower-case
    expect(isValidAtlasId("role:System")).toBe(true);
    expect(isValidAtlasId("unknown:thing")).toBe(false);

    expect(() =>
      assertIdIsNotASourcePath("capability:apps.api.routes"),
    ).toThrow(/ATLAS-IR-020/);
    expect(() => assertIdIsNotASourcePath("entity:answer.frozen.ts")).toThrow(
      /ATLAS-IR-020/,
    );
    // HTTP interface IDs are exempt (wire-contract identity, ATLAS-IR-024).
    expect(() =>
      assertIdIsNotASourcePath("interface:http.GET./api/apps/status"),
    ).not.toThrow();
  });

  it("path-template normalization collapses shape differences, keeps parameters verbatim", async () => {
    const { normalizeHttpPathTemplate } = await import("../src/ir/ids.js");
    expect(
      normalizeHttpPathTemplate(
        "post",
        "/api/attempts/:attemptId/answers/:questionId",
      ),
    ).toBe("interface:http.POST./api/attempts/:attemptId/answers/:questionId");
    expect(normalizeHttpPathTemplate("GET", "/api//exams/")).toBe(
      "interface:http.GET./api/exams",
    );
    expect(normalizeHttpPathTemplate("get", "/api/exams?verbose=1")).toBe(
      "interface:http.GET./api/exams",
    );
    // :id vs :attemptId are different templates (ATLAS-IR-027.4).
    expect(normalizeHttpPathTemplate("GET", "/api/exams/:id")).not.toBe(
      normalizeHttpPathTemplate("GET", "/api/exams/:attemptId"),
    );
  });
});
