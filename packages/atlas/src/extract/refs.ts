/**
 * Source-ref constructor for extractors — every extracted node binds its
 * refs to the observed SOURCE_SHA with repo freshness CURRENT, so
 * ATLAS-SREF-050 ("every ref is bound to the snapshot's git_sha, or
 * explicitly HISTORICAL/external") holds by construction.
 */

import type { ExtractionMethod, SourceRef } from "../sref/types.js";
import { EXTRACTOR_ID, EXTRACTOR_VERSION } from "../snapshot/types.js";

export function sourceRefRecord(
  sourceSha: string,
  options: {
    path_or_uri: string;
    symbol?: string;
    section?: string;
    extraction_method: ExtractionMethod;
    source_kind?: SourceRef["source_kind"];
  },
): SourceRef {
  return {
    source_ref_version: "SREF-1",
    repo: "jnhu76/exam",
    git_sha: sourceSha,
    source_kind: options.source_kind ?? "REPO_SYMBOL",
    path_or_uri: options.path_or_uri,
    ...(options.symbol !== undefined ? { symbol: options.symbol } : {}),
    ...(options.section !== undefined ? { section: options.section } : {}),
    extractor: { id: EXTRACTOR_ID, version: EXTRACTOR_VERSION },
    extraction_method: options.extraction_method,
    resolution_state: "RESOLVED",
    repo_freshness: "CURRENT",
    sensitivity: "NONE",
  };
}
