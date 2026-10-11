/**
 * Curation loading and semantic-input assembly (#764 R1-C).
 *
 * Curation is the explicit, reviewable product-semantics input: it may mint
 * curated identities and assert curated relations WITH evidence and an
 * explicit review_state, but it may never invent support, compute effective
 * authorization, or override extracted runtime truth. The route capture and
 * the @exam/authz closed sets are extraction; everything product-shaped in
 * `curation/*.json` is curation.
 *
 * The curation input revision is the sha256 of the canonical concatenation
 * of every curation file — a deterministic identity for the curated input
 * (R1 handoff §6: CURATION_INPUT_REVISION).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "../canon/serialize.js";
import {
  unclassifiedAdditionalGates,
  type RouteFacts,
} from "../extract/routes.js";
import { authzFragment } from "../extract/authz.js";
import { routeFragment } from "../extract/routes.js";
import type { SemanticInput } from "../snapshot/types.js";

export interface CurationBundle {
  files: Map<string, Record<string, unknown>>;
  /** Canonical bytes identity of the whole curated input. */
  revision: string;
}

const CURATION_FILE_ORDER = [
  "external-revisions.json",
  "authorities.json",
  "scopes.json",
  "entities-policies.json",
  "work-items.json",
  "golden-rich.json",
  "golden-manual-grading.json",
  "golden-rbac.json",
  "golden-timed-sync.json",
  "capability-inventory.json",
] as const;

export function loadCurationInputs(curationDir: string): CurationBundle {
  const files = new Map<string, Record<string, unknown>>();
  const present = new Set(readdirSync(curationDir));
  const parts: string[] = [];
  for (const name of CURATION_FILE_ORDER) {
    if (!present.has(name)) {
      throw new Error(`curation input missing required file ${name}`);
    }
    const parsed = JSON.parse(
      readFileSync(join(curationDir, name), "utf8"),
    ) as Record<string, unknown>;
    files.set(name, parsed);
    parts.push(canonicalJson(parsed));
  }
  const revision = sha256Hex(parts.join("\n"));
  return { files, revision };
}

export function curationInputRevisionOf(bundle: CurationBundle): string {
  return bundle.revision;
}

interface Fragment {
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  facts?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  claims?: Array<Record<string, unknown>>;
  conflicts?: Array<Record<string, unknown>>;
}

/**
 * Bind curation source refs to the observed revision: curation records carry
 * `snapshot: "SOURCE_SHA"` placeholders and refs without git_sha — the
 * assembler binds them so ATLAS-SREF-050 holds for every committed ref.
 */
function bindRef(ref: Record<string, unknown>, sourceSha: string): void {
  if (
    ref["git_sha"] === undefined &&
    ref["source_kind"] !== "GITHUB_ISSUE" &&
    ref["source_kind"] !== "GITHUB_PR"
  ) {
    ref["git_sha"] = sourceSha;
    ref["repo"] = "jnhu76/exam";
    ref["repo_freshness"] = "CURRENT";
  }
}

/**
 * Evidence records carry a human `locator`; ATLAS-SEM-031 requires a full
 * source_ref. The ref is derived mechanically from the locator's primary
 * segment.
 *
 * PROTOCOL — locator grammar: `path[#anchor][; context…]`. Only the first
 * `;`-separated segment becomes the SREF; later segments are curation
 * context that the record's `proves` statement already carries. The primary
 * segment is used verbatim (test-case anchors keep their parentheses), so
 * curation locators must not embed annotations inside the primary segment.
 */
function sourceRefFromLocator(
  locator: string,
  snapshot: string,
): Record<string, unknown> | undefined {
  const primary = (locator.split(";")[0] ?? "").trim();
  if (!primary || primary.startsWith("work:") || primary.startsWith("http")) {
    return undefined;
  }
  const hash = primary.indexOf("#");
  const path = hash === -1 ? primary : primary.slice(0, hash);
  const anchor = hash === -1 ? undefined : primary.slice(hash + 1);
  const source_kind =
    anchor === undefined || anchor.length === 0
      ? "REPO_FILE"
      : path.endsWith(".test.ts") || path.endsWith(".test.tsx")
        ? "TEST_CASE"
        : path.startsWith("docs/")
          ? "REPO_SECTION"
          : path.endsWith(".md")
            ? "REPO_SECTION"
            : "REPO_SYMBOL";
  const ref: Record<string, unknown> = {
    source_ref_version: "SREF-1",
    repo: "jnhu76/exam",
    git_sha: snapshot,
    source_kind,
    path_or_uri: path,
    extractor: { id: "@exam/atlas", version: "0.1.0" },
    extraction_method: "MANUAL_CURATION",
    resolution_state: "RESOLVED",
    repo_freshness: "CURRENT",
    sensitivity: "NONE",
  };
  if (anchor !== undefined && anchor.length > 0) {
    ref[source_kind === "REPO_SECTION" ? "section" : "symbol"] = anchor;
  }
  return ref;
}

function externalRefFromLocator(
  locator: string,
  externalRevisions: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const match = /^work:([\w.-]+\/)([\w.-]+)#(\d+)/.exec(locator.trim());
  if (match === null) {
    return undefined;
  }
  const ref = `work:${match[1]}${match[2]}#${match[3]}`;
  const observed = externalRevisions.get(ref);
  return {
    source_ref_version: "SREF-1",
    source_kind: "GITHUB_ISSUE",
    path_or_uri: `https://github.com/${match[1]}${match[2]}/issues/${match[3]}`,
    extractor: { id: "@exam/atlas", version: "0.1.0" },
    extraction_method: "GITHUB_API",
    resolution_state: "RESOLVED",
    external_revision:
      observed !== undefined
        ? {
            observed_state: String(observed["observed_state"]),
            observed_updated_at: String(observed["observed_updated_at"]),
            observed_at: String(observed["observed_at"]),
          }
        : {
            observed_state: "UNKNOWN",
            observed_updated_at: "",
            observed_at: "",
          },
    external_freshness: "UNKNOWN",
    sensitivity: "NONE",
  };
}

function bindSourceRefs(bundle: CurationBundle, sourceSha: string): void {
  const revisionsFile = bundle.files.get("external-revisions.json");
  const externalRevisions = new Map<string, Record<string, unknown>>();
  for (const item of (revisionsFile?.["items"] as
    | Array<Record<string, unknown>>
    | undefined) ?? []) {
    externalRevisions.set(String(item["ref"]), item);
  }
  const bind = (ref: Record<string, unknown>): void => bindRef(ref, sourceSha);
  for (const file of bundle.files.values()) {
    for (const node of (file["nodes"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      for (const ref of (node["source_refs"] as
        | Array<Record<string, unknown>>
        | undefined) ?? []) {
        bind(ref);
      }
    }
    for (const fact of (file["facts"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      bind(fact["source_ref"] as Record<string, unknown>);
    }
    for (const evidence of (file["evidence"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      let ref = evidence["source_ref"] as Record<string, unknown> | undefined;
      if (ref === undefined && typeof evidence["locator"] === "string") {
        const locator = evidence["locator"] as string;
        const derived = locator.trim().startsWith("work:")
          ? externalRefFromLocator(locator, externalRevisions)
          : sourceRefFromLocator(locator, sourceSha);
        if (derived !== undefined) {
          evidence["source_ref"] = derived;
          ref = derived;
        }
      }
      if (ref !== undefined) bind(ref);
      if (evidence["snapshot"] === "SOURCE_SHA")
        evidence["snapshot"] = sourceSha;
    }
    for (const claim of (file["claims"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      if (claim["source_snapshot"] === "SOURCE_SHA")
        claim["source_snapshot"] = sourceSha;
    }
  }
}

/**
 * ATLAS-IR-091 — apply the curated additional-gate patches to the extracted
 * Interface nodes. Every patch carries the capture candidate locator it
 * resolves; after patching, any candidate that no patch mapped is reported
 * as an unclassified finding by the caller (never silently dropped).
 */
function applyInterfacePatches(
  bundle: CurationBundle,
  interfaceNodes: Array<Record<string, unknown>>,
  routeFacts: RouteFacts,
): string[] {
  const byId = new Map(interfaceNodes.map((n) => [String(n["id"]), n]));
  const mapped: Array<{ file: string; line: number }> = [];
  for (const file of bundle.files.values()) {
    for (const patch of (file["interface_patches"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      const target = byId.get(String(patch["interface_id"]));
      if (target === undefined) {
        throw new Error(
          `interface patch targets unknown interface ${String(patch["interface_id"])} — curation may not mint an interface the runtime does not expose`,
        );
      }
      const gates =
        (patch["additional_gates"] as
          | Array<Record<string, unknown>>
          | undefined) ?? [];
      const existing =
        (target["additional_gates"] as
          | Array<Record<string, unknown>>
          | undefined) ?? [];
      for (const gate of gates) {
        const locator = String(gate["candidate_locator"] ?? "");
        const at = locator.lastIndexOf(":");
        const filePart = locator.slice(0, at).replace(/^apps\/api\//, "");
        mapped.push({ file: filePart, line: Number(locator.slice(at + 1)) });
        const { candidate_locator: _drop, ...gateRecord } = gate;
        existing.push(gateRecord);
      }
      target["additional_gates"] = existing;
    }
  }
  const unclassified = unclassifiedAdditionalGates(routeFacts, mapped);
  return unclassified.map(
    (c) =>
      `UNCLASSIFIED_HANDLER_GATE: ${c.file}:${c.line} references ${c.permission_key} inside ${c.enclosing_function} — every detected in-handler branch must be mapped in curation or reported (ATLAS-IR-091)`,
  );
}

export interface AssembleInput {
  repo: string;
  sourceSha: string;
  curation: CurationBundle;
  routeFacts: RouteFacts;
}

/** Assemble the full SemanticInput: extraction + curation, no duplication. */
export function buildAtlasInput(input: AssembleInput): SemanticInput & {
  o07: ReturnType<typeof routeFragment>["o07"];
  ir091Findings: string[];
} {
  bindSourceRefs(input.curation, input.sourceSha);

  const authz = authzFragment(input.sourceSha);
  const routes = routeFragment(input.routeFacts, input.sourceSha);

  const nodes: Array<Record<string, unknown>> = [
    ...authz.nodes,
    ...routes.nodes,
  ];
  const edges: SemanticInput["edges"] = [];
  const facts: SemanticInput["facts"] = [...authz.facts, ...routes.facts];
  const evidence: SemanticInput["evidence"] = [];
  const claims: SemanticInput["claims"] = [];
  const conflicts: SemanticInput["conflicts"] = [];

  for (const file of input.curation.files.values()) {
    nodes.push(...((file["nodes"] as Fragment["nodes"]) ?? []));
    edges.push(...((file["edges"] as Fragment["edges"]) ?? []));
    facts.push(...((file["facts"] as Fragment["facts"]) ?? []));
    evidence.push(...((file["evidence"] as Fragment["evidence"]) ?? []));
    claims.push(...((file["claims"] as Fragment["claims"]) ?? []));
    conflicts.push(...((file["conflicts"] as Fragment["conflicts"]) ?? []));
  }

  const ir091Findings = applyInterfacePatches(
    input.curation,
    nodes,
    input.routeFacts,
  );

  return {
    repo: input.repo,
    source_sha: input.sourceSha,
    nodes,
    edges,
    facts,
    evidence,
    claims,
    conflicts,
    o07: routes.o07,
    ir091Findings,
  };
}
