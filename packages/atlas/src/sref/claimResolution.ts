/**
 * Claim-level resolution / freshness / eligibility derivation.
 *
 * - `resolution` (semantic-contract §8.6) is DERIVED from the per-ref
 *   resolution_state values with the frozen precedence
 *   CONFLICT > MISSING_REF > AMBIGUOUS > STALE_REF > UNKNOWN > RESOLVED
 *   (ATLAS-SEM-075), and names the causing refs.
 * - `current_support_usable` (provenance §7.3, ATLAS-SREF-034) is a separate
 *   eligibility verdict: it NEVER overwrites resolution or freshness, and
 *   `min(resolution, freshness)`-style combinations are non-conformant.
 * - `freshness` is the per-claim roll of the freshness dimension only.
 */

import {
  usableAsCurrentEvidence,
  type FreshnessState,
  type SourceRef,
} from "./types.js";
import { locatorKey } from "../ir/records.js";
import type { ClaimResolution } from "../ir/types.js";

export interface ClaimDerivation {
  resolution: ClaimResolution;
  resolution_causes: string[];
  freshness: FreshnessState;
  current_support_usable: { usable: "YES" | "NO"; non_usable_refs: string[] };
}

const PRECEDENCE: Record<Exclude<ClaimResolution, "RESOLVED">, number> = {
  CONFLICT: 5,
  MISSING_REF: 4,
  AMBIGUOUS: 3,
  STALE_REF: 2,
  UNKNOWN: 1,
};

function fromRefState(state: SourceRef["resolution_state"]): ClaimResolution {
  switch (state) {
    case "RESOLVED":
    case "HISTORICAL":
      return "RESOLVED";
    case "STALE":
      return "STALE_REF";
    case "MISSING":
      return "MISSING_REF";
    case "AMBIGUOUS":
      return "AMBIGUOUS";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

/** Derive a claim's resolution/freshness/eligibility from its cited refs. */
export function deriveClaimResolution(refs: SourceRef[]): ClaimDerivation {
  if (refs.length === 0) {
    return {
      resolution: "UNKNOWN",
      resolution_causes: [],
      freshness: "UNKNOWN",
      current_support_usable: { usable: "NO", non_usable_refs: [] },
    };
  }

  const causes = new Map<ClaimResolution, string[]>();
  const nonUsable: string[] = [];
  let anyStale = false;
  let anyUnknownFreshness = false;

  for (const ref of refs) {
    const derived = fromRefState(ref.resolution_state);
    const key = locatorKey(ref);
    if (derived !== "RESOLVED") {
      const list = causes.get(derived) ?? [];
      list.push(key);
      causes.set(derived, list);
    }
    const freshness: FreshnessState =
      ref.source_kind === "GITHUB_ISSUE" || ref.source_kind === "GITHUB_PR"
        ? (ref.external_freshness ?? "UNKNOWN")
        : (ref.repo_freshness ?? "UNKNOWN");
    if (freshness === "STALE") anyStale = true;
    if (freshness === "UNKNOWN") anyUnknownFreshness = true;
    if (!usableAsCurrentEvidence(ref)) {
      nonUsable.push(key);
    }
  }

  let resolution: ClaimResolution = "RESOLVED";
  for (const candidate of Object.keys(PRECEDENCE) as Array<
    Exclude<ClaimResolution, "RESOLVED">
  >) {
    if (causes.has(candidate)) {
      resolution = candidate;
      break;
    }
  }

  const freshness: FreshnessState = anyStale
    ? "STALE"
    : anyUnknownFreshness
      ? "UNKNOWN"
      : "CURRENT";

  return {
    resolution,
    resolution_causes: [...(causes.get(resolution) ?? [])].sort(),
    freshness,
    current_support_usable: {
      usable: nonUsable.length === 0 ? "YES" : "NO",
      non_usable_refs: [...nonUsable].sort(),
    },
  };
}
