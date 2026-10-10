/**
 * Snapshot model — the envelope, manifest and semantic body.
 *
 * provenance §9: the manifest declares repository, git_sha, IR schema
 * version, source-ref version, extractor id + version, curation input
 * revision and the hash of the normalized body. `generated_at` and other
 * volatile build metadata are deliberately NOT committed at all (R1 handoff
 * §11: no semantic output may depend on wall clock; prefer not to commit
 * volatile build metadata).
 */

import type { ConformanceFinding } from "../ir/validate.js";

export const IR_SCHEMA_VERSION = "v0.1" as const;
import { SOURCE_REF_VERSION } from "../sref/types.js";
export { SOURCE_REF_VERSION };

/** Version of this extractor implementation. Bumped when extraction or
 * normalization semantics change; recorded in the manifest (ATLAS-SREF-020). */
export const EXTRACTOR_ID = "@exam/atlas" as const;
export const EXTRACTOR_VERSION = "0.1.0" as const;

export interface SemanticInput {
  repo: string;
  source_sha: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
}

export interface SnapshotManifest {
  snapshot_id: string;
  repo: string;
  git_sha: string;
  ir_schema_version: typeof IR_SCHEMA_VERSION;
  source_ref_version: typeof SOURCE_REF_VERSION;
  extractor: { id: string; version: string };
  curation_input_revision: string;
  route_facts_digest: string;
  normalized_body_hash: string;
}

export interface SnapshotBody {
  ir_schema_version: typeof IR_SCHEMA_VERSION;
  source_ref_version: typeof SOURCE_REF_VERSION;
  repo: string;
  source_sha: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
}

export interface SnapshotEnvelope {
  manifest: SnapshotManifest;
  body: SnapshotBody;
}

export interface BuildOutput {
  envelope: SnapshotEnvelope;
  /** Canonical bytes of the full envelope file. */
  bytes: Uint8Array;
  /** sha256 of the canonical body alone (the normalized-body hash). */
  bodyHash: string;
  findings: ConformanceFinding[];
}
