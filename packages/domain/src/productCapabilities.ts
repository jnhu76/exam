/**
 * #678 / ADR-022 Phase 1: the CLOSED catalog of capabilities supported by
 * today's Standard deployment. This is product availability, not actor RBAC.
 *
 * A capability in this list is not a new QuestionType, an ExamPolicyProfile,
 * or permission to act on a resource. Unknown/future capability names do not
 * become supported merely because they appear in a proposal.
 */
export const SUPPORTED_PRODUCT_CAPABILITIES = Object.freeze([
  "question.single_choice",
  "question.multiple_choice",
  "question.true_false",
  "question.fill_blank",
  "question.text_response",
  "content.prompt.rich",
  "content.option.rich",
  "answer.text.rich",
  "grading.manual",
  "admission.account",
  "admission.queue",
  "result.publication",
  "operator.monitoring",
] as const);

export type ProductCapabilityId =
  (typeof SUPPORTED_PRODUCT_CAPABILITIES)[number];

/**
 * Phase 1 shipped the Standard configuration; Phase 2 adds BOUNDED subsets
 * of it (ADR-022 authoritative write guards). The preset vocabulary stays
 * the `standard` literal — a subset of Standard expresses disabled
 * capabilities without introducing a `Minimal` runtime preset, which remains
 * an ACCEPTED design awaiting Phase 3's UI/obligation proof.
 *
 * Every field is a closed literal so an internal TypeScript caller cannot
 * construct a configuration the resolver would reject. External input stays
 * `unknown` at the resolver boundary because JSON/config/deployment sources
 * are not type-checked.
 */
export type DeploymentProductConfiguration = Readonly<{
  preset: "standard";
  revision: 1;
  presentation: "standard";
  enabled: readonly ProductCapabilityId[];
}>;

export interface ResolvedProductConfiguration {
  /**
   * Catalog/configuration FORMAT revision for the Phase 1 static Standard
   * configuration. It is NOT a deployment-configuration state revision and
   * MUST NOT be used as an optimistic-concurrency token; Phase 4 introduces
   * transactional revisions when persisted configuration writes exist.
   */
  readonly revision: 1;
  readonly presentation: "standard";
  readonly enabled: readonly ProductCapabilityId[];
  /**
   * Product availability only: may this deployment make a NEW product
   * commitment? `true` does NOT mean the actor has Permission, the current
   * exam enabled the capability (for example `admission.queue` still depends
   * on the frozen per-exam `requireQueue` policy), or an existing obligation
   * (pending manual grading, historical Rich content, recovery/incident
   * work) is present. Callers MUST still resolve actor scope, policy and
   * lifecycle facts through their existing authorities.
   */
  allows(capability: ProductCapabilityId): boolean;
}

export const STANDARD_PRODUCT_CONFIGURATION = Object.freeze({
  preset: "standard",
  revision: 1,
  presentation: "standard",
  enabled: SUPPORTED_PRODUCT_CAPABILITIES,
} as const satisfies DeploymentProductConfiguration);

const supported = new Set<string>(SUPPORTED_PRODUCT_CAPABILITIES);
const configFields = new Set(["preset", "revision", "presentation", "enabled"]);

/**
 * Pure, deterministic, fail-closed resolver (ADR-022 Phase 2). Accepts the
 * full Standard catalog or any guarded subset of it. `enabled` lists the
 * capabilities this deployment may make NEW commitments with; every omitted
 * catalog capability is disabled at the authoritative write boundaries.
 * Fail-closed invariants are unchanged: unknown/future names, duplicates and
 * structural violations never resolve. In-catalog dependency: subjective
 * questions cannot be enabled without their manual completion path. No DB
 * state, environment variables, permissions or UI flags enter here.
 */
export function resolveDeploymentProductConfiguration(
  input: unknown,
): ResolvedProductConfiguration {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid deployment product configuration");
  }
  const raw = input as Record<string, unknown>;
  const fields = Object.keys(raw);
  if (
    fields.length !== configFields.size ||
    fields.some((field) => !configFields.has(field))
  ) {
    throw new Error("Unknown or missing product configuration field");
  }
  if (
    raw.preset !== "standard" ||
    raw.revision !== 1 ||
    raw.presentation !== "standard"
  ) {
    throw new Error("Product preset, revision or presentation not supported");
  }
  if (!Array.isArray(raw.enabled)) {
    throw new Error("Product capability list must be an array");
  }

  const seen = new Set<string>();
  for (const value of raw.enabled) {
    if (typeof value !== "string" || !supported.has(value)) {
      throw new Error("Unknown or future product capability");
    }
    if (seen.has(value)) {
      throw new Error("Duplicate product capability");
    }
    seen.add(value);
  }
  if (seen.has("question.text_response") && !seen.has("grading.manual")) {
    // product-capability-composition.md §5: 不能开启主观题却关闭其
    // completion path. The message names the missing dependency so a broken
    // deployment fails with an actionable cause.
    throw new Error(
      "question.text_response requires grading.manual (a deployment cannot enable subjective questions without their manual completion path)",
    );
  }

  // Stable catalog-order projection of the VALIDATED subset, independent of
  // caller ordering; a disabled capability must never appear as effective.
  // No exposed mutable set, and no runtime branch on the preset name after
  // resolution.
  const enabled = Object.freeze(
    SUPPORTED_PRODUCT_CAPABILITIES.filter((capability) => seen.has(capability)),
  );
  const allowed = new Set<string>(enabled);
  return Object.freeze({
    revision: 1 as const,
    presentation: "standard" as const,
    enabled,
    allows(capability: ProductCapabilityId): boolean {
      return allowed.has(capability);
    },
  });
}
