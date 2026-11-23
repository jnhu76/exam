import {
  MINIMAL_PRODUCT_CONFIGURATION,
  STANDARD_PRODUCT_CONFIGURATION,
  resolveDeploymentProductConfiguration,
  type DeploymentProductConfiguration,
  type ProductPreset,
  type ResolvedProductConfiguration,
} from "@exam/domain";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * Canonical server composition root (#678 / ADR-022).
 *
 * One validated instance for the entire process, resolved by the ONE domain
 * resolver from the deployment's STATIC bootstrap preset (`PRODUCT_PRESET`,
 * ADR-022 Phase 3; product-capability-composition.md §8: configuration is
 * read at bootstrap only until Phase 4 introduces persisted configuration).
 * The Phase 2 authoritative write guards consume it per call through
 * `getResolvedProductConfiguration`; there is no runtime configuration write
 * path and no second capability definition.
 *
 * The FIRST accessor is the startup fail-closed gate: `server.ts` resolves
 * (and runs the deployment-switch preflight) before listening, so an
 * unsupported deployment configuration fails startup instead of serving.
 * There is no runtime branch on the preset name — consumers read
 * `allows()` and the projection, never the preset name (§6).
 *
 * Product availability is not actor authorization, and does not interpret
 * ExamPolicyProfile or persisted Exam/Attempt/Result facts.
 */

// Total over the settings-validated preset vocabulary; the resolver still
// judges the full configuration, so this mapping never becomes a second
// validation authority.
const CONFIGURATION_BY_PRESET: Record<
  ProductPreset,
  DeploymentProductConfiguration
> = {
  standard: STANDARD_PRODUCT_CONFIGURATION,
  minimal: MINIMAL_PRODUCT_CONFIGURATION,
};

let resolvedProduct: ResolvedProductConfiguration | undefined;

function resolveOnce(): ResolvedProductConfiguration {
  if (resolvedProduct === undefined) {
    resolvedProduct = resolveDeploymentProductConfiguration(
      CONFIGURATION_BY_PRESET[getRuntimeConfig().product.preset],
    );
  }
  return resolvedProduct;
}

export function getResolvedProductConfiguration(): ResolvedProductConfiguration {
  return resolveOnce();
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
  const resolved = resolveOnce();
  return {
    revision: resolved.revision,
    presentation: resolved.presentation,
    enabled: [...resolved.enabled],
  };
}

/**
 * Test seam (mirrors `resetRuntimeConfigForTest`): drops the memoized
 * instance so the next accessor re-resolves from the current environment.
 * Never called by production code paths.
 */
export function resetResolvedProductConfigurationForTest(): void {
  resolvedProduct = undefined;
}
