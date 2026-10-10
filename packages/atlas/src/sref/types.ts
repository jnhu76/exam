/**
 * `ArchitectureSourceRef` (`SREF-1`) — executable implementation of
 * `docs/architecture/atlas/provenance-v0.1.md`.
 *
 * RESOLUTION (does the locator resolve, uniquely, at the revision it claims)
 * and FRESHNESS (is that revision still live) are independent questions
 * (ATLAS-SREF-002) and are never collapsed into one ordinal
 * (ATLAS-SREF-033). A ref can be perfectly RESOLVED and simultaneously not
 * CURRENT — the expected state for historical evidence (ATLAS-SREF-031).
 */

export const SOURCE_REF_VERSION = "SREF-1" as const;

/** provenance §3 — source_kind closed set. */
export const SOURCE_KINDS = [
  "REPO_FILE",
  "REPO_SYMBOL",
  "REPO_SECTION",
  "WIRE_CONTRACT",
  "GENERATED_ARTEFACT",
  "RUNTIME_CAPTURE",
  "TEST_CASE",
  "SCHEMA_OBJECT",
  "GIT_COMMIT",
  "GITHUB_ISSUE",
  "GITHUB_PR",
  "HUMAN_STATEMENT",
  "ARCHIVED_DOC",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** provenance §4 — per-ref resolution_state closed set. */
export const RESOLUTION_STATES = [
  "RESOLVED",
  "STALE",
  "HISTORICAL",
  "MISSING",
  "AMBIGUOUS",
  "UNKNOWN",
] as const;
export type ResolutionState = (typeof RESOLUTION_STATES)[number];

/** provenance §5 — extraction_method closed set. */
export const EXTRACTION_METHODS = [
  "MANUAL_CURATION",
  "AST_SYMBOL_LOOKUP",
  "LEXICAL_ANCHOR",
  "ROUTE_CAPTURE",
  "SCHEMA_INTROSPECTION",
  "OPENAPI_ARTIFACT",
  "TEST_NAME_MATCH",
  "GITHUB_API",
  "COMMIT_LOOKUP",
  "HUMAN_RECORDED",
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/** provenance §7 — freshness, two independent dimensions. */
export const FRESHNESS_STATES = ["CURRENT", "STALE", "UNKNOWN"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** provenance §8 — sensitivity classes. */
export const SENSITIVITY_LEVELS = [
  "NONE",
  "INTERNAL",
  "SENSITIVE_METADATA",
] as const;
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

/** External sources carry a capture-time revision, never a repo SHA claim. */
export interface ExternalRevision {
  observed_state: string;
  observed_updated_at: string;
  observed_at: string;
}

/** provenance §2 — the ArchitectureSourceRef record. */
export interface SourceRef {
  source_ref_version: typeof SOURCE_REF_VERSION;
  /** "owner/name" — REQUIRED for every repo-hosted source. */
  repo?: string;
  /** Full 40-hex commit — REQUIRED for repo sources. */
  git_sha?: string;
  source_kind: SourceKind;
  /** Repo-relative path, or URI for external/artefact sources. */
  path_or_uri: string;
  symbol?: string;
  section?: string;
  /** { start, end } 1-based inclusive — a HINT, never identity. */
  line_or_range?: { start: number; end: number };
  extractor: { id: string; version: string };
  extraction_method: ExtractionMethod;
  resolution_state: ResolutionState;
  resolution_detail?: {
    candidates?: string[];
    nearest_anchor?: string;
    reason?: string;
  };
  /** provenance §7.2 — external sources only. */
  external_revision?: ExternalRevision;
  external_freshness?: FreshnessState;
  /** provenance §7.1 — repo sources only. */
  repo_freshness?: FreshnessState;
  /** provenance §4 — intentionally bound to an older revision. */
  historical?: true;
  /** ATLAS-SREF-021 — the literal anchor a LEXICAL_ANCHOR ref matched. */
  anchor_text?: string;
  sensitivity: Sensitivity;
}

/** The 40-hex Git SHA shape. */
export const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** True when the ref points at an external (non-repo-hosted) source. */
export function isExternalRef(ref: SourceRef): boolean {
  return ref.source_kind === "GITHUB_ISSUE" || ref.source_kind === "GITHUB_PR";
}

/**
 * ATLAS-SREF-003 — repo + git_sha + path_or_uri + source_kind are mandatory
 * for every non-external ref. A ref without a revision does not satisfy any
 * claim boundary (ATLAS-SEM-021).
 */
export function validateSourceRef(ref: SourceRef): string[] {
  const errors: string[] = [];
  if (ref.source_ref_version !== SOURCE_REF_VERSION) {
    errors.push(`source_ref_version must be ${SOURCE_REF_VERSION}`);
  }
  if (isExternalRef(ref)) {
    if (!ref.external_revision) {
      errors.push("external refs must carry external_revision (provenance §7)");
    }
  } else {
    if (!ref.repo) {
      errors.push("repo is REQUIRED for repo-hosted sources");
    } else if (!/^[\w.-]+\/[\w.-]+$/.test(ref.repo)) {
      errors.push(`repo "${ref.repo}" is not "owner/name"`);
    }
    if (!ref.git_sha) {
      errors.push("git_sha is REQUIRED for repo-hosted sources");
    } else if (!GIT_SHA_PATTERN.test(ref.git_sha)) {
      errors.push(`git_sha "${ref.git_sha}" is not full 40-hex`);
    }
    if (!ref.path_or_uri) {
      errors.push("path_or_uri is REQUIRED");
    }
  }
  if (!ref.extractor?.id || !ref.extractor?.version) {
    errors.push("extractor { id, version } is REQUIRED (ATLAS-SREF-020)");
  }
  return errors;
}

/**
 * ATLAS-SREF-033 §7.3 — per-ref eligibility: usable as CURRENT evidence iff
 * resolution = RESOLVED AND freshness = CURRENT; a HISTORICAL ref is never
 * current evidence even when a re-check is CURRENT (ATLAS-SREF-014).
 */
export function usableAsCurrentEvidence(ref: SourceRef): boolean {
  if (ref.resolution_state === "HISTORICAL") {
    return false;
  }
  if (ref.resolution_state !== "RESOLVED") {
    return false;
  }
  const freshness = isExternalRef(ref)
    ? ref.external_freshness
    : ref.repo_freshness;
  return freshness === "CURRENT";
}

/**
 * ATLAS-SREF-033 §7.3 — usable as evidence about the bound revision or the
 * past: resolution ∈ {RESOLVED, HISTORICAL} (freshness may be STALE).
 */
export function usableAsBoundRevisionEvidence(ref: SourceRef): boolean {
  return (
    ref.resolution_state === "RESOLVED" || ref.resolution_state === "HISTORICAL"
  );
}
