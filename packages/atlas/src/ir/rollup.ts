/**
 * ATLAS-IR-032 — `support_summary` roll-up, implemented exactly as frozen.
 *
 * The roll-up is a total function over a capability's own CAPABILITY_SUPPORT
 * claims and its facets' claims. A part is **qualifying** at a given boundary
 * when it has a CAPABILITY_SUPPORT claim whose `verification = PASS` at that
 * boundary with adequate evidence; a part with no such claim is never counted
 * as supported. Clause 0 (the coverage gate) precedes every other clause: an
 * incompletely-mapped capability yields no aggregate verdict at all, and an
 * UNMAPPED capability is never NOT_SUPPORTED (ATLAS-SEM-102).
 *
 * B0..B6 are opaque boundary identifiers: adequacy is `boundary_coverage`
 * membership, never numeric comparison of B-values (ATLAS-SEM-083).
 */

import type {
  ActivationSupport,
  Boundary,
  MappingState,
  SupportSummary,
} from "./types.js";

/** One roll-up part: the capability itself or one facet. */
export interface RollupPart {
  partId: string;
  /** The part's CAPABILITY_SUPPORT claim, when it has one. */
  support?:
    | {
        activation_support: ActivationSupport;
        verification: string;
        boundary?: Boundary | undefined;
        /** True when ≥1 supporting evidence's boundary_coverage includes the
         * claim's declared boundary (ATLAS-SEM-083 membership). */
        evidenceAdequateForDeclaredBoundary: boolean;
      }
    | undefined;
  /** design ∈ {ACCEPTED, PROPOSED} — accepted (or owner-proposed) intent. */
  hasAcceptedDesign: boolean;
  /** A work item owning the future (DEFERRED carrier). */
  owningWorkItem?: string | undefined;
  /** A named activation decision gate (GATED carrier). */
  decisionGate?: { locator: string; lift_condition: string } | undefined;
}

export interface RollupResult {
  summary: SupportSummary;
  /** Which clause produced the value, and what it names (GATED/DEFERRED). */
  clause: 0 | 1 | 2 | 3 | 4 | 5;
  basis?: string;
}

function isQualifyingAt(part: RollupPart, boundary: Boundary): boolean {
  const support = part.support;
  if (!support) return false;
  return (
    support.activation_support === "SUPPORTED" &&
    support.verification === "PASS" &&
    support.boundary === boundary &&
    support.evidenceAdequateForDeclaredBoundary
  );
}

function isSupportingAtAnyBoundary(
  part: RollupPart,
  boundaries: readonly Boundary[],
): boolean {
  return boundaries.some((b) => isQualifyingAt(part, b));
}

export function rollupSupport(input: {
  mapping_state: MappingState;
  parts: RollupPart[];
  support_boundary: Boundary;
  /** A closed-search statement records that no known non-supported part is
   * unmapped — clause 2's third conjunct. */
  closedSearchStatement: boolean;
  /** Positive negative evidence covering the capability at support_boundary
   * (ATLAS-SEM-084) — clause 4's requirement. */
  positiveNegativeEvidenceAtBoundary: boolean;
}): RollupResult {
  const { mapping_state, parts, support_boundary, closedSearchStatement } =
    input;
  const allBoundaries: Boundary[] = ["B0", "B1", "B2", "B3", "B4", "B5", "B6"];

  // Clause 0 — unresolved precedence over every other clause.
  if (
    mapping_state !== "MAPPED" ||
    parts.some((p) => p.support?.activation_support === "UNKNOWN") ||
    parts.some(
      (p) =>
        p.support !== undefined &&
        !p.support.evidenceAdequateForDeclaredBoundary,
    )
  ) {
    return { summary: "UNKNOWN", clause: 0 };
  }

  const qualifyingAtBoundary = parts.filter((p) =>
    isQualifyingAt(p, support_boundary),
  );
  const nonQualifyingAtBoundary = parts.filter(
    (p) => !isQualifyingAt(p, support_boundary),
  );

  // Clause 1 — MIXED must be rendered, never flattened (ATLAS-IR-033).
  if (qualifyingAtBoundary.length >= 1 && nonQualifyingAtBoundary.length >= 1) {
    return { summary: "MIXED", clause: 1 };
  }

  // Clause 2 — the only path to SUPPORTED; deliberately hard.
  if (
    parts.length >= 1 &&
    nonQualifyingAtBoundary.length === 0 &&
    closedSearchStatement
  ) {
    return { summary: "SUPPORTED", clause: 2 };
  }

  const anySupporting = parts.some((p) =>
    isSupportingAtAnyBoundary(p, allBoundaries),
  );

  // Clause 3 — GATED | DEFERRED from the strongest such part, naming it.
  if (!anySupporting) {
    const ownedParts = parts.filter(
      (p) =>
        p.hasAcceptedDesign &&
        (p.owningWorkItem !== undefined || p.decisionGate !== undefined),
    );
    if (ownedParts.length >= 1) {
      const gated = ownedParts.find((p) => p.decisionGate !== undefined);
      if (gated?.decisionGate) {
        return {
          summary: "GATED",
          clause: 3,
          basis: `gate ${gated.decisionGate.locator} on part ${gated.partId}; lift: ${gated.decisionGate.lift_condition}`,
        };
      }
      const deferred = ownedParts.find((p) => p.owningWorkItem !== undefined);
      return {
        summary: "DEFERRED",
        clause: 3,
        basis: `design accepted; owned by ${deferred?.owningWorkItem} on part ${deferred?.partId}`,
      };
    }

    // Clause 4 — NOT_SUPPORTED requires positive negative evidence.
    if (input.positiveNegativeEvidenceAtBoundary) {
      return { summary: "NOT_SUPPORTED", clause: 4 };
    }
  }

  // Clause 5.
  return { summary: "UNKNOWN", clause: 5 };
}
