import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MINIMAL_PRODUCT_CONFIGURATION,
  STANDARD_PRODUCT_CONFIGURATION,
  SUPPORTED_PRODUCT_CAPABILITIES,
  resolveDeploymentProductConfiguration,
} from "@exam/domain";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  getProductCapabilityProjection,
  getResolvedProductConfiguration,
  resetResolvedProductConfigurationForTest,
} from "./compositionRoot.js";

/**
 * W3.1 counterexamples (ADR-022 Phase 3 #678): the deployment's STATIC
 * product ceiling is selected at bootstrap (product-capability-composition.md
 * §8: configuration read at bootstrap + startup preflight; Phase 4 introduces
 * persistence) and resolved by the ONE canonical resolver through the ONE
 * composition root. The carrier is the `PRODUCT_PRESET` settings leaf
 * (configuration-authority.md §9: deployment-level fact owned by
 * settings/runtimeConfig, consumed by the composition root — no second
 * resolution point in server.ts, routes or guards).
 *
 * The controlled seam mirrors the existing `resetRuntimeConfigForTest`
 * precedent: tests mutate the process env leaf and reset both resolution
 * caches; production resolution stays untouched (the unset leaf resolves
 * Standard — behavior-equivalent to today).
 */
describe("static deployment ceiling source (#678 W3.1)", () => {
  const ORIGINAL = process.env.PRODUCT_PRESET;

  function useDeploymentPreset(preset: string | undefined): void {
    if (preset === undefined) {
      delete process.env.PRODUCT_PRESET;
    } else {
      process.env.PRODUCT_PRESET = preset;
    }
    resetRuntimeConfigForTest();
    resetResolvedProductConfigurationForTest();
  }

  beforeAll(() => {
    useDeploymentPreset(undefined);
  });

  afterAll(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PRODUCT_PRESET;
    } else {
      process.env.PRODUCT_PRESET = ORIGINAL;
    }
    resetRuntimeConfigForTest();
    resetResolvedProductConfigurationForTest();
  });

  /**
   * Same-resolver equivalence: the composition root's instance must be
   * behaviorally identical to a fresh resolution of the same source through
   * the canonical domain resolver. `allows` is a per-resolution closure, so
   * equivalence is asserted over the data projection plus allows() verdicts
   * across the whole catalog — never by object identity of two closures.
   */
  function expectSameResolution(
    resolved: ReturnType<typeof getResolvedProductConfiguration>,
    source:
      | typeof STANDARD_PRODUCT_CONFIGURATION
      | typeof MINIMAL_PRODUCT_CONFIGURATION,
  ): void {
    const fresh = resolveDeploymentProductConfiguration(source);
    expect(resolved.revision).toBe(fresh.revision);
    expect(resolved.presentation).toBe(fresh.presentation);
    expect(resolved.enabled).toEqual(fresh.enabled);
    for (const capability of SUPPORTED_PRODUCT_CAPABILITIES) {
      expect(resolved.allows(capability)).toBe(fresh.allows(capability));
    }
  }

  it("resolves Standard when no deployment preset is set (behavior equivalence)", () => {
    const resolved = getResolvedProductConfiguration();
    expect(resolved.presentation).toBe("standard");
    expect(resolved.enabled).toEqual(SUPPORTED_PRODUCT_CAPABILITIES);
    // Same-instance: the composition root resolves ONCE per process; every
    // consumer (write guards, public-config, switch preflight) reads the
    // identical instance.
    expect(getResolvedProductConfiguration()).toBe(resolved);
    // Same-resolver equivalence: the composition root's instance is exactly
    // what the canonical domain resolver produces for the same source.
    expectSameResolution(resolved, STANDARD_PRODUCT_CONFIGURATION);
  });

  it("resolves Minimal through the same resolver and projection when PRODUCT_PRESET=minimal", () => {
    useDeploymentPreset("minimal");

    const resolved = getResolvedProductConfiguration();
    expect(resolved.presentation).toBe("minimal");
    expect(resolved.enabled).toEqual(MINIMAL_PRODUCT_CONFIGURATION.enabled);
    expect(getResolvedProductConfiguration()).toBe(resolved);
    expectSameResolution(resolved, MINIMAL_PRODUCT_CONFIGURATION);

    // The candidate/admin-safe read projection follows the deployment
    // ceiling (GET /system/public-config consumes this).
    expect(getProductCapabilityProjection()).toEqual({
      revision: 1,
      presentation: "minimal",
      enabled: [...MINIMAL_PRODUCT_CONFIGURATION.enabled],
    });
  });

  it("fails with a clear error naming the unsupported deployment preset", () => {
    useDeploymentPreset("bogus");
    // product-capability-composition.md §6: unknown/unsupported configuration
    // must fail closed with an actionable cause — the invalid value AND the
    // supported vocabulary, not a silent Standard fallback.
    expect(() => getResolvedProductConfiguration()).toThrow(/bogus/);
    expect(() => getResolvedProductConfiguration()).toThrow(
      /standard.*minimal|minimal.*standard/s,
    );
  });

  it("never mutates the domain preset defaults", () => {
    useDeploymentPreset("minimal");
    getResolvedProductConfiguration();
    expect(STANDARD_PRODUCT_CONFIGURATION.enabled).toEqual(
      SUPPORTED_PRODUCT_CAPABILITIES,
    );
    expect(MINIMAL_PRODUCT_CONFIGURATION.preset).toBe("minimal");
    expect(Object.isFrozen(MINIMAL_PRODUCT_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(MINIMAL_PRODUCT_CONFIGURATION.enabled)).toBe(true);
  });
});
