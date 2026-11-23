import {
  STANDARD_PRODUCT_CONFIGURATION,
  resolveDeploymentProductConfiguration,
} from "@exam/domain";

/**
 * Canonical server composition root (#678 / ADR-022).
 *
 * One validated instance for the entire process. The Phase 2 authoritative
 * write guards consume it per call through `getResolvedProductConfiguration`;
 * there is no deployment override, no runtime configuration write path and
 * no second capability definition (Phase 4 introduces persisted
 * configuration management).
 *
 * The module-level resolution is the startup fail-closed gate: importing this
 * module (the public-config route does) validates the catalog before the
 * process can serve requests. There is no runtime branch on the preset name.
 *
 * Product availability is not actor authorization, and does not interpret
 * ExamPolicyProfile or persisted Exam/Attempt/Result facts.
 */
const resolvedProduct = resolveDeploymentProductConfiguration(
  STANDARD_PRODUCT_CONFIGURATION,
);

export function getResolvedProductConfiguration() {
  return resolvedProduct;
}

/**
 * Candidate/Admin-safe read projection, intentionally free of permissions,
 * secrets, dynamic host settings and per-Exam policy.
 *
 * Consumed by `GET /system/public-config`. `enabled` means the deployment may
 * make a NEW commitment; it says nothing about the current actor, exam policy,
 * attempt state, or existing obligations (pending manual grading, recovery,
 * incidents, historical Rich content). `revision` is a catalog/format
 * revision, not a CAS token.
 */
export function getProductCapabilityProjection() {
  return {
    revision: resolvedProduct.revision,
    presentation: resolvedProduct.presentation,
    enabled: [...resolvedProduct.enabled],
  };
}
