/**
 * Source-ref resolution — executable implementation of provenance-v0.1.md §4
 * (frozen detection criteria) over pluggable revision views.
 *
 * The frozen criteria, restated as implemented:
 * - RESOLVED   — at git_sha: the path exists and, when symbol/section is
 *                present, the anchor matches exactly one target there.
 * - STALE      — bound-revision resolution succeeds AND live-resolution
 *                fails or lands elsewhere.
 * - HISTORICAL — a declaration on the ref (historical: true) plus successful
 *                resolution at its bound revision. A choice, never a decay.
 * - MISSING    — does not resolve even at its own bound revision.
 * - AMBIGUOUS  — ≥2 matches at the bound revision; detail lists them.
 * - UNKNOWN    — not evaluated / not evaluable.
 */

import ts from "typescript";

import type { ResolutionState, SourceRef } from "./types.js";

/** A read-only view of one revision of the repository. */
export interface RevisionView {
  /** The revision label this view represents (a full SHA, or a test label). */
  readonly revision: string;
  fileExists(path: string): boolean;
  readFile(path: string): string | undefined;
  /** Existence of a commit, for GIT_COMMIT refs (optional capability). */
  commitExists?(sha: string): boolean;
}

export interface ResolutionOutcome {
  resolution_state: ResolutionState;
  resolution_detail?: {
    candidates?: string[];
    nearest_anchor?: string;
    reason?: string;
  };
}

export interface ResolveContext {
  /** The bound revision view (the snapshot's SOURCE_SHA). */
  bound: RevisionView;
  /** The live revision view; required for STALE detection. When omitted,
   * live drift is not evaluated (resolution stays bound-revision-only). */
  live?: RevisionView;
}

function lexicalOccurrences(text: string, needle: string): number[] {
  const positions: number[] = [];
  let index = text.indexOf(needle);
  while (index >= 0) {
    positions.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return positions;
}

function anchorFor(ref: SourceRef): string | undefined {
  return ref.symbol ?? ref.section ?? ref.anchor_text;
}

/** Resolve one ref against the bound (and optional live) revision views. */
export function resolveRef(
  ref: SourceRef,
  context: ResolveContext,
): ResolutionOutcome {
  const { bound, live } = context;

  if (ref.source_kind === "GITHUB_ISSUE" || ref.source_kind === "GITHUB_PR") {
    if (ref.external_revision) {
      return { resolution_state: "RESOLVED" };
    }
    return {
      resolution_state: "UNKNOWN",
      resolution_detail: {
        reason: "external object not captured at observation time",
      },
    };
  }

  if (ref.source_kind === "GIT_COMMIT") {
    const sha = ref.git_sha ?? ref.path_or_uri;
    if (!sha) {
      return {
        resolution_state: "UNKNOWN",
        resolution_detail: { reason: "no commit to resolve" },
      };
    }
    if (bound.commitExists?.(sha)) {
      return { resolution_state: "RESOLVED" };
    }
    if (bound.commitExists === undefined) {
      return {
        resolution_state: "UNKNOWN",
        resolution_detail: {
          reason: "commit existence not verifiable in this view",
        },
      };
    }
    // The view CAN verify commits and this one is absent: SREF-1 §4 —
    // the object is not found at the bound revision → MISSING. A declared
    // historical ref whose commit the view cannot confirm stays UNKNOWN.
    return {
      resolution_state: ref.historical === true ? "UNKNOWN" : "MISSING",
      resolution_detail: {
        reason:
          ref.historical === true
            ? "historical commit not verifiable in this view"
            : "commit absent from the bound repository",
      },
    };
  }

  if (ref.source_kind === "HUMAN_STATEMENT") {
    // A recorded statement resolves to its record in this snapshot.
    return { resolution_state: "RESOLVED" };
  }

  const path = ref.path_or_uri;
  if (!bound.fileExists(path)) {
    return {
      resolution_state: "MISSING",
      resolution_detail: {
        reason: `path ${path} absent at bound revision ${bound.revision}`,
      },
    };
  }

  const anchor = anchorFor(ref);
  if (anchor === undefined) {
    // Pure file-level ref (REPO_FILE / artefact kinds without anchors).
    if (live !== undefined && !live.fileExists(path)) {
      return {
        resolution_state: "STALE",
        resolution_detail: {
          reason: `path ${path} no longer exists at live revision`,
        },
      };
    }
    return { resolution_state: "RESOLVED" };
  }

  const boundMatches = matchAnchor(ref, anchor, bound);
  if (boundMatches.length === 0) {
    return {
      resolution_state: "MISSING",
      resolution_detail: {
        reason: `anchor "${anchor}" not found in ${path} at bound revision`,
      },
    };
  }
  if (boundMatches.length >= 2) {
    return {
      resolution_state: "AMBIGUOUS",
      resolution_detail: { candidates: boundMatches },
    };
  }

  if (live !== undefined) {
    if (!live.fileExists(path)) {
      return {
        resolution_state: "STALE",
        resolution_detail: {
          reason: `${path} no longer exists at live revision`,
        },
      };
    }
    const liveMatches = matchAnchor(ref, anchor, live);
    if (liveMatches.length === 0) {
      return {
        resolution_state: "STALE",
        resolution_detail: {
          reason: `anchor "${anchor}" drifted: resolved at bound revision, absent at live`,
        },
      };
    }
    if (liveMatches.length >= 2) {
      return {
        resolution_state: "STALE",
        resolution_detail: {
          reason: `anchor "${anchor}" is unique at the bound revision but ambiguous at live`,
          candidates: liveMatches,
        },
      };
    }
  }

  return {
    resolution_state: ref.historical === true ? "HISTORICAL" : "RESOLVED",
  };
}

/**
 * Anchor matching per source_kind. Symbols and test cases use the AST index
 * (never a bare regex over source text, R1 handoff §13.1); document sections
 * use lexical anchors (allowed for documents/headings).
 */
function matchAnchor(
  ref: SourceRef,
  anchor: string,
  view: RevisionView,
): string[] {
  const text = view.readFile(ref.path_or_uri);
  if (text === undefined) {
    return [];
  }
  switch (ref.source_kind) {
    case "REPO_SYMBOL":
    case "SCHEMA_OBJECT":
      return symbolMatches(text, anchor);
    case "TEST_CASE":
      return testCaseMatches(text, anchor);
    case "REPO_SECTION":
    case "REPO_FILE":
    case "WIRE_CONTRACT":
    case "GENERATED_ARTEFACT":
    case "RUNTIME_CAPTURE":
    default: {
      const needle = ref.anchor_text ?? anchor;
      return lexicalOccurrences(text, needle).map((p) => `offset:${String(p)}`);
    }
  }
}

const SYMBOL_DECLARATION_KINDS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "InterfaceDeclaration",
  "TypeAliasDeclaration",
  "EnumDeclaration",
  "VariableDeclaration",
  "MethodDeclaration",
  "PropertyAssignment",
  "PropertySignature",
  "ShorthandPropertyAssignment",
]);

/**
 * Symbol occurrence via the TypeScript parser AST. Returns one entry per
 * declaration whose name matches, so a duplicated anchor is detectably
 * AMBIGUOUS rather than silently first-match.
 */
function symbolMatches(text: string, symbol: string): string[] {
  const source = ts.createSourceFile(
    "anchor.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    if (SYMBOL_DECLARATION_KINDS.has(ts.SyntaxKind[node.kind])) {
      const name = (
        node as {
          name?: { text?: string; getText?: (sourceFile?: unknown) => string };
        }
      ).name;
      const nameText =
        name === undefined
          ? undefined
          : typeof name.text === "string"
            ? name.text
            : name.getText?.(source);
      if (nameText === symbol) {
        matches.push(`${ts.SyntaxKind[node.kind]}:${symbol}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return matches;
}

/** Test-case names via the parser AST (test/it/describe string literals). */
function testCaseMatches(text: string, testName: string): string[] {
  const source = ts.createSourceFile(
    "anchor.test.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["test", "it", "describe"].includes(node.expression.text) &&
      node.arguments.length >= 1
    ) {
      const first = node.arguments[0]!;
      if (
        ts.isStringLiteral(first) ||
        ts.isNoSubstitutionTemplateLiteral(first)
      ) {
        if (first.text === testName) {
          matches.push(`test:${first.text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return matches;
}

/**
 * ATLAS-SREF-031/§7.1 — repo freshness: CURRENT iff the ref's git_sha equals
 * the snapshot's base revision; STALE once the repository has advanced past
 * it. Independent of resolution.
 */
export function repoFreshnessFor(
  ref: SourceRef,
  snapshotBaseSha: string,
): "CURRENT" | "STALE" | "UNKNOWN" {
  if (ref.git_sha === undefined) {
    return "UNKNOWN";
  }
  return ref.git_sha === snapshotBaseSha ? "CURRENT" : "STALE";
}
